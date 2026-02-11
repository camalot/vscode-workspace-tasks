<#
.SYNOPSIS
    Loads environment variables from .secrets file for local testing.

.DESCRIPTION
    Reads the .secrets file from the repository root and sets environment variables
    for the current PowerShell session. This is useful for local development and testing.

.PARAMETER SecretsFile
    Path to the secrets file. Defaults to .secrets in the repository root.

.PARAMETER Scope
    The scope for the environment variables. Valid values are 'Process' (default) or 'User'.
    - Process: Sets variables for the current session only
    - User: Sets variables permanently for the current user

.EXAMPLE
    .\scripts\load-secrets.ps1
    Loads secrets for the current session

.EXAMPLE
    .\scripts\load-secrets.ps1 -Scope User
    Loads secrets permanently for the current user

.EXAMPLE
    . .\scripts\load-secrets.ps1
    Dot-sources the script to load secrets in the current context
#>

param(
    [string]$SecretsFile = (Join-Path -Path $PSScriptRoot -ChildPath ".." -ChildPath ".secrets"),
    [ValidateSet('Process', 'User')]
    [string]$Scope = 'Process'
)

# Resolve the secrets file path
$SecretsFile = Resolve-Path $SecretsFile -ErrorAction SilentlyContinue

if (-not $SecretsFile -or -not (Test-Path $SecretsFile)) {
    Write-Error "Secrets file not found at: $SecretsFile"
    exit 1
}

Write-Output "Loading secrets from: $SecretsFile" -ForegroundColor Cyan

$loadedCount = 0
$skippedCount = 0

Get-Content $SecretsFile | ForEach-Object {
    $line = $_.Trim()

    # Skip empty lines and comments
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
        return
    }

    # Parse KEY="VALUE" or KEY=VALUE format
    if ($line -match '^([^=]+)=(.+)$') {
        $key = $matches[1].Trim()
        $value = $matches[2].Trim()

        # Remove quotes if present
        if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") {
            $value = $matches[1]
        }

        # Check if variable already exists
        $existing = [System.Environment]::GetEnvironmentVariable($key, $Scope)

        if ($existing -and $Scope -eq 'Process') {
            Write-Output "  ⚠️  Skipping $key (already set in current session)" -ForegroundColor Yellow
            $skippedCount++
        } else {
            # Set the environment variable
            [System.Environment]::SetEnvironmentVariable($key, $value, $Scope)

            # Also set in the current session if scope is User
            if ($Scope -eq 'User') {
                [System.Environment]::SetEnvironmentVariable($key, $value, 'Process')
            }

            $indicator = if ($Scope -eq 'User') { '✓ [PERMANENT]' } else { '✓' }
            Write-Output "  $indicator Set $key" -ForegroundColor Green
            $loadedCount++
        }
    } else {
        Write-Warning "Skipping invalid line: $line"
    }
}

Write-Output ""
Write-Output "Summary:" -ForegroundColor Cyan
Write-Output "  Loaded: $loadedCount" -ForegroundColor Green
if ($skippedCount -gt 0) {
    Write-Output "  Skipped: $skippedCount" -ForegroundColor Yellow
}

if ($Scope -eq 'Process') {
    Write-Output ""
    Write-Output "Environment variables are set for this session only." -ForegroundColor Yellow
    Write-Output "To set them permanently, run: .\scripts\load-secrets.ps1 -Scope User" -ForegroundColor Yellow
}
