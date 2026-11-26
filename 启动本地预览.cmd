@echo off
cd /d "%~dp0"
set "PORT=4188"
echo Urban Renewal Lab: http://127.0.0.1:4188/
echo Keep this window open while using the local website.
node server.cjs
pause
