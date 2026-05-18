import { runMonitorOnce } from './monitor.js';
import { D1Repository } from './repository.js';
import { Notifier } from './notifier.js';
import { renderAdminPage } from './admin-page.js';
import { renderStatusPage } from './status-page.js';
import { ZjmfClient } from './zjmf-client.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(request, env, repo) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return false;
  const currentHash = await repo.getSetting('admin_token_hash', '');
  if (currentHash) return await sha256Hex(token) === currentHash;
  const bootstrapToken = env.ADMIN_TOKEN || 'admin';
  return token === bootstrapToken;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || '').trim());
}

function serverDisplayName(server) {
  return isIpAddress(server.name) || isIpAddress(server.ip) ? `服务器 #${server.id}` : server.name;
}

function publicServer(server) {
  const { ip: _ip, http_url: _httpUrl, tcp_host: _tcpHost, ...rest } = server;
  return { ...rest, name: serverDisplayName(server) };
}

function adminServer(server) {
  const { ip: _ip, ...rest } = server;
  return { ...rest, name: serverDisplayName(server) };
}

function publicEvent(event) {
  const { id, server_id, old_state, new_state, label, level, created_at } = event;
  return { id, server_id, old_state, new_state, label, level, created_at };
}

function adminServers(servers, status) {
  const activeIds = new Set(status.map((server) => String(server.id)));
  return servers.map(adminServer).sort((a, b) => {
    const activeDiff = Number(activeIds.has(String(b.id))) - Number(activeIds.has(String(a.id)));
    if (activeDiff) return activeDiff;
    const enabledDiff = Number(b.enabled) - Number(a.enabled);
    return enabledDiff || String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
  });
}

function hostDisplayName(host) {
  const id = host.id ?? host.hostid ?? host.product_id ?? host.uid ?? '';
  const name = host.name || host.title || host.domain || host.hostname || '';
  return isIpAddress(name) || !name ? `服务器 #${id}` : String(name);
}

function publicHost(host) {
  const id = host.id ?? host.hostid ?? host.product_id ?? host.uid ?? '';
  return {
    id: String(id),
    name: hostDisplayName(host),
    status: host.status || host.state || host.power_status || '',
  };
}

