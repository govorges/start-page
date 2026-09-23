# Draws the "~/" start mark and saves it in all standard sizes as:
#   assets\start-page.ico       orange, for the installed (live) app
#   assets\start-page-test.ico  green, for the test copy started by start.bat
# Sizes up to 64 are stored as plain bitmaps and 256 as PNG, like Windows' own icons: some programs
# (including .NET's, used by the tray icon) can't read PNG-compressed small sizes.
# Run again after changing the colors below: powershell -ExecutionPolicy Bypass -File scripts\make-icon.ps1
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$variants = @(
  @{ File = 'start-page.ico';      Background = '#fa6e1d'; Foreground = '#140b06' },  # orange accent
  @{ File = 'start-page-test.ico'; Background = '#4db649'; Foreground = '#0b1a0c' }   # green accent
)
$sizes = 16, 20, 24, 32, 40, 48, 64, 256

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'assets'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function Draw-Image($size, $background, $foreground) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'
  $g.TextRenderingHint = if ($size -le 24) { 'AntiAliasGridFit' } else { 'AntiAlias' }
  $g.Clear($background)
  # Consolas ships with Windows; the dashboard itself uses Fira Code, which may not be installed.
  # Small icons need proportionally bigger text to stay legible.
  $em = if ($size -le 24) { 0.68 } elseif ($size -le 48) { 0.62 } else { 0.56 }
  $font = New-Object System.Drawing.Font 'Consolas', ([float]($size * $em)), ([System.Drawing.FontStyle]::Bold), ([System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = 'Center'
  $format.LineAlignment = 'Center'
  $brush = New-Object System.Drawing.SolidBrush $foreground
  $rect = New-Object System.Drawing.RectangleF 0, ([float]($size * 0.02)), $size, $size
  $g.DrawString('~/', $font, $brush, $rect, $format)
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  if ($size -ge 256) {
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    # BITMAPINFOHEADER (height doubled to cover the mask), BGRA rows bottom-up, then an empty 1-bit mask.
    $maskRow = [int]([math]::Ceiling($size / 32) * 4)
    $bw = New-Object System.IO.BinaryWriter $ms
    $bw.Write([uint32]40); $bw.Write([int32]$size); $bw.Write([int32]($size * 2))
    $bw.Write([uint16]1); $bw.Write([uint16]32); $bw.Write([uint32]0)
    $bw.Write([uint32]($size * $size * 4 + $maskRow * $size))
    $bw.Write([int32]0); $bw.Write([int32]0); $bw.Write([uint32]0); $bw.Write([uint32]0)
    for ($y = $size - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $size; $x++) {
        $c = $bmp.GetPixel($x, $y)
        $bw.Write([byte]$c.B); $bw.Write([byte]$c.G); $bw.Write([byte]$c.R); $bw.Write([byte]$c.A)
      }
    }
    $bw.Write((New-Object byte[] ($maskRow * $size)))
    $bw.Flush()
  }
  $bmp.Dispose()
  [pscustomobject]@{ Size = $size; Bytes = $ms.ToArray() }
}

foreach ($v in $variants) {
  $background = [System.Drawing.ColorTranslator]::FromHtml($v.Background)
  $foreground = [System.Drawing.ColorTranslator]::FromHtml($v.Foreground)
  $images = foreach ($size in $sizes) { Draw-Image $size $background $foreground }

  # ICO container: 6-byte header, a 16-byte entry per image, then the image data.
  $outFile = Join-Path $outDir $v.File
  $fs = [System.IO.File]::Create($outFile)
  $w = New-Object System.IO.BinaryWriter $fs
  $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]$images.Count)
  $offset = 6 + 16 * $images.Count
  foreach ($img in $images) {
    $dim = if ($img.Size -ge 256) { 0 } else { $img.Size }
    $w.Write([byte]$dim); $w.Write([byte]$dim); $w.Write([byte]0); $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$img.Bytes.Length); $w.Write([uint32]$offset)
    $offset += $img.Bytes.Length
  }
  foreach ($img in $images) { $w.Write($img.Bytes) }
  $w.Close()
  Write-Host "Saved $outFile ($($images.Count) sizes)"
}
