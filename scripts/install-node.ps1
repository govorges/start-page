# Downloads the current Node.js LTS (portable zip) into .\runtime\node for this folder only.
# Nothing is installed system-wide and no administrator rights are needed.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # progress bars make downloads much slower in Windows PowerShell
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$root    = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime'
$target  = Join-Path $runtime 'node'
$arch    = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'x64' }

Write-Host "  Looking up the current Node.js LTS release..."
$index   = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
$release = $index | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1
if (-not $release) { throw "Couldn't find a Node.js LTS download for Windows ($arch)." }

$version = $release.version
$name    = "node-$version-win-$arch"
$zipUrl  = "https://nodejs.org/dist/$version/$name.zip"
$zipPath = Join-Path $env:TEMP "$name.zip"

Write-Host "  Downloading Node.js $version ($arch)..."
Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing

Write-Host "  Checking the download..."
$sums     = Invoke-RestMethod -Uri "https://nodejs.org/dist/$version/SHASUMS256.txt" -UseBasicParsing
$line     = ($sums -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($name)).zip\s*$" } | Select-Object -First 1
if (-not $line) { throw "Couldn't find the checksum for $name.zip." }
$expected = ($line.Trim() -split '\s+')[0].ToLower()
$actual   = (Get-FileHash -Algorithm SHA256 -Path $zipPath).Hash.ToLower()
if ($expected -ne $actual) {
  Remove-Item $zipPath -Force
  throw "The download didn't match its published checksum, so it was deleted. Try again."
}

Write-Host "  Unpacking..."
# Unpack into a short temporary folder first: npm's deeply nested files can pass Windows' 260-character path limit.
$tmpDir = Join-Path $env:TEMP ("sp-node-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'
if (Test-Path $tar) {
  & $tar -xf $zipPath -C $tmpDir
  if ($LASTEXITCODE -ne 0) { throw "Unpacking Node.js failed (tar exit code $LASTEXITCODE)." }
} else {
  Expand-Archive -Path $zipPath -DestinationPath $tmpDir -Force
}
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
Move-Item -Path (Join-Path $tmpDir $name) -Destination $target
Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zipPath -Force

Write-Host "  Node.js $version is ready in runtime\node."
