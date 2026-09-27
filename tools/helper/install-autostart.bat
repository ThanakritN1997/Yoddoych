@echo off
rem Create a Startup shortcut so Yoddoy Helper starts (minimized) every time you sign in to Windows.
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Yoddoy Helper.lnk'); $s.TargetPath='%~dp0YoddoyHelper.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Save()"
if errorlevel 1 (echo Could not create the startup shortcut.) else (echo Done: Yoddoy Helper will start automatically when you sign in.)
pause
