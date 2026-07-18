import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { handleRequest } from '../src/routes.js';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

class FakeStatement {
  constructor(data, sql) {
    this.data = data;
    this.sql = sql;
  }

  bind() {
    this.args = [...arguments];
    return this;
  }

  async all() {
    if (this.sql.includes('SELECT key, value FROM settings')) {
      return { results: Object.entries(this.data.settings).map(([key, value]) => ({ key, value })) };
    }
    if (this.sql.includes('FROM providers ORDER BY name')) {
      return {
        results: this.data.providers.map(({ name, display_name, api_base_url, api_account, api_password, created_at, updated_at }) => ({
          name,
          display_name,
          api_base_url,
          api_account,
          api_password,
          created_at,
          updated_at,
        })),
      };
    }
    if (this.sql.includes('SELECT * FROM servers ORDER BY id')) return { results: this.data.servers };
    if (this.sql.includes('FROM servers s')) return { results: this.data.status };
    if (this.sql.includes('ORDER BY created_at DESC, id DESC')) return { results: this.data.recentChecks };
    if (this.sql.includes('FROM check_results')) return { results: this.data.dailyResults };
    if (this.sql.includes('FROM events')) return { results: this.data.events };
    throw new Error(`Unexpected SQL: ${this.sql}`);
  }

  async first() {
    if (this.sql.includes('SELECT value FROM settings WHERE key')) {
      const value = this.data.settings[this.args[0]];
      return value == null ? null : { value };
    }
    if (this.sql.includes('SELECT * FROM providers WHERE name')) {
      return this.data.providers.find((provider) => provider.name === this.args[0]) || null;
    }
    if (this.sql.includes('SELECT * FROM servers WHERE id')) {
      return this.data.servers.find((server) => server.id === this.args[0]) || null;
    }
    throw new Error(`Unexpected SQL: ${this.sql}`);
  }

  async run() {
    const sql = this.sql.trim();
    if (this.sql.includes('INSERT INTO providers')) {
      this.data.providerWrites.push({
        name: this.args[0],
        display_name: this.args[1],
        api_base_url: this.args[2],
        api_account: this.args[3],
        api_password: this.args[4],
      });
      return {};
    }
    if (this.sql.includes('INSERT INTO servers')) {
      this.data.serverWrites.push({
        id: this.args[0],
        name: this.args[1],
        ip: this.args[2],
        provider: this.args[3],
        check_method: this.args[4],
        enabled: this.args[5],
        visible_on_status: this.args[6],
        daily_reboot_limit: this.args[7],
        scheduled_reboot: this.args[8],
        http_url: this.args[9],
        tcp_port: this.args[13],
      });
      return {};
    }
    if (this.sql.includes('INSERT INTO events')) {
      this.data.eventWrites.push({
        server_id: this.args[0],
        label: this.args[3],
        level: this.args[4],
        message: this.args[5],
      });
      return {};
    }
    if (sql === 'DELETE FROM check_results') {
      this.data.dailyResults = [];
      this.data.recentChecks = [];
      return {};
    }
    if (sql === 'DELETE FROM events') {
      this.data.events = [];
      return {};
    }
    if (sql === 'DELETE FROM runtimes') {
      this.data.deletedTables.push('runtimes');
      return {};
    }
    if (sql === 'DELETE FROM servers') {
      this.data.servers = [];
      this.data.status = [];
      return {};
    }
    if (sql === 'DELETE FROM providers') {
      this.data.providers = [];
      return {};
    }
    if (sql === 'DELETE FROM settings WHERE key != ?1') {
      for (const key of Object.keys(this.data.settings)) {
        if (key !== this.args[0]) delete this.data.settings[key];
      }
      return {};
    }
    if (this.sql.includes('DELETE FROM runtimes')) {
      this.data.deletedRuntimes.push(this.args[0]);
      return {};
    }
    if (this.sql.includes('DELETE FROM servers')) {
      this.data.deletedServers.push(this.args[0]);
      return {};
    }
    if (this.sql.includes('INSERT INTO settings')) {
      this.data.settings[this.args[0]] = this.args[1];
      return {};
    }
    throw new Error(`Unexpected SQL: ${this.sql}`);
  }
}

