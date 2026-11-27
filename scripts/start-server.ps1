param([string]$NodePath = 'node', [switch]$LogToFile)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (!(Test-Path '.env')) { throw 'Run .\scripts\install.ps1 first.' }
if ($LogToFile) {
    New-Item -ItemType Directory -Path 'data\logs' -Force | Out-Null
    $stamp = Get-Date -Format 'yyyy-MM-dd'
    & $NodePath --env-file=.env server.js >> "data\logs\workspace-$stamp.log" 2>&1
} else {
    & $NodePath --env-file=.env server.js
}
if ($LASTEXITCODE -ne 0) { throw 'The workspace server exited with an error.' }
