Exit code: 0
Wall time: 0.4 seconds
Output:
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

test('runMonitorOnce 灏嗚繛缁紓甯哥殑 API-only 鍏虫満鏈嶅姟鍣ㄦ帹杩涘埌 down 骞舵墽琛屽紑鏈?, async () => {
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
    servers: [{ id: '4075', name: '娴嬭瘯鏈?, provider: 'heyun', check_method: 'api_only', daily_reboot_limit: 0, scheduled_reboot: '' }],
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
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
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

test('runMonitorOnce 鍙戦€佷笉娉勯湶鐩爣鍦板潃鐨勪腑鏂囪缁嗛€氱煡', async () => {
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
    servers: [{ id: '4075', name: '缁煎悎', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
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
  assert.equal(hookBodies[0].title, '銆愪俊鎭€戠患鍚?- 妫€娴嬪紓甯?);
  assert.match(hookBodies[0].message, /鐩戞帶椤癸細缁煎悎 \(#4075\)/);
  assert.match(hookBodies[0].message, /妫€娴嬫柟寮忥細涓夋妫€娴嬶細HTTP\(S\) \+ TCP \+ API/);
  assert.match(hookBodies[0].message, /鏈€杩戠粨鏋滐細HTTP 503 -> TCP 996 closed -> off/);
  assert.doesNotMatch(hookBodies[0].message, /web\.example|tcp\.example/);
});

test('runMonitorOnce 鍕鹃€夊け璐ラ樁娈甸潤榛樺悗涓嶅彂閫佹娴嬪紓甯搁€氱煡', async () => {
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
    servers: [{ id: '4075', name: '缁煎悎', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
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
  assert.equal(repo.events[0].label, '妫€娴嬪紓甯?);
  assert.equal(hookBodies.length, 0);
  assert.equal(repo.data.runtimes['4075'].state, 'suspect');
});

test('runMonitorOnce 鍕鹃€夊け璐ラ樁娈甸潤榛樺悗鍙帹閫佽Е鍙戝紑鏈洪€氱煡', async () => {
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
    servers: [{ id: '4075', name: '娴嬭瘯鏈?, provider: 'heyun', check_method: 'tcp_then_api', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 0, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const hookBodies = [];
  const fetcher = async (url, init) => {
    if (String(url) === 'https://hook.example/send') {
      hookBodies.push(JSON.parse(init.body));
      return new Response('{}');
    }
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.deepEqual(hookBodies.map((body) => body.title), ['銆愪弗閲嶃€戞祴璇曟満 - 瑙﹀彂寮€鏈?]);
  assert.deepEqual(repo.events.map((event) => event.label), ['纭瀹曟満', '瑙﹀彂寮€鏈?, '寮€鏈烘寚浠ゅ凡鍙戦€?]);
});

test('runMonitorOnce 蹇界暐鏃ч厤缃腑鐨勫畾鏃堕噸鍚瓧娈?, async () => {
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
    servers: [{ id: '4075', name: '娴嬭瘯鏈?, provider: 'heyun', daily_reboot_limit: 3, scheduled_reboot: '04:00' }],
    runtimes: { 4075: null },
  });
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'on' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
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

test('runMonitorOnce 鏀寔 HTTP 妫€娴嬪苟鍦ㄧ 3 娆″け璐ュ悗閲嶅惎', async () => {
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
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(calls.some((url) => url.includes('web.example')), true);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), true);
  assert.equal(repo.data.runtimes['4075'].state, 'recovering');
  assert.equal(repo.data.runtimes['4075'].last_status_value, 'HTTP 503');
});

test('runMonitorOnce 鏀寔 TCP 绔彛妫€娴嬫垚鍔?, async () => {
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

test('runMonitorOnce HTTP+API 鍦?HTTP 澶辫触浣?API 涓?on 鏃跺垽瀹氭甯?, async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '浜屾HTTP', provider: 'heyun', check_method: 'http_then_api', http_url: 'https://web.example/health', daily_reboot_limit: 3 }],
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

test('runMonitorOnce TCP+API 鍦?TCP 澶辫触涓?API 涓?off 鏃舵墽琛屽紑鏈?, async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '浜屾TCP', provider: 'heyun', check_method: 'tcp_then_api', tcp_host: 'tcp.example', tcp_port: 996, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(calls.some((url) => url.includes('/module/on')), true);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), false);
});

test('runMonitorOnce 涓夋妫€娴嬩細渚濇鎵ц HTTP TCP API 鍚庡啀鍒ゆ柇寮傚父', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', api_account: 'u', api_password: 'p', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '缁煎悎', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
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

test('runMonitorOnce 涓夋妫€娴嬬‘璁ゅ叧鏈哄悗鎵ц寮€鏈鸿€屼笉鏄噸鍚?, async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '缁煎悎', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(calls.some((url) => url.includes('/module/on')), true);
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), false);
});

test('runMonitorOnce 涓夋妫€娴嬪湪 HTTP TCP 澶辫触浣?API 涓?on 鏃跺垽瀹氭甯?, async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999999999 } },
    servers: [{ id: '4075', name: '缁煎悎', provider: 'heyun', check_method: 'service_then_power', http_url: 'https://web.example/health', tcp_host: 'tcp.example', tcp_port: 443, daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 0, reboot_date: '', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('web.example')) return new Response('down', { status: 503 });
    if (String(url).includes('/module/status')) return new Response(JSON.stringify({ data: { status: 'on' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, tcpConnector: async () => false, now: 1778382000 });

  assert.equal(repo.data.runtimes['4075'].state, 'healthy');
  assert.equal(calls.some((url) => url.includes('/hard_reboot')), false);
  assert.equal(calls.some((url) => url.includes('/module/on')), false);
});

test('runMonitorOnce API 璇锋眰澶辫触鏃惰繑鍥炰笁鎬?null 涓斾笉鎺ㄨ繘寮傚父璁℃暟', async () => {
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

test('runMonitorOnce 榛樿鎸夋瘡灏忔椂缁熻閲嶅惎娆℃暟', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, reboot_limit_window: 'hour', api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '娴嬭瘯鏈?, provider: 'heyun', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 3, reboot_date: '2026-05-10', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
    recentReboots: { 4075: 1 },
  });
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/module/on')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(repo.recentRebootQuery.since, 1778382000 - 3600);
  assert.equal(calls.some((url) => url.includes('/module/on')), true);
  assert.equal(repo.data.runtimes['4075'].reboot_count_today, 2);
});

test('runMonitorOnce 鍙垏鎹负鏈€杩?24 灏忔椂閲嶅惎娆℃暟鍒ゆ柇涓婇檺', async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, reboot_limit_window: 'day', api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300 },
    providers: { heyun: { name: 'heyun', api_base_url: 'https://api.example/v1', jwt_token: 'jwt', jwt_expire_at: 9999 } },
    servers: [{ id: '4075', name: '娴嬭瘯鏈?, provider: 'heyun', daily_reboot_limit: 3 }],
    runtimes: { 4075: { state: 'suspect', consecutive_failures: 2, consecutive_successes: 0, last_check_time: 0, last_reboot_time: 1000, reboot_count_today: 3, reboot_date: '2026-05-10', last_status_value: '', state_changed_at: 1000, first_failure_at: 1000, reboot_initiated_at: 0, scheduled_reboot_date: '' } },
    recentReboots: { 4075: 1 },
  });
  const fetcher = async (url) => {
    if (String(url).includes('/status')) return new Response(JSON.stringify({ data: { status: 'off' } }));
    if (String(url).includes('/hard_reboot')) return new Response(JSON.stringify({ msg: '鎴愬姛' }));
    return new Response(JSON.stringify({ jwt: 'jwt' }));
  };

  await runMonitorOnce({ repo, fetcher, now: 1778382000, date: new Date('2026-05-10T03:00:00Z') });

  assert.equal(repo.recentRebootQuery.since, 1778382000 - 86400);
});

test('runMonitorOnce 鎸夎缃竻鐞嗚繃鏈熷師濮嬫帰娴嬬粨鏋?, async () => {
  const repo = new FakeRepo({
    settings: { suspect_threshold: 3, reboot_cooldown: 300, recover_timeout: 300, default_daily_reboot_limit: 3, api_timeout: 60, timezone: 'Asia/Shanghai', check_interval: 300, data_retention_days: 45 },
    providers: {},
    servers: [],
    runtimes: {},
  });

  await runMonitorOnce({ repo, fetcher: async () => new Response('{}'), now: 1778382000 });

  assert.deepEqual(repo.pruneCheckResultsCall, { retentionDays: 45, now: 1778382000 });
});