class FakeD1 {
  constructor(data) {
    this.data = data;
  }

  prepare(sql) {
    return new FakeStatement(this.data, sql);
  }
}

function env(overrides = {}) {
  return {
    ADMIN_TOKEN: 'admin-password',
    GITHUB_TOKEN: overrides.GITHUB_TOKEN,
    GITHUB_REPOSITORY: overrides.GITHUB_REPOSITORY || 'loqwe/heyun-zjmf-worker-monitor',
    GITHUB_BRANCH: overrides.GITHUB_BRANCH || 'main',
    GITHUB_WORKFLOW_FILE: overrides.GITHUB_WORKFLOW_FILE || 'deploy.yml',
    APP_VERSION: overrides.APP_VERSION || 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    fetcher: overrides.fetcher,
    DB: new FakeD1({
      settings: {
        pushplus_token: 'pushplus-secret',
        suspect_threshold: '2',
        reboot_cooldown: '300',
        recover_timeout: '300',
        ...(overrides.settings || {}),
      },
      providers: overrides.providers || [
        {
          name: 'heyunidc',
          display_name: '核云',
          api_base_url: 'https://api.example/v1',
          api_account: 'account@example.test',
          api_password: 'provider-secret',
        },
      ],
      providerWrites: [],
      serverWrites: [],
      eventWrites: [],
      deletedTables: [],
      deletedRuntimes: [],
      deletedServers: [],
      servers: overrides.servers || [{ id: '8564', name: '主服务器', ip: '203.0.113.10', provider: 'heyunidc', enabled: 1 }],
      status: Object.hasOwn(overrides, 'status') ? overrides.status : [{
        id: '8564',
        name: '203.0.113.10',
        ip: '203.0.113.10',
        http_url: 'https://203.0.113.10/health',
        tcp_host: '203.0.113.10',
        tcp_port: 443,
        visible_on_status: 1,
        state: 'healthy',
        last_status_value: 'on',
      }],
      events: overrides.events || [
        {
          id: 1,
          server_id: '8564',
          old_state: 'suspect',
          new_state: 'down',
          label: '确认宕机',
          level: 'critical',
          message: '测试日志',
          created_at: 1778384953,
        },
      ],
      dailyResults: overrides.dailyResults || [
        { server_id: '8564', date_key: '2026-05-10', total: 2, ok_count: 1, avg_latency_ms: 1500 },
      ],
      recentChecks: overrides.recentChecks || [
        { ok: 1, latency_ms: 120, created_at: 1778385053 },
        { ok: 0, latency_ms: 0, created_at: 1778384753 },
      ],
    }),
  };
}

test('管理接口缺少 ZJMF_ADMIN_TOKEN 对应的 Bearer Token 时拒绝访问', async () => {
  const res = await handleRequest(new Request('https://worker.example/api/admin/overview'), env());

  assert.equal(res.status, 401);
});

test('D1 修改后的管理密码优先于部署时 ADMIN_TOKEN', async () => {
  const testEnv = env({ settings: { admin_token_hash: sha256('new-password') } });
  const oldRes = await handleRequest(new Request('https://worker.example/api/admin/overview', {
    headers: { authorization: 'Bearer admin-password' },
  }), testEnv);
  const newRes = await handleRequest(new Request('https://worker.example/api/admin/overview', {
    headers: { authorization: 'Bearer new-password' },
  }), testEnv);

  assert.equal(oldRes.status, 401);
  assert.equal(newRes.status, 200);
});

