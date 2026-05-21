# 魔方财务 V3 服务器监控 Worker 版

这是 `server_monitor.py` 的 Cloudflare Worker/D1 版本：用 Cron Trigger 定时执行 API / HTTP(S) / TCP 探测，连续失败 3 次后自动重启或开机，并可通过 pushplus、Bark、Telegram、飞书、企业微信、钉钉、Slack、Discord 或自定义 Webhook 通知。

## 已实现

- Cron 定时检查，默认 `*/5 * * * *`
- D1 持久化：服务商、服务器、运行状态、事件、设置
- 5 状态机：`healthy -> suspect -> down -> rebooting -> recovering`
- 探测方式：魔方财务 API、HTTP(S)、TCP 端口、HTTP/TCP + API 复核、三步检测
- 通知渠道：pushplus、Bark、Telegram、飞书机器人、企业微信机器人、钉钉机器人、Slack Webhook、Discord Webhook、自定义 Webhook
- 管理后台：`GET /admin`，使用 `ZJMF_ADMIN_TOKEN` 登录
- 魔方财务 API：
  - `POST /v1/login_api?account=xx&password=xx`
  - `GET /v1/hosts/:id/module/status?type=host`
  - `PUT /v1/hosts/:id/module/hard_reboot`
  - `PUT /v1/hosts/:id/module/on`
- 管理 API：
  - `GET /api/admin/overview`
  - `POST /api/admin/providers`
  - `POST /api/admin/servers`
  - `POST /api/admin/settings`
  - `POST /api/admin/run`
- 公共状态 API：
  - `GET /api/status`

## 限制

Cloudflare Worker 不能执行本机 ICMP `ping`，因此 Worker 版不支持 `ping_only`、`ping_then_api`、`api_then_ping`。当前可用 HTTP(S) 请求或 TCP 端口连接替代 ping 做在线检测。

Worker 版已去掉定时重启，只在连续 3 次探测异常后触发恢复动作，并按 24 小时窗口限制次数。三步检测模式下：API 状态为 `on` 时重启，API 状态为 `off` 时开机。

## 快速开始

### 方式一：使用脚本一键部署 Cloudflare Worker（⭐ 推荐）

