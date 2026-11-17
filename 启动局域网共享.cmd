@echo off
cd /d "%~dp0"
set "PORT=4189"
echo Starting office shared workspace. Keep this window open.
node lan-server.cjs
pause
