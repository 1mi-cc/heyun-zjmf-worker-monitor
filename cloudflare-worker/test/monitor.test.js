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
  async pruneCheckResults(retentionDays, now) {
    this.pruneCheckResultsCall = { retentionDays, now };
  }
}

test('runMonitorOnce 将连续异常的 API-only 关机服务器推进到 down 并执行开机', async () => {
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
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', check_method: 'api_only', daily_reboot_limit: 0, scheduled_reboot: '' }],
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
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '成功' }));
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
  assert.equal(repo.data.runtimes['4075'].reboot_date, '2026-05-10-11');
  assert.equal(calls.some((c) => c.url.includes('/module/on')), true);
  assert.equal(calls.some((c) => c.url.includes('/hard_reboot')), false);
  assert.equal(repo.events.some((event) => event.new_state === 'down'), true);
});

test('runMonitorOnce 发送不泄露目标地址的中文详细通知', async () => {
  const repo = new FakeRepo({
    settings: {
      suspect_threshold: 3,
      reboot_cooldown: 300,
      recover_timeout: 300,
      default_daily_reboot_limit: 3,
      api_timeout: 60,
      timezone: 'Asia/Shanghai',
      check_interval: 300,
      webhook_url: 'https://hook.example/send',
      webhook_type: 'custom',
    },
    providers: {
      heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 },
    },
    servers: [{ id: '4075', name: '综合', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
    runtimes: { 4075: null },
  });
  const hookBodies = [];
  const fetcher = async (url) => {
    const value = String(url);
    if (value === 'https://hook.example/send') {
      return new Response('{}', { status: 200 });
    }
    if (value.includes('web.example')) return new Response('down', { status: 503 });
    if (value.includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };
  const captureFetcher = async (url, init) => {
    if (String(url) === 'https://hook.example/send') hookBodies.push(JSON.parse(init.body));
    return fetcher(url, init);
  };

  await runMonitorOnce({ repo, fetcher: captureFetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(hookBodies.length, 1);
  assert.equal(hookBodies[0].title, '【信息】综合 - 检测异常');
  assert.match(hookBodies[0].message, /监控项：综合 \(#4075\)/);
  assert.match(hookBodies[0].message, /检测方式：三步检测：HTTP\(S\) \+ TCP \+ API/);
  assert.match(hookBodies[0].message, /最近结果：HTTP 503 -> TCP 996 closed -> off/);
  assert.doesNotMatch(hookBodies[0].message, /web\.example|tcp\.example/);
});

test('runMonitorOnce 勾选失败阶段静默后不发送检测异常通知', async () => {
  const repo = new FakeRepo({
    settings: {
      suspect_threshold: 3,
      reboot_cooldown: 300,
      recover_timeout: 300,
      default_daily_reboot_limit: 3,
      api_timeout: 60,
      timezone: 'Asia/Shanghai',
      check_interval: 300,
      webhook_url: 'https://hook.example/send',
      webhook_type: 'custom',
      notify_failure_silence: true,
    },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '综合', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
    runtimes: { 4075: null },
  });
  const hookBodies = [];
  const fetcher = async (url, init) => {
    if (String(url) === 'https://hook.example/send') hookBodies.push(JSON.parse(init.body));
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(repo.events.length, 1);
  assert.equal(repo.events[0].label, '检测异常');
  assert.equal(hookBodies.length, 0);
  assert.equal(repo.data.runtimes['4075'].state, 'suspect');
});

test('runMonitorOnce 勾选失败阶段静默后只推送触发开机通知', async () => {
  const repo = new FakeRepo({
    settings: {
      suspect_threshold: 3,
      reboot_cooldown: 300,
      recover_timeout: 300,
      default_daily_reboot_limit: 3,
      api_timeout: 60,
      timezone: 'Asia/Shanghai',
      check_interval: 300,
      webhook_url: 'https://hook.example/send',
      webhook_type: 'custom',
      notify_failure_silence: true,
    },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', check_method: 'tcp_then_api', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 0, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const hookBodies = [];
  const fetcher = async (url, init) => {
    if (String(url) === 'https://hook.example/send') {
      hookBodies.push(JSON.parse(init.body));
      return new Response('{}');
    }
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.deepEqual(hookBodies.map((body) => body.title), ['【严重】测试机 - 触发开机']);
  assert.deepEqual(repo.events.map((event) => event.label), ['确认宕机', '触发开机', '开机指令已发送']);
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

test('runMonitorOnce HTTP+API 在 HTTP 失败但 API 为 on 时判定正常', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '二步HTTP', provider: 'heyun', check_method: 'http_then_api', http_url: 'https://web.example/health', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const fetcher = async (url) => {
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'on' } }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000 });

  assert.equal(repo.data.runtimes['4075'].state, 'healthy');
  assert.equal(repo.data.runtimes['4075'].last_status_value, 'HTTP 503 -> on');
});

test('runMonitorOnce TCP+API 在 TCP 失败且 API 为 off 时执行开机', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '二步TCP', provider: 'heyun', check_method: 'tcp_then_api', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(calls.some((url) => url.includes('/module/on')), true);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), false);
});

test('runMonitorOnce 三步检测会依次执行 HTTP TCP API 后再判断异常', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', api_account: 'u', api_password: 'p', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '综合', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
    runtimes: { 4075: null },
  });
  const order = [];
  const fetcher = async (url) => {
    const value = String(url);
    if (value.includes('web.example')) { order.push('http'); return new Response('down', { status: 503 }); }
    if (value.includes('/module/status')) { order.push('api'); return new Response(JSON.stringify({ data: { status: 'off' } })); }
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };
  const tcpConnector = async () => { order.push('tcp'); return false; };

  await runMonitorOnce({ repo, fetcher, tcpConnector, now: 1778382000 });

  assert.deepEqual(order, ['http', 'tcp', 'api']);
  assert.equal(repo.data.runtimes['4075'].state, 'suspect');
});

test('runMonitorOnce 三步检测确认关机后执行开机而不是重启', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '综合', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(calls.some((url) => url.includes('/module/on')), true);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), false);
});

