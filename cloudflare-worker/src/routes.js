import { runMonitorOnce } from './monitor.js';
import { D1Repository } from './repository.js';
import { renderAdminPage } from './admin-page.js';
import { renderStatusPage } from './status-page.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function isAuthorized(request, env) {
  const token = env.ADMIN_TOKEN || '';
  const header = request.headers.get('authorization') || '';
  return token && header === `Bearer ${token}`;
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
  const { ip: _ip, ...rest } = server;
  return { ...rest, name: serverDisplayName(server) };
}

function adminServers(servers, status) {
  const activeIds = new Set(status.map((server) => String(server.id)));
  return servers.map(publicServer).sort((a, b) => {
    const activeDiff = Number(activeIds.has(String(b.id))) - Number(activeIds.has(String(a.id)));
    if (activeDiff) return activeDiff;
    const enabledDiff = Number(b.enabled) - Number(a.enabled);
    return enabledDiff || String(a.id).localeCompare(String(b.id), 'zh-CN', { numeric: true });
  });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const repo = new D1Repository(env.DB);

  if ((url.pathname === '/' || url.pathname === '/status') && request.method === 'GET') {
    return new Response(renderStatusPage(await repo.listStatus()), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (url.pathname === '/admin' && request.method === 'GET') {
    return new Response(renderAdminPage(), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }

  if (url.pathname === '/api/status' && request.method === 'GET') {
    return json({ servers: (await repo.listStatus()).map(publicServer) });
  }

  if (!url.pathname.startsWith('/api/admin/')) return json({ error: 'NOT_FOUND' }, 404);
  if (!isAuthorized(request, env)) return json({ error: 'UNAUTHORIZED' }, 401);

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

  if (url.pathname === '/api/admin/events' && request.method === 'GET') {
    return json({ events: await repo.listEvents(100) });
  }

  if (url.pathname === '/api/admin/run' && request.method === 'POST') {
    const now = Math.floor(Date.now() / 1000);
    const today = new Date().toISOString().slice(0, 10);
    return json(await runMonitorOnce({ repo, fetcher: (input, init) => fetch(input, init), now, today }));
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
    };
    await repo.upsertServer(nextServer, Math.floor(Date.now() / 1000));
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
