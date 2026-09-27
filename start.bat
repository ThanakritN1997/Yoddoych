@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Screen Mirror

rem เปิดเว็บ (ปุ่ม "เริ่มสะท้อนหน้าจอ" ในหน้าเว็บจะเปิดตัวรับ AirPlay "PC-Mirror" ให้เอง)
if not exist node_modules call npm install
start "" http://localhost:3000/studio.html
node server.js
pause
