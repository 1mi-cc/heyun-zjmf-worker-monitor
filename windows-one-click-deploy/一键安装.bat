@echo off
chcp 65001 >nul
setlocal EnableExtensions

set "SELF_TEST=0"
if /I "%~1"=="--self-test" set "SELF_TEST=1"

cd /d "%~dp0"
set "SCRIPT_DIR=%CD%"
set "CACHE_DIR=%SCRIPT_DIR%\.cache\bootstrap"
set "CONFIG_FILE=%SCRIPT_DIR%\one-click.config.jsonc"
set "PS1_FILE=%CACHE_DIR%\deploy-one-click.ps1"
set "PS1_URL=https://raw.githubusercontent.com/loqwe/heyun-zjmf-worker-monitor/main/windows-one-click-deploy/deploy-one-click.ps1"

where pwsh >nul 2>nul
if %ERRORLEVEL%==0 (
  set "PS_EXE=pwsh"
) else (
  set "PS_EXE=powershell"
)

if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%" >nul 2>nul

echo.
echo ========================================
echo heyun-zjmf-worker-monitor 一键安装
echo ========================================
echo.
echo 本脚本会自动完成：
echo [1] 创建 one-click.config.jsonc
echo [2] 下载最新部署脚本
echo [3] 交互输入 Cloudflare Token、仓库地址、网站密码
echo [4] 部署 Cloudflare Worker
echo.

if exist "%SCRIPT_DIR%\deploy-one-click.ps1" (
  echo 使用当前目录的部署脚本...
  copy /Y "%SCRIPT_DIR%\deploy-one-click.ps1" "%PS1_FILE%" >nul
) else (
  echo 正在下载部署脚本...
  set "BOOTSTRAP_URL=%PS1_URL%"
  set "BOOTSTRAP_PS1=%PS1_FILE%"
  "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri $env:BOOTSTRAP_URL -OutFile $env:BOOTSTRAP_PS1 -UseBasicParsing"
  if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 部署脚本下载失败。
    pause
    exit /b 1
  )
)

if "%SELF_TEST%"=="1" (
  set "ZJMF_ADMIN_TOKEN=admin"
  "%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1_FILE%" -ConfigPath "%CONFIG_FILE%" -PreflightOnly
  exit /b %ERRORLEVEL%
)

"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1_FILE%" -ConfigPath "%CONFIG_FILE%" -Interactive
set "SCRIPT_EXIT=%ERRORLEVEL%"
echo.
if not "%SCRIPT_EXIT%"=="0" (
  echo [ERROR] 部署已中断，退出码：%SCRIPT_EXIT%
  echo 请查看上方错误信息。
) else (
  echo [OK] 部署脚本执行完成。
)
pause
exit /b %SCRIPT_EXIT%
