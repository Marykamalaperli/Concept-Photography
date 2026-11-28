param([Parameter(Mandatory=$true)][ValidatePattern('^[0-9a-fA-F]{40}$')][string]$ApprovedCommit)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
Set-Location (Join-Path $PSScriptRoot '..')
if (& git status --porcelain) { throw 'The checkout contains changes. Review them before updating.' }
& git fetch origin main
if ($LASTEXITCODE -ne 0) { throw 'Could not fetch the approved release.' }
& git merge-base --is-ancestor $ApprovedCommit FETCH_HEAD
if ($LASTEXITCODE -ne 0) { throw 'The approved commit is not present in origin/main.' }
$previous = & git rev-parse HEAD
Write-Host 'Stop the workspace and its reverse proxy before continuing this update.'
$confirmation = Read-Host 'Type STOPPED to continue'
if ($confirmation -cne 'STOPPED') { throw 'Update cancelled before replacing any files.' }
$workspaceTask = Get-ScheduledTask -TaskName 'Concept Photography Workspace' -ErrorAction SilentlyContinue
if ($workspaceTask -and $workspaceTask.State -eq 'Running') { throw 'Stop the workspace scheduled task before updating.' }
& (Join-Path $PSScriptRoot 'backup.ps1')
Write-Host "Previous release: $previous"
& git checkout --detach $ApprovedCommit
if ($LASTEXITCODE -ne 0) { throw 'Checkout failed. The previous release and backup remain available.' }
& npm.cmd ci --omit=dev
if ($LASTEXITCODE -ne 0) {
    Write-Warning "Installation failed. Restoring the previous checkout and dependencies for $previous."
    & git checkout --detach $previous
    if ($LASTEXITCODE -ne 0) { throw "Checkout recovery failed. Keep the service stopped and restore $previous manually." }
    & npm.cmd ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw "Dependency recovery failed. Keep the service stopped and review npm before starting $previous." }
    throw 'The update failed. The previous checkout and dependencies were restored. The workspace remains stopped for a verified restart.'
}
Write-Host 'Start the workspace, then run health-check.ps1. Review the recovery guide before reverting a database migration.'
