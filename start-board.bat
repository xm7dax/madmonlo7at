@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required. Install Node.js, then run this file again.
  pause
  exit /b 1
)
if not exist "node_modules\tiktok-live-connector" (
  echo Installing the TikTok LIVE connector and server dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
start "Auction server" /D "%~dp0" cmd /k npm start
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:3001
