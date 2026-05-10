import assert from 'node:assert/strict';
import test from 'node:test';

import { renderAdminPage } from '../src/admin-page.js';

test('管理后台页面使用 ZJMF_ADMIN_TOKEN 登录且不嵌入真实密码', () => {
  const html = renderAdminPage();

  assert.match(html, /管理面板/);
  assert.match(html, /ZJMF_ADMIN_TOKEN/);
  assert.match(html, /\/api\/admin\/overview/);
  assert.match(html, /\/api\/admin\/events/);
  assert.match(html, /监控项/);
  assert.match(html, /事件日志/);
  assert.match(html, /新建监控项/);
  assert.match(html, /id="editModal"/);
  assert.match(html, /保存服务商/);
  assert.match(html, /保存服务器/);
  assert.match(html, /id="toast"/);
  assert.match(html, /操作中/);
  assert.match(html, /async function task/);
  assert.match(html, /wasDisabled/);
  assert.match(html, /const scrub=/);
  assert.match(html, /background-size:50px 50px/);
  assert.match(html, /--bg:#f5f7fb/);
  assert.match(html, /留空则保留旧密钥/);
  assert.match(html, /localStorage\.getItem\('zjmf_admin_token'\)/);
  assert.doesNotMatch(html, /服务器 IP|1\.2\.3\.4/);
  assert.doesNotMatch(html, /super-secret-admin-password/);
});
