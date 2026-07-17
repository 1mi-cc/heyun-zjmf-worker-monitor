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

const STATE_TEXT = {
  healthy: '正常',
  suspect: '可疑',
  down: '宕机',
  rebooting: '处理中',
  recovering: '恢复中',
};

const LEVEL_TEXT = {
  info: '信息',
  warning: '警告',
  critical: '严重',
};

const METHOD_TEXT = {
  api_only: '魔方财务 API',
  http: 'HTTP(S)',
  tcp: 'TCP 端口',
  http_then_api: 'HTTP(S) + API 复核',
  tcp_then_api: 'TCP + API 复核',
  service_then_power: '三步检测：HTTP(S) + TCP + API',
};

function formatNotifyTime(now, timezone = 'Asia/Shanghai') {
  return new Date(now * 1000).toLocaleString('zh-CN', {
    timeZone: timezone,
    hour12: false,
  });
}

function rebootLimitWindow(settings = {}) {
  return settings.reboot_limit_window === 'day' ? 'day' : 'hour';
}

function rebootWindowText(settings = {}) {
  return rebootLimitWindow(settings) === 'day' ? '24 小时' : '每小时';
}

function actionHint(label, nextRuntime, settings) {
  if (label === '检测异常') return `继续观察，连续失败 ${settings.suspect_threshold} 次后才会自动处理`;
  if (label === '确认宕机') return '已确认异常，准备按电源状态自动处理';
  if (label === '触发开机') return '正在发送开机指令';
  if (label === '触发重启') return '正在发送重启指令';
  if (label === '恢复成功') return '服务已恢复正常';
  if (label === '恢复超时') return '恢复超时，等待下一轮处理';
  return nextRuntime.state === 'healthy' ? '无需处理' : '持续监控中';
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || '').trim());
}

function displayServerName(server) {
  return isIpAddress(server.name) || isIpAddress(server.ip) ? `服务器 #${server.id}` : server.name;
}

function buildTransitionNotice(server, oldState, nextRuntime, now, label, level, settings) {
  const name = displayServerName(server);
  const method = METHOD_TEXT[server.check_method || 'api_only'] || server.check_method || 'api_only';
  const stateText = `${STATE_TEXT[oldState] || oldState} -> ${STATE_TEXT[nextRuntime.state] || nextRuntime.state}`;
  const limit = settings.default_daily_reboot_limit;
  const rebootText = limit <= 0 ? `${nextRuntime.reboot_count_today || 0} / 不限` : `${nextRuntime.reboot_count_today || 0} / ${limit}`;
  const windowText = rebootWindowText(settings);
  return {
    title: `【${LEVEL_TEXT[level] || level}】${name} - ${label || STATE_TEXT[nextRuntime.state] || nextRuntime.state}`,
    message: [
      `事件：${label || '状态变更'}`,
      `监控项：${name} (#${server.id})`,
      `严重级别：${LEVEL_TEXT[level] || level}`,
      `状态变化：${stateText}`,
      `检测方式：${method}`,
      `最近结果：${nextRuntime.last_status_value || '暂无'}`,
      `连续失败：${nextRuntime.consecutive_failures || 0} / ${settings.suspect_threshold}`,
      `重启次数：${rebootText}（${windowText}）`,
      `处理建议：${actionHint(label, nextRuntime, settings)}`,
      `时间：${formatNotifyTime(now, settings.timezone || 'Asia/Shanghai')}`,
    ].join('\n'),
  };
}

const ACTION_ONLY_NOTICE_LABELS = new Set(['触发开机', '触发重启', '恢复成功', '恢复超时']);

function shouldSendTransitionNotice(label, settings) {
  if (!settings.notify_failure_silence) return true;
  return ACTION_ONLY_NOTICE_LABELS.has(label);
}

async function recordTransition(repo, notifier, server, oldState, nextRuntime, now, options = {}) {
  if (oldState === nextRuntime.state) return;
  const label = options.label || transitionLabel(oldState, nextRuntime.state);
  const level = eventLevel(nextRuntime.state);
  const name = displayServerName(server);
  const message = options.message || `${name}: ${oldState} -> ${nextRuntime.state}${label ? ` (${label})` : ''}`;
  const notice = buildTransitionNotice(server, oldState, nextRuntime, now, label, level, notifier.settings || {});
  await repo.addEvent({ server_id: server.id, old_state: oldState, new_state: nextRuntime.state, label, level, message, created_at: now });
  if (shouldSendTransitionNotice(label, notifier.settings || {})) {
    await notifier.send(notice.title, notice.message, level);
  }
}

async function checkApiHealth(client, server, runtime, now) {
  const started = Date.now();
  const status = await client.getStatus(server.id, now);
  const statusValue = status == null ? `ERROR: ${client.lastError || 'N/A'}` : String(status);
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  const health = status == null || !normalizedStatus ? null : normalizedStatus === 'on';
  return {
    ok: health,
    statusValue,
    error: health === null ? client.lastError || 'API 状态获取失败' : '',
    latencyMs: Date.now() - started,
  };
}

