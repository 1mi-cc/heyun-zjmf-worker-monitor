import assert from 'node:assert/strict';
import test from 'node:test';

import { runMonitorOnce } from '../src/monitor.js';

class FakeRepo {
  constructor(data) {
    this.data = data;
    this.saved = [];
    this.events = [];
    this.providers = [];
  }

  async getSettings() { return this.data.settings; }
  async listEnabledServers() { return this.data.servers; }
  async getProvider(name) { return this.data.providers[name]; }
  async updateProvider(provider) { this.providers.push({ ...provider }); }
  async getRuntime(id) { return this.data.runtimes[id]; }
  async saveRuntime(id, runtime) { this.data.runtimes[id] = runtime; this.saved.push({ id, runtime }); }
  async addEvent(event) { this.events.push(event); }
  async countRecentReboots(id, since) {
    this.recentRebootQuery = { id, since };
    return this.data.recentReboots?.[id] ?? 0;
  }
}

test('runMonitorOnce 将连续异常服务器推进到 down 并执行重启', async () => {
  const repo = new FakeRepo({
    settings: {
      suspect_threshold: 3,
      reboot_cooldown: 300,
      recover_timeout: 300,
      default_daily_reboot_limit: 3,
      api_timeout: 60,
      timezone: 'Asia/Shanghai',
    },
    providers: {
      heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 },
    },
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', daily_reboot_limit: 0, scheduled_reboot: '' }],
    runtimes: {
      4075: {
        state: 'suspect',
        consecutive_failures: 2,
        consecutive_successes: 0,
        last_check_time: 0,
        last_reboot_time: 100,
        reboot_count_today: 0,
        reboot_date: '2026-05-10',
        last_status_value: '',
        state_changed_at: 1000,
        first_failure_at: 1000,
        reboot_initiated_at: 0,
        scheduled_reboot_date: '',
      },
    },
  });
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  const summary = await runMonitorOnce({
    repo,
    fetcher,
    now: 1778382000,
    date: new Date('2026-05-10T03:00:00Z'),
  });
  assert.equal(summary.checked, 1);
  assert.equal(repo.data.runtimes['4075'].state, 'recovering');
  assert.equal(repo.data.runtimes['4075'].reboot_count_today, 1);
  assert.equal(repo.data.runtimes['4075'].reboot_date, '2026-05-10');
  assert.equal(calls.some((c) => c.url.includes('/hard_reboot')), true);
  assert.equal(repo.events.some((event) => event.new_state === 'down'), true);
});

test('runMonitorOnce 忽略旧配置中的定时重启字段', async () => {
  const repo = new FakeRepo({
    settings: {
      suspect_threshold: 2,
      reboot_cooldown: 300,
      recover_timeout: 300,
      default_daily_reboot_limit: 3,
      api_timeout: 60,
      timezone: 'Asia/Shanghai',
      check_interval: 300,
    },
    providers: {
      heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 },
    },
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', daily_reboot_limit: 3, scheduled_reboot: '04:00' }],
    runtimes: { 4075: null },
  });
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'on' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  const summary = await runMonitorOnce({
    repo,
    fetcher,
    now: 1778356800,
    today: '2026-05-10',
    date: new Date('2026-05-09T20:00:00Z'),
  });

  assert.equal(summary.checked, 1);
  assert.equal(calls.some((c) => c.url.includes('/hard_reboot')), false);
});

test('runMonitorOnce 支持 HTTP 检测并在第 3 次失败后重启', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: 'Web', provider: 'heyun', check_method: 'http', http_url: 'https://web.example/health', http_expected_status: '200-399', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 1000, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(calls.some((url) => url.includes('web.example')), true);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), true);
  assert.equal(repo.data.runtimes['4075'].state, 'recovering');
  assert.equal(repo.data.runtimes['4075'].last_status_value, 'HTTP 503');
});

test('runMonitorOnce 支持 TCP 端口检测成功', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '443', name: 'TCP', provider: 'heyun', check_method: 'tcp', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
    runtimes: { 443: null },
  });
  const tcpCalls = [];
  const tcpConnector = async (host, port) => { tcpCalls.push({ host, port }); return true; };

  await runMonitorOnce({ repo, fetcher: async () => new Response('{}'), tcpConnector, now: 1778382000 });

  assert.deepEqual(tcpCalls, [{ host: 'tcp.example', port: 443 }]);
  assert.equal(repo.data.runtimes['443'].state, 'healthy');
  assert.equal(repo.data.runtimes['443'].last_status_value, 'TCP 443 open');
});

test('runMonitorOnce 用最近 24 小时重启次数判断上限', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 3, reboot_date: '2026-05-10', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
    recentReboots: { 4075: 1 },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(repo.recentRebootQuery.since, 1778382000 - 86400);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), true);
  assert.equal(repo.data.runtimes['4075'].reboot_count_today, 2);
});
