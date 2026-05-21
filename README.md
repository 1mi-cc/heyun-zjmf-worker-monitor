# 魔方财务云服务器轻量级监控与自动重启系统

专为魔方财务云服务器设计，支持一键脚本快速部署到 Cloudflare Workers，也可部署到 EdgeOne Pages；无需自建服务器，零服务器成本运行，内置异常检测、自动开机/重启、通知推送和可视化管理后台。

## 界面预览

### 管理面板

![管理面板](docs/images/admin-panel.png)

### 状态页

![状态页](docs/images/status-page.png)

## 快速开始

### 方式一：使用脚本一键部署 Cloudflare Worker（⭐ 推荐）

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

### 方式二：EdgeOne Pages 复用现有仓库部署

打开 [EdgeOne Pages 控制台](https://console.tencentcloud.com/edgeone/pages)，点击 **导入其它仓库**，选择你自己的仓库：`xxxx/heyun-zjmf-worker-monitor`。

按图填写：

| 项目 | 值 |
|---|---|
| 框架预设 | `Other` |
| 根目录 | `edgeone-pages` |
| 输出目录 | `.` |
| 构建命令 | `npm test` |
| 安装命令 | `npm install` |
| 环境变量 | 变量名 `ADMIN_TOKEN`，值 `admin`；变量名 `ZJMF_KV`，值 `ZJMF_KV` |

KV 绑定：打开 **KV 存储**，变量名填 `ZJMF_KV`，值选择或创建 `ZJMF_KV`。如果还没有命名空间，先点击 **创建命名空间**。

说明：EdgeOne 版使用 Edge Functions + KV 保存配置和事件，定时监控由外部定时器调用 `/api/admin/run`。首次部署后仍需在 EdgeOne 控制台绑定 KV 到变量名 `ZJMF_KV`。EdgeOne 版不能做原生 TCP 检测，默认检测方式是 **HTTP(S) + API（EdgeOne 选这个）**；Cloudflare Worker 版默认检测方式是 **HTTP(S) + TCP + API（Cloudflare Worker 选这个）**。不要改成 `cloud-functions/`，否则 KV 绑定不会注入。

详细说明见 `edgeone-pages/README.md`。

### 方式三：手动部署 Cloudflare Worker

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
    "reboot_limit_window": "hour",
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
| `daily_reboot_limit` | 单台服务器重启次数上限（0=不限，统计窗口由 `reboot_limit_window` 控制，字段名沿用旧名称） | 全局默认 |
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
| `default_daily_reboot_limit` | 默认重启次数上限（字段名沿用旧名称） | `3` |
| `reboot_limit_window` | 重启次数统计窗口：`hour`=每小时，`day`=24 小时 | `hour` |
| `webhook_url` | 通知地址 | 空 |
| `webhook_type` | 通知类型 | `custom` |
| `log_level` | 日志级别（仅控制台输出） | `INFO` |

### 检测方式

默认选择：Cloudflare Worker 版选择 **HTTP(S) + TCP + API（Cloudflare Worker 选这个）**；EdgeOne Pages 版选择 **HTTP(S) + API（EdgeOne 选这个）**。

| 方式 | 说明 | 适用场景 |
|------|------|----------|
| `api_only` | 只通过API检测（推荐） | 有API，最准确 |
| `http` | 通过 HTTP(S) 状态码检测 | 网站/API 健康检查 |
| `tcp` | 通过 TCP 端口连接检测 | 检查 80/443/数据库等端口 |
| `http_then_api` | HTTP 失败后再用魔方财务 API 复核 | EdgeOne Pages 默认推荐 |
| `tcp_then_api` | TCP 失败后再用魔方财务 API 复核 | 端口异常后再复核 |
| `service_then_power` | 依次执行 HTTP(S)、TCP、API 三步检测；服务不可达时用 API 状态决定重启或开机 | Cloudflare Worker 默认推荐 |

### 支持的通知渠道（Cloudflare Worker / EdgeOne）

| 渠道 | 必填项 | 填写说明 |
|------|--------|----------|
| `pushplus` | Token | 默认推荐；选择后无需填写 Webhook URL，只填 PushPlus Token。 |
| `bark` | Bark Key | 填写 Bark 设备 Key，用于 iOS 推送。 |
| `telegram` | Bot Token、Chat ID | Token 填 Telegram Bot Token，接收目标填 Chat ID。 |
| `feishu` | Webhook URL | 填写飞书机器人 Webhook 地址。 |
| `wecom` | Webhook URL | 填写企业微信机器人 Webhook 地址。 |
| `dingtalk` | Webhook URL、可选签名密钥 | 填写钉钉机器人地址；如果开启加签，再填写签名密钥。 |
| `slack` | Webhook URL | 填写 Slack Incoming Webhook 地址。 |
| `discord` | Webhook URL | 填写 Discord Webhook 地址。 |
| `custom` | Webhook URL | 自定义 JSON Webhook，可在管理后台配置请求头和消息模板。 |

通知填写教程：

1. 进入 **管理后台 → 通知 → 新建通知渠道**。
2. 选择通知类型。
3. 按上表填写 Token、接收目标或 Webhook URL。
4. 如不想每次检测失败都提醒，可勾选 **失败阶段静默**；勾选后只在 **触发开机 / 触发重启 / 恢复成功 / 恢复超时** 时通知。
5. 保存后点击 **测试**，收到测试消息即配置成功。

> 本地 Python 版当前保留 `custom`、`dingtalk`、`wecom`、`telegram`。

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
3. **重启上限**：默认每台服务器每小时最多重启 `daily_reboot_limit` 次，可把 `reboot_limit_window` 切到 `day` 改为 24 小时统计
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
2026-05-09 22:00:00 [INFO] 配置加载：1 个服务商，0 个服务器，检查间隔 300s，疑似阈值 3次，每小时重启上限 3次
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

## 鸣谢

本项目在设计和实现过程中参考并受益于以下项目与平台：

- [Uptimer](https://github.com/VrianCao/Uptimer)：参考其轻量化状态页、监控展示和快速部署思路。
- [Cloudflare Workers](https://workers.cloudflare.com/)：提供零服务器成本的 Worker、D1 和定时任务运行能力。
- [EdgeOne Pages](https://console.tencentcloud.com/edgeone/pages)：提供可选的 Pages 部署方案。
- [PushPlus](https://www.pushplus.plus/) 与 Webhook：提供灵活的异常通知能力。
- 魔方财务 API：提供服务器状态查询、开机和重启等自动化接口能力。

## 许可证

本项目采用 [MIT License](./LICENSE) 开源。使用本项目时，请同时遵守相关第三方平台和接口服务的使用条款。
