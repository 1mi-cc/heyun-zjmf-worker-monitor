[CmdletBinding()]
param(
    [string]$ConfigPath = "",
    [string]$SourceRoot = "",
    [string]$UpstreamRepo = "loqwe/heyun-zjmf-worker-monitor",
    [string]$UpstreamRef = "main",
    [string]$WranglerVersion = "4.91.0",
    [string]$CacheRoot = (Join-Path $PSScriptRoot ".cache\heyun-zjmf-worker-monitor"),
    [switch]$RefreshSource,
    [switch]$PreflightOnly,
    [switch]$PrepareOnly,
    [switch]$SkipSeed,
    [switch]$Interactive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)

$Root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$Npx = if (Get-Command "npx.cmd" -ErrorAction SilentlyContinue) { "npx.cmd" } else { "npx" }
$WranglerPackage = "wrangler@$WranglerVersion"

function Write-Step([string]$Message) { Write-Host ""; Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Note([string]$Message) { Write-Host " -> $Message" -ForegroundColor DarkGray }
function Get-ConfigValue($Config, [string]$Key, [string]$Default = "") {
    if ($Config.ContainsKey($Key) -and $null -ne $Config[$Key] -and -not [string]::IsNullOrWhiteSpace([string]$Config[$Key])) { return [string]$Config[$Key] }
    return $Default
}
function Get-ConfigInt($Config, [string]$Key, [int]$Default) {
    $value = Get-ConfigValue $Config $Key ""
    if ($value -match '^\d+$') { return [int]$value }
    return $Default
}
function New-RandomSecret([int]$Length = 32) {
    $chars = @()
    $chars += [char[]](48..57)
    $chars += [char[]](65..90)
    $chars += [char[]](97..122)
    return -join (1..$Length | ForEach-Object { $chars | Get-Random })
}
function Read-RequiredText([string]$Prompt) {
    do {
        $raw = Read-Host $Prompt
        if ($null -eq $raw) { throw "未读取到输入：$Prompt" }
        $value = $raw.Trim()
    } while ([string]::IsNullOrWhiteSpace($value))
    return $value
}
function Read-OptionalText([string]$Prompt) {
    $raw = Read-Host $Prompt
    if ($null -eq $raw) { return "" }
    return $raw.Trim()
}
function ConvertTo-PlainText([System.Security.SecureString]$SecureValue) {
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureValue)
    try { return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}
function Read-OptionalSecret([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    if ($null -eq $secure) { return "" }
    return (ConvertTo-PlainText $secure).Trim()
}
function Read-AdminTokenWithConfirmation {
    while ($true) {
        $first = Read-OptionalSecret "请输入 ZJMF_ADMIN_TOKEN 网站密码（直接回车默认 admin）"
        $second = Read-OptionalSecret "请再次输入 ZJMF_ADMIN_TOKEN 网站密码"
        if ([string]::IsNullOrWhiteSpace($first) -and [string]::IsNullOrWhiteSpace($second)) { return "admin" }
        if ($first -eq $second -and -not [string]::IsNullOrWhiteSpace($first)) { return $first }
        Write-Host "两次输入不一致，请重新输入。" -ForegroundColor Yellow
    }
}
function Convert-GitHubRepoInput([string]$Value) {
    $text = $Value.Trim().TrimEnd("/")
    $text = $text -replace '\.git$', ''
    if ($text -match 'github\.com[:/]+([^/]+)/([^/#?]+)') { return "$($matches[1])/$($matches[2])" }
    if ($text -match '^[^/\s]+/[^/\s]+$') { return $text }
    throw "仓库地址格式不正确，请输入 https://github.com/用户名/仓库名 或 用户名/仓库名。"
}
function Save-Config($Config) {
    $Config | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $script:ConfigPath -Encoding utf8
}
function Remove-JsonComments([string]$Text) {
    $sb = [System.Text.StringBuilder]::new()
    $inString = $false; $escape = $false; $lineComment = $false; $blockComment = $false
    for ($i = 0; $i -lt $Text.Length; $i++) {
        $c = $Text[$i]
        $n = if ($i + 1 -lt $Text.Length) { $Text[$i + 1] } else { [char]0 }
        if ($lineComment) {
            if ($c -eq "`n") { [void]$sb.Append($c); $lineComment = $false }
            continue
        }
        if ($blockComment) {
            if ($c -eq "*" -and $n -eq "/") { $i++; $blockComment = $false }
            continue
        }
        if ($inString) {
            [void]$sb.Append($c)
            if ($escape) { $escape = $false }
            elseif ($c -eq "\") { $escape = $true }
            elseif ($c -eq '"') { $inString = $false }
            continue
        }
        if ($c -eq '"') { [void]$sb.Append($c); $inString = $true; continue }
        if ($c -eq "/" -and $n -eq "/") { $i++; $lineComment = $true; continue }
        if ($c -eq "/" -and $n -eq "*") { $i++; $blockComment = $true; continue }
        [void]$sb.Append($c)
    }
    return $sb.ToString()
}
function ConvertFrom-JsoncFile([string]$Path) {
    $content = Get-Content -LiteralPath $Path -Raw -Encoding utf8
    return (Remove-JsonComments $content | ConvertFrom-Json -AsHashtable)
}
function Get-DefaultConfigText {
    return @'
{
  // Cloudflare Worker 名称和 D1 数据库名
  "workerName": "zjmf-monitor",
  "d1DatabaseName": "zjmf-monitor",
  "cloudflareAccountId": "",

  // GitHub 仓库地址，一键安装脚本会从这里下载源码
  "upstreamRepo": "loqwe/heyun-zjmf-worker-monitor",

  // 管理后台网站密码；双击 BAT 交互部署时会要求输入两次
  "adminToken": "请填写强密码",

  // 魔方财务配置；可留空，部署后到 /admin 初始化向导填写
  "providerName": "heyunidc",
  "providerDisplayName": "核云",
  "zjmfApiBaseUrl": "https://www.heyunidc.cn/v1",
  "zjmfApiAccount": "",
  "zjmfApiPassword": "",
  "serverId": "",
  "serverName": "",
  "serverIp": "",

  // 检测配置
  "checkMethod": "service_then_power",
  "httpUrl": "",
  "httpMethod": "GET",
  "httpExpectedStatus": "200-399",
  "tcpHost": "",
  "tcpPort": 996,
  "dailyRebootLimit": 3,

  // 通知配置
  "pushplusToken": "",
  "timezone": "Asia/Shanghai"
}
'@
}
function Get-WranglerCommand([string[]]$SubCommands) {
    return @($Npx, "--yes", $WranglerPackage) + $SubCommands
}
function Get-CloudflareWhoamiAccountIds([string]$Output) {
    $ids = @()
    foreach ($match in [regex]::Matches($Output, '\b[0-9a-f]{32}\b', [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
        $value = $match.Value.ToLowerInvariant()
        if (-not $ids.Contains($value)) { $ids += $value }
    }
    return $ids
}
function Invoke-CommandLine([string[]]$Command, [string]$WorkingDirectory = $Root, [string]$InputText = $null) {
    Push-Location $WorkingDirectory
    try {
        $exe = $Command[0]
        $args = @()
        if ($Command.Length -gt 1) { $args = $Command[1..($Command.Length - 1)] }
        Write-Note ("运行: " + ($Command -join " "))
        $global:LASTEXITCODE = 0
        $output = if ($null -ne $InputText) {
            $InputText | & $exe @args 2>&1 | Out-String -Width 4096
        } else {
            & $exe @args 2>&1 | Out-String -Width 4096
        }
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "命令失败，退出码 $exitCode`n命令: $($Command -join ' ')`n`n完整输出:`n$output"
        }
        return $output.Trim()
    } finally {
        Pop-Location
    }
}
function Invoke-CommandLineVisible([string[]]$Command, [string]$WorkingDirectory = $Root) {
    Push-Location $WorkingDirectory
    try {
        $exe = $Command[0]
        $cmdArgs = @()
        if ($Command.Length -gt 1) { $cmdArgs = $Command[1..($Command.Length - 1)] }
        Write-Note ("运行: " + ($Command -join " "))
        & $exe @cmdArgs
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "命令失败，退出码 $exitCode`n命令: $($Command -join ' ')"
        }
    } finally {
        Pop-Location
    }
}
function Invoke-WranglerDeploy([string]$WorkerRoot, [string]$WorkerName) {
    Push-Location $WorkerRoot
    try {
        $commandText = "$Npx --yes $WranglerPackage deploy"
        Write-Note "运行: $commandText"
        & $Npx --yes $WranglerPackage deploy
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) { return }
        if ($exitCode -eq -1073740791) {
            Write-Note "Wrangler 在 Windows 上返回崩溃码，正在二次确认部署状态。"
            $status = Invoke-CommandLine (Get-WranglerCommand @("deployments", "status", "--name", $WorkerName)) $WorkerRoot
            if ($status -match "Version\(s\):|Created:") {
                Write-Note "已确认 Cloudflare 端存在最新部署，继续后续步骤。"
                return
            }
        }
        throw "命令失败，退出码 $exitCode`n命令: $commandText"
    } finally {
        Pop-Location
    }
}
function Test-WorkerRoot([string]$Path) {
    return (Test-Path (Join-Path $Path "package.json")) -and (Test-Path (Join-Path $Path "wrangler.toml")) -and (Test-Path (Join-Path $Path "migrations\0001_init.sql"))
}
function Resolve-WorkerRoot {
    if (-not [string]::IsNullOrWhiteSpace($SourceRoot)) {
        $resolved = [System.IO.Path]::GetFullPath($SourceRoot)
        if (Test-WorkerRoot $resolved) { return $resolved }
        $nested = Join-Path $resolved "cloudflare-worker"
        if (Test-WorkerRoot $nested) { return $nested }
        throw "-SourceRoot 不是 heyun-zjmf-worker-monitor 源码目录: $resolved"
    }
    $local = Join-Path $Root "cloudflare-worker"
    if (Test-WorkerRoot $local) { return $local }
    $cacheSource = Join-Path $CacheRoot "source"
    $zipPath = Join-Path $CacheRoot "source.zip"
    if ($RefreshSource -and (Test-Path $cacheSource)) { Remove-Item -LiteralPath $cacheSource -Recurse -Force }
    if (-not (Test-Path $cacheSource)) {
        New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
        Write-Step "下载项目源码"
        $urls = @(
            "https://github.com/$UpstreamRepo/archive/refs/heads/$UpstreamRef.zip",
            "https://github.com/$UpstreamRepo/archive/refs/tags/$UpstreamRef.zip",
            "https://github.com/$UpstreamRepo/archive/$UpstreamRef.zip"
        )
        foreach ($url in $urls) {
            try { Write-Note "下载: $url"; Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 180; break } catch { Write-Note "当前地址失败，尝试下一个" }
        }
        if (-not (Test-Path $zipPath)) { throw "源码下载失败，请检查网络或使用 -SourceRoot 指定本地源码。" }
        Expand-Archive -Path $zipPath -DestinationPath $cacheSource -Force
    }
    foreach ($dir in Get-ChildItem -Path $cacheSource -Directory -Recurse) {
        if ($dir.Name -eq "cloudflare-worker" -and (Test-WorkerRoot $dir.FullName)) { return $dir.FullName }
    }
    throw "缓存源码里没有找到 cloudflare-worker 目录。"
}
function Read-Config {
    $defaultJsonc = Join-Path $Root "one-click.config.jsonc"
    $defaultJson = Join-Path $Root "one-click.config.json"
    $configFile = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
        if (Test-Path $defaultJsonc) { $defaultJsonc } elseif (Test-Path $defaultJson) { $defaultJson } else { $defaultJsonc }
    } else {
        [System.IO.Path]::GetFullPath($ConfigPath)
    }
    $exampleJsonc = Join-Path $Root "one-click.config.example.jsonc"
    $exampleJson = Join-Path $Root "one-click.config.example.json"
    if (-not (Test-Path $configFile)) {
        if (Test-Path $exampleJsonc) {
            Copy-Item -LiteralPath $exampleJsonc -Destination $configFile
        } elseif (Test-Path $exampleJson) {
            Copy-Item -LiteralPath $exampleJson -Destination $configFile
        } else {
            Get-DefaultConfigText | Set-Content -LiteralPath $configFile -Encoding utf8
        }
        Write-Note "已生成配置文件: $configFile"
    }
    $script:ConfigPath = $configFile
    if ($configFile -match '\.jsonc$') {
        return (ConvertFrom-JsoncFile $configFile)
    }
    return (Get-Content -LiteralPath $configFile -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable)
}
function Invoke-InteractiveSetup($Config) {
    if (-not $Interactive) { return }
    if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
        $env:CLOUDFLARE_API_TOKEN = Read-RequiredText "请输入 Cloudflare API Token"
    }
    $whoami = ""
    try { $whoami = Invoke-CommandLine (Get-WranglerCommand @("whoami")) } catch {}
    $detectedAccountIds = @(Get-CloudflareWhoamiAccountIds $whoami)
    if ($detectedAccountIds.Count -gt 0) {
        Write-Host "检测到账户 ID：" -ForegroundColor Cyan
        for ($i = 0; $i -lt $detectedAccountIds.Count; $i++) {
            Write-Host ("  [{0}] {1}" -f ($i + 1), $detectedAccountIds[$i])
        }
    }
    $pickedAccount = Read-RequiredText "请输入要部署的 Cloudflare Account ID（必须手动填写）"
    if ($detectedAccountIds.Count -gt 0 -and -not ($detectedAccountIds -contains $pickedAccount.ToLowerInvariant())) {
        Write-Host "警告：输入的 Account ID 不在当前 Token 检测列表里，请确认 Token 有该账户权限。" -ForegroundColor Yellow
    }
    $Config.cloudflareAccountId = $pickedAccount
    $env:CLOUDFLARE_ACCOUNT_ID = $pickedAccount
    Save-Config $Config
    $repoInput = Read-RequiredText "请输入 GitHub 仓库地址（例如 https://github.com/loqwe/heyun-zjmf-worker-monitor）"
    $script:UpstreamRepo = Convert-GitHubRepoInput $repoInput
    $Config.upstreamRepo = $script:UpstreamRepo
    Save-Config $Config
    $Config.adminToken = Read-AdminTokenWithConfirmation
    Save-Config $Config
    if ($Config.adminToken -eq "admin") { Write-Host "已使用默认管理后台密码：admin。部署后可在管理面板设置里修改。" -ForegroundColor Yellow }
}
function Ensure-CloudflareAuth($Config) {
    $whoami = ""
    try { $whoami = Invoke-CommandLine (Get-WranglerCommand @("whoami")) } catch {}
    $detectedAccountIds = @(Get-CloudflareWhoamiAccountIds $whoami)
    $configAccountId = (Get-ConfigValue $Config "cloudflareAccountId" "").ToLowerInvariant()
    $envAccountId = if ($env:CLOUDFLARE_ACCOUNT_ID) { $env:CLOUDFLARE_ACCOUNT_ID.Trim().ToLowerInvariant() } else { "" }
    $resolvedAccountId = if ($configAccountId) { $configAccountId } else { $envAccountId }
    if ([string]::IsNullOrWhiteSpace($resolvedAccountId)) {
        if ([string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
            Write-Step "Cloudflare 登录"
            Invoke-CommandLine (Get-WranglerCommand @("login")) | Out-Null
        }
        throw "未填写 Cloudflare Account ID。请双击一键安装 BAT 输入，或在 one-click.config.jsonc 填写 cloudflareAccountId。"
    }
    $env:CLOUDFLARE_ACCOUNT_ID = $resolvedAccountId
    if ($configAccountId -ne $resolvedAccountId) {
        $Config.cloudflareAccountId = $resolvedAccountId
        Save-Config $Config
    }
    if ($detectedAccountIds.Count -gt 0 -and -not ($detectedAccountIds -contains $resolvedAccountId)) {
        Write-Host "警告：当前使用的 Account ID 不在 Token 检测列表里，请确认 Token 有该账户权限。" -ForegroundColor Yellow
        return
    }
    Write-Note "使用用户指定的 Cloudflare Account ID: $resolvedAccountId"
}
function Use-FixedWranglerInSource([string]$WorkerRoot) {
    $preparePath = Join-Path $WorkerRoot "scripts\prepare-cloudflare.mjs"
    if (-not (Test-Path $preparePath)) { return }
    $content = Get-Content -LiteralPath $preparePath -Raw -Encoding utf8
    $patched = $content -replace "'wrangler@latest'", "'$WranglerPackage'"
    if ($patched -ne $content) {
        Set-Content -LiteralPath $preparePath -Value $patched -Encoding utf8
        Write-Note "已固定 Wrangler 版本: $WranglerPackage"
    }
}
function Ensure-WorkersDevEnabled([string]$WorkerRoot) {
    $tomlPath = Join-Path $WorkerRoot "wrangler.toml"
    if (-not (Test-Path $tomlPath)) { return }
    $toml = Get-Content -LiteralPath $tomlPath -Raw -Encoding utf8
    if ($toml -match '(?m)^workers_dev\s*=') {
        $toml = [regex]::Replace($toml, '(?m)^workers_dev\s*=.*$', 'workers_dev = true')
    } else {
        $toml = $toml -replace '(?m)^(compatibility_date\s*=.*)$', "`$1`nworkers_dev = true"
    }
    Set-Content -LiteralPath $tomlPath -Value $toml -Encoding utf8
}
function Post-Admin($BaseUrl, $Token, [string]$Path, $Body) {
    $json = $Body | ConvertTo-Json -Depth 8 -Compress
    Invoke-RestMethod -Method Post -Uri "$BaseUrl$Path" -Headers @{ Authorization = "Bearer $Token" } -ContentType "application/json; charset=utf-8" -Body $json | Out-Null
}
function Get-WorkersDevUrl([string]$WorkerName, $Config) {
    $accountId = Get-ConfigValue $Config "cloudflareAccountId" $env:CLOUDFLARE_ACCOUNT_ID
    if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
        return ""
    }
    try {
        $headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
        $apiUrl = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/subdomain"
        $response = Invoke-RestMethod -Method Get -Uri $apiUrl -Headers $headers -TimeoutSec 30
        $subdomain = [string]$response.result.subdomain
        if (-not [string]::IsNullOrWhiteSpace($subdomain)) {
            return "https://$WorkerName.$subdomain.workers.dev"
        }
    } catch {
        Write-Note "未能自动读取 workers.dev 子域，将以上方 Wrangler 输出为准。"
    }
    return ""
}
function Enable-WorkerSubdomain([string]$WorkerName, $Config) {
    $accountId = Get-ConfigValue $Config "cloudflareAccountId" $env:CLOUDFLARE_ACCOUNT_ID
    if ([string]::IsNullOrWhiteSpace($accountId) -or [string]::IsNullOrWhiteSpace($env:CLOUDFLARE_API_TOKEN)) {
        Write-Note "缺少 Cloudflare Token 或 Account ID，跳过 workers.dev 显式启用。"
        return
    }
    try {
        $headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
        $apiUrl = "https://api.cloudflare.com/client/v4/accounts/$accountId/workers/scripts/$WorkerName/subdomain"
        $body = @{ enabled = $true; previews_enabled = $true } | ConvertTo-Json -Compress
        $response = Invoke-RestMethod -Method Post -Uri $apiUrl -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30
        if ($response.success -and $response.result.enabled) {
            Write-Note "已启用 workers.dev 访问 URL。"
            return
        }
        Write-Host "警告：workers.dev 启用接口返回异常，请到 Cloudflare 后台手动启用。" -ForegroundColor Yellow
    } catch {
        Write-Host "警告：未能自动启用 workers.dev，请到 Cloudflare 后台的 域和路由 手动启用。" -ForegroundColor Yellow
        Write-Note $_.Exception.Message
    }
}
function Seed-MonitorConfig($BaseUrl, $AdminToken, $Config) {
    $apiAccount = Get-ConfigValue $Config "zjmfApiAccount" $env:ZJMF_API_ACCOUNT
    $apiPassword = Get-ConfigValue $Config "zjmfApiPassword" $env:ZJMF_API_PASSWORD
    $serverId = Get-ConfigValue $Config "serverId" $env:ZJMF_SERVER_ID
    if ([string]::IsNullOrWhiteSpace($apiAccount) -or [string]::IsNullOrWhiteSpace($apiPassword) -or [string]::IsNullOrWhiteSpace($serverId)) {
        Write-Note "未填写魔方财务账号/API密钥/serverId，跳过初始化；可部署后进 /admin 手动添加。"
        return
    }
    $provider = Get-ConfigValue $Config "providerName" "heyunidc"
    $serverIp = Get-ConfigValue $Config "serverIp" $env:ZJMF_SERVER_IP
    $httpUrl = Get-ConfigValue $Config "httpUrl" ""
    $tcpHost = Get-ConfigValue $Config "tcpHost" $serverIp
    $tcpPort = Get-ConfigInt $Config "tcpPort" 996
    $method = Get-ConfigValue $Config "checkMethod" ""
    if (-not $method) { $method = if ($httpUrl -and $tcpHost) { "service_then_power" } elseif ($httpUrl) { "http_then_api" } elseif ($tcpHost -and $tcpPort -gt 0) { "tcp_then_api" } else { "api_only" } }
    if ($method -eq "service_then_power" -and -not $httpUrl -and -not $tcpHost) { $method = "api_only" }
    Write-Step "初始化监控配置"
    Post-Admin $BaseUrl $AdminToken "/api/admin/providers" @{
        name = $provider; display_name = Get-ConfigValue $Config "providerDisplayName" "核云"; api_base_url = Get-ConfigValue $Config "zjmfApiBaseUrl" "https://www.heyunidc.cn/v1"; api_account = $apiAccount; api_password = $apiPassword
    }
    Post-Admin $BaseUrl $AdminToken "/api/admin/servers" @{
        id = $serverId; name = Get-ConfigValue $Config "serverName" (if ($serverIp) { $serverIp } else { $serverId }); ip = $serverIp; provider = $provider; check_method = $method; enabled = $true; daily_reboot_limit = Get-ConfigInt $Config "dailyRebootLimit" 3; http_url = $httpUrl; http_method = Get-ConfigValue $Config "httpMethod" "GET"; http_expected_status = Get-ConfigValue $Config "httpExpectedStatus" "200-399"; tcp_host = $tcpHost; tcp_port = $tcpPort
    }
    $pushplus = Get-ConfigValue $Config "pushplusToken" $env:PUSHPLUS_TOKEN
    if ($pushplus) { Post-Admin $BaseUrl $AdminToken "/api/admin/settings" @{ webhook_url = "https://www.pushplus.plus/send"; webhook_type = "pushplus"; pushplus_token = $pushplus; timezone = Get-ConfigValue $Config "timezone" "Asia/Shanghai" } }
    Post-Admin $BaseUrl $AdminToken "/api/admin/run" @{}
}

