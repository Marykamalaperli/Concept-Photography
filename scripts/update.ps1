param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{7,40}$')][string]$ApprovedCommit)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (& git status --porcelain) { throw 'The checkout contains changes. Review them before updating.' }
& git fetch origin
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the approved release.' }
& git merge-base --is-ancestor $ApprovedCommit origin/main
if ($LASTEXITCODE -ne 0) { throw 'The approved commit is not present in origin/main.' }
$previous = & git rev-parse HEAD
Write-Host 'Stop the workspace and its reverse proxy before continuing this update.'
$confirmation = Read-Host 'Type STOPPED to continue'
if ($confirmation -cne 'STOPPED') { throw 'Update cancelled before replacing any files.' }
& (Join-Path $PSScriptRoot 'backup.ps1')
Write-Host "Previous release: $previous"
& git checkout --detach $ApprovedCommit
if ($LASTEXITCODE -ne 0) { throw 'Checkout failed. The previous release and backup remain available.' }
& npm.cmd ci --omit=dev
if ($LASTEXITCODE -ne 0) { throw "Installation failed. Restore release $previous before restarting." }
Write-Host 'Start the workspace, then run health-check.ps1. Review the recovery guide before reverting a database migration.'
