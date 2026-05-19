# 魔方财务监控 EdgeOne Pages 版

这是新增的 EdgeOne Pages + Cloud Functions 版本，和 `cloudflare-worker/` 并存，不影响原 Cloudflare Worker 部署。

[![使用 EdgeOne Pages 部署](https://cdnstatic.tencentcs.com/edgeone/pages/deploy.svg)](https://edgeone.ai/pages/new?repository-url=https%3A%2F%2Fgithub.com%2Floqwe%2Fheyun-zjmf-worker-monitor%2Ftree%2Fmain%2Fedgeone-pages&project-name=zjmf-monitor-edgeone&install-command=npm+install&build-command=npm+test&output-directory=.&env=ADMIN_TOKEN%2CZJMF_KV&env-description=ADMIN_TOKEN+%E6%98%AF%E7%AE%A1%E7%90%86%E5%90%8E%E5%8F%B0%E5%88%9D%E5%A7%8B%E5%AF%86%E7%A0%81%EF%BC%9BZJMF_KV+%E6%98%AF+EdgeOne+KV+%E7%BB%91%E5%AE%9A%E5%8F%98%E9%87%8F%E5%90%8D%E3%80%82%E9%83%A8%E7%BD%B2%E5%90%8E%E8%BF%98%E9%9C%80%E8%A6%81%E5%9C%A8+EdgeOne+Pages+%E9%A1%B9%E7%9B%AE%E4%B8%AD%E7%BB%91%E5%AE%9A+KV%E3%80%82&env-link=https%3A%2F%2Fpages.edgeone.ai%2Fzh%2Fdocument%2Fpages-kv-integration)

> 部署按钮会帮你创建 EdgeOne Pages 项目并填入基础构建参数；KV 仍需在 EdgeOne 控制台绑定到变量名 `ZJMF_KV`。

## 架构

```text
EdgeOne Pages
├─ Cloud Functions：状态页、管理后台和 API
├─ EdgeOne KV：保存配置、运行状态、事件和探测记录
└─ 外部定时器：定时调用 /api/admin/run 执行监控
```

## 已支持

- 状态页：`/`
- 管理后台：`/admin`
- 公共 API：`/api/status`
- 管理 API：`/api/admin/*`
- 魔方财务 API 检测、HTTP(S) 检测、TCP 端口检测
- 连续失败 3 次后自动重启或开机
- pushplus / Webhook 通知

## 和 Cloudflare 版的区别

EdgeOne Pages 没有直接使用 Cloudflare D1 和 Cron Trigger。本版本使用 KV 保存数据，定时监控需要外部触发：

- 推荐：GitHub Actions `schedule` 定时请求 `/api/admin/run`
- 也可以用腾讯云函数 SCF 定时器或其他定时任务服务

## 方式二：部署按钮

1. 点击上方 **使用 EdgeOne Pages 部署**。
2. 按页面提示授权并创建项目。
3. 环境变量至少填写：
   - `ADMIN_TOKEN`：管理后台初始密码。
   - `ZJMF_KV`：KV 绑定变量名，推荐保持 `ZJMF_KV`。
4. 部署完成后，到 EdgeOne Pages 项目里绑定 KV Namespace，变量名必须和上一步一致。
5. 访问部署后的域名，首次打开会进入初始化向导。

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
