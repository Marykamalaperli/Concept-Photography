param(
    [Parameter(Mandatory=$true)][string]$Backup,
    [Parameter(Mandatory=$true)][string]$NewDatabase
)
$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath $Backup).Path
$destination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($NewDatabase)
Set-Location (Join-Path $PSScriptRoot '..')
& node scripts/database-backup.js restore $source $destination
if ($LASTEXITCODE -ne 0) { throw 'Restore failed. The configured production database has not been replaced.' }
Write-Host 'Restored to a separate database and, if present, an adjacent .files folder. Verify the pair before switching DATABASE_PATH or FILE_STORAGE_DIRECTORY.'
