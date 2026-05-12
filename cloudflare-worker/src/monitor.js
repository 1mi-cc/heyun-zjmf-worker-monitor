import { TRANSITION_LABELS } from './constants.js';
import { Notifier } from './notifier.js';
import { checkHttpHealth, checkTcpHealth } from './probe.js';
import { createRuntime, advanceState, shouldReboot, applyRebootStart, applyRebootSuccess } from './state-machine.js';
import { localDateParts } from './time.js';
import { ZjmfClient } from './zjmf-client.js';

function transitionLabel(oldState, newState) {
  return TRANSITION_LABELS[`${oldState}:${newState}`] || '';
}

function eventLevel(newState) {
  if (newState === 'down' || newState === 'rebooting') return 'critical';
  if (newState === 'recovering') return 'warning';
  return 'info';
}

async function recordTransition(repo, notifier, server, oldState, nextRuntime, now) {
  if (oldState === nextRuntime.state) return;
  const label = transitionLabel(oldState, nextRuntime.state);
  const level = eventLevel(nextRuntime.state);
  const message = `${server.name}: ${oldState} -> ${nextRuntime.state}${label ? ` (${label})` : ''}`;
  await repo.addEvent({ server_id: server.id, old_state: oldState, new_state: nextRuntime.state, label, level, message, created_at: now });
  await notifier.send(`[${server.name}] ${label || nextRuntime.state}`, message, level);
}

async function checkApiHealth(client, server, runtime, now) {
  const started = Date.now();
  const status = await client.getStatus(server.id, now);
  const statusValue = status == null ? `ERROR: ${client.lastError || 'N/A'}` : String(status);
  return {
    ok: status != null && String(status).toLowerCase() === 'on',
    statusValue,
    error: status == null ? client.lastError || 'API 状态获取失败' : '',
    latencyMs: Date.now() - started,
  };
}

function rebootWindowKey(date, timezone) {
  const parts = localDateParts(date, timezone);
  return parts.dateKey;
}

async function probeServer({ client, server, fetcher, tcpConnector, now }) {
  const method = server.check_method || 'api_only';
  if (method === 'http') return await checkHttpHealth({ server, fetcher });
  if (method === 'tcp') return await checkTcpHealth({ server, connector: tcpConnector });
  if (method === 'http_then_api') {
    const http = await checkHttpHealth({ server, fetcher });
    return http.ok ? http : await checkApiHealth(client, server, {}, now);
  }
  if (method === 'tcp_then_api') {
    const tcp = await checkTcpHealth({ server, connector: tcpConnector });
    return tcp.ok ? tcp : await checkApiHealth(client, server, {}, now);
  }
  return await checkApiHealth(client, server, {}, now);
}

export async function runMonitorOnce({ repo, fetcher = (input, init) => globalThis.fetch(input, init), tcpConnector, now, date = new Date(now * 1000), force = false }) {
  const settings = await repo.getSettings();
  const notifier = new Notifier(settings, fetcher);
  const rebootWindow = rebootWindowKey(date, settings.timezone || 'Asia/Shanghai');
  const rebootWindowStart = now - 24 * 60 * 60;
  const servers = await repo.listEnabledServers();
  let checked = 0;

  for (const server of servers) {
    const provider = await repo.getProvider(server.provider);
    if (!provider) continue;
    const client = new ZjmfClient(provider, fetcher, settings.api_timeout);
    const loadedRuntime = (await repo.getRuntime(server.id)) || createRuntime({ now });
    const recentRebootCount = typeof repo.countRecentReboots === 'function'
      ? await repo.countRecentReboots(server.id, rebootWindowStart)
      : undefined;
    if (!force && loadedRuntime.last_check_time && now - loadedRuntime.last_check_time < settings.check_interval) continue;
    const probe = await probeServer({ client, server, fetcher, tcpConnector, now });
    const withStatus = { ...loadedRuntime, reboot_count_today: recentRebootCount ?? loadedRuntime.reboot_count_today, last_status_value: probe.statusValue || '', last_check_time: now };
    let nextRuntime = advanceState(withStatus, probe.ok, settings, now);
    if (typeof repo.addCheckResult === 'function') {
      await repo.addCheckResult({ server_id: server.id, ok: probe.ok, latency_ms: probe.latencyMs || 0, status_value: probe.statusValue || '', error: probe.error || '', created_at: now });
    }
    await recordTransition(repo, notifier, server, loadedRuntime.state, nextRuntime, now);

    if (shouldReboot(nextRuntime, server, settings, now, rebootWindow, recentRebootCount)) {
      const rebooting = applyRebootStart(nextRuntime, now);
      await recordTransition(repo, notifier, server, nextRuntime.state, rebooting, now);
      const success = await client.hardReboot(server.id, now);
      if (success) {
        const recovering = applyRebootSuccess(rebooting, now, rebootWindow, recentRebootCount);
        await recordTransition(repo, notifier, server, rebooting.state, recovering, now);
        nextRuntime = recovering;
      } else {
        nextRuntime = { ...rebooting, state: 'down', state_changed_at: now };
      }
    }

    await repo.updateProvider(provider);
    await repo.saveRuntime(server.id, nextRuntime);
    checked += 1;
  }

  return { checked };
}
