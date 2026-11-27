$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = (& node -p 'Number(process.versions.node.split(".")[0])')
if ($LASTEXITCODE -ne 0 -or [int]$version -lt 24) { throw 'Install Node.js 24 or newer first.' }
if (!(Test-Path '.env')) { Copy-Item '.env.example' '.env' }
& npm.cmd ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
Write-Host 'Dependencies installed. Review .env before starting the workspace.'
