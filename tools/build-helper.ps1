# สร้าง dist/YoddoyHelper-win64.zip สำหรับอัปโหลดขึ้น GitHub Releases
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$env:MSYSTEM = 'UCRT64'
$env:CHERE_INVOKING = '1'
& C:\msys64\usr\bin\bash.exe -l (($PSScriptRoot -replace '\\', '/') + '/build-helper.sh')
if ($LASTEXITCODE -ne 0) { throw 'build-helper.sh ล้มเหลว' }

$zip = Join-Path $root 'dist\YoddoyHelper-win64.zip'
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path (Join-Path $root 'dist\staging\YoddoyHelper') -DestinationPath $zip -CompressionLevel Optimal
'{0:N1} MB  {1}' -f ((Get-Item $zip).Length / 1MB), $zip
