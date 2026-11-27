param([Parameter(Mandatory=$true)][pscredential]$ServiceCredential)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$node = (Get-Command node.exe).Source
$taskName = 'Concept Photography Workspace'
$backupName = 'Concept Photography Backup'
foreach ($name in @($taskName, $backupName)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        throw "Task '$name' already exists. Review it in Task Scheduler before replacing it."
    }
}
if (!(Test-Path (Join-Path $root '.env'))) { throw 'Run installation and configure .env first.' }
$account = $ServiceCredential.UserName
$password = $ServiceCredential.GetNetworkCredential().Password
$startScript = Join-Path $PSScriptRoot 'start-server.ps1'
$startArguments = '-NoProfile -ExecutionPolicy RemoteSigned -File "{0}" -NodePath "{1}" -LogToFile' -f $startScript, $node
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $startArguments -WorkingDirectory $root
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtStartup) `
    -User $account -Password $password -RunLevel Limited -Settings $settings | Out-Null
$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
$backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy RemoteSigned -File `"$backupScript`"" -WorkingDirectory $root
$backupSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $backupName -Action $backupAction -Trigger (New-ScheduledTaskTrigger -Daily -At '02:00') `
    -User $account -Password $password -RunLevel Limited -Settings $backupSettings | Out-Null
Write-Host 'Startup and daily backup tasks registered. Start the workspace task after reviewing its settings.'
