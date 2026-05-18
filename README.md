# ZJMF 服务器监控与自动重启系统

基于 5 状态机架构的云服务器监控，Worker 版支持 API / HTTP(S) / TCP 探测、异常自动重启、24 小时重启上限、Webhook/pushplus 通知和管理后台。

## Cloudflare Worker 版

已新增 Worker/D1 免费部署版本，路径：

```text
cloudflare-worker/
```

说明：
- 使用 Cloudflare Cron Trigger 定时执行检查
- 使用 D1 保存服务商、服务器、运行状态和事件
- 支持魔方财务 API 状态检测与 `hard_reboot`
- 支持 Webhook / pushplus 通知
- Worker 环境不能执行 ICMP ping，当前支持魔方财务 API、HTTP(S) 和 TCP 端口探测。

部署文档见：

```text
cloudflare-worker/README.md
```

## Windows 一键首次安装

如果你只想下载一个文件，直接使用：

```text
windows-one-click-deploy/一键安装.bat
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

## 架构

### 5状态机

```
healthy ↔ suspect → down → rebooting → recovering → healthy
                                          ↘ down (恢复超时)
```

| 状态 | 含义 | 触发条件 |
|------|------|----------|
| `healthy` | 正常运行 | API返回状态为 `on` |
| `suspect` | 疑似异常 | 首次检测到非 `on` |
| `down` | 确认宕机 | 连续 `suspect_threshold` 次异常 |
| `rebooting` | 正在重启 | 触发 `hard_reboot` |
| `recovering` | 恢复中 | 重启指令发送成功，等待恢复 |

### 监控与重启分离

检测（Monitor）只负责判断健康状态和推进状态机，重启决策（Reboot Decision）独立判断是否执行重启。两者解耦，便于扩展。

## API调用

```
1. POST /v1/login_api?account=xx&password=xx    → 获取 JWT
2. GET  /v1/hosts?page=1&limit=100              → 获取产品列表
3. GET  /v1/hosts/:id/module/status?type=host   → 获取状态（on=正常）
4. PUT  /v1/hosts/:id/module/hard_reboot        → 硬重启
```

关键点：
- 登录参数通过 **query string** 传递，不是 body
- 获取状态必须传 `?type=host`
- 重启用 **hard_reboot**（硬重启）
- 服务器状态为 `on` 表示正常，其他值均视为异常

## 快速开始

### 1. 安装

```bash
pip install requests
```

### 2. 配置

编辑 `servers.json`：

```json
{
  "providers": [
    {
      "name": "heyunidc",
      "display_name": "核云",
      "api_base_url": "https://www.heyunidc.cn/v1",
      "api_account": "你的账号",
      "api_password": "你的API密钥"
    }
  ],
  "servers": [
    {
      "id": "4075",
      "name": "我的服务器",
      "ip": "1.2.3.4",
      "provider": "heyunidc",
      "check_method": "api_only",
      "enabled": true,
      "daily_reboot_limit": 3
    }
  ],
  "global_settings": {
    "check_interval": 300,
    "suspect_threshold": 3,
    "reboot_cooldown": 600,
    "recover_timeout": 300,
    "default_daily_reboot_limit": 3,
    "webhook_url": "",
    "webhook_type": "custom",
    "log_level": "INFO"
  }
}
```

### 3. 运行

```bash
# 单次检查（测试用，无服务器时自动发现）
python server_monitor.py --once

# 查看状态（自动发现+检测）
python server_monitor.py --status

# 持续监控（无服务器时自动发现）
python server_monitor.py

# 自定义检查间隔
python server_monitor.py --interval 60
```

## 配置说明

### providers

| 字段 | 说明 | 示例 |
|------|------|------|
| `name` | 服务商标识（servers引用用） | `heyunidc` |
| `display_name` | 显示名称 | `核云` |
| `api_base_url` | API基础URL | `https://www.heyunidc.cn/v1` |
| `api_account` | API账号 | 手机号或邮箱 |
| `api_password` | API密钥 | 后台生成的Key |

### servers

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `id` | 服务器ID（必填） | - |
| `name` | 显示名称 | - |
| `ip` | IP地址（ping用，可选） | 空 |
| `provider` | 对应provider的name | - |
| `check_method` | 检测方式 | `api_only` |
| `enabled` | 是否启用 | `true` |
| `daily_reboot_limit` | 24 小时重启上限（0=不限，字段名沿用旧名称） | 全局默认 |
| `http_url` | HTTP(S) 探测地址 | 空 |
| `http_expected_status` | HTTP 期望状态码，支持 `200-399,401` | `200-399` |
| `tcp_host` | TCP 探测主机 | 空 |
| `tcp_port` | TCP 探测端口 | `0` |