async function publicStatus(repo) {
  const servers = (await repo.listStatus()).map(publicServer);
  const ids = servers.map((server) => String(server.id));
  const daily = await repo.listDailyHistory(ids);
  const events = await repo.listPublicEvents(ids);
  const recent = new Map();
  for (const server of servers) {
    recent.set(String(server.id), await repo.listRecentChecks(server.id));
  }
  return servers.map((server) => ({
    ...server,
    daily_history: daily.get(String(server.id)) || [],
    events: (events.get(String(server.id)) || []).map(publicEvent),
    recent_checks: recent.get(String(server.id)) || [],
  }));
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const repo = new D1Repository(env.DB);

  if ((url.pathname === '/' || url.pathname === '/status') && request.method === 'GET') {
    if (url.pathname === '/' && (await repo.getSetting('setup_completed', '0')) !== '1') {
      return new Response(renderAdminPage({ showIntro: true }), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    return new Response(renderStatusPage(await publicStatus(repo)), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (url.pathname === '/admin' && request.method === 'GET') {
    return new Response(renderAdminPage({ showIntro: (await repo.getSetting('setup_completed', '0')) !== '1' }), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (url.pathname === '/api/status' && request.method === 'GET') {
    return json({ servers: await publicStatus(repo) });
  }

  if (!url.pathname.startsWith('/api/admin/')) return json({ error: 'NOT_FOUND' }, 404);
  if (!(await isAuthorized(request, env, repo))) return json({ error: 'UNAUTHORIZED' }, 401);

  if (url.pathname === '/api/admin/overview' && request.method === 'GET') {
    const settings = await repo.getSettings();
    const status = (await repo.listStatus()).map(publicServer);
    return json({
      settings: { ...settings, pushplus_token: settings.pushplus_token ? '已配置' : '' },
      providers: await repo.listProviders(),
      servers: adminServers(await repo.listServers(), status),
      status,
      events: await repo.listEvents(50),
    });
  }

  if (url.pathname === '/api/admin/password' && request.method === 'POST') {
    const body = await readJson(request);
    const password = String(body?.password || '').trim();
    if (!password) return json({ error: 'INVALID_PASSWORD' }, 400);
    await repo.setSetting('admin_token_hash', await sha256Hex(password));
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/zjmf/hosts' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body?.api_base_url || !body?.api_account || !body?.api_password) {
      return json({ error: 'INVALID_PROVIDER' }, 400);
    }
    const client = new ZjmfClient({
      api_base_url: body.api_base_url,
      api_account: body.api_account,
      api_password: body.api_password,
    }, env.fetcher || ((input, init) => fetch(input, init)));
    const hosts = await client.getHosts(Math.floor(Date.now() / 1000));
    if (!hosts) return json({ error: client.lastError || 'HOSTS_FETCH_FAILED' }, 502);
    return json({ hosts: hosts.map(publicHost).filter((host) => host.id) });
  }

  if (url.pathname === '/api/admin/events' && request.method === 'GET') {
    return json({ events: await repo.listEvents(100) });
  }

  if (url.pathname === '/api/admin/run' && request.method === 'POST') {
    const now = Math.floor(Date.now() / 1000);
    return json(await runMonitorOnce({ repo, fetcher: (input, init) => fetch(input, init), now, force: true }));
  }

  if (url.pathname === '/api/admin/notify/test' && request.method === 'POST') {
    const notifier = new Notifier(await repo.getSettings(), (input, init) => fetch(input, init));
    return json(await notifier.send('ZJMF 测试通知', '这是一条来自管理后台的测试通知。', 'info'));
  }

  if (url.pathname === '/api/admin/setup' && request.method === 'POST') {
    const body = await readJson(request);
    const provider = body?.provider || {};
    const server = body?.server || {};
    if (!provider.api_base_url || !provider.api_account || !provider.api_password || !server.id) {
      return json({ error: 'INVALID_SETUP' }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    const providerName = provider.name || 'heyunidc';
    await repo.upsertProvider({ ...provider, name: providerName, display_name: provider.display_name || '核云' }, now);
    await repo.upsertServer({
      ...server,
      name: server.name || `服务器 #${server.id}`,
      provider: server.provider || providerName,
      check_method: server.check_method || 'api_only',
      enabled: true,
      daily_reboot_limit: Number(server.daily_reboot_limit || 3),
      probe_timeout_ms: Number(server.probe_timeout_ms || body.settings?.api_timeout_ms || 10000),
    }, now);
    await repo.setSetting('check_interval', Number(body.settings?.check_interval || 300));
    await repo.setSetting('api_timeout', Math.max(1, Math.ceil(Number(body.settings?.api_timeout_ms || 60000) / 1000)));
    await repo.setSetting('default_daily_reboot_limit', Number(server.daily_reboot_limit || 3));
    if (body.notification?.enabled) {
      await repo.setSetting('webhook_type', body.notification.type || 'pushplus');
      await repo.setSetting('webhook_url', body.notification.webhook_url || 'https://www.pushplus.plus/send');
      await repo.setSetting('pushplus_token', body.notification.pushplus_token || '');
    }
    await repo.setSetting('setup_completed', '1');
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/providers' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body?.name || !body?.api_base_url || !body?.api_account) {
      return json({ error: 'INVALID_PROVIDER' }, 400);
    }
    const existing = await repo.getProvider(body.name);
    const apiPassword = body.api_password || existing?.api_password || '';
    if (!apiPassword) return json({ error: 'INVALID_PROVIDER' }, 400);
    await repo.upsertProvider({ ...body, api_password: apiPassword }, Math.floor(Date.now() / 1000));
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/servers' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body?.id || !body?.name || !body?.provider) return json({ error: 'INVALID_SERVER' }, 400);
    if (!(await repo.getProvider(body.provider))) return json({ error: 'PROVIDER_NOT_FOUND' }, 400);
    const existing = await repo.getServer(body.id);
    const nextServer = {
      ...body,
      ip: Object.hasOwn(body, 'ip') ? body.ip : existing?.ip || '',
      check_method: body.check_method || 'api_only',
      scheduled_reboot: '',
    };
    await repo.upsertServer(nextServer, Math.floor(Date.now() / 1000));
    return json({ ok: true });
  }

  if (url.pathname.startsWith('/api/admin/servers/') && request.method === 'DELETE') {
    const id = decodeURIComponent(url.pathname.slice('/api/admin/servers/'.length));
    const existing = id ? await repo.getServer(id) : null;
    if (!existing) return json({ error: 'SERVER_NOT_FOUND' }, 404);
    const now = Math.floor(Date.now() / 1000);
    await repo.deleteServer(id);
    await repo.addEvent({
      server_id: id,
      old_state: 'configured',
      new_state: 'deleted',
      label: '删除监控项',
      level: 'warning',
      message: `监控项 ${serverDisplayName(existing)} 已从管理后台删除`,
      created_at: now,
    });
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/settings' && request.method === 'POST') {
    const body = await readJson(request);
    if (!body || typeof body !== 'object') return json({ error: 'INVALID_SETTINGS' }, 400);
    for (const [key, value] of Object.entries(body)) await repo.setSetting(key, value);
    return json({ ok: true });
  }

  return json({ error: 'NOT_FOUND' }, 404);
}
