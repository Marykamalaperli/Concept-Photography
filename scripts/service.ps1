param([ValidateSet('Start','Stop','Restart','Status')][string]$Action = 'Status')
$ErrorActionPreference = 'Stop'
$name = 'Concept Photography Workspace'
if ($Action -in @('Stop','Restart')) {
    Stop-ScheduledTask -TaskName $name
    $deadline = (Get-Date).AddSeconds(30)
    do {
        Start-Sleep -Milliseconds 250
        $running = (Get-ScheduledTask -TaskName $name).State -eq 'Running'
    } while ($running -and (Get-Date) -lt $deadline)
    if ($running) { throw 'The workspace is still running.' }
}
if ($Action -in @('Start','Restart')) { Start-ScheduledTask -TaskName $name }
Get-ScheduledTask -TaskName $name | Select-Object TaskName, State