trap { Write-Host ""; Write-Host "部署已中断: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }

$Config = Read-Config
$ConfigPath = $script:ConfigPath
$UpstreamRepo = Get-ConfigValue $Config "upstreamRepo" $UpstreamRepo

Write-Step "环境预检"
foreach ($cmd in @("node", $Npx)) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "找不到命令 $cmd，请先安装 Node.js 20+。" }
}
Invoke-InteractiveSetup $Config
$adminToken = Get-ConfigValue $Config "adminToken" ""
if (-not $Interactive -and $env:ZJMF_ADMIN_TOKEN) { $adminToken = $env:ZJMF_ADMIN_TOKEN }
if ([string]::IsNullOrWhiteSpace($adminToken) -or $adminToken -eq "请填写强密码") { throw "请在配置文件填写 adminToken，或设置环境变量 ZJMF_ADMIN_TOKEN。" }
if ($PreflightOnly) { Write-Host "预检通过。" -ForegroundColor Green; exit 0 }

$workerRoot = Resolve-WorkerRoot
Use-FixedWranglerInSource $workerRoot
Ensure-WorkersDevEnabled $workerRoot
$workerName = Get-ConfigValue $Config "workerName" "zjmf-monitor"
$databaseName = Get-ConfigValue $Config "d1DatabaseName" "$workerName-d1"
$env:WORKER_NAME = $workerName
$env:D1_DATABASE_NAME = $databaseName

