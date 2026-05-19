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

test('步骤2一键部署默认刷新源码缓存，避免部署旧版本', () => {
  const deployer = readUtf8('步骤2-一键部署.bat');

  assert.match(deployer, /deploy-one-click\.ps1/);
  assert.match(deployer, /-Interactive -RefreshSource/);
});

test('步骤1会刷新部署脚本，源码下载优先使用 codeload', () => {
  const installer = readUtf8('步骤1-一键安装.bat');
  const script = readUtf8('deploy-one-click.ps1');

  assert.doesNotMatch(installer, /if exist "%~1" exit \/b 0/);
  assert.match(script, /codeload\.github\.com\/\$UpstreamRepo\/zip\/refs\/heads\/\$UpstreamRef/);
  assert.match(script, /Invoke-DownloadFile/);
  assert.match(script, /User-Agent/);
});

test('一键部署写入配置前等待新版管理接口就绪并隐藏布尔返回值', () => {
  const script = readUtf8('deploy-one-click.ps1');

  assert.match(script, /function Wait-AdminApiReady/);
  assert.match(script, /Wait-AdminApiReady \$workerUrl \$adminToken/);
  assert.match(script, /\$null = Post-Admin \$BaseUrl \$AdminToken "\/api\/admin\/settings"/);
  assert.doesNotMatch(script, /if \(\$githubRepo\) \{ Post-Admin \$BaseUrl \$AdminToken/);
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
