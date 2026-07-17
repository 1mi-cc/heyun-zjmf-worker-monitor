Exit code: 0
Wall time: 0.4 seconds
Output:
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

function boolValue(value) {
  return ['1', 'true', 'on', 'yes'].includes(String(value ?? '').trim().toLowerCase());
}

function boolValueWithDefault(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return boolValue(value);
}

function visibleOnStatus(server) {
  return boolValueWithDefault(server?.visible_on_status, true);
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function matchesAdminToken(token, env, repo) {
  if (!token) return false;
  const currentHash = await repo.getSetting('admin_token_hash', '');
  if (currentHash) return await sha256Hex(token) === currentHash;
  const bootstrapToken = env.ADMIN_TOKEN || 'admin';
  return token === bootstrapToken;
}

async function isAuthorized(request, env, repo) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  return await matchesAdminToken(token, env, repo);
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
  return isIpAddress(server.name) || isIpAddress(server.ip) ? `鏈嶅姟鍣?#${server.id}` : server.name;
}

function publicServer(server) {
  const { ip: _ip, http_url: _httpUrl, tcp_host: _tcpHost, visible_on_status: _visible, ...rest } = server;
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
  return isIpAddress(name) || !name ? `鏈嶅姟鍣?#${id}` : String(name);
}

function hostIpAddress(host) {
  const candidates = [
    host.ip, host.main_ip, host.server_ip, host.dedicatedip, host.dedicated_ip,
    host.ipaddress, host.ip_address, host.public_ip, host.ipv4, host.address,
    host.hostname, host.domain,
  ];
  const value = candidates.find((item) => isIpAddress(item));
  return value ? String(value) : '';
}

function normalizeRepo(value) {
  const text = String(value || '').trim().replace(/\.git$/i, '');
  const match = text.match(/github\.com[:/](.+\/.+)$/i);
  return (match ? match[1] : text).replace(/^\/+|\/+$/g, '');
}