### global_settings

| 字段 | 说明 | 默认值 |
|------|------|--------|
| `check_interval` | 检查间隔（秒） | `300` |
| `suspect_threshold` | 连续异常 N 次确认宕机 | `3` |
| `reboot_cooldown` | 重启冷却时间（秒） | `600` |
| `recover_timeout` | 重启后恢复等待超时（秒） | `300` |
| `default_daily_reboot_limit` | 默认 24 小时重启上限（字段名沿用旧名称） | `3` |
| `webhook_url` | 通知地址 | 空 |
| `webhook_type` | 通知类型 | `custom` |
| `log_level` | 日志级别（仅控制台输出） | `INFO` |

### 检测方式

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| `api_only` | 只通过API检测（推荐） | 有API，最准确 |
| `http` | 通过 HTTP(S) 状态码检测 | 网站/API 健康检查 |
| `tcp` | 通过 TCP 端口连接检测 | 检查 80/443/数据库等端口 |
| `http_then_api` | HTTP 失败后再用魔方财务 API 复核 | 降低误判后再重启 |
| `tcp_then_api` | TCP 失败后再用魔方财务 API 复核 | 端口异常后再复核 |
| `service_then_power` | 依次执行 HTTP(S)、TCP、API 三步检测；服务不可达时用 API 状态决定重启或开机 | 推荐用于自动恢复 |

### Webhook通知类型

| 类型 | 说明 |
|------|------|
| `custom` | 通用JSON格式 |
| `dingtalk` | 钉钉机器人 |
| `wecom` | 企业微信机器人 |
| `telegram` | Telegram Bot |

## 状态转换与通知

以下状态转换会触发Webhook通知：

| 转换 | 通知级别 | 说明 |
|------|----------|------|
| suspect → down | 🚨 critical | 确认宕机 |
| down → rebooting | 🚨 critical | 触发重启 |
| rebooting → recovering | ⚠️ warning | 等待恢复 |
| recovering → healthy | ✅ info | 恢复成功 |
| recovering → down | 🚨 critical | 恢复超时 |

## 安全机制

1. **疑似阈值**：首次异常进入suspect，连续N次才确认DOWN，避免误判
2. **重启冷却**：两次重启之间至少间隔 `reboot_cooldown` 秒
3. **24 小时上限**：每台服务器每 24 小时最多重启 `daily_reboot_limit` 次
4. **恢复超时**：重启后超过 `recover_timeout` 秒未恢复，重新标记DOWN
5. **JWT自动刷新**：2小时过期，提前10分钟自动重新登录

## 手动测试API

```bash
# 登录
curl -X POST "https://www.heyunidc.cn/v1/login_api?account=你的账号&password=你的API密钥"

# 获取产品列表
curl -H "Authorization: JWT YOUR_TOKEN" "https://www.heyunidc.cn/v1/hosts?page=1&limit=10"

# 获取服务器状态（注意 type=host）
curl -H "Authorization: JWT YOUR_TOKEN" "https://www.heyunidc.cn/v1/hosts/4075/module/status?type=host"

# 硬重启
curl -X PUT -H "Authorization: JWT YOUR_TOKEN" "https://www.heyunidc.cn/v1/hosts/4075/module/hard_reboot"
```

## 日志示例

```
2026-05-09 22:00:00 [INFO] 配置加载：1 个服务商，0 个服务器，检查间隔 300s，疑似阈值 3次，24 小时重启上限 3次
2026-05-09 22:00:01 [INFO] [核云] 正在登录...
2026-05-09 22:00:02 [INFO] [核云] 登录成功
2026-05-09 22:00:03 [INFO]   [HEALTHY] 我的服务器 (ID:4075) status=on
2026-05-09 22:05:03 [INFO] [我的服务器] healthy → suspect (检测异常)
2026-05-09 22:10:03 [INFO] [我的服务器] suspect → down (确认宕机)
2026-05-09 22:10:03 [INFO] [我的服务器] down → rebooting (触发重启)
2026-05-09 22:10:03 [WARNING] [4075] 发送硬重启指令...
2026-05-09 22:10:05 [INFO] [4075] 硬重启指令已发送：成功
2026-05-09 22:10:05 [INFO] [我的服务器] rebooting → recovering (重启指令已发送)
2026-05-09 22:15:05 [INFO] [我的服务器] recovering → healthy (恢复成功)
```
