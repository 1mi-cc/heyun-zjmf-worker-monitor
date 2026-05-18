import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const localScriptDir = path.join(repoRoot, 'windows-one-click-deploy');

function readUtf8(relativePath) {
  return readFileSync(path.join(localScriptDir, relativePath), 'utf8');
}

test('步骤1脚本写明 GitHub 仓库地址并复用为下载源', () => {
  const wrapperBytes = readFileSync(path.join(localScriptDir, '步骤1-一键安装脚本.bat'));
  const wrapperLatin1 = wrapperBytes.toString('binary');
  const installer = readUtf8('步骤1-一键安装.bat');

  assert.match(wrapperLatin1, /UPSTREAM_REPO/);
  assert.match(wrapperLatin1, /chcp 936/);
  assert.match(wrapperLatin1, /REAL_FILE=/);
  assert.match(wrapperLatin1, /releases\/download\/release-step1-bat-v1\/step1-install\.bat/);
  assert.match(installer, /GitHub 仓库地址|UPSTREAM_REPO/);
  assert.match(installer, /raw\.githubusercontent\.com/);
});

test('文档里的步骤1下载入口使用 main 分支 raw 直链', () => {
  const rootReadme = readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const workerReadme = readFileSync(path.join(repoRoot, 'cloudflare-worker', 'README.md'), 'utf8');
  const usage = readUtf8('使用说明.txt');
  const downloadUrl = /https:\/\/github\.com\/loqwe\/heyun-zjmf-worker-monitor\/raw\/main\/windows-one-click-deploy\/步骤1-一键安装脚本\.bat/;

  assert.match(rootReadme, downloadUrl);
  assert.match(workerReadme, downloadUrl);
  assert.match(usage, downloadUrl);
  assert.match(rootReadme, /直接下载 `步骤1-一键安装脚本\.bat`/);
  assert.doesNotMatch(rootReadme, /htmlpreview\.github\.io/);
  assert.doesNotMatch(workerReadme, /htmlpreview\.github\.io/);
});

test('Release workflow 会发布中文名步骤1安装脚本附件', () => {
  const workflow = readFileSync(path.join(repoRoot, '.github', 'workflows', 'release-step1-bat.yml'), 'utf8');

  assert.match(workflow, /release-step1-bat-v1/);
  assert.match(workflow, /ASSET_NAME: step1-install\.bat/);
  assert.match(workflow, /ASSET_LABEL: 步骤1-一键安装脚本\.bat/);
  assert.match(workflow, /ASSET_PATH: windows-one-click-deploy\/步骤1-一键安装\.bat/);
  assert.match(workflow, /actions\/github-script@v7/);
  assert.match(workflow, /uploadReleaseAsset/);
  assert.match(workflow, /deleteReleaseAsset/);
});
