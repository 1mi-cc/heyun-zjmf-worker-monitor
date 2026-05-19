@echo off
chcp 65001 >nul
setlocal EnableExtensions

cd /d "%~dp0"
set "SCRIPT_DIR=%CD%"
set "UPSTREAM_REPO=loqwe/heyun-zjmf-worker-monitor"
set "GITHUB_REPO_URL=https://github.com/%UPSTREAM_REPO%"
set "REMOTE_BASE=https://raw.githubusercontent.com/%UPSTREAM_REPO%/main/windows-one-click-deploy"
set "STEP2_FILE=%SCRIPT_DIR%\步骤2-一键部署.bat"
set "PS1_FILE=%SCRIPT_DIR%\deploy-one-click.ps1"
set "EXAMPLE_FILE=%SCRIPT_DIR%\one-click.config.example.jsonc"
set "CONFIG_FILE=%SCRIPT_DIR%\one-click.config.jsonc"
set "STEP2_URL=%REMOTE_BASE%/步骤2-一键部署.bat"
set "PS1_URL=%REMOTE_BASE%/deploy-one-click.ps1"
set "EXAMPLE_URL=%REMOTE_BASE%/one-click.config.example.jsonc"

set "PS_EXE="
where pwsh >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh"
if defined PS_EXE goto after_detect_powershell
where powershell >nul 2>nul
if not errorlevel 1 set "PS_EXE=powershell"
:after_detect_powershell

echo.
echo ========================================
echo heyun-zjmf-worker-monitor 步骤1-一键安装
echo ========================================
echo GitHub 仓库地址：%GITHUB_REPO_URL%
echo 检查依赖、下载部署文件，然后启动步骤2。
echo.

call :check_dependencies
if errorlevel 1 exit /b 1

call :fetch "%STEP2_FILE%" "%STEP2_URL%" "步骤2-一键部署.bat"
if errorlevel 1 exit /b 1
call :fix_crlf "%STEP2_FILE%"
if errorlevel 1 exit /b 1
call :fetch "%PS1_FILE%" "%PS1_URL%" "deploy-one-click.ps1"
if errorlevel 1 exit /b 1
call :fetch "%EXAMPLE_FILE%" "%EXAMPLE_URL%" "one-click.config.example.jsonc"
if errorlevel 1 exit /b 1

if not exist "%CONFIG_FILE%" (
  copy /Y "%EXAMPLE_FILE%" "%CONFIG_FILE%" >nul
  echo [成功] 已创建 one-click.config.jsonc
)

if /I "%~1"=="--self-test" set "ZJMF_ADMIN_TOKEN=admin"
call "%STEP2_FILE%" %*
exit /b %ERRORLEVEL%

:fetch
echo 下载/更新：%~3
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $tmp='%~1.tmp'; if(Test-Path -LiteralPath $tmp){Remove-Item -LiteralPath $tmp -Force}; Invoke-WebRequest -Uri '%~2' -OutFile $tmp -UseBasicParsing; Move-Item -LiteralPath $tmp -Destination '%~1' -Force"
exit /b %ERRORLEVEL%

:check_dependencies
echo 正在检查依赖...
if not defined PS_EXE call :install_powershell
if not defined PS_EXE goto dep_powershell_missing
where node >nul 2>nul
if errorlevel 1 goto dep_node_missing
where npx >nul 2>nul
if errorlevel 1 where npx.cmd >nul 2>nul
if errorlevel 1 goto dep_npx_missing
echo [成功] 依赖检查完成：PowerShell、Node.js、npx
exit /b 0

:dep_powershell_missing
echo [错误] 未找到 PowerShell。
echo 请先安装 PowerShell 7，或手动安装后再重新运行。
echo 下载地址：https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows
exit /b 1

:dep_node_missing
call :install_node
where node >nul 2>nul
if errorlevel 1 goto dep_node_missing_final
where npx >nul 2>nul
if errorlevel 1 where npx.cmd >nul 2>nul
if errorlevel 1 goto dep_npx_missing
echo [成功] 依赖检查完成：PowerShell、Node.js、npx
exit /b 0

:dep_node_missing_final
echo [错误] 未找到 Node.js。
echo 请先安装 Node.js 20+，或手动安装后再重新运行。
echo 下载地址：https://nodejs.org/zh-cn/download
exit /b 1

:dep_npx_missing
echo [错误] 未找到 npx。Node.js 安装可能不完整，请重新安装 Node.js 20+。
exit /b 1

:install_powershell
where winget >nul 2>nul
if errorlevel 1 exit /b 0
echo 检测到缺少 PowerShell，尝试通过 winget 安装 PowerShell 7...
winget install -e --id Microsoft.PowerShell --silent --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\PowerShell\7;%PATH%"
where pwsh >nul 2>nul
if not errorlevel 1 set "PS_EXE=pwsh"
if defined PS_EXE exit /b 0
where powershell >nul 2>nul
if not errorlevel 1 set "PS_EXE=powershell"
exit /b 0

:install_node
where winget >nul 2>nul
if errorlevel 1 exit /b 0
echo 检测到缺少 Node.js，尝试通过 winget 安装 Node.js LTS...
winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%LOCALAPPDATA%\Programs\nodejs;%PATH%"
exit /b 0

:fix_crlf
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$p='%~1'; $t=Get-Content -LiteralPath $p -Raw -Encoding UTF8; $t=$t -replace '\r?\n', [Environment]::NewLine; [System.IO.File]::WriteAllText($p,$t,[System.Text.UTF8Encoding]::new($false))"
exit /b %ERRORLEVEL%
