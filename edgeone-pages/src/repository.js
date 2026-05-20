import { DEFAULT_SETTINGS } from './constants.js';
import { createRuntime } from './state-machine.js';

function numberSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolSetting(value, fallback) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

function rowToBool(row, key, fallback = false) {
  return boolSetting(row[key], fallback);
}

function serverRow(row) {
  return { ...row, enabled: rowToBool(row, 'enabled'), visible_on_status: rowToBool(row, 'visible_on_status', true) };
}

function placeholders(values, start = 1) {
  return values.map((_, index) => `?${start + index}`).join(',');
}

function percent(ok, total) {
  const count = Number(total || 0);
  if (count <= 0) return '0.000%';
  return `${((Number(ok || 0) / count) * 100).toFixed(3)}%`;
}

export class D1Repository {
  constructor(db) {
    this.db = db;
  }

  async getSettings() {
    const { results } = await this.db.prepare('SELECT key, value FROM settings').all();
    const raw = Object.fromEntries((results || []).map((row) => [row.key, row.value]));
    return {
      check_interval: numberSetting(raw.check_interval, DEFAULT_SETTINGS.check_interval),
      suspect_threshold: numberSetting(raw.suspect_threshold, DEFAULT_SETTINGS.suspect_threshold),
      reboot_cooldown: numberSetting(raw.reboot_cooldown, DEFAULT_SETTINGS.reboot_cooldown),
      recover_timeout: numberSetting(raw.recover_timeout, DEFAULT_SETTINGS.recover_timeout),
      recover_check_interval: numberSetting(raw.recover_check_interval, DEFAULT_SETTINGS.recover_check_interval),
      api_timeout: numberSetting(raw.api_timeout, DEFAULT_SETTINGS.api_timeout),
      default_daily_reboot_limit: numberSetting(raw.default_daily_reboot_limit, DEFAULT_SETTINGS.default_daily_reboot_limit),
      reboot_limit_window: raw.reboot_limit_window || DEFAULT_SETTINGS.reboot_limit_window,
      data_retention_days: numberSetting(raw.data_retention_days, DEFAULT_SETTINGS.data_retention_days),
      recover_success_threshold: numberSetting(raw.recover_success_threshold, DEFAULT_SETTINGS.recover_success_threshold),
      admin_overview_range: raw.admin_overview_range || DEFAULT_SETTINGS.admin_overview_range,
      admin_monitor_range: raw.admin_monitor_range || DEFAULT_SETTINGS.admin_monitor_range,
      site_title: raw.site_title || DEFAULT_SETTINGS.site_title,
      site_description: raw.site_description || DEFAULT_SETTINGS.site_description,
      webhook_name: raw.webhook_name || DEFAULT_SETTINGS.webhook_name,
      webhook_url: raw.webhook_url || '',
      webhook_type: raw.webhook_type || 'custom',
      webhook_timeout: numberSetting(raw.webhook_timeout, DEFAULT_SETTINGS.webhook_timeout),
      webhook_headers: raw.webhook_headers || DEFAULT_SETTINGS.webhook_headers,
      webhook_template: raw.webhook_template || DEFAULT_SETTINGS.webhook_template,
      notify_failure_silence: boolSetting(raw.notify_failure_silence, DEFAULT_SETTINGS.notify_failure_silence),
      pushplus_token: raw.pushplus_token || '',
      timezone: raw.timezone || DEFAULT_SETTINGS.timezone,
      setup_completed: raw.setup_completed || '0',
    };
  }

  async getSetting(key, fallback = '') {
    const row = await this.db.prepare('SELECT value FROM settings WHERE key = ?1').bind(key).first();
    return row?.value ?? fallback;
  }

  async listEnabledServers() {
    const { results } = await this.db.prepare('SELECT * FROM servers WHERE enabled = 1 ORDER BY id').all();
    return (results || []).map(serverRow);
  }

  async listServers() {
    const { results } = await this.db.prepare('SELECT * FROM servers ORDER BY id').all();
    return (results || []).map(serverRow);
  }

  async getServer(id) {
    const row = await this.db.prepare('SELECT * FROM servers WHERE id = ?1').bind(id).first();
    return row ? serverRow(row) : null;
  }

  async listProviders() {
    const { results } = await this.db.prepare(
      'SELECT name, display_name, api_base_url, api_account, api_password, created_at, updated_at FROM providers ORDER BY name',
    ).all();
    return results || [];
  }

  async getProvider(name) {
    return await this.db.prepare('SELECT * FROM providers WHERE name = ?1').bind(name).first();
  }

