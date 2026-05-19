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

## EdgeOne Pages 版

已新增 EdgeOne Pages + Cloud Functions 版本，路径：

```text
edgeone-pages/
```

EdgeOne 版使用 KV 保存配置和事件，定时监控由外部定时器调用 `/api/admin/run`。部署说明见：

```text
edgeone-pages/README.md
```

方式二：部署按钮

[使用 EdgeOne Pages 部署](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Floqwe%2Fheyun-zjmf-worker-monitor%2Ftree%2Fmain%2Fedgeone-pages&project-name=zjmf-monitor-edgeone&install-command=npm+install&build-command=npm+test&output-directory=.&env=ADMIN_TOKEN%2CZJMF_KV&env-description=ADMIN_TOKEN+%E6%98%AF%E7%AE%A1%E7%90%86%E5%90%8E%E5%8F%B0%E5%88%9D%E5%A7%8B%E5%AF%86%E7%A0%81%EF%BC%9BZJMF_KV+%E6%98%AF+EdgeOne+KV+%E7%BB%91%E5%AE%9A%E5%8F%98%E9%87%8F%E5%90%8D%E3%80%82%E9%83%A8%E7%BD%B2%E5%90%8E%E8%BF%98%E9%9C%80%E8%A6%81%E5%9C%A8+EdgeOne+Pages+%E9%A1%B9%E7%9B%AE%E4%B8%AD%E7%BB%91%E5%AE%9A+KV%E3%80%82&env-link=https%3A%2F%2Fpages.edgeone.ai%2Fzh%2Fdocument%2Fpages-kv-integration)

方式三：手动部署见 `edgeone-pages/README.md`。

## 快速开始

### 方式一：使用安装脚本（⭐ 推荐）

