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
        scheduled_reboot: this.args[7],
        http_url: this.args[8],
        tcp_port: this.args[12],
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
    fetcher: overrides.fetcher,
    DB: new FakeD1({
      settings: {
        pushplus_token: 'pushplus-secret',
        suspect_threshold: '2',
        reboot_cooldown: '300',
        recover_timeout: '300',
        ...(overrides.settings || {}),
      },
      providers: [
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
      deletedRuntimes: [],
      deletedServers: [],
      servers: overrides.servers || [{ id: '8564', name: '主服务器', ip: '203.0.113.10', provider: 'heyunidc', enabled: 1 }],
      status: [{
        id: '8564',
        name: '203.0.113.10',
        ip: '203.0.113.10',
        http_url: 'https://203.0.113.10/health',
        tcp_host: '203.0.113.10',
        tcp_port: 443,
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
    body: JSON.stringify({ password: 'changed-password' }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.settings.admin_token_hash, sha256('changed-password'));
});

test('管理后台可以自动获取魔方财务产品列表', async () => {
  const testEnv = env({
    fetcher: async (url) => {
      if (String(url).includes('login_api')) return new Response(JSON.stringify({ jwt: 'jwt-1' }));
      return new Response(JSON.stringify({ data: { host: [{ id: '4075', name: '主服务器', ip: '203.0.113.10' }] } }));
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
  assert.equal(data.hosts[0].ip, undefined);
});

test('初始化接口一次保存服务商、服务器、监控参数和通知设置', async () => {
  const testEnv = env();
  const res = await handleRequest(new Request('https://worker.example/api/admin/setup', {
    method: 'POST',
    headers: { authorization: 'Bearer admin-password', 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      provider: { name: 'heyunidc', display_name: '核云', api_base_url: 'https://api.example/v1', api_account: 'acct', api_password: 'key' },
      server: { id: '4075', name: '主服务器', provider: 'heyunidc', check_method: 'api_only', daily_reboot_limit: 5 },
      settings: { check_interval: 120, api_timeout_ms: 15000 },
      notification: { enabled: true, type: 'pushplus', pushplus_token: 'push-token' },
    }),
  }), testEnv);

  assert.equal(res.status, 200);
  assert.equal(testEnv.DB.data.providerWrites[0].api_account, 'acct');
  assert.equal(testEnv.DB.data.serverWrites[0].id, '4075');
  assert.equal(testEnv.DB.data.settings.check_interval, '120');
  assert.equal(testEnv.DB.data.settings.api_timeout, '15');
  assert.equal(testEnv.DB.data.settings.pushplus_token, 'push-token');
  assert.equal(testEnv.DB.data.settings.setup_completed, '1');
});

test('管理概览返回配置并仅隐藏 pushplus token 和服务器 IP', async () => {
  const res = await handleRequest(
    new Request('https://worker.example/api/admin/overview', {
      headers: { authorization: 'Bearer admin-password' },
    }),
    env(),
  );
  const text = await res.text();
  const data = JSON.parse(text);

  assert.equal(res.status, 200);
  assert.equal(data.settings.pushplus_token, '已配置');
  assert.equal(data.settings.webhook_name, 'pushplus');
  assert.equal(data.providers[0].api_password, 'provider-secret');
  assert.doesNotMatch(text, /pushplus-secret|203\.0\.113\.10/);
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