test('runMonitorOnce 三步检测在 HTTP TCP 失败但 API 为 on 时判定正常', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '综合', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'on' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(repo.data.runtimes['4075'].state, 'healthy');
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), false);
  assert.equal(calls.some((url) => url.includes('/module/on')), false);
});

test('runMonitorOnce API 请求失败时返回三态 null 且不推进异常计数', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: 'API', provider: 'heyun', check_method: 'api_only', daily_reboot_limit: 3 }],
    runtimes: { 4075: null },
  });
  const fetcher = async (url) => {
    if (String(url).includes('/module/status')) throw new Error('network down');
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000 });

  assert.equal(repo.data.runtimes['4075'].state, 'healthy');
  assert.equal(repo.events.length, 0);
});

test('runMonitorOnce 默认按每小时统计重启次数', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, reboot_limit_window: 'hour', api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 3, reboot_date: '2026-05-10', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
    recentReboots: { 4075: 1 },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(repo.recentRebootQuery.since, 1778382000 - 3600);
  assert.equal(calls.some((url) => url.includes('/module/on')), true);
  assert.equal(repo.data.runtimes['4075'].reboot_count_today, 2);
});

test('runMonitorOnce 可切换为最近 24 小时重启次数判断上限', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, reboot_limit_window: 'day', api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '测试机', provider: 'heyun', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 3, reboot_date: '2026-05-10', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
    recentReboots: { 4075: 1 },
  });
  const fetcher = async (url) => {
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '成功' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(repo.recentRebootQuery.since, 1778382000 - 86400);
});

test('runMonitorOnce 按设置清理过期原始探测结果', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300, data_retention_days: 45 },
    providers: {},
    servers: [],
    runtimes: {},
  });

  await runMonitorOnce({ repo, fetcher: async () => new Response('{}'), now: 1778382000 });

  assert.deepEqual(repo.pruneCheckResultsCall, { retentionDays: 45, now: 1778382000 });
});
