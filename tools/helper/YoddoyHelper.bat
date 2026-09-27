@echo off
rem Keep this file ASCII-only: cmd.exe misparses batch files that contain multi-byte text.
title Yoddoy Helper
cd /d "%~dp0"

rem Everything the helper needs is inside this folder.
set "HELPER=1"
set "UXPLAY_DIR=%~dp0bin"
set "FFMPEG=%~dp0bin\ffmpeg.exe"
set "PATH=%~dp0bin;%SystemRoot%\System32;%SystemRoot%;%SystemRoot%\System32\WindowsPowerShell\v1.0"
set "GST_PLUGIN_SYSTEM_PATH=%~dp0lib\gstreamer-1.0"
set "GST_PLUGIN_PATH="
set "GST_PLUGIN_SCANNER=%~dp0libexec\gstreamer-1.0\gst-plugin-scanner.exe"
if not exist "%LOCALAPPDATA%\YoddoyHelper" mkdir "%LOCALAPPDATA%\YoddoyHelper"
set "GST_REGISTRY=%LOCALAPPDATA%\YoddoyHelper\gst-registry.bin"

"%~dp0runtime\node.exe" "%~dp0app\server.js"
echo.
echo Yoddoy Helper has stopped.
pause