function githubHeaders(token) {
  const headers = {
    accept: 'application/vnd.github+json',
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'zjmf-monitor-worker',
    'x-github-api-version': '2022-11-28',
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function githubErrorDetail(res) {
  try {
    const data = await res.clone().json();
    return {
      github_message: String(data?.message || '').slice(0, 500),
      documentation_url: String(data?.documentation_url || ''),
    };
  } catch {
    try {
      const text = String(await res.clone().text()).trim();
      return { github_message: text.slice(0, 500) };
    } catch {
      return {};
    }
  }
}

async function githubUpdateConfig(repo, env) {
  const githubRepo = normalizeRepo(await repo.getSetting('github_repo', env.GITHUB_REPOSITORY || env.GITHUB_REPO || ''));
  return {
    repo: githubRepo,
    branch: await repo.getSetting('github_branch', env.GITHUB_BRANCH || env.GITHUB_REF_NAME || 'main'),
    workflow: await repo.getSetting('github_workflow_file', env.GITHUB_WORKFLOW_FILE || 'deploy.yml'),
    currentSha: String(env.APP_VERSION || env.WORKER_VERSION || '').trim(),
    token: env.GITHUB_TOKEN || env.WEB_UPDATE_GITHUB_TOKEN || '',
    fetcher: env.fetcher || ((input, init) => fetch(input, init)),
  };
}

async function dayOrdinal(cfg, dateStr, sha) {
  if (!dateStr || !sha) return { ordinal: 0, total: 0 };
  const dt = new Date(dateStr);
  if (isNaN(dt.getTime())) return { ordinal: 0, total: 0 };
  const day = new Date(dt.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const since = `${day}T00:00:00+08:00`;
  const until = `${day}T23:59:59+08:00`;
  const url = `https://api.github.com/repos/${cfg.repo}/commits?sha=${encodeURIComponent(cfg.branch)}&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`;
  try {
    const res = await cfg.fetcher(url, { headers: githubHeaders(cfg.token) });
    if (!res.ok) return { ordinal: 0, total: 0 };
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return { ordinal: 0, total: 0 };
    const idx = list.findIndex(c => {
      const cSha = String(c.sha || '');
      return cSha.startsWith(sha) || (sha && sha.startsWith(cSha));
    });
    if (idx < 0) return { ordinal: 0, total: list.length };
    return { ordinal: list.length - idx, total: list.length };
  } catch {
    return { ordinal: 0, total: 0 };
  }
}

function githubActionsUrl(repo, workflow) {
  return `https://github.com/${repo}/actions/workflows/${encodeURIComponent(workflow)}`;
}

function adminHost(host) {
  const id = host.id ?? host.hostid ?? host.product_id ?? host.uid ?? '';
  const ip = hostIpAddress(host);
  const tcpPort = host.tcp_port || host.port || host.service_port || host.listen_port || '';
  return {
    id: String(id),
    name: hostDisplayName(host),
    status: host.status || host.state || host.power_status || '',
    ip: ip ? String(ip) : '',
    tcp_host: ip ? String(ip) : '',
    tcp_port: tcpPort ? Number(tcpPort) : '',
  };
}

async function publicStatus(repo) {
  const servers = (await repo.listStatus()).filter(visibleOnStatus).map(publicServer);
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
    return new Response(renderStatusPage(await publicStatus(repo), await repo.getSettings()), {
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
      settings: {
        ...settings,
        pushplus_token: settings.pushplus_token ? '宸查厤缃? : '',
        notify_token: settings.notify_token || settings.pushplus_token ? '宸查厤缃? : '',
        notify_secret: settings.notify_secret ? '宸查厤缃? : '',
      },
      providers: await repo.listProviders(),
      servers: adminServers(await repo.listServers(), status),
      status,
      events: await repo.listEvents(50),
    });
  }

  if (url.pathname === '/api/admin/password' && request.method === 'POST') {
    const body = await readJson(request);
    const oldPassword = String(body?.old_password || '').trim();
    const password = String(body?.password || '').trim();
    if (!(await matchesAdminToken(oldPassword, env, repo))) return json({ error: 'INVALID_OLD_PASSWORD' }, 400);
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
    return json({ hosts: hosts.map(adminHost).filter((host) => host.id) });
  }

  if (url.pathname === '/api/admin/events' && request.method === 'GET') {
    return json({ events: await repo.listEvents(100) });
  }

  if (url.pathname === '/api/admin/run' && request.method === 'POST') {
    const now = Math.floor(Date.now() / 1000);
    return json(await runMonitorOnce({ repo, fetcher: (input, init) => fetch(input, init), now, force: true }));
  }

  if (url.pathname === '/api/admin/setup/reset' && request.method === 'POST') {
    await repo.resetTutorialData();
    return json({ ok: true });
  }

  if (url.pathname === '/api/admin/notify/test' && request.method === 'POST') {
    const notifier = new Notifier(await repo.getSettings(), (input, init) => fetch(input, init));
    const result = await notifier.send('ZJMF 娴嬭瘯閫氱煡', '杩欐槸涓€鏉℃潵鑷鐞嗗悗鍙扮殑娴嬭瘯閫氱煡銆?, 'info');
    return json(result, result.ok ? 200 : 502);
  }

  if (url.pathname === '/api/admin/update/check' && request.method === 'GET') {
    const cfg = await githubUpdateConfig(repo, env);
    if (!cfg.repo) return json({ ok: true, configured: false, message: '鏈厤缃?GitHub 浠撳簱' });
    const latestUrl = `https://api.github.com/repos/${cfg.repo}/commits/${encodeURIComponent(cfg.branch)}`;
    const res = await cfg.fetcher(latestUrl, { headers: githubHeaders(cfg.token) });
    if (!res.ok) {
      const detail = await githubErrorDetail(res);
      return json({
        ok: false,
        configured: true,
        error: 'GITHUB_CHECK_FAILED',
        status: res.status,
        repo: cfg.repo,
        branch: cfg.branch,
        workflow: cfg.workflow,
        actions_url: githubActionsUrl(cfg.repo, cfg.workflow),
        ...detail,
      }, 502);
    }
    const data = await res.json();
    const latestSha = String(data.sha || '').trim();
    const latestDate = String(data.commit?.committer?.date || data.commit?.author?.date || '');
    const currentSha = cfg.currentSha;
    let currentDate = '';
    if (currentSha) {
      try {
        const cur = await cfg.fetcher(`https://api.github.com/repos/${cfg.repo}/commits/${encodeURIComponent(currentSha)}`, { headers: githubHeaders(cfg.token) });
        if (cur.ok) {
          const curData = await cur.json();
          currentDate = String(curData.commit?.committer?.date || curData.commit?.author?.date || '');
        }
      } catch {}
    }
    const latestOrd = await dayOrdinal(cfg, latestDate, latestSha);
    const currentOrd = currentSha && currentDate ? await dayOrdinal(cfg, currentDate, currentSha) : { ordinal: 0, total: 0 };
    const updateAvailable = currentSha && latestSha ? !latestSha.startsWith(currentSha) && !currentSha.startsWith(latestSha) : null;
    return json({
      ok: true,
      configured: true,
      repo: cfg.repo,
      branch: cfg.branch,
      workflow: cfg.workflow,
      current_sha: currentSha,
      current_date: currentDate,
      current_ordinal: currentOrd.ordinal,
      current_day_total: currentOrd.total,
      latest_sha: latestSha,
      latest_date: latestDate,
      latest_ordinal: latestOrd.ordinal,
      latest_day_total: latestOrd.total,
      latest_message: String(data.commit?.message || '').split('\n')[0],
      update_available: updateAvailable,
      actions_url: githubActionsUrl(cfg.repo, cfg.workflow),
    });
  }

  if (url.pathname === '/api/admin/update/dispatch' && request.method === 'POST') {
    const cfg = await githubUpdateConfig(repo, env);
    if (!cfg.repo) return json({ error: 'GITHUB_REPO_NOT_CONFIGURED' }, 400);
    if (!cfg.token) return json({ error: 'GITHUB_TOKEN_NOT_CONFIGURED' }, 400);
    const workflow = encodeURIComponent(cfg.workflow);
    const endpoint = `https://api.github.com/repos/${cfg.repo}/actions/workflows/${workflow}/dispatches`;
    const res = await cfg.fetcher(endpoint, {
      method: 'POST',
      headers: githubHeaders(cfg.token),
      body: JSON.stringify({ ref: cfg.branch }),
    });
    if (!res.ok) return json({ error: 'GITHUB_DISPATCH_FAILED', status: res.status }, 502);
    return json({ ok: true, repo: cfg.repo, branch: cfg.branch, workflow: cfg.workflow, actions_url: githubActionsUrl(cfg.repo, cfg.workflow) });
  }

  if (url.pathname === '/api/admin/setup' && request.method === 'POST') {
    const body = await readJson(request);
    const provider = body?.provider || {};
    const server = body?.server || {};
    const batchMode = Array.isArray(body?.providers) || Array.isArray(body?.servers);
    const providers = batchMode ? (Array.isArray(body.providers) ? body.providers : []) : (provider.api_base_url || provider.api_account || provider.api_password || provider.name ? [provider] : []);
    const servers = batchMode ? (Array.isArray(body.servers) ? body.servers : []) : (server.id || server.name || server.provider || server.http_url || server.tcp_host ? [server] : []);
    const missing = [];
    const providerNames = new Set(providers.map((item) => item.name).filter(Boolean));
    providers.forEach((item, index) => {
      const prefix = batchMode ? `providers.${index}` : 'provider';
      if (batchMode && !item.name) missing.push(`${prefix}.name`);
      if (!item.api_base_url) missing.push(`${prefix}.api_base_url`);
      if (!item.api_account) missing.push(`${prefix}.api_account`);
      if (!item.api_password) missing.push(`${prefix}.api_password`);
    });
    servers.forEach((item, index) => {
      const prefix = batchMode ? `servers.${index}` : 'server';
      if (!item.id) missing.push(`${prefix}.id`);
      if (batchMode && !item.provider) missing.push(`${prefix}.provider`);
      if (batchMode && item.provider && !providerNames.has(item.provider)) missing.push(`${prefix}.provider`);
    });
    if (missing.length) {
      return json({ error: 'INVALID_SETUP', message: '鍒濆鍖栦俊鎭笉瀹屾暣', missing }, 400);
    }
    const now = Math.floor(Date.now() / 1000);
    const firstProvider = providers[0] || provider;
    const firstServer = servers[0] || server;
    for (const item of providers) {
      await repo.upsertProvider({ ...item, name: item.name || firstProvider.name || 'heyunidc', display_name: item.display_name || '鏍镐簯' }, now);
    }
    for (const item of servers) {
      await repo.upsertServer({
        ...item,
        name: item.name || `鏈嶅姟鍣?#${item.id}`,
        provider: item.provider || firstProvider.name || 'heyunidc',
        check_method: item.check_method || 'service_then_power',
        visible_on_status: boolValueWithDefault(item.visible_on_status, true),
        enabled: true,
        daily_reboot_limit: Number(item.daily_reboot_limit || 3),
        probe_timeout_ms: Number(item.probe_timeout_ms || body.settings?.api_timeout_ms || 10000),
      }, now);
    }
    await repo.setSetting('check_interval', Number(body.settings?.check_interval || 300));
    await repo.setSetting('api_timeout', Math.max(1, Math.ceil(Number(body.settings?.api_timeout_ms || 60000) / 1000)));
    await repo.setSetting('default_daily_reboot_limit', Number(body.settings?.default_daily_reboot_limit || firstServer.daily_reboot_limit || 3));
    await repo.setSetting('reboot_limit_window', body.settings?.reboot_limit_window || 'hour');
    await repo.setSetting('notify_failure_silence', boolValue(body.notification?.notify_failure_silence));
    if (body.notification?.enabled) {
      await repo.setSetting('webhook_type', body.notification.type || 'pushplus');
      await repo.setSetting('webhook_url', body.notification.webhook_url || 'https://www.pushplus.plus/send');
      await repo.setSetting('pushplus_token', body.notification.pushplus_token || '');
      await repo.setSetting('notify_token', body.notification.notify_token || body.notification.pushplus_token || '');
      await repo.setSetting('notify_target', body.notification.notify_target || '');
      await repo.setSetting('notify_secret', body.notification.notify_secret || '');
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
    if (!body?.id || !body?.name) return json({ error: 'INVALID_SERVER' }, 400);
    const existing = await repo.getServer(body.id);
    const providers = await repo.listProviders();
    const providerName = String(body?.provider || '').trim();
    const provider = providers.some((item) => item.name === providerName)
      ? providerName
      : existing?.provider && providers.some((item) => item.name === existing.provider)
        ? existing.provider
        : providers[0]?.name || '';
    if (!provider) return json({ error: 'PROVIDER_NOT_FOUND' }, 400);
    const settings = await repo.getSettings();
    const nextServer = {
      ...body,
      provider,
      ip: Object.hasOwn(body, 'ip') ? body.ip : existing?.ip || '',
      check_method: body.check_method || 'service_then_power',
      daily_reboot_limit: Object.hasOwn(body, 'daily_reboot_limit')
        ? Number(body.daily_reboot_limit || 0)
        : Number(existing?.daily_reboot_limit ?? settings.default_daily_reboot_limit ?? 3),
      visible_on_status: Object.hasOwn(body, 'visible_on_status')
        ? boolValueWithDefault(body.visible_on_status, true)
        : boolValueWithDefault(existing?.visible_on_status, true),
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
      label: '鍒犻櫎鐩戞帶椤?,
      level: 'warning',
      message: `鐩戞帶椤?${serverDisplayName(existing)} 宸蹭粠绠＄悊鍚庡彴鍒犻櫎`,
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