Write-Step "本次部署配置"
Write-Host "  源码目录 : $workerRoot"
Write-Host "  Worker   : $workerName"
Write-Host "  D1       : $databaseName"
Write-Host "  配置文件 : $ConfigPath"

Ensure-CloudflareAuth $Config

Write-Step "创建或复用 D1，并写入 wrangler.toml"
Invoke-CommandLine @("node", (Join-Path $workerRoot "scripts\prepare-cloudflare.mjs")) $workerRoot | Write-Host
if ($PrepareOnly) { Write-Host "已完成预生成，未正式部署。" -ForegroundColor Green; exit 0 }

Write-Step "执行 D1 迁移"
Invoke-CommandLine (Get-WranglerCommand @("d1", "migrations", "apply", $databaseName, "--remote")) $workerRoot | Out-Null

Write-Step "写入管理后台密钥"
Invoke-CommandLine (Get-WranglerCommand @("secret", "put", "ADMIN_TOKEN")) $workerRoot $adminToken | Out-Null

Write-Step "部署 Worker"
Invoke-WranglerDeploy $workerRoot $workerName
Write-Step "启用 workers.dev 访问 URL"
Enable-WorkerSubdomain $workerName $Config
$workerUrl = Get-WorkersDevUrl $workerName $Config
if (-not $workerUrl) {
    Write-Host ""
    Write-Host "部署命令已完成，但脚本未自动解析到 workers.dev 地址；请以上方 Wrangler 输出为准。" -ForegroundColor Yellow
}

if (-not $SkipSeed -and $workerUrl) { Start-Sleep -Seconds 3; Seed-MonitorConfig $workerUrl $adminToken $Config }

Write-Host ""
Write-Host "部署完成。" -ForegroundColor Green
if ($workerUrl) {
    Write-Host "状态页     : $workerUrl/"
    Write-Host "管理后台   : $workerUrl/admin"
    Write-Host "状态 API   : $workerUrl/api/status"
} else {
    Write-Host "Worker 名称: $workerName"
    Write-Host "请从上方 Wrangler 输出复制 workers.dev 链接。"
}