1. Fork 本仓库。
2. [点击下载：步骤1-一键安装脚本](https://github.com/loqwe/heyun-zjmf-worker-monitor/raw/main/windows-one-click-deploy/步骤1-一键安装脚本.bat)，保存到你想部署的目录。
   点击后会直接下载 `步骤1-一键安装脚本.bat`。
3. 准备 Cloudflare Token、Account ID、Fork 后的仓库地址和魔方财务 API。
   - 可能需要：后续更新首推再次双击 `步骤1-一键安装脚本.bat`；如果想在管理后台点 **系统更新 → 确定更新**，再按下方“更新方式”准备 GitHub 更新令牌和 GitHub Actions Secrets。
4. 双击下载得到的 `步骤1-一键安装脚本.bat`，按提示填写信息。
   如果你是在 PowerShell 当前目录里手动运行，请先 `cd` 到文件所在目录，再输入 `.\步骤1-一键安装脚本.bat`；不要直接粘贴完整路径。

脚本会先检查 PowerShell、Node.js、npx；缺少 Node.js/npx 时会尝试通过 winget 自动安装 Node.js LTS，找不到任何 PowerShell 时会尝试通过 winget 安装 PowerShell 7，然后自动下载 `步骤2-一键部署.bat`、部署脚本和配置模板，并在同目录生成 `one-click.config.jsonc`。

### 方式二：手动部署

无需修改任何代码或配置文件，即可部署专属于你的魔方财务监控实例。

### 第 1 步 — Fork 仓库

点击本仓库右上角的 **Fork** 按钮，创建你自己的副本。

### 第 2 步 — 创建 Cloudflare API Token

打开 <https://dash.cloudflare.com/profile/api-tokens>，点击 **创建令牌**，在 API 令牌模板里选择 **编辑 Cloudflare Workers**，点击 **使用模板**；再点击 **增加更多帐户**，添加 **D1 / 编辑**。账户资源选择 **包括所有账户**，区域资源选择 **包括所有区域**。最后点击 **继续以显示摘要**，再点击 **创建令牌**。

| 权限 | 级别 |
|------|------|
| Account / Workers Scripts | Edit |
| Account / D1 | Edit |
| Account / Account Settings | Read |
| User / User Details | Read |

### 第 3 步 — 添加 GitHub Secrets

进入你 Fork 的仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加：

| Secret 名称 | 值 | 是否必填 |
|-------------|----|----------|
| `CLOUDFLARE_API_TOKEN` | 第 2 步获取的 Token | 必填 |
| `ZJMF_ADMIN_TOKEN` | 任意强密码字符串（用于登录管理后台） | 必填 |
| `CLOUDFLARE_ACCOUNT_ID` | 你的 Cloudflare Account ID | 推荐（多账号时必填） |
| `ZJMF_SERVER_NAME` | 状态页显示名称 | 可选 |
| `ZJMF_SERVER_IP` | 服务器 IP，仅保存配置，状态页/API 不显示 | 可选 |
| `PUSHPLUS_TOKEN` | pushplus 用户 token | 可选 |
| `WEB_UPDATE_GITHUB_TOKEN` | GitHub Fine-grained PAT，用于管理后台“系统更新”触发 GitHub Actions | 可选 |

只有 `CLOUDFLARE_API_TOKEN` 和 `ZJMF_ADMIN_TOKEN` 是部署硬性必填。魔方财务相关 Secrets 不填也能完成部署，之后可在 `/admin` 管理后台添加服务商和监控项。

魔方财务 API 获取方式：打开 <https://www.heyunidc.cn/apimanage>，复制魔方财务登录邮箱或手机号、API 密钥；产品 ID 可在魔方财务产品详情页查看，也可以部署后在 `/admin` 管理后台添加监控项时填写。

### 第 4 步 — 运行 GitHub Actions

进入 **Actions → Deploy to Cloudflare → Run workflow**，或向 `main`/`master` 推送一次提交。

工作流会自动完成：

- 创建或复用 D1 数据库
- 执行 D1 迁移
- 注入 `ZJMF_ADMIN_TOKEN` 为 Worker Secret `ADMIN_TOKEN`
- 部署 Worker（状态页 UI + 管理后台 + API + Cron 监控任务）
- 如果填写了 `PUSHPLUS_TOKEN`，会自动添加 pushplus 通知；更多渠道可在管理后台的“通知”页配置

### 第 5 步 — 访问你的状态页

工作流成功后，在日志最后查看真实地址。默认 Worker 名称是 `zjmf-monitor`，也可在仓库 **Settings → Secrets and variables → Actions → Variables** 里设置 `WORKER_NAME`。

- 状态页：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/`
- 管理后台：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/admin`
- API：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/api/status`

## 更新方式

### 方式 1：重新运行安装脚本

首推这个方式。双击 `步骤1-一键安装脚本.bat`，按提示重新部署即可。脚本会重新下载最新源码并复用同名 D1 数据库，已有配置会保留。

### 方式 2：管理后台自动更新

进入 **管理后台 → 系统更新 → 检查更新 / 确定更新**。这个方式需要 `WEB_UPDATE_GITHUB_TOKEN`，否则只能检查更新，点击“确定更新”会提示 `GITHUB_TOKEN_NOT_CONFIGURED`。

获取教程：打开 <https://github.com/settings/personal-access-tokens/new>，`Token name` 填 `zjmf-monitor-update`，`Resource owner` 选择你的 GitHub 账号，`Repository access` 选择 **Only select repositories** 并选中你 Fork 后的仓库；`Repository permissions` 设置 **Actions: Read and write**、**Contents: Read-only**，最后点击 **Generate token**，复制 `github_pat_` 开头的令牌。

注意：网页自动更新触发的是你 Fork 仓库里的 GitHub Actions。该仓库还必须配置 Cloudflare 相关 Secrets，否则可能在 Actions 里报 `Missing CLOUDFLARE_API_TOKEN`。

### 方式 3：同步 Fork 后自动部署

支持。到你的 Fork 仓库页面点击 **Sync fork → Update branch**，或自己同步上游后 push。只要 Fork 仓库配置好了 Actions Secrets，`push` 会自动触发部署。

如果你没有在 GitHub 仓库配置 Secrets，只是用本地脚本部署，那么这种方式可能失败；请改用方式 1。

## 本地测试

```powershell
cd D:\自建功能\魔方财务V3通用云服务器监控异常重启\cloudflare-worker
npm test
```

当前验证结果以 `npm test` 输出为准。

## 部署前校验

```powershell
npx wrangler@latest deploy --dry-run --outdir .wrangler-dry-run
```

上传包大小以 `wrangler` 实际输出为准。

## 部署步骤

### 1. 登录 Cloudflare

```powershell
npx wrangler@latest login
```

如果是在非交互环境，改用 `CLOUDFLARE_API_TOKEN`：

```powershell
$env:CLOUDFLARE_API_TOKEN = "你的 Cloudflare API Token"
```

### 2. 创建 D1 数据库

```powershell
npx wrangler@latest d1 create zjmf-monitor
```

把输出里的 `database_id` 填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "zjmf-monitor"
database_id = "你的 database_id"
```

### 3. 设置管理 Token

```powershell
npx wrangler@latest secret put ADMIN_TOKEN
```

输入你想用的管理后台 token。

### 4. 应用 D1 迁移

```powershell
npx wrangler@latest d1 migrations apply zjmf-monitor --remote
```

### 5. 部署 Worker

```powershell
npx wrangler@latest deploy
```

## 初始化配置

以下示例里的 `$base` 换成部署后的 Worker 地址，`$token` 换成 `ADMIN_TOKEN`。

### 添加服务商

```powershell
$base = "https://zjmf-monitor.<你的子域>.workers.dev"
$token = "你的 ADMIN_TOKEN"

$body = @{
  name = "heyunidc"
  display_name = "核云"
  api_base_url = "https://www.heyunidc.cn/v1"
  api_account = "登录邮箱或手机号"
  api_password = "API密钥"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$base/api/admin/providers" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

### 添加服务器

```powershell
$body = @{
  id = "4075"
  name = "我的服务器"
  ip = "1.2.3.4"
  provider = "heyunidc"
  check_method = "api_only"
  enabled = $true
  # 字段名沿用 daily_reboot_limit，实际含义是 24 小时重启上限。
  daily_reboot_limit = 3
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$base/api/admin/servers" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

### HTTP(S) 检测示例

```powershell
$body = @{
  id = "web-1"
  name = "官网"
  provider = "heyunidc"
  check_method = "http"
  http_url = "https://example.com/health"
  http_method = "GET"
  http_expected_status = "200-399"
  daily_reboot_limit = 3
  enabled = $true
} | ConvertTo-Json -Compress
```

### TCP 端口检测示例

```powershell
$body = @{
  id = "tcp-443"
  name = "HTTPS 端口"
  provider = "heyunidc"
  check_method = "tcp"
  tcp_host = "example.com"
  tcp_port = 443
  daily_reboot_limit = 3
  enabled = $true
} | ConvertTo-Json -Compress
```

### 配置 pushplus 通知

```powershell
$body = @{
  webhook_url = "https://www.pushplus.plus/send"
  webhook_type = "pushplus"
  pushplus_token = "你的 pushplus token"
  timezone = "Asia/Shanghai"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$base/api/admin/settings" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
```

更多通知渠道（Bark、Telegram、飞书、企业微信、钉钉、Slack、Discord、自定义 Webhook）请在管理后台的 **通知** 页配置。

### 手动触发一次检查

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/admin/run" `
  -Headers @{ Authorization = "Bearer $token" }
```

### 查看状态页 JSON

```powershell
Invoke-RestMethod -Method Get -Uri "$base/api/status"
```

## 官方文档

- Cloudflare Cron Triggers: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Cloudflare D1 Wrangler commands: https://developers.cloudflare.com/d1/wrangler-commands/
- Cloudflare Worker secrets: https://developers.cloudflare.com/workers/configuration/secrets/