test('管理后台可以修改登录密码', async () => {
  const testEnv = env();
  const res = await handleRequest(new Request('https://worker.example/api/admin/password', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ old_password: 'admin-password', password: 'changed-password' }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.settings.admin_token_hash, sha256('changed-password'));
});

test('管理后台修改登录密码时旧密码错误会拒绝', async () => {
  const testEnv = env();
  const res = await handleRequest(new Request('https://worker.example/api/admin/password', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ old_password: 'wrong-password', password: 'changed-password' }),
  }), testEnv);

  assert.equal(res.status, 400);
  assert.equal(testEnv.DB.data.settings.admin_token_hash, undefined);
});

test('管理后台可以自动获取魔方财务产品列表', async () => {
  const testEnv = env({
    fetcher: async (url) => {
      if (String(url).includes('login_api')) return new Response(JSON.stringify({ jwt: 'jwt-1' }));
      return new Response(JSON.stringify({ data: { host: [{ id: '4075', name: '主服务器', ip: '203.0.113.10', port: 996 }] } }));
    },
  });
  const res = await handleRequest(new Request('https://worker.example/api/admin/zjmf/hosts', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ api_base_url: 'https://api.example/v1', api_account: 'acct', api_password: 'key' }),
  }), testEnv);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.hosts[0].id, '4075');
  assert.equal(data.hosts[0].name, '主服务器');
  assert.equal(data.hosts[0].ip, '203.0.113.10');
  assert.equal(data.hosts[0].tcp_host, '203.0.113.10');
  assert.equal(data.hosts[0].tcp_port, 996);
});

test('魔方财务产品列表 TCP 主机只使用接口返回的真实 IP', async () => {
  const testEnv = env({
    fetcher: async (url) => {
      if (String(url).includes('login_api')) return new Response(JSON.stringify({ jwt: 'jwt-1' }));
      return new Response(JSON.stringify({ data: { host: [
        { id: '8564', hostname: 'ser0906873439', dedicatedip: '186.244.244.31', port: 996 },
        { id: '8565', hostname: 'ser-no-ip', port: 996 },
      ] } }));
    },
  });
  const res = await handleRequest(new Request('https://worker.example/api/admin/zjmf/hosts', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ api_base_url: 'https://api.example/v1', api_account: 'acct', api_password: 'key' }),
  }), testEnv);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.hosts[0].name, 'ser0906873439');
  assert.equal(data.hosts[0].ip, '186.244.244.31');
  assert.equal(data.hosts[0].tcp_host, '186.244.244.31');
  assert.equal(data.hosts[1].name, 'ser-no-ip');
  assert.equal(data.hosts[1].ip, '');
  assert.equal(data.hosts[1].tcp_host, '');
});

test('初始化接口一次保存服务商、服务器、监控参数和通知设置', async () => {
  const testEnv = env();
  const res = await handleRequest(new Request('https://worker.example/api/admin/setup', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      provider: { name: 'heyunidc', display_name: '核云', api_base_url: 'https://api.example/v1', api_account: 'acct', api_password: 'key' },
      server: { id: '4075', name: '主服务器', provider: 'heyunidc', daily_reboot_limit: 5 },
      settings: { check_interval: 120, api_timeout_ms: 15000, reboot_limit_window: 'day' },
      notification: {
        enabled: true,
        type: 'telegram',
        notify_failure_silence: true,
        notify_token: 'bot-token',
        notify_target: '10086',
        notify_secret: 'sign-secret',
      },
    }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.providerWrites[0].api_account, 'acct');
  assert.equal(testEnv.DB.data.serverWrites[0].id, '4075');
  assert.equal(testEnv.DB.data.serverWrites[0].check_method, 'service_then_power');
  assert.equal(testEnv.DB.data.settings.check_interval, '120');
  assert.equal(testEnv.DB.data.settings.api_timeout, '15');
  assert.equal(testEnv.DB.data.settings.reboot_limit_window, 'day');
  assert.equal(testEnv.DB.data.settings.default_daily_reboot_limit, '5');
  assert.equal(testEnv.DB.data.settings.notify_failure_silence, 'true');
  assert.equal(testEnv.DB.data.settings.webhook_type, 'telegram');
  assert.equal(testEnv.DB.data.settings.notify_token, 'bot-token');
  assert.equal(testEnv.DB.data.settings.notify_target, '10086');
  assert.equal(testEnv.DB.data.settings.notify_secret, 'sign-secret');
  assert.equal(testEnv.DB.data.settings.setup_completed, '1');
});

