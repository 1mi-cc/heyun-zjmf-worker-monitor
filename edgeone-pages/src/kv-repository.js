import { DEFAULT_SETTINGS } from './constants.js';
import { createRuntime } from './state-machine.js';

const STATE_KEY = 'zjmf_monitor_state';

function numberSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function percent(ok, total) {
  const count = Number(total || 0);
  if (count <= 0) return '0.000%';
  return `${((Number(ok || 0) / count) * 100).toFixed(3)}%`;
}

function defaultState() {
  return {
    settings: {},
    providers: [],
    servers: [],
    runtimes: {},
    events: [],
    check_results: [],
    next_event_id: 1,
    next_check_id: 1,
  };
}

function normalizeState(raw) {
  return { ...defaultState(), ...(raw && typeof raw === 'object' ? raw : {}) };
}

async function kvGetJson(kv, key) {
  const value = await kv.get(key);
  if (!value) return null;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

async function kvPutJson(kv, key, value) {
  await kv.put(key, JSON.stringify(value));
}

export class KVRepository {
  constructor(kv) {
    if (!kv?.get || !kv?.put) throw new Error('EdgeOne KV 未绑定，请配置 ZJMF_KV 或 KV 环境变量');
    this.kv = kv;
  }

  async readState() {
    return normalizeState(await kvGetJson(this.kv, STATE_KEY));
  }

  async writeState(state) {
    await kvPutJson(this.kv, STATE_KEY, normalizeState(state));
  }

  async updateState(mutator) {
    const state = await this.readState();
    const result = await mutator(state);
    await this.writeState(state);
    return result;
  }

  settingsWithDefaults(raw = {}) {
    return {
      check_interval: numberSetting(raw.check_interval, DEFAULT_SETTINGS.check_interval),
      suspect_threshold: numberSetting(raw.suspect_threshold, DEFAULT_SETTINGS.suspect_threshold),
      reboot_cooldown: numberSetting(raw.reboot_cooldown, DEFAULT_SETTINGS.reboot_cooldown),
      recover_timeout: numberSetting(raw.recover_timeout, DEFAULT_SETTINGS.recover_timeout),
      recover_check_interval: numberSetting(raw.recover_check_interval, DEFAULT_SETTINGS.recover_check_interval),
      api_timeout: numberSetting(raw.api_timeout, DEFAULT_SETTINGS.api_timeout),
      default_daily_reboot_limit: numberSetting(raw.default_daily_reboot_limit, DEFAULT_SETTINGS.default_daily_reboot_limit),
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
      pushplus_token: raw.pushplus_token || '',
      timezone: raw.timezone || DEFAULT_SETTINGS.timezone,
      setup_completed: raw.setup_completed || '0',
    };
  }

  async getSettings() {
    const state = await this.readState();
    return this.settingsWithDefaults(state.settings);
  }

  async getSetting(key, fallback = '') {
    const state = await this.readState();
    return state.settings[key] ?? fallback;
  }

  async setSetting(key, value) {
    await this.updateState((state) => {
      state.settings[key] = String(value);
    });
  }

  async listEnabledServers() {
    return (await this.listServers()).filter((server) => server.enabled);
  }

  async listServers() {
    const state = await this.readState();
    return state.servers.map((server) => ({ ...server, enabled: server.enabled !== false }));
  }

  async getServer(id) {
    return (await this.listServers()).find((server) => String(server.id) === String(id)) || null;
  }

  async listProviders() {
    const state = await this.readState();
    return [...state.providers].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  async getProvider(name) {
    const state = await this.readState();
    return state.providers.find((provider) => provider.name === name) || null;
  }

  async updateProvider(provider) {
    await this.updateState((state) => {
      const index = state.providers.findIndex((item) => item.name === provider.name);
      if (index >= 0) state.providers[index] = { ...state.providers[index], ...provider, updated_at: Math.floor(Date.now() / 1000) };
    });
  }

  async upsertProvider(provider, now) {
    await this.updateState((state) => {
      const next = { ...provider, created_at: provider.created_at || now, updated_at: now };
      const index = state.providers.findIndex((item) => item.name === provider.name);
      if (index >= 0) state.providers[index] = { ...state.providers[index], ...next };
      else state.providers.push(next);
    });
  }

  async upsertServer(server, now) {
    await this.updateState((state) => {
      const next = { ...server, enabled: server.enabled !== false, created_at: server.created_at || now, updated_at: now };
      const index = state.servers.findIndex((item) => String(item.id) === String(server.id));
      if (index >= 0) state.servers[index] = { ...state.servers[index], ...next };
      else state.servers.push(next);
    });
  }

  async deleteServer(id) {
    await this.updateState((state) => {
      state.servers = state.servers.filter((server) => String(server.id) !== String(id));
      delete state.runtimes[String(id)];
    });
  }

  async resetTutorialData() {
    const state = await this.readState();
    const adminTokenHash = state.settings.admin_token_hash || '';
    const next = defaultState();
    if (adminTokenHash) next.settings.admin_token_hash = adminTokenHash;
    await this.writeState(next);
  }

  async getRuntime(serverId) {
    const state = await this.readState();
    const row = state.runtimes[String(serverId)];
    return row ? createRuntime(row) : null;
  }

  async saveRuntime(serverId, runtime) {
    await this.updateState((state) => {
      state.runtimes[String(serverId)] = runtime;
    });
  }

  async addEvent(event) {
    await this.updateState((state) => {
      state.events.push({ id: state.next_event_id++, ...event });
      state.events = state.events.slice(-500);
    });
  }

  async addCheckResult(result) {
    await this.updateState((state) => {
      state.check_results.push({ id: state.next_check_id++, ...result, ok: Boolean(result.ok) });
      state.check_results = state.check_results.slice(-3000);
    });
  }

  async pruneCheckResults(retentionDays, now = Math.floor(Date.now() / 1000)) {
    const days = Number(retentionDays || 0);
    if (!Number.isFinite(days) || days <= 0) return;
    const before = Math.floor(now - days * 24 * 60 * 60);
    await this.updateState((state) => {
      state.check_results = state.check_results.filter((row) => Number(row.created_at || 0) >= before);
    });
  }

  async listRecentChecks(serverId, limit = 60) {
    const state = await this.readState();
    return state.check_results
      .filter((row) => String(row.server_id) === String(serverId))
      .sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0) || Number(b.id || 0) - Number(a.id || 0))
      .slice(0, limit)
      .map((row) => ({ ok: Boolean(row.ok), latency_ms: Number(row.latency_ms || 0), created_at: Number(row.created_at || 0) }));
  }

  async countRecentReboots(serverId, since) {
    const state = await this.readState();
    return state.events.filter((event) => String(event.server_id) === String(serverId)
      && event.old_state === 'rebooting'
      && event.new_state === 'recovering'
      && Number(event.created_at || 0) >= since).length;
  }

  async listStatus() {
    const state = await this.readState();
    return state.servers.filter((server) => server.enabled !== false).map((server) => {
      const runtime = state.runtimes[String(server.id)] || {};
      const last = [...state.check_results].reverse().find((row) => String(row.server_id) === String(server.id)) || {};
      return { ...server, ...runtime, last_latency_ms: Number(last.latency_ms || 0) };
    });
  }

  async listEvents(limit = 50) {
    const state = await this.readState();
    return [...state.events].sort((a, b) => Number(b.id || 0) - Number(a.id || 0)).slice(0, limit);
  }

  async listDailyHistory(serverIds, days = 30, now = Math.floor(Date.now() / 1000)) {
    const state = await this.readState();
    const since = now - days * 24 * 60 * 60;
    const grouped = new Map(serverIds.map((id) => [String(id), []]));
    const buckets = new Map();
    for (const row of state.check_results.filter((item) => serverIds.map(String).includes(String(item.server_id)) && Number(item.created_at || 0) >= since)) {
      const date = new Date(Number(row.created_at || 0) * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const key = `${row.server_id}|${date}`;
      const bucket = buckets.get(key) || { server_id: String(row.server_id), date, total: 0, ok: 0, latency: 0 };
      bucket.total += 1;
      bucket.ok += row.ok ? 1 : 0;
      bucket.latency += Number(row.latency_ms || 0);
      buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) {
      grouped.get(bucket.server_id)?.push({
        date: bucket.date,
        checks: bucket.total,
        failures: Math.max(0, bucket.total - bucket.ok),
        uptime: percent(bucket.ok, bucket.total),
        avg_latency_ms: Math.round(bucket.latency / bucket.total),
        downtime_seconds: Math.max(0, bucket.total - bucket.ok) * 300,
      });
    }
    return grouped;
  }

  async listPublicEvents(serverIds, limit = 80) {
    const grouped = new Map(serverIds.map((id) => [String(id), []]));
    const events = (await this.listEvents(limit)).filter((event) => serverIds.map(String).includes(String(event.server_id)));
    for (const event of events) grouped.get(String(event.server_id))?.push(event);
    return grouped;
  }
}
