@echo off
rem Keep this file ASCII-only: cmd.exe misparses batch files that contain multi-byte text.
rem Starts the web server. The "Start mirroring" button in the page launches the AirPlay receiver (PC-Mirror).
cd /d "%~dp0"
title Screen Mirror
if not exist node_modules call npm install
start "" http://localhost:3000/studio.html
node server.js
pause
