$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = & node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
    throw 'Install Node.js 24 or newer first.'
}
if (!(Test-Path '.env')) { Copy-Item '.env.example' '.env' }
& npm.cmd ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Host 'Dependencies installed. Review .env before starting the workspace.'