test('初始化接口允许跳过魔方财务和服务器导入', async () => {
  const testEnv = env();
  const res = await handleRequest(new Request('https://worker.example/api/admin/setup', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      providers: [],
      servers: [],
      settings: { check_interval: 180, api_timeout_ms: 30000 },
      notification: { enabled: false },
    }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.providerWrites.length, 0);
  assert.equal(testEnv.DB.data.serverWrites.length, 0);
  assert.equal(testEnv.DB.data.settings.check_interval, '180');
  assert.equal(testEnv.DB.data.settings.api_timeout, '30');
  assert.equal(testEnv.DB.data.settings.setup_completed, '1');
});

test('初始化接口支持多个账号一次导入多个服务器', async () => {
  const testEnv = env();
  const res = await handleRequest(new Request('https://worker.example/api/admin/setup', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      providers: [
        { name: 'heyunidc_a', display_name: '核云 A', api_base_url: 'https://api.example/v1', api_account: 'a@example.test', api_password: 'key-a' },
        { name: 'heyunidc_b', display_name: '核云 B', api_base_url: 'https://api.example/v1', api_account: 'b@example.test', api_password: 'key-b' },
      ],
      servers: [
        { id: '1001', name: 'A-1', provider: 'heyunidc_a' },
        { id: '1002', name: 'A-2', provider: 'heyunidc_a' },
        { id: '2001', name: 'B-1', provider: 'heyunidc_b' },
      ],
      settings: { check_interval: 300, api_timeout_ms: 60000 },
    }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.deepEqual(testEnv.DB.data.providerWrites.map((provider) => provider.name), ['heyunidc_a', 'heyunidc_b']);
  assert.deepEqual(testEnv.DB.data.serverWrites.map((server) => server.id), ['1001', '1002', '2001']);
  assert.deepEqual(testEnv.DB.data.serverWrites.map((server) => server.provider), ['heyunidc_a', 'heyunidc_a', 'heyunidc_b']);
  assert.equal(testEnv.DB.data.settings.setup_completed, '1');
});

test('初始化接口缺少必填项时返回具体缺失字段', async () => {
  const res = await handleRequest(new Request('https://worker.example/api/admin/setup', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      provider: { name: 'heyunidc', api_base_url: 'https://api.example/v1' },
      server: { name: '主服务器' },
    }),
  }), env());
  const data = await res.json();

  assert.equal(res.status, 400);
  assert.equal(data.error, 'INVALID_SETUP');
  assert.equal(data.message, '初始化信息不完整');
  assert.deepEqual(data.missing, ['provider.api_account', 'provider.api_password', 'server.id']);
});

test('管理概览返回配置并仅隐藏 pushplus token 和服务器 IP', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/overview', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env({ settings: { telegram_webhook_secret: 'private-webhook-secret' } }),
  );
  const text = await res.text();
  const data = JSON.parse(text);

  assert.equal(res.status, 200);
  assert.equal(data.settings.pushplus_token, '已配置');
  assert.equal(data.settings.notify_token, '已配置');
  assert.equal(data.settings.notify_secret, '');
  assert.equal(data.settings.webhook_name, 'pushplus');
  assert.equal(data.providers[0].api_password, 'provider-secret');
  assert.equal(Object.hasOwn(data.settings, 'telegram_webhook_secret'), false);
  assert.doesNotMatch(text, /pushplus-secret|private-webhook-secret|203\.0\.113\.10/);
});

