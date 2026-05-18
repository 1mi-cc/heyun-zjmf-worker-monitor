# 魔方财务 V3 服务器监控 Worker 版

这是 `server_monitor.py` 的 Cloudflare Worker/D1 版本：用 Cron Trigger 定时执行 API / HTTP(S) / TCP 探测，连续失败 3 次后自动重启或开机，并可通过 Webhook 或 pushplus 通知。

## 已实现

- Cron 定时检查，默认 `*/5 * * * *`
- D1 持久化：服务商、服务器、运行状态、事件、设置
- 5 状态机：`healthy -> suspect -> down -> rebooting -> recovering`
- 探测方式：魔方财务 API、HTTP(S)、TCP 端口、HTTP/TCP + API 复核、三步检测
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

## Windows 一键首次安装

如果你只想下载一个文件，下载并双击：

```text
../windows-one-click-deploy/一键安装.bat
```

它会自动下载部署脚本，并在同目录生成 `one-click.config.jsonc`。

## 快速部署（5 步完成）

无需修改任何代码或配置文件，即可部署专属于你的魔方财务监控实例。

### 第 1 步 — Fork 仓库

点击本仓库右上角的 **Fork** 按钮，创建你自己的副本。

### 第 2 步 — 创建 Cloudflare API Token

前往 **Cloudflare Dashboard → API Tokens**，点击 **Create Token**，使用 **Edit Cloudflare Workers** 模板，并确认包含：

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
| `ZJMF_API_ACCOUNT` | 魔方财务登录邮箱或手机号 | 可选，用于首次自动初始化 |
| `ZJMF_API_PASSWORD` | 魔方财务 API 密钥 | 可选，用于首次自动初始化 |
| `ZJMF_SERVER_ID` | 魔方财务产品 ID | 可选，用于首次自动初始化 |
| `ZJMF_SERVER_NAME` | 状态页显示名称 | 可选 |
| `ZJMF_SERVER_IP` | 服务器 IP，仅保存配置，状态页/API 不显示 | 可选 |
| `PUSHPLUS_TOKEN` | pushplus 用户 token | 可选 |

只有 `CLOUDFLARE_API_TOKEN` 和 `ZJMF_ADMIN_TOKEN` 是部署硬性必填。魔方财务相关 Secrets 不填也能完成部署，之后可在 `/admin` 管理后台添加服务商和监控项。

### 第 4 步 — 运行 GitHub Actions

进入 **Actions → Deploy to Cloudflare → Run workflow**，或向 `main`/`master` 推送一次提交。

工作流会自动完成：

- 创建或复用 D1 数据库
- 执行 D1 迁移
- 注入 `ZJMF_ADMIN_TOKEN` 为 Worker Secret `ADMIN_TOKEN`
- 部署 Worker（状态页 UI + 管理后台 + API + Cron 监控任务）
- 如果填写了 `ZJMF_API_ACCOUNT`、`ZJMF_API_PASSWORD`、`ZJMF_SERVER_ID`，会自动添加服务商和服务器监控配置
- 如果填写了 `PUSHPLUS_TOKEN`，会自动添加 pushplus 通知

### 第 5 步 — 访问你的状态页

工作流成功后，在日志最后查看真实地址。默认 Worker 名称是 `zjmf-monitor`，也可在仓库 **Settings → Secrets and variables → Actions → Variables** 里设置 `WORKER_NAME`。

- 状态页：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/`
- 管理后台：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/admin`
- API：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/api/status`

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
