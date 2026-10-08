# สร้าง dist/YoddoyHelper-<เวอร์ชัน>-win64.zip สำหรับอัปโหลดขึ้น GitHub Releases
# ข้างในเป็นโฟลเดอร์ YoddoyHelper-<เวอร์ชัน> → แตกไฟล์แล้วรู้ทันทีว่าเป็นเวอร์ชันไหน
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
$env:MSYSTEM = 'UCRT64'
$env:CHERE_INVOKING = '1'
& C:\msys64\usr\bin\bash.exe -l (($PSScriptRoot -replace '\\', '/') + '/build-helper.sh')
if ($LASTEXITCODE -ne 0) { throw 'build-helper.sh ล้มเหลว' }

$staged = Join-Path $root 'dist\staging\YoddoyHelper'
$named = Join-Path $root "dist\staging\YoddoyHelper-$version"
if (Test-Path $named) { Remove-Item $named -Recurse -Force }
Move-Item $staged $named

$zip = Join-Path $root "dist\YoddoyHelper-$version-win64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $named -DestinationPath $zip -CompressionLevel Optimal
# ชื่อเดิม (ไม่มีเวอร์ชัน) ไว้ให้ลิงก์เก่า .../releases/latest/download/YoddoyHelper-win64.zip ยังใช้ได้
Copy-Item $zip (Join-Path $root 'dist\YoddoyHelper-win64.zip') -Force
'{0:N1} MB  {1}' -f ((Get-Item $zip).Length / 1MB), $zip
