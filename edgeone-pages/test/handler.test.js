import assert from 'node:assert/strict';
import test from 'node:test';

import { handleEdgeOneRequest, edgeOneTcpConnector } from '../src/handler.js';
import { onRequest } from '../edge-functions/index.js';

class MemoryKV {
  constructor() {
    this.map = new Map();
  }

  async get(key) {
    return this.map.get(key) || null;
  }

  async put(key, value) {
    this.map.set(key, value);
  }
}

test('EdgeOne handler 渲染初始化页', async () => {
  const res = await handleEdgeOneRequest(new Request('https://edgeone.example/'), {
    ADMIN_TOKEN: 'admin',
    ZJMF_KV: new MemoryKV(),
  });
  const html = await res.text();

  assert.equal(res.status, 200);
  assert.match(html, /首次配置|管理面板/);
});

test('EdgeOne handler 使用 KV 管理接口', async () => {
  const kv = new MemoryKV();
  const env = { ADMIN_TOKEN: 'admin', ZJMF_KV: kv };
  const res = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/settings', {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin',
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ setup_completed: '1' }),
  }), env);
  const data = await res.json();

  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
});

test('EdgeOne handler 支持全局 KV 绑定变量', async () => {
  const kv = new MemoryKV();
  const previous = globalThis.ZJMF_KV;
  globalThis.ZJMF_KV = kv;
  try {
    const res = await handleEdgeOneRequest(new Request('https://edgeone.example/'), {
      ADMIN_TOKEN: 'admin',
    });
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /首次配置|管理面板/);
  } finally {
    if (previous === undefined) {
      delete globalThis.ZJMF_KV;
    } else {
      globalThis.ZJMF_KV = previous;
    }
  }
});

test('EdgeOne TCP 连接器不依赖 Node 原生模块', async () => {
  await assert.rejects(
    () => edgeOneTcpConnector('127.0.0.1', 996, 1000),
    /EdgeOne Pages 暂不支持 TCP 原生端口探测/,
  );
});

test('Edge Function 入口支持全局 KV 绑定', async () => {
  const previous = globalThis.ZJMF_KV;
  globalThis.ZJMF_KV = new MemoryKV();
  try {
    const res = await onRequest({
      request: new Request('https://edgeone.example/'),
      env: { ADMIN_TOKEN: 'admin' },
    });
    const html = await res.text();

    assert.equal(res.status, 200);
    assert.match(html, /首次配置|管理面板/);
  } finally {
    if (previous === undefined) {
      delete globalThis.ZJMF_KV;
    } else {
      globalThis.ZJMF_KV = previous;
    }
  }
});

test('管理初始化弹窗支持滚动显示完整内容', async () => {
  const res = await handleEdgeOneRequest(new Request('https://edgeone.example/admin'), {
    ADMIN_TOKEN: 'admin',
    ZJMF_KV: new MemoryKV(),
  });
  const html = await res.text();

  assert.match(html, /#setupWizardModal,#notifyModal,#editModal\{align-items:start;overflow:auto\}/);
  assert.match(html, /#setupWizardModal \.setup-modal\{width:min\(1180px,calc\(100vw - 48px\)\);scrollbar-gutter:stable\}/);
  assert.match(html, /HTTP\(S\) \+ API（EdgeOne 选这个）/);
  assert.match(html, /HTTP\(S\) \+ TCP \+ API<\/option>/);
  assert.match(html, /probeTcpField is-hidden/);
  assert.doesNotMatch(html, /三步检测/);
});

test('EdgeOne 初始化默认使用 HTTP(S) + API', async () => {
  const kv = new MemoryKV();
  const env = { ADMIN_TOKEN: 'admin', ZJMF_KV: kv };
  const setup = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/setup', {
    method: 'POST',
    headers: {
      authorization: 'Bearer admin',
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      providers: [{
        name: 'heyunidc',
        display_name: '核云',
        api_base_url: 'https://api.example/v1',
        api_account: 'account',
        api_password: 'secret',
      }],
      servers: [{
        id: '1001',
        name: '测试服务器',
        provider: 'heyunidc',
      }],
      settings: {},
      notification: { enabled: false },
    }),
  }), env);

  assert.equal(setup.status, 200);
  const overview = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/overview', {
    headers: { authorization: 'Bearer admin' },
  }), env);
  const data = await overview.json();

  assert.equal(data.servers[0].check_method, 'http_then_api');
});

test('管理面板顶部提供重走初始教程入口', async () => {
  const res = await handleEdgeOneRequest(new Request('https://edgeone.example/admin'), {
    ADMIN_TOKEN: 'admin',
    ZJMF_KV: new MemoryKV(),
  });
  const html = await res.text();

  assert.match(html, /重走初始教程/);
  assert.match(html, /data-action="restart-tutorial"/);
});

test('重走初始教程会清空现有数据但保留管理密码', async () => {
  const kv = new MemoryKV();
  const env = { ADMIN_TOKEN: 'admin', ZJMF_KV: kv };
  const headers = (token) => ({
    authorization: `Bearer ${token}`,
    'content-type': 'application/json; charset=utf-8',
  });
  await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/password', {
    method: 'POST',
    headers: headers('admin'),
    body: JSON.stringify({ old_password: 'admin', password: 'secret123' }),
  }), env);
  await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/setup', {
    method: 'POST',
    headers: headers('secret123'),
    body: JSON.stringify({
      providers: [{
        name: 'heyunidc',
        display_name: '核云',
        api_base_url: 'https://api.example/v1',
        api_account: 'account',
        api_password: 'secret',
      }],
      servers: [{
        id: '1001',
        name: '测试服务器',
        provider: 'heyunidc',
      }],
      settings: {},
      notification: { enabled: false },
    }),
  }), env);
  const reset = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/setup/reset', {
    method: 'POST',
    headers: headers('secret123'),
  }), env);
  assert.equal(reset.status, 200);

  const overview = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/overview', {
    headers: { authorization: 'Bearer secret123' },
  }), env);
  const data = await overview.json();

  assert.equal(data.providers.length, 0);
  assert.equal(data.servers.length, 0);
  assert.equal(data.settings.setup_completed, '0');
});

test('保存服务器时自动使用已有服务商', async () => {
  const kv = new MemoryKV();
  const env = { ADMIN_TOKEN: 'admin', ZJMF_KV: kv };
  const headers = {
    authorization: 'Bearer admin',
    'content-type': 'application/json; charset=utf-8',
  };
  await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/setup', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      providers: [{
        name: 'heyunidc_18817567790',
        display_name: '核云',
        api_base_url: 'https://api.example/v1',
        api_account: '18817567790',
        api_password: 'secret',
      }],
      servers: [],
      settings: {},
      notification: { enabled: false },
    }),
  }), env);

  const save = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/servers', {
    method: 'POST',
    headers,
    body: JSON.stringify({ id: '1001', name: '测试服务器', provider: 'heyunidc' }),
  }), env);
  assert.equal(save.status, 200);

  const overview = await handleEdgeOneRequest(new Request('https://edgeone.example/api/admin/overview', {
    headers: { authorization: 'Bearer admin' },
  }), env);
  const data = await overview.json();

  assert.equal(data.servers[0].provider, 'heyunidc_18817567790');
});
