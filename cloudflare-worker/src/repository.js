import { DEFAULT_SETTINGS } from './constants.js';
import { createRuntime } from './state-machine.js';

function numberSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowToBool(row, key) {
  return Number(row[key]) === 1;
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
      webhook_name: raw.webhook_name || DEFAULT_SETTINGS.webhook_name,
      webhook_url: raw.webhook_url || '',
      webhook_type: raw.webhook_type || 'custom',
      webhook_timeout: numberSetting(raw.webhook_timeout, DEFAULT_SETTINGS.webhook_timeout),
      webhook_headers: raw.webhook_headers || DEFAULT_SETTINGS.webhook_headers,
      webhook_template: raw.webhook_template || DEFAULT_SETTINGS.webhook_template,
      pushplus_token: raw.pushplus_token || '',
      timezone: raw.timezone || 'Asia/Shanghai',
    };
  }

  async listEnabledServers() {
    const { results } = await this.db.prepare('SELECT * FROM servers WHERE enabled = 1 ORDER BY id').all();
    return (results || []).map((row) => ({ ...row, enabled: rowToBool(row, 'enabled') }));
  }

  async listServers() {
    const { results } = await this.db.prepare('SELECT * FROM servers ORDER BY id').all();
    return (results || []).map((row) => ({ ...row, enabled: rowToBool(row, 'enabled') }));
  }

  async getServer(id) {
    const row = await this.db.prepare('SELECT * FROM servers WHERE id = ?1').bind(id).first();
    return row ? { ...row, enabled: rowToBool(row, 'enabled') } : null;
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
      SELECT s.id, s.name, s.ip, s.provider, s.enabled, s.check_method, s.http_url, s.tcp_host, s.tcp_port,
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

  async upsertProvider(provider, now) {
    await this.db.prepare(`
      INSERT INTO providers (name,display_name,api_base_url,api_account,api_password,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?6)
      ON CONFLICT(name) DO UPDATE SET display_name=excluded.display_name,api_base_url=excluded.api_base_url,api_account=excluded.api_account,api_password=excluded.api_password,updated_at=excluded.updated_at
    `).bind(provider.name, provider.display_name || provider.name, provider.api_base_url, provider.api_account, provider.api_password, now).run();
  }

  async upsertServer(server, now) {
    await this.db.prepare(`
      INSERT INTO servers (id,name,ip,provider,check_method,enabled,daily_reboot_limit,scheduled_reboot,http_url,http_method,http_expected_status,tcp_host,tcp_port,probe_timeout_ms,recovery_action,created_at,updated_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?16)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,ip=excluded.ip,provider=excluded.provider,check_method=excluded.check_method,enabled=excluded.enabled,daily_reboot_limit=excluded.daily_reboot_limit,scheduled_reboot=excluded.scheduled_reboot,http_url=excluded.http_url,http_method=excluded.http_method,http_expected_status=excluded.http_expected_status,tcp_host=excluded.tcp_host,tcp_port=excluded.tcp_port,probe_timeout_ms=excluded.probe_timeout_ms,recovery_action=excluded.recovery_action,updated_at=excluded.updated_at
    `).bind(server.id, server.name, server.ip || '', server.provider, server.check_method || 'api_only', server.enabled === false ? 0 : 1, server.daily_reboot_limit || 0, '', server.http_url || '', server.http_method || 'GET', server.http_expected_status || '200-399', server.tcp_host || '', Number(server.tcp_port || 0), Number(server.probe_timeout_ms || 10000), server.recovery_action || 'reboot', now).run();
  }

  async deleteServer(id) {
    await this.db.prepare('DELETE FROM runtimes WHERE server_id = ?1').bind(id).run();
    await this.db.prepare('DELETE FROM servers WHERE id = ?1').bind(id).run();
  }

  async setSetting(key, value) {
    await this.db.prepare('INSERT INTO settings (key,value) VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .bind(key, String(value))
      .run();
  }
}
