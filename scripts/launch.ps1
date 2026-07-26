param([int]$Port = 3000)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port"

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$pnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
$codexDependencies = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies"
$bundledNode = Join-Path $codexDependencies "node\bin\node.exe"
$bundledPnpm = Join-Path $codexDependencies "bin\fallback\pnpm.cmd"
$nodePath = if ($nodeCommand) { $nodeCommand.Source } elseif (Test-Path $bundledNode) { $bundledNode } else { $null }
$pnpmPath = if ($pnpmCommand) { $pnpmCommand.Source } elseif (Test-Path $bundledPnpm) { $bundledPnpm } else { $null }
if (-not $nodePath) { throw "Node.js 20+ is required. Install it, then run this launcher again." }
if (-not $pnpmPath) { throw "pnpm is required. Run: corepack enable" }

Push-Location $projectRoot
try {
  $env:Path = "$(Split-Path -Parent $nodePath);$env:Path"
  if (-not (Test-Path "node_modules")) { & $pnpmPath install --frozen-lockfile; if ($LASTEXITCODE) { throw "Dependency installation failed." } }
  if (-not (Test-Path "apps/server/dist/main.js")) { & $pnpmPath build; if ($LASTEXITCODE) { throw "Build failed." } }
  $tweego = Join-Path $projectRoot "tools/tweego/tweego.exe"
  if (-not (Test-Path $tweego)) { Write-Warning "Tweego was not found at $tweego. Twee export will be unavailable." }

  $start = [System.Diagnostics.ProcessStartInfo]::new($nodePath, "apps/server/dist/main.js")
  $start.WorkingDirectory = $projectRoot; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.Environment["HOST"] = "127.0.0.1"; $start.Environment["PORT"] = "$Port"
  $process = [System.Diagnostics.Process]::Start($start)
  $deadline = (Get-Date).AddSeconds(20)
  do { try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2 } catch { Start-Sleep -Milliseconds 400 } } until ($health.ok -or (Get-Date) -gt $deadline)
  if (-not $health.ok) { $process.Dispose(); throw "The local service did not become healthy at $url." }
  Start-Process $url
  [pscustomobject]@{ ProcessId = $process.Id; Url = $url }
} finally { Pop-Location }
