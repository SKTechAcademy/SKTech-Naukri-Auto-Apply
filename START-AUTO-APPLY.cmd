@echo off
cd /d "%~dp0worker"
if not exist node_modules call npm install --no-audit --no-fund
if errorlevel 1 exit /b 1
call npx playwright install chromium
if errorlevel 1 exit /b 1
echo Open http://127.0.0.1:8788 in your browser.
call npm start