test('settings update preserves configured notification secrets when the admin form submits masks', async () => {
  const testEnv = env({
    settings: {
      notify_token: 'real-bot-token',
      notify_secret: 'real-signing-secret',
    },
  });

  const res = await handleRequest(new Request('https://worker.example/api/admin/settings', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      notify_token: '已配置',
      notify_secret: '•••',
      notify_target: 'new-chat-id',
    }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.settings.notify_token, 'real-bot-token');
  assert.equal(testEnv.DB.data.settings.notify_secret, 'real-signing-secret');
  assert.equal(testEnv.DB.data.settings.notify_target, 'new-chat-id');
});

test('Telegram 命令 webhook 已移除', async () => {
  const res = await handleRequest(new Request('https://worker.example/api/telegram/webhook', {
    method: 'POST',
  }), env());

  assert.equal(res.status, 404);
});

test('管理员可以清理 Telegram webhook 且不暴露 Token', async () => {
  const calls = [];
  const testEnv = env({
    settings: { notify_token: 'bot-token', telegram_webhook_secret: 'old-secret' },
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, result: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const res = await handleRequest(new Request('https://worker.example/api/admin/telegram/webhook/remove', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password' },
  }), testEnv);
  const text = await res.text();
  const payload = JSON.parse(calls[0].init.body);

  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(text), { ok: true, status: 200 });
  assert.equal(calls[0].input, 'https://api.telegram.org/botbot-token/deleteWebhook');
  assert.deepEqual(payload, { drop_pending_updates: true });
  assert.equal(testEnv.DB.data.settings.telegram_webhook_secret, '');
  assert.doesNotMatch(text, /bot-token|old-secret/);
});

test('管理后台可以立即主动发送服务器状态汇报且不暴露 Telegram Token', async () => {
  const calls = [];
  const testEnv = env({
    settings: {
      webhook_type: 'telegram',
      notify_token: 'bot-token',
      notify_target: '123456',
      status_report_enabled: 'true',
      status_report_interval: '3600',
    },
    status: [{
      id: '8564',
      name: '主服务器',
      ip: '203.0.113.10',
      state: 'healthy',
      last_status_value: 'on',
      last_latency_ms: 88,
    }],
    fetcher: async (input, init) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const res = await handleRequest(new Request('https://worker.example/api/admin/report/send', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password' },
  }), testEnv);
  const text = await res.text();
  const data = JSON.parse(text);
  const payload = JSON.parse(calls[0].init.body);

  assert.equal(res.status, 200);
  assert.equal(data.sent, true);
  assert.equal(data.servers, 1);
  assert.equal(calls[0].input, 'https://api.telegram.org/botbot-token/sendMessage');
  assert.equal(payload.chat_id, '123456');
  assert.match(payload.text, /服务器状态汇报/);
  assert.match(payload.text, /主服务器 \(#8564\).*正常/);
  assert.doesNotMatch(text, /bot-token/);
});

test('管理概览返回数据保留和后台分析默认范围配置', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/overview', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env({
      settings: {
        data_retention_days: '45',
        admin_overview_range: '7d',
        admin_monitor_range: '30d',
      },
    }),
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.settings.data_retention_days, 45);
  assert.equal(data.settings.admin_overview_range, '7d');
  assert.equal(data.settings.admin_monitor_range, '30d');
});

test('管理概览返回站点品牌和状态切换默认值配置', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/overview', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env({
      settings: {
        site_title: '核云状态页',
        site_description: '自定义状态页描述',
        timezone: 'UTC',
        suspect_threshold: '4',
        recover_success_threshold: '2',
      },
    }),
  );
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.settings.site_title, '核云状态页');
  assert.equal(data.settings.site_description, '自定义状态页描述');
  assert.equal(data.settings.timezone, 'UTC');
  assert.equal(data.settings.suspect_threshold, 4);
  assert.equal(data.settings.recover_success_threshold, 2);
});