1. Fork 本仓库。
2. 下载安装脚本：
   - [点击下载：步骤1-一键安装脚本](https://github.com/loqwe/heyun-zjmf-worker-monitor/raw/main/windows-one-click-deploy/步骤1-一键安装脚本.bat)
   - 保存到你想部署的目录，例如 `D:\heyun-zjmf-worker-monitor\`
   - 点击后会直接下载 `步骤1-一键安装脚本.bat`
3. 准备脚本要填写的信息：
   - **Cloudflare Token**：打开 <https://dash.cloudflare.com/profile/api-tokens>，点击 **创建令牌**，在 API 令牌模板里选择 **编辑 Cloudflare Workers**，点击 **使用模板**；再点击 **增加更多帐户**，添加 **D1 / 编辑**；账户资源选择 **包括所有账户**，区域资源选择 **包括所有区域**；最后点击 **继续以显示摘要**，再点击 **创建令牌**，复制生成的 Token。
   - **Cloudflare Account ID**：进入 Cloudflare 账户主页，在右侧三个点里点击 **复制账户 ID**；如果脚本检测到账户 ID，也可以直接复制脚本显示的值。
   - **Fork 后的仓库地址**：打开你 Fork 后的 GitHub 仓库，复制浏览器地址，例如 `https://github.com/你的用户名/heyun-zjmf-worker-monitor`。
   - **魔方财务 API**：打开 <https://www.heyunidc.cn/apimanage>，复制魔方财务登录邮箱或手机号、API 密钥；产品 ID 可部署后在管理后台添加监控项时填写。
   - **可能需要：更新方式**：后续更新首推再次双击 `步骤1-一键安装脚本.bat`；如果想在管理后台点 **系统更新 → 确定更新**，再按下方“更新方式”准备 GitHub 更新令牌和 GitHub Actions Secrets。
4. 双击下载得到的 `步骤1-一键安装脚本.bat`，按提示粘贴以上信息。
   如果你是在 PowerShell 当前目录里手动运行，请先 `cd` 到文件所在目录，再输入 `.\步骤1-一键安装脚本.bat`；不要直接粘贴完整路径。
5. 脚本会自动检查依赖、下载部署文件、生成配置并启动部署。
6. 完成后按日志里的真实地址访问状态页和管理后台。

### 方式二：手动部署

1. Fork 本仓库。
2. 准备 Cloudflare API Token：
   - 打开 <https://dash.cloudflare.com/profile/api-tokens>
   - 点击 **创建令牌**，在 API 令牌模板里选择 **编辑 Cloudflare Workers**
   - 点击 **增加更多帐户**，添加 **D1 / 编辑**
   - 账户资源选择 **包括所有账户**，区域资源选择 **包括所有区域**
   - 滑到最下面，点击 **继续以显示摘要**，再点击 **创建令牌**
3. 准备其他信息：
   - **Cloudflare Account ID**：Cloudflare 账户主页右侧三个点 -> **复制账户 ID**。
   - **魔方财务 API**：打开 <https://www.heyunidc.cn/apimanage> 获取登录邮箱或手机号、API 密钥。
   - **Fork 后的仓库地址**：复制你 Fork 后仓库的浏览器地址。
4. 进入 Fork 后的仓库，打开 **Settings → Secrets and variables → Actions**，添加：

   | Secret 名称 | 值 | 是否必填 |
   |-------------|----|----------|
   | `CLOUDFLARE_API_TOKEN` | 第 2 步复制的 Token | 必填 |
   | `ZJMF_ADMIN_TOKEN` | 管理后台网站密码 | 必填 |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID | 推荐，多账号时必填 |
   | `ZJMF_API_ACCOUNT` | 魔方财务登录邮箱或手机号 | 可选，用于首次自动初始化 |
   | `ZJMF_API_PASSWORD` | 魔方财务 API 密钥 | 可选，用于首次自动初始化 |
   | `ZJMF_SERVER_ID` | 魔方财务产品 ID | 可选，用于首次自动初始化 |
   | `WEB_UPDATE_GITHUB_TOKEN` | GitHub Fine-grained Token，用于管理后台点“确定更新”触发 Actions | 可选，不填只能检查更新 |

5. 进入 **Actions → Deploy to Cloudflare → Run workflow**。
6. 工作流成功后，在日志最后查看真实 Worker 地址，并访问：
   - 状态页：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/`
   - 管理后台：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/admin`
   - API：`https://<WORKER_NAME>.<你的 workers.dev 子域>.workers.dev/api/status`

## 更新方式

### 方式 1：重新运行安装脚本

首推这个方式。双击 `步骤1-一键安装脚本.bat`，按提示重新部署即可。脚本会刷新源码并复用同名 D1 数据库，已有监控配置和事件数据会保留。

### 方式 2：管理后台自动更新

进入 **管理后台 → 系统更新 → 检查更新 / 确定更新**。这个方式需要额外配置 `WEB_UPDATE_GITHUB_TOKEN`，否则只能检查更新，点击“确定更新”会提示 `GITHUB_TOKEN_NOT_CONFIGURED`。

GitHub 更新令牌获取方式：打开 <https://github.com/settings/personal-access-tokens/new>，创建 Fine-grained Token，仓库只选择你的 Fork 仓库，权限只给 **Actions: Read and write** 和 **Contents: Read-only**。生成后复制 `github_pat_` 开头的令牌；它不是 `cfut_` 开头的 Cloudflare Token。

注意：网页自动更新依赖 GitHub Actions。你的 Fork 仓库还必须配置 `CLOUDFLARE_API_TOKEN`、`ZJMF_ADMIN_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 等 Actions Secrets，否则 Actions 会失败。

### 方式 3：GitHub 同步 Fork 后自动部署

支持。到你的 Fork 仓库页面点击 **Sync fork → Update branch**，或自己把上游代码同步到 Fork 后 push。只要你的 Fork 仓库配置好了 Cloudflare 相关 Secrets，`push` 会触发 GitHub Actions 自动部署。

如果你只用本地脚本部署、没有在 GitHub 仓库里配置 Secrets，那么 Sync fork 后 Actions 可能会因为缺少 `CLOUDFLARE_API_TOKEN` 失败；这种情况下请用方式 1 重新运行脚本部署。

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

## Python 本地版快速开始

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
