Exit code: 0
Wall time: 0.3 seconds
Output:
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
  healthy: '姝ｅ父',
  suspect: '鍙枒',
  down: '瀹曟満',
  rebooting: '澶勭悊涓?,
  recovering: '鎭㈠涓?,
};

const LEVEL_TEXT = {
  info: '淇℃伅',
  warning: '璀﹀憡',
  critical: '涓ラ噸',
};

const METHOD_TEXT = {
  api_only: '榄旀柟璐㈠姟 API',
  http: 'HTTP(S)',
  tcp: 'TCP 绔彛',
  http_then_api: 'HTTP(S) + API 澶嶆牳',
  tcp_then_api: 'TCP + API 澶嶆牳',
  service_then_power: '涓夋妫€娴嬶細HTTP(S) + TCP + API',
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
  return rebootLimitWindow(settings) === 'day' ? '24 灏忔椂' : '姣忓皬鏃?;
}

function actionHint(label, nextRuntime, settings) {
  if (label === '妫€娴嬪紓甯?) return `缁х画瑙傚療锛岃繛缁け璐?${settings.suspect_threshold} 娆″悗鎵嶄細鑷姩澶勭悊`;
  if (label === '纭瀹曟満') return '宸茬‘璁ゅ紓甯革紝鍑嗗鎸夌數婧愮姸鎬佽嚜鍔ㄥ鐞?;
  if (label === '瑙﹀彂寮€鏈?) return '姝ｅ湪鍙戦€佸紑鏈烘寚浠?;
  if (label === '瑙﹀彂閲嶅惎') return '姝ｅ湪鍙戦€侀噸鍚寚浠?;
  if (label === '鎭㈠鎴愬姛') return '鏈嶅姟宸叉仮澶嶆甯?;
  if (label === '鎭㈠瓒呮椂') return '鎭㈠瓒呮椂锛岀瓑寰呬笅涓€杞鐞?;
  return nextRuntime.state === 'healthy' ? '鏃犻渶澶勭悊' : '鎸佺画鐩戞帶涓?;
}

function isIpAddress(value) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(value || '').trim());
}

function displayServerName(server) {
  return isIpAddress(server.name) || isIpAddress(server.ip) ? `鏈嶅姟鍣?#${server.id}` : server.name;
}

function buildTransitionNotice(server, oldState, nextRuntime, now, label, level, settings) {
  const name = displayServerName(server);
  const method = METHOD_TEXT[server.check_method || 'api_only'] || server.check_method || 'api_only';
  const stateText = `${STATE_TEXT[oldState] || oldState} -> ${STATE_TEXT[nextRuntime.state] || nextRuntime.state}`;
  const limit = settings.default_daily_reboot_limit;
  const rebootText = limit <= 0 ? `${nextRuntime.reboot_count_today || 0} / 涓嶉檺` : `${nextRuntime.reboot_count_today || 0} / ${limit}`;
  const windowText = rebootWindowText(settings);
  return {
    title: `銆?{LEVEL_TEXT[level] || level}銆?{name} - ${label || STATE_TEXT[nextRuntime.state] || nextRuntime.state}`,
    message: [
      `浜嬩欢锛?{label || '鐘舵€佸彉鏇?}`,
      `鐩戞帶椤癸細${name} (#${server.id})`,
      `涓ラ噸绾у埆锛?{LEVEL_TEXT[level] || level}`,
      `鐘舵€佸彉鍖栵細${stateText}`,
      `妫€娴嬫柟寮忥細${method}`,
      `鏈€杩戠粨鏋滐細${nextRuntime.last_status_value || '鏆傛棤'}`,
      `杩炵画澶辫触锛?{nextRuntime.consecutive_failures || 0} / ${settings.suspect_threshold}`,
      `閲嶅惎娆℃暟锛?{rebootText}锛?{windowText}锛塦,
      `澶勭悊寤鸿锛?{actionHint(label, nextRuntime, settings)}`,
      `鏃堕棿锛?{formatNotifyTime(now, settings.timezone || 'Asia/Shanghai')}`,
    ].join('\n'),
  };
}

const ACTION_ONLY_NOTICE_LABELS = new Set(['瑙﹀彂寮€鏈?, '瑙﹀彂閲嶅惎', '鎭㈠鎴愬姛', '鎭㈠瓒呮椂']);

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
    error: health === null ? client.lastError || 'API 鐘舵€佽幏鍙栧け璐? : '',
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
    error: hasErrorOverride ? overrides.error : results.filter((item) => item.ok === false).map((item) => item.error).filter(Boolean).join('锛?),
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
        const startLabel = action === 'power_on' ? '瑙﹀彂寮€鏈? : '瑙﹀彂閲嶅惎';
        const doneLabel = action === 'power_on' ? '寮€鏈烘寚浠ゅ凡鍙戦€? : '閲嶅惎鎸囦护宸插彂閫?;
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