test('管理概览优先返回启用服务器，避免表单默认选中旧禁用记录', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/overview', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env({
      servers: [
        { id: '4075', name: '旧服务器', provider: 'heyunidc', enabled: 0 },
        { id: '8564', name: '主服务器', provider: 'heyunidc', enabled: 1 },
      ],
    }),
  );
  const data = await res.json();

  assert.equal(data.servers[0].id, '8564');
  assert.equal(data.servers[0].enabled, true);
});

test('公共状态接口不返回服务器 IP', async () => {
  const res = await handleRequest(new Request('https://worker.example/api/status'), env());
  const text = await res.text();
  const data = JSON.parse(text);

  assert.equal(res.status, 200);
  assert.equal(data.servers[0].name, '服务器 #8564');
  assert.equal(data.servers[0].ip, undefined);
  assert.equal(data.servers[0].http_url, undefined);
  assert.equal(data.servers[0].tcp_host, undefined);
  assert.doesNotMatch(text, /203\.0\.113\.10/);
});

test('公共状态接口隐藏不在状态页显示的服务器', async () => {
  const res = await handleRequest(new Request('https://worker.example/api/status'), env({
    servers: [
      { id: '8564', name: '主服务器', ip: '203.0.113.10', provider: 'heyunidc', enabled: 1, visible_on_status: 0 },
    ],
    status: [{
      id: '8564',
      name: '203.0.113.10',
      ip: '203.0.113.10',
      http_url: 'https://203.0.113.10/health',
      tcp_host: '203.0.113.10',
      tcp_port: 443,
      state: 'healthy',
      last_status_value: 'on',
      visible_on_status: 0,
    }],
  }));
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.servers.length, 0);
});

test('未完成初始化时根路径直接显示首次配置向导', async () => {
  const res = await handleRequest(new Request('https://worker.example/'), env());
  const text = await res.text();

  assert.equal(res.status, 200);
  assert.match(text, /首次打开网站/);
  assert.match(text, /开始初始化监控系统/);
  assert.match(text, /确定进入/);
  assert.match(text, /ZJMF_ADMIN_TOKEN/);
});

test('未完成初始化时 /admin 也先显示首次确认弹窗', async () => {
  const res = await handleRequest(new Request('https://worker.example/admin'), env());
  const text = await res.text();

  assert.equal(res.status, 200);
  assert.match(text, /开始初始化监控系统/);
  assert.match(text, /取消/);
  assert.match(text, /确定进入/);
});

test('公共状态接口返回真实天级可用性和事件历史且不泄露地址', async () => {
  const res = await handleRequest(new Request('https://worker.example/api/status'), env({
    events: [
      {
        id: 2,
        server_id: '8564',
        old_state: 'down',
        new_state: 'rebooting',
        label: '触发重启',
        level: 'critical',
        message: '203.0.113.10 已触发重启',
        created_at: 1778385053,
      },
    ],
    dailyResults: [
      { server_id: '8564', date_key: '2026-05-10', total: 3, ok_count: 2, avg_latency_ms: 1200 },
      { server_id: '8564', date_key: '2026-05-11', total: 1, ok_count: 1, avg_latency_ms: 900 },
    ],
  }));
  const text = await res.text();
  const data = JSON.parse(text);

  assert.equal(res.status, 200);
  assert.equal(data.servers[0].daily_history.length, 2);
  assert.equal(data.servers[0].daily_history[0].uptime, '66.667%');
  assert.equal(data.servers[0].daily_history[0].failures, 1);
  assert.equal(data.servers[0].recent_checks.length, 2);
  assert.equal(data.servers[0].recent_checks[0].latency_ms, 120);
  assert.equal(data.servers[0].events[0].label, '触发重启');
  assert.doesNotMatch(text, /203\.0\.113\.10|api\.example|provider-secret|pushplus-secret/);
});

