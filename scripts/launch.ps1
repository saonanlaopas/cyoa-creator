param(
  [int]$Port = 3000
)

$projectRoot = Split-Path -Parent $PSScriptRoot
$serverEntry = Join-Path $projectRoot "apps\server\dist\main.js"
$nodeExecutable = (Get-Command node -ErrorAction Stop).Source
$url = "http://127.0.0.1:$Port"

if (-not (Test-Path $serverEntry)) {
  throw "Build the app first with 'pnpm build'."
}

$process = Start-Process -FilePath $nodeExecutable -ArgumentList $serverEntry -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -Environment @{ PORT = "$Port"; HOST = "127.0.0.1" }
Start-Process $url

[pscustomobject]@{
  ProcessId = $process.Id
  Url = $url
}