  async updateProvider(provider) {
    await this.db.prepare('UPDATE providers SET jwt_token = ?1, jwt_expire_at = ?2, updated_at = ?3 WHERE name = ?4')
      .bind(provider.jwt_token || '', provider.jwt_expire_at || 0, Math.floor(Date.now() / 1000), provider.name)
      .run();
  }

  async getRuntime(serverId) {
    const row = await this.db.prepare('SELECT * FROM runtimes WHERE server_id = ?1').bind(serverId).first();
    return row ? createRuntime(row) : null;
  }

  async saveRuntime(serverId, runtime) {
    await this.db.prepare(`
      INSERT INTO runtimes (server_id,state,consecutive_failures,consecutive_successes,last_check_time,last_reboot_time,reboot_count_today,reboot_date,last_status_value,state_changed_at,first_failure_at,reboot_initiated_at,scheduled_reboot_date)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)
      ON CONFLICT(server_id) DO UPDATE SET state=excluded.state,consecutive_failures=excluded.consecutive_failures,consecutive_successes=excluded.consecutive_successes,last_check_time=excluded.last_check_time,last_reboot_time=excluded.last_reboot_time,reboot_count_today=excluded.reboot_count_today,reboot_date=excluded.reboot_date,last_status_value=excluded.last_status_value,state_changed_at=excluded.state_changed_at,first_failure_at=excluded.first_failure_at,reboot_initiated_at=excluded.reboot_initiated_at,scheduled_reboot_date=excluded.scheduled_reboot_date
    `).bind(serverId, runtime.state, runtime.consecutive_failures, runtime.consecutive_successes, runtime.last_check_time, runtime.last_reboot_time, runtime.reboot_count_today, runtime.reboot_date, runtime.last_status_value, runtime.state_changed_at, runtime.first_failure_at, runtime.reboot_initiated_at, runtime.scheduled_reboot_date || '').run();
  }

  async addEvent(event) {
    await this.db.prepare('INSERT INTO events (server_id,old_state,new_state,label,level,message,created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)')
      .bind(event.server_id, event.old_state, event.new_state, event.label, event.level, event.message, event.created_at)
      .run();
  }

  async addCheckResult(result) {
    await this.db.prepare('INSERT INTO check_results (server_id,ok,latency_ms,status_value,error,created_at) VALUES (?1,?2,?3,?4,?5,?6)')
      .bind(result.server_id, result.ok ? 1 : 0, Math.round(result.latency_ms || 0), result.status_value || '', result.error || '', result.created_at)
      .run();
  }

  async pruneCheckResults(retentionDays, now = Math.floor(Date.now() / 1000)) {
    const days = Number(retentionDays || 0);
    if (!Number.isFinite(days) || days <= 0) return;
    const before = Math.floor(now - days * 24 * 60 * 60);
    await this.db.prepare('DELETE FROM check_results WHERE created_at < ?1').bind(before).run();
  }

  async listRecentChecks(serverId, limit = 60) {
    const { results } = await this.db.prepare(`
      SELECT ok, latency_ms, created_at
      FROM check_results
      WHERE server_id = ?1
      ORDER BY created_at DESC, id DESC
      LIMIT ?2
    `).bind(serverId, limit).all();
    return (results || []).map((row) => ({
      ok: Number(row.ok) === 1,
      latency_ms: Number(row.latency_ms || 0),
      created_at: Number(row.created_at || 0),
    }));
  }