test('管理后台保存脱敏服务器时保留原 IP', async () => {
  const testEnv = env();
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/servers', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-password',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ id: '8564', name: '主服务器', provider: 'heyunidc', enabled: false }),
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.serverWrites[0].ip, '203.0.113.10');
});

test('管理后台保存服务器时清空旧定时重启配置', async () => {
  const testEnv = env();
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/servers', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-password',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        id: '8564',
        name: '主服务器',
        provider: 'heyunidc',
        enabled: true,
        check_method: 'http',
        http_url: 'https://example.test/health',
        tcp_port: 443,
        scheduled_reboot: '04:00',
      }),
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.serverWrites[0].scheduled_reboot, '');
  assert.equal(testEnv.DB.data.serverWrites[0].check_method, 'http');
  assert.equal(testEnv.DB.data.serverWrites[0].http_url, 'https://example.test/health');
  assert.equal(testEnv.DB.data.serverWrites[0].tcp_port, 443);
});

test('管理后台保存服务器时会写入 visible_on_status', async () => {
  const testEnv = env();
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/servers', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-password',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        id: '8564',
        name: '主服务器',
        provider: 'heyunidc',
        visible_on_status: false,
      }),
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.serverWrites[0].visible_on_status, 0);
});

test('管理后台编辑服务器时不传重启次数上限会保留旧值', async () => {
  const testEnv = env({
    servers: [
      { id: '8564', name: '主服务器', ip: '203.0.113.10', provider: 'heyunidc', enabled: 1, daily_reboot_limit: 7 },
    ],
  });
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/servers', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-password',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        id: '8564',
        name: '主服务器',
        provider: 'heyunidc',
      }),
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.serverWrites[0].daily_reboot_limit, 7);
});

test('管理后台删除监控项会删除配置和运行状态并写入日志', async () => {
  const testEnv = env();
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/servers/8564', {
      method: 'DELETE',
      headers: { authorization: 'Bearer admin-password' },
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.deepEqual(testEnv.DB.data.deletedRuntimes, ['8564']);
  assert.deepEqual(testEnv.DB.data.deletedServers, ['8564']);
  assert.equal(testEnv.DB.data.eventWrites[0].label, '删除监控项');
  assert.doesNotMatch(testEnv.DB.data.eventWrites[0].message, /203\.0\.113\.10/);
});

test('管理日志接口返回最近事件且不泄露服务器 IP', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/events', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env(),
  );
  const text = await res.text();
  const data = JSON.parse(text);

  assert.equal(res.status, 200);
  assert.equal(data.events[0].server_id, '8564');
  assert.match(data.events[0].message, /测试日志/);
  assert.doesNotMatch(text, /203\.0\.113\.10|provider-secret|pushplus-secret/);
});

test('管理概览附带最近事件，后台无需额外首屏请求日志', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/overview', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env(),
  );
  const data = await res.json();

  assert.equal(data.events[0].label, '确认宕机');
});

test('已有服务商保存时允许 API 密钥留空并保留旧密钥', async () => {
  const testEnv = env();
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/providers', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-password',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        name: 'heyunidc',
        display_name: '核云',
        api_base_url: 'https://api.example/v1',
        api_account: 'new-account@example.test',
      }),
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.providerWrites[0].api_password, 'provider-secret');
});

