# 魔方财务 V3 服务器监控 Worker 版

这是 `server_monitor.py` 的 Cloudflare Worker/D1 版本：用 Cron Trigger 定时检查魔方财务 API 状态，异常达到阈值后调用 `hard_reboot`，并可通过 Webhook 或 pushplus 通知。

## 已实现

- Cron 定时检查，默认 `*/5 * * * *`
- D1 持久化：服务商、服务器、运行状态、事件、设置
- 5 状态机：`healthy -> suspect -> down -> rebooting -> recovering`
- 魔方财务 API：
  - `POST /v1/login_api?account=xx&password=xx`
  - `GET /v1/hosts/:id/module/status?type=host`
  - `PUT /v1/hosts/:id/module/hard_reboot`
- 管理 API：
  - `POST /api/admin/providers`
  - `POST /api/admin/servers`
  - `POST /api/admin/settings`
  - `POST /api/admin/run`
- 公共状态 API：
  - `GET /api/status`

## 限制

Cloudflare Worker 不能执行本机 ICMP `ping`，所以当前 Worker 版只支持 `api_only`。原 Python 里的 `ping_only`、`ping_then_api`、`api_then_ping` 不适用于 Worker。

## 快速部署流程

```powershell
git clone https://github.com/loqwe/heyun-zjmf-worker-monitor.git
cd heyun-zjmf-worker-monitor\cloudflare-worker
npm test
npx wrangler@latest login
npx wrangler@latest d1 create zjmf-monitor
```

把 `d1 create` 输出里的 `database_id` 写入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "zjmf-monitor"
database_id = "你的 database_id"
```

继续部署：

```powershell
npx wrangler@latest secret put ADMIN_TOKEN
npx wrangler@latest d1 migrations apply zjmf-monitor --remote
npx wrangler@latest deploy
```

部署成功后访问 `https://你的-worker.workers.dev/` 查看 UI。

## 本地测试

```powershell
cd D:\自建功能\魔方财务V3通用云服务器监控异常重启\cloudflare-worker
npm test
```

当前验证结果：`20` 个测试全部通过。

## 部署前校验

```powershell
npx wrangler@latest deploy --dry-run --outdir .wrangler-dry-run
```

当前已通过 dry-run 打包校验，上传包大小约 `29.82 KiB`。

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
  daily_reboot_limit = 3
  scheduled_reboot = "04:00"
} | ConvertTo-Json -Compress

Invoke-RestMethod -Method Post -Uri "$base/api/admin/servers" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json; charset=utf-8" `
  -Body $body
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
