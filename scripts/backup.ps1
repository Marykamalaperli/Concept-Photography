$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
& node --env-file=.env scripts/database-backup.js backup
if ($LASTEXITCODE -ne 0) { throw 'Backup failed. Review the database and backup folder settings.' }
