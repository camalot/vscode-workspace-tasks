
# set the output image size from argument
param(
    [int]$Width = 128,
    [string]$pattern = "../res/icons/**/*.svg"
)

foreach ($file in Get-ChildItem -Recurse -Filter $pattern) {
  Write-Output "Converting $($file.FullName) to PNG with width $Width"
  magick -density 300 -background none $file.FullName -resize ${Width}x ($file.DirectoryName + "\" + $file.BaseName + ".png")
}
