[CmdletBinding()]
param(
    [ValidateSet('Rehearsal', 'Configure')][string]$Mode = 'Rehearsal',
    [string]$DataDirectory,
    [string]$BackupDirectory,
    [ValidateRange(1024, 65535)][int]$Port = 3000,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
$npm = (Get-Command npm.cmd -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1).Source
if (!$node -or !$npm) { throw 'Install Node.js 24 with npm, then open a new PowerShell window.' }
$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) {
    throw 'Install Node.js 24 or newer.'
}

function Get-OfficePath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[/\\]' -or $Path -match '[\x00-\x1f"]') {
        throw 'Use an absolute path on a local drive, such as C:\ConceptPrivate.'
    }
    $resolved = [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('/', '\'))
    if ($resolved.Length -le 2) { throw 'Use a dedicated directory on the drive.' }
    if (!(Test-Path -LiteralPath ([IO.Path]::GetPathRoot($resolved)) -PathType Container)) {
        throw "The drive for $resolved is unavailable."
    }
    if ($resolved.Equals($root, 'OrdinalIgnoreCase') -or $resolved.StartsWith($root + '\', 'OrdinalIgnoreCase')) {
        throw 'Choose a directory outside the source checkout.'
    }
    if (Test-Path -LiteralPath $resolved -PathType Leaf) { throw "The directory path is already a file: $resolved" }
    return $resolved
}

$config = Join-Path $root '.env'
if ($Mode -eq 'Configure') {
    if (Test-Path -LiteralPath $config) {
        Write-Host 'Existing configuration preserved. Use scripts\start-server.ps1 after reviewing .env.'
        return
    }
    if (!$DataDirectory -or !$BackupDirectory) {
        throw 'Pass separate -DataDirectory and -BackupDirectory paths outside this checkout.'
    }
    $data = Get-OfficePath $DataDirectory
    $backups = Get-OfficePath $BackupDirectory
    if ($data.Equals($backups, 'OrdinalIgnoreCase') -or $data.StartsWith($backups + '\', 'OrdinalIgnoreCase') -or
        $backups.StartsWith($data + '\', 'OrdinalIgnoreCase')) {
        throw 'Use separate, non-overlapping data and backup directories.'
    }
    Write-Host "Local workspace address: http://127.0.0.1:$Port"
    Write-Host "Database and private files: $data"
    Write-Host "Backups: $backups"
} else {
    Write-Host 'Temporary rehearsal uses synthetic accounts and cleans up when stopped with Ctrl+C.'
}
if ($CheckOnly) { Write-Host 'Setup check passed.'; return }

Push-Location $root
try {
    & $npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the npm output before retrying.' }
    if ($Mode -eq 'Rehearsal') {
        & $node scripts/demo.js
        if ($LASTEXITCODE -ne 0) { throw 'The rehearsal stopped with an error.' }
        return
    }

    [IO.Directory]::CreateDirectory($data) | Out-Null
    [IO.Directory]::CreateDirectory($backups) | Out-Null
    $databasePath = (Join-Path $data 'workforce.sqlite').Replace('\', '/')
    $backupPath = $backups.Replace('\', '/')
    $pending = Join-Path $root ('.env.setup-' + [guid]::NewGuid().ToString('N'))
    $settings = @(
        'HOST=127.0.0.1'
        "PORT=$Port"
        ('DATABASE_PATH="{0}"' -f $databasePath)
        ('BACKUP_DIRECTORY="{0}"' -f $backupPath)
        'ENABLE_WEB_PUSH=0'
    )
    try {
        [IO.File]::WriteAllLines($pending, [string[]]$settings, [Text.UTF8Encoding]::new($false))
        [IO.File]::Move($pending, $config)
    } finally { [IO.File]::Delete($pending) }
    Write-Host 'Local configuration saved. Follow START_HERE.md to provision the admin and check startup.'
} finally { Pop-Location }