  async countRecentReboots(serverId, since) {
    const row = await this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM events
      WHERE server_id = ?1
        AND old_state = 'rebooting'
        AND new_state = 'recovering'
        AND created_at >= ?2
    `).bind(serverId, since).first();
    return Number(row?.count || 0);
  }

  async listStatus() {
    const { results } = await this.db.prepare(`
      SELECT s.id, s.name, s.ip, s.provider, s.enabled, s.visible_on_status, s.check_method, s.http_url, s.tcp_host, s.tcp_port,
             r.state, r.last_status_value, r.last_check_time, r.last_reboot_time, r.reboot_count_today,
             cr.latency_ms AS last_latency_ms
      FROM servers s
      LEFT JOIN runtimes r ON r.server_id = s.id
      LEFT JOIN check_results cr ON cr.id = (
        SELECT id FROM check_results WHERE server_id = s.id ORDER BY id DESC LIMIT 1
      )
      WHERE s.enabled = 1
      ORDER BY s.id
    `).all();
    return results || [];
  }

  async listEvents(limit = 50) {
    const { results } = await this.db.prepare(`
      SELECT id,server_id,old_state,new_state,label,level,message,created_at
      FROM events
      ORDER BY id DESC
      LIMIT ?1
    `).bind(limit).all();
    return results || [];
  }

  async listDailyHistory(serverIds, days = 30, now = Math.floor(Date.now() / 1000)) {
    if (!serverIds.length) return new Map();
    const since = now - days * 24 * 60 * 60;
    const ids = placeholders(serverIds);
    const { results } = await this.db.prepare(`
      SELECT server_id,
             strftime('%Y-%m-%d', created_at, 'unixepoch', '+8 hours') AS date_key,
             COUNT(*) AS total,
             SUM(CASE WHEN ok = 1 THEN 1 ELSE 0 END) AS ok_count,
             AVG(latency_ms) AS avg_latency_ms
      FROM check_results
      WHERE server_id IN (${ids}) AND created_at >= ?${serverIds.length + 1}
      GROUP BY server_id, date_key
      ORDER BY date_key ASC
    `).bind(...serverIds, since).all();
    const grouped = new Map(serverIds.map((id) => [String(id), []]));
    for (const row of results || []) {
      const total = Number(row.total || 0);
      const ok = Number(row.ok_count || 0);
      grouped.get(String(row.server_id))?.push({
        date: row.date_key,
        checks: total,
        failures: Math.max(0, total - ok),
        uptime: percent(ok, total),
        avg_latency_ms: Math.round(Number(row.avg_latency_ms || 0)),
        downtime_seconds: Math.max(0, total - ok) * 300,
      });
    }
    return grouped;
  }

  async listPublicEvents(serverIds, limit = 80) {
    if (!serverIds.length) return new Map();
    const ids = placeholders(serverIds);
    const { results } = await this.db.prepare(`
      SELECT id,server_id,old_state,new_state,label,level,created_at
      FROM events
      WHERE server_id IN (${ids})
      ORDER BY created_at DESC
      LIMIT ?${serverIds.length + 1}
    `).bind(...serverIds, limit).all();
    const grouped = new Map(serverIds.map((id) => [String(id), []]));
    for (const event of results || []) grouped.get(String(event.server_id))?.push(event);
    return grouped;
  }

  async upsertProvider(provider, now) {
    await this.db.prepare(`
      INSERT INTO providers (name,display_name,api_base_url,api_account,api_password,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?6)
      ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name,api_base_url=excluded.api_base_url,api_account=excluded.api_account,api_password=excluded.api_password,updated_at=excluded.updated_at
    `).bind(provider.name, provider.display_name || provider.name, provider.api_base_url, provider.api_account, provider.api_password, now).run();
  }

  async upsertServer(server, now) {
    await this.db.prepare(`
      INSERT INTO servers (id,name,ip,provider,check_method,enabled,visible_on_status,daily_reboot_limit,scheduled_reboot,http_url,http_method,http_expected_status,tcp_host,tcp_port,probe_timeout_ms,recovery_action,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,ip=excluded.ip,provider=excluded.provider,check_method=excluded.check_method,enabled=excluded.enabled,visible_on_status=excluded.visible_on_status,daily_reboot_limit=excluded.daily_reboot_limit,scheduled_reboot=excluded.scheduled_reboot,http_url=excluded.http_url,http_method=excluded.http_method,http_expected_status=excluded.http_expected_status,tcp_host=excluded.tcp_host,tcp_port=excluded.tcp_port,probe_timeout_ms=excluded.probe_timeout_ms,recovery_action=excluded.recovery_action,updated_at=excluded.updated_at
    `).bind(server.id, server.name, server.ip || '', server.provider, server.check_method || 'service_then_power', server.enabled === false ? 0 : 1, boolSetting(server.visible_on_status, true) ? 1 : 0, server.daily_reboot_limit || 0, '', server.http_url || '', server.http_method || 'GET', server.http_expected_status || '200-399', server.tcp_host || '', Number(server.tcp_port || 0), Number(server.probe_timeout_ms || 10000), server.recovery_action || 'reboot', now).run();
  }

  async deleteServer(id) {
    await this.db.prepare('DELETE FROM runtimes WHERE server_id = ?1').bind(id).run();
    await this.db.prepare('DELETE FROM servers WHERE id = ?1').bind(id).run();
  }

  async resetTutorialData() {
    await this.db.prepare('DELETE FROM check_results').run();
    await this.db.prepare('DELETE FROM events').run();
    await this.db.prepare('DELETE FROM runtimes').run();
    await this.db.prepare('DELETE FROM servers').run();
    await this.db.prepare('DELETE FROM providers').run();
    await this.db.prepare('DELETE FROM settings WHERE key != ?1').bind('admin_token_hash').run();
  }

  async setSetting(key, value) {
    await this.db.prepare('INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(key, String(value))
      .run();
  }
}