test('重走初始教程会清空现有数据但保留管理密码', async () => {
  const testEnv = env({ settings: { admin_token_hash: sha256('changed-password') } });
  const res = await handleRequest(new Request('https://worker.example/api/admin/setup/reset', {
    method: 'POST',
    headers: { authorization: 'Bearer changed-password' },
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.providers.length, 0);
  assert.equal(testEnv.DB.data.servers.length, 0);
  assert.equal(testEnv.DB.data.events.length, 0);
  assert.equal(testEnv.DB.data.dailyResults.length, 0);
  assert.equal(testEnv.DB.data.recentChecks.length, 0);
  assert.equal(testEnv.DB.data.settings.admin_token_hash, sha256('changed-password'));
  assert.equal(testEnv.DB.data.settings.setup_completed, undefined);
});

test('保存服务器时会回退到现有服务商，避免 PROVIDER_NOT_FOUND', async () => {
  const testEnv = env({
    providers: [
      {
        name: 'heyunidc_186_244_244_31',
        display_name: '核云 2',
        api_base_url: 'https://api.example/v1',
        api_account: 'account2@example.test',
        api_password: 'provider-secret-2',
      },
    ],
    servers: [{ id: '8564', name: '主服务器', ip: '203.0.113.10', provider: 'heyunidc_186_244_244_31', enabled: 1 }],
  });
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/servers', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-password',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        id: '8564',
        name: '主服务器',
        provider: 'heyunidc',
        enabled: true,
        check_method: 'http',
        http_url: 'https://example.test/health',
      }),
    }),
    testEnv,
  );

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.serverWrites[0].provider, 'heyunidc_186_244_244_31');
});

test('系统更新检查会读取 GitHub 最新提交并返回更新状态', async () => {
  const calls = [];
  const testEnv = env({
    APP_VERSION: '1111111111111111111111111111111111111111',
    fetcher: async (input, init = {}) => {
      calls.push({ input: String(input), init });
      return new Response(JSON.stringify({
        sha: '2222222222222222222222222222222222222222',
        commit: { message: 'feat: 更新页面' },
      }));
    },
  });
  const res = await handleRequest(new Request('https://worker.example/api/admin/update/check', {
    headers: { authorization: 'Bearer admin-password' },
  }), testEnv);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.configured, true);
  assert.equal(data.update_available, true);
  assert.equal(data.current_sha, '1111111111111111111111111111111111111111');
  assert.equal(data.latest_sha, '2222222222222222222222222222222222222222');
  assert.match(calls[0].input, /api\.github\.com\/repos\/loqwe\/heyun-zjmf-worker-monitor\/commits\/main/);
});

test('系统更新检查失败时返回 GitHub API 的具体原因', async () => {
  const testEnv = env({
    fetcher: async () => new Response(JSON.stringify({
      message: 'Not Found',
      documentation_url: 'https://docs.github.com/rest/commits/commits#get-a-commit',
    }), { status: 404 }),
  });
  const res = await handleRequest(new Request('https://worker.example/api/admin/update/check', {
    headers: { authorization: 'Bearer admin-password' },
  }), testEnv);
  const data = await res.json();

  assert.equal(res.status, 502);
  assert.equal(data.error, 'GITHUB_CHECK_FAILED');
  assert.equal(data.status, 404);
  assert.equal(data.github_message, 'Not Found');
  assert.equal(data.documentation_url, 'https://docs.github.com/rest/commits/commits#get-a-commit');
  assert.equal(data.repo, 'loqwe/heyun-zjmf-worker-monitor');
  assert.equal(data.branch, 'main');
});

test('系统更新确认会触发 GitHub Actions workflow_dispatch', async () => {
  const calls = [];
  const testEnv = env({
    GITHUB_TOKEN: 'ghp-test-token',
    fetcher: async (input, init = {}) => {
      calls.push({ input: String(input), init });
      return new Response(null, { status: 204 });
    },
  });
  const res = await handleRequest(new Request('https://worker.example/api/admin/update/dispatch', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password' },
  }), testEnv);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.match(calls[0].input, /api\.github\.com\/repos\/loqwe\/heyun-zjmf-worker-monitor\/actions\/workflows\/deploy\.yml\/dispatches/);
  assert.deepEqual(JSON.parse(calls[0].init.body), { ref: 'main' });
  assert.match(String(calls[0].init.headers.authorization), /Bearer ghp-test-token/);
});
