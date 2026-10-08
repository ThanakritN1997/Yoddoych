# Build files for GitHub Releases:
#   dist/YoddoyHelper-<ver>-win64.zip   full package (first install / when FFmpeg, UxPlay, Node change)
#   dist/YoddoyHelper-win64.zip         same file, old name (old links keep working)
#   dist/YoddoyHelper-app-<ver>.zip     app folder only (small) for the built-in updater
#   dist/latest.json                    version info + SHA-256 for the built-in updater
# The folder inside the full zip is named "YoddoyHelper" (no version): after a built-in update the folder
# would otherwise show an old version. The window title shows the real running version.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$pkg = Get-Content (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $pkg.version
# Lowest installed version that can take a small (app-only) update. Raise it when anything outside app/ changes.
$minFull = $pkg.helperMinFull
$env:MSYSTEM = 'UCRT64'
$env:CHERE_INVOKING = '1'
& C:\msys64\usr\bin\bash.exe -l (($PSScriptRoot -replace '\\', '/') + '/build-helper.sh')
if ($LASTEXITCODE -ne 0) { throw 'build-helper.sh failed' }

$staged = Join-Path $root 'dist\staging\YoddoyHelper'
$dist = Join-Path $root 'dist'

$zip = Join-Path $dist "YoddoyHelper-$version-win64.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $staged -DestinationPath $zip -CompressionLevel Optimal
Copy-Item $zip (Join-Path $dist 'YoddoyHelper-win64.zip') -Force

$appZip = Join-Path $dist "YoddoyHelper-app-$version.zip"
if (Test-Path $appZip) { Remove-Item $appZip }
Compress-Archive -Path (Join-Path $staged 'app') -DestinationPath $appZip -CompressionLevel Optimal
$sha = (Get-FileHash $appZip -Algorithm SHA256).Hash.ToLower()

$base = "https://github.com/ThanakritN1997/Yoddoych/releases/download/v$version"
$manifest = [ordered]@{
  version = $version
  app = [ordered]@{ url = "$base/YoddoyHelper-app-$version.zip"; sha256 = $sha }
  minFullVersion = $minFull
  fullUrl = "$base/YoddoyHelper-$version-win64.zip"
}
[IO.File]::WriteAllText((Join-Path $dist 'latest.json'), ($manifest | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding $false))

'{0:N1} MB  {1}' -f ((Get-Item $zip).Length / 1MB), $zip
'{0:N0} KB  {1}' -f ((Get-Item $appZip).Length / 1KB), $appZip
