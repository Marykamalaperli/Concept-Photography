param([string]$BaseUrl = 'http://127.0.0.1:3000')
$ErrorActionPreference = 'Stop'
$response = Invoke-RestMethod -Uri ($BaseUrl.TrimEnd('/') + '/healthz') -TimeoutSec 15
if ($response.ok -ne $true) { throw 'The workspace did not pass its health check.' }
Write-Host 'Workspace database is reachable.'
