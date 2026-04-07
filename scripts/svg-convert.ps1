
# set the output image size from argument
param(
    [int]$Width = 128,
    [string]$pattern = "../res/icons/**/*.svg",
    [bool]$overwrite = $false
)

foreach ($file in Get-ChildItem -Recurse $pattern) {
  # get system path separator
  $sep = [System.IO.Path]::DirectorySeparatorChar
  $pngPath = $file.DirectoryName + $sep + $file.BaseName + ".png"
  if (-not $overwrite -and (Test-Path $pngPath)) {
    Write-Output "Skipping $pngPath as it already exists."
    continue
  }

  Write-Output "Converting $($file.FullName) to PNG with width $Width -> $pngPath"
  magick -density 300 -background none $file.FullName -resize ${Width}x $pngPath
}
