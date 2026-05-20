# 魔方财务监控 EdgeOne Pages 版

这是新增的 EdgeOne Pages + Edge Functions 版本，和 `cloudflare-worker/` 并存，不影响原 Cloudflare Worker 部署。

> 打开 [EdgeOne Pages 控制台](https://console.tencentcloud.com/edgeone/pages)，点击 **导入其它仓库**，选择现有 GitHub 仓库。

## 架构

```text
EdgeOne Pages
├─ Edge Functions：状态页、管理后台和 API
├─ EdgeOne KV：保存配置、运行状态、事件和探测记录
└─ 外部定时器：定时调用 /api/admin/run 执行监控
```

## 已支持

- 状态页：`/`
- 管理后台：`/admin`
- 公共 API：`/api/status`
- 管理 API：`/api/admin/*`
- 魔方财务 API 检测、HTTP(S) 检测
- EdgeOne 版不能做原生 TCP 检测；初始化检测方式建议选 **HTTP(S) + API（EdgeOne 选这个）**
- 连续失败 3 次后自动重启或开机
- pushplus、Bark、Telegram、飞书机器人、企业微信机器人、钉钉机器人、Slack Webhook、Discord Webhook、自定义 Webhook 通知

## 和 Cloudflare 版的区别

EdgeOne Pages 没有直接使用 Cloudflare D1 和 Cron Trigger。本版本使用 KV 保存数据，定时监控需要外部触发：

- 推荐：GitHub Actions `schedule` 定时请求 `/api/admin/run`
- 也可以用腾讯云函数 SCF 定时器或其他定时任务服务

## 方式二：复用现有仓库部署

1. 打开 [EdgeOne Pages 控制台](https://console.tencentcloud.com/edgeone/pages)，点击 **导入其它仓库**。
2. 选择你自己的 GitHub 仓库：`xxxx/heyun-zjmf-worker-monitor`。
3. 配置构建参数：
   - 框架预设：`Other`
   - 根目录：`edgeone-pages`
   - 输出目录：`.`
   - 构建命令：`npm test`
   - 安装命令：`npm install`
4. 环境变量至少填写：`ADMIN_TOKEN=admin`，后续可在管理后台修改密码。
5. 部署完成后，打开 **KV 存储** 绑定命名空间：变量名称填 `ZJMF_KV`；命名空间名称随意，例如 `zjmf`。如果还没有命名空间，先点击 **创建命名空间**。
   - 注意：本项目使用 `edge-functions/`，不要改回 `cloud-functions/`，否则 EdgeOne KV 绑定不会注入。
   - 通知渠道可在管理后台的 **通知** 页继续配置。
6. 访问部署后的域名，首次打开会进入初始化向导。

## 方式三：手动部署

### 第 1 步：创建 EdgeOne Pages 项目

在 EdgeOne 控制台创建 Pages 项目，连接你的 GitHub 仓库。

建议项目根目录设置为：

```text
edgeone-pages
```

### 第 2 步：绑定 KV

创建 EdgeOne KV，并在 Pages 项目环境变量或绑定里命名为：

```text
ZJMF_KV
```

如果控制台只支持其他变量名，也可以使用：

```text
KV
EDGEONE_KV
```

三者任意一个存在即可。

### 第 3 步：配置环境变量

至少配置：

| 变量名 | 说明 |
|---|---|
| `ADMIN_TOKEN` | 管理后台初始密码 |
| `ZJMF_KV` | EdgeOne KV 绑定 |

可选：

| 变量名 | 说明 |
|---|---|
| `GITHUB_REPOSITORY` | 用于后台检查更新，例如 `你的用户名/heyun-zjmf-worker-monitor` |
| `GITHUB_BRANCH` | 默认 `main` |
| `GITHUB_TOKEN` | 用于后台触发 GitHub Actions 更新 |
| `APP_VERSION` | 当前部署版本号 |

### 第 4 步：部署

推送到 GitHub 后，由 EdgeOne Pages 自动部署。

部署完成后访问：

```text
https://你的 EdgeOne Pages 域名/
https://你的 EdgeOne Pages 域名/admin
```

首次打开会进入初始化向导。

## 定时监控

EdgeOne 版需要外部定时器调用：

```text
POST https://你的 EdgeOne Pages 域名/api/admin/run
Authorization: Bearer 你的 ADMIN_TOKEN
```

GitHub Actions 示例：

```yaml
name: EdgeOne Monitor Cron

on:
  schedule:
    - cron: '*/5 * * * *'
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Run monitor
        run: |
          curl -fsS -X POST "$EDGEONE_MONITOR_URL/api/admin/run" \
            -H "Authorization: Bearer $EDGEONE_ADMIN_TOKEN"
        env:
          EDGEONE_MONITOR_URL: ${{ secrets.EDGEONE_MONITOR_URL }}
          EDGEONE_ADMIN_TOKEN: ${{ secrets.EDGEONE_ADMIN_TOKEN }}
```

## 本地验证

```powershell
cd edgeone-pages
npm test
```
