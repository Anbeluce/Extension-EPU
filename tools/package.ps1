# Đóng gói extension thành dist/tro-ly-sinh-vien-<version>.zip, chỉ gồm file cần thiết
# (không kèm html/, .playwright-mcp/, tools/, README...). Chạy: powershell -File tools/package.ps1
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content (Join-Path $root "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$include = "manifest.json", "config.js", "icons", "lib", "shared", "background", "content", "popup", "options", "teachers"

$dist = Join-Path $root "dist"
New-Item -ItemType Directory -Force $dist | Out-Null
$zipPath = Join-Path $dist "tro-ly-sinh-vien-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
try {
  foreach ($item in $include) {
    $full = Join-Path $root $item
    $files = if (Test-Path $full -PathType Container) { Get-ChildItem $full -Recurse -File } else { Get-Item $full }
    foreach ($f in $files) {
      # Dùng dấu / trong tên mục zip (Compress-Archive của PowerShell 5.1 dùng \, store không chấp nhận).
      $entry = $f.FullName.Substring($root.Length + 1) -replace "\\", "/"
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $f.FullName, $entry, "Optimal")
    }
  }
} finally {
  $zip.Dispose()
}
Write-Host "Created $zipPath"
