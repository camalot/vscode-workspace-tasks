# Long running script that completes after 5 seconds
Write-Host "Starting long running task..."

for ($i = 0; $i -lt 5; $i++) {
    Start-Sleep -Seconds 1
    Write-Host "Waiting... $($i + 1) seconds"
}

Write-Host "Done"
exit 0
