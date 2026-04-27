@echo off
chcp 65001 >nul
title Doscom Dashboard - Local Dev Server

REM ═════════════════════════════════════════════════════════════════
REM  Khoi dong dev server Cloudflare Pages local cho Doscom Dashboard
REM  Su dung trong terminal Antigravity / VSCode / cmd / PowerShell
REM
REM  Lan dau setup:
REM    1. npm install -g wrangler   (cai wrangler global)
REM    2. wrangler login            (auth Cloudflare account)
REM    3. copy .dev.vars.example .dev.vars   (tao file secret local)
REM
REM  Chay:
REM    .\dev.bat        (PowerShell)
REM    dev.bat          (cmd.exe)
REM
REM  URL: http://localhost:8788
REM ═════════════════════════════════════════════════════════════════

echo.
echo ════════════════════════════════════════════════════
echo   Doscom Dashboard - Local Dev Server
echo ════════════════════════════════════════════════════
echo.

REM === Check wrangler installed ===
where wrangler >nul 2>&1
if errorlevel 1 (
  echo [LOI] Chua cai wrangler.
  echo.
  echo Chay lenh sau roi quay lai:
  echo    npm install -g wrangler
  echo.
  pause
  exit /b 1
)

REM === Check .dev.vars exists ===
if not exist .dev.vars (
  if exist .dev.vars.example (
    echo .dev.vars chua co - tao tu .dev.vars.example...
    copy .dev.vars.example .dev.vars >nul
    echo Tao xong. Co the chinh .dev.vars neu can custom secret.
    echo.
  ) else (
    echo [LOI] Khong tim thay .dev.vars.example
    pause
    exit /b 1
  )
)

REM === Print info + start ===
echo Server URL : http://localhost:8788
echo KV binding : INVENTORY (local, rong - khong co data inventory)
echo AI binding : AI (call remote Workers AI - can wrangler login)
echo Stop server: Ctrl+C
echo.
echo Luu y:
echo  - Login Google OAuth tren localhost CHUA SETUP
echo    -^> Cac nut goi /api/* se tra ve 401 "Chua dang nhap"
echo  - De test API: copy cookie "doscom_session" tu tab prod
echo    (DevTools ^> Application ^> Cookies) sang tab localhost:8788
echo.
echo Khoi dong...
echo.

wrangler pages dev . --kv=INVENTORY --ai=AI --compatibility-date=2026-04-01