function combinedHealth(results) {
  if (results.some((item) => item.ok === true)) return true;
  if (results.some((item) => item.ok === false)) return false;
  return null;
}

function apiRecoveryAction(api) {
  if (api.ok === null) return 'none';
  const status = String(api.statusValue || '').trim().toLowerCase();
  if (status === 'off') return 'power_on';
  if (status === 'on') return '';
  return 'reboot';
}

function combinedProbe(results, overrides = {}) {
  const hasOkOverride = Object.prototype.hasOwnProperty.call(overrides, 'ok');
  const hasErrorOverride = Object.prototype.hasOwnProperty.call(overrides, 'error');
  return {
    ok: hasOkOverride ? overrides.ok : combinedHealth(results),
    statusValue: results.map((item) => item.statusValue).filter(Boolean).join(' -> '),
    error: hasErrorOverride ? overrides.error : results.filter((item) => item.ok === false).map((item) => item.error).filter(Boolean).join('；'),
    latencyMs: results.reduce((sum, item) => sum + Number(item.latencyMs || 0), 0),
    recoveryAction: overrides.recoveryAction,
  };
}

function rebootWindowKey(date, timezone, window = 'hour') {
  const parts = localDateParts(date, timezone);
  if (window === 'day') return parts.dateKey;
  const hour = Number.isFinite(parts.hour) ? String(parts.hour).padStart(2, '0') : '00';
  return `${parts.dateKey}-${hour}`;
}

async function checkServiceThenPower({ client, server, fetcher, tcpConnector, now }) {
  const http = await checkHttpHealth({ server, fetcher });
  const tcp = await checkTcpHealth({ server, connector: tcpConnector });
  const api = await checkApiHealth(client, server, {}, now);
  const serviceOk = http.ok || tcp.ok;
  if (serviceOk) {
    return combinedProbe([http, tcp, api], { ok: true, error: '', recoveryAction: '' });
  }
  if (api.ok === null) {
    return combinedProbe([http, tcp, api], { ok: null, recoveryAction: 'none' });
  }
  return combinedProbe([http, tcp, api], { ok: api.ok, error: '', recoveryAction: apiRecoveryAction(api) });
}

async function probeServer({ client, server, fetcher, tcpConnector, now }) {
  const method = server.check_method || 'api_only';
  if (method === 'http') return await checkHttpHealth({ server, fetcher });
  if (method === 'tcp') return await checkTcpHealth({ server, connector: tcpConnector });
  if (method === 'service_then_power') return await checkServiceThenPower({ client, server, fetcher, tcpConnector, now });
  if (method === 'http_then_api') {
    const http = await checkHttpHealth({ server, fetcher });
    if (http.ok) return http;
    const api = await checkApiHealth(client, server, {}, now);
    if (api.ok === null) return api;
    return combinedProbe([http, api], { ok: api.ok, error: '', recoveryAction: apiRecoveryAction(api) });
  }
  if (method === 'tcp_then_api') {
    const tcp = await checkTcpHealth({ server, connector: tcpConnector });
    if (tcp.ok) return tcp;
    const api = await checkApiHealth(client, server, {}, now);
    if (api.ok === null) return api;
    return combinedProbe([tcp, api], { ok: api.ok, error: '', recoveryAction: apiRecoveryAction(api) });
  }
  const api = await checkApiHealth(client, server, {}, now);
  return { ...api, recoveryAction: apiRecoveryAction(api) };
}

export async function runMonitorOnce({ repo, fetcher = (input, init) => globalThis.fetch(input, init), tcpConnector, now, date = new Date(now * 1000), force = false }) {
  const settings = await repo.getSettings();
  const notifier = new Notifier(settings, fetcher);
  const limitWindow = rebootLimitWindow(settings);
  const rebootWindow = rebootWindowKey(date, settings.timezone || 'Asia/Shanghai', limitWindow);
  const rebootWindowStart = now - (limitWindow === 'day' ? 24 * 60 * 60 : 60 * 60);
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
      const action = probe.recoveryAction === undefined ? 'reboot' : probe.recoveryAction;
      if (action !== 'none') {
        const rebooting = applyRebootStart(nextRuntime, now);
        const startLabel = action === 'power_on' ? '触发开机' : '触发重启';
        const doneLabel = action === 'power_on' ? '开机指令已发送' : '重启指令已发送';
        await recordTransition(repo, notifier, server, nextRuntime.state, rebooting, now, { label: startLabel });
        const success = action === 'power_on' ? await client.powerOn(server.id, now) : await client.hardReboot(server.id, now);
        if (success) {
          const recovering = applyRebootSuccess(rebooting, now, rebootWindow, recentRebootCount);
          await recordTransition(repo, notifier, server, rebooting.state, recovering, now, { label: doneLabel });
          nextRuntime = recovering;
        } else {
          nextRuntime = { ...rebooting, state: 'down', state_changed_at: now };
        }
      }
    }

    await repo.updateProvider(provider);
    await repo.saveRuntime(server.id, nextRuntime);
    checked += 1;
  }

  if (typeof repo.pruneCheckResults === 'function') {
    await repo.pruneCheckResults(settings.data_retention_days, now);
  }

  return { checked };
}
