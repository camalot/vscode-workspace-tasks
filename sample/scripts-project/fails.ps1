# Fail the script after 5 seconds
Write-Host "Starting fail task..."
for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Seconds 1
    Write-Host "Waiting... $($i + 1) seconds"
}
Write-Host "Failing..."
exit 1
