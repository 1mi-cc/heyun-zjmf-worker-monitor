Exit code: 0
Wall time: 0.4 seconds
Output:
import assert from 'node:assert/strict';
import test from 'node:test';

import { handleRequest } from '../src/routes.js';

class FakeDB {
  constructor(settings) {
    this.settings = settings;
  }

  prepare(sql) {
    const db = this;
    let params = [];
    const statement = {
      bind(...values) {
        params = values;
        return statement;
      },
      async first() {
        if (sql.includes('SELECT value FROM settings WHERE key')) {
          const value = db.settings[params[0]];
          return value === undefined ? null : { value };
        }
        return null;
      },
      async all() {
        if (sql.includes('SELECT key, value FROM settings')) {
          return { results: Object.entries(db.settings).map(([key, value]) => ({ key, value })) };
        }
        return { results: [] };
      },
    };
    return statement;
  }
}

test('Telegram 鎷掔粷娴嬭瘯娑堟伅鏃堕€氱煡娴嬭瘯鎺ュ彛杩斿洖澶辫触鐘舵€?, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ok":false}', { status: 401 });
  try {
    const request = new Request('https://worker.example/api/admin/notify/test', {
      method: 'POST',
      headers: { authorization: 'Bearer admin' },
    });
    const response = await handleRequest(request, {
      ADMIN_TOKEN: 'admin',
      DB: new FakeDB({
        webhook_type: 'telegram',
        notify_token: 'invalid-bot-token',
        notify_target: '7742227280',
      }),
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { ok: false, status: 401 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Telegram 鎺ュ彈娴嬭瘯娑堟伅鏃堕€氱煡娴嬭瘯鎺ュ彛杩斿洖鎴愬姛鐘舵€?, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"ok":true}', { status: 200 });
  try {
    const request = new Request('https://worker.example/api/admin/notify/test', {
      method: 'POST',
      headers: { authorization: 'Bearer admin' },
    });
    const response = await handleRequest(request, {
      ADMIN_TOKEN: 'admin',
      DB: new FakeDB({
        webhook_type: 'telegram',
        notify_token: 'valid-bot-token',
        notify_target: '7742227280',
      }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, status: 200 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

