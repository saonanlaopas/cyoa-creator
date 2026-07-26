param([int]$Port = 3000)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:$Port"

$node = Get-Command node -ErrorAction SilentlyContinue
$pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js 20+ is required. Install it, then run this launcher again." }
if (-not $pnpm) { throw "pnpm is required. Run: corepack enable" }

Push-Location $projectRoot
try {
  if (-not (Test-Path "node_modules")) { & $pnpm.Source install --frozen-lockfile; if ($LASTEXITCODE) { throw "Dependency installation failed." } }
  if (-not (Test-Path "apps/server/dist/main.js")) { & $pnpm.Source build; if ($LASTEXITCODE) { throw "Build failed." } }
  $tweego = Join-Path $projectRoot "tools/tweego/tweego.exe"
  if (-not (Test-Path $tweego)) { Write-Warning "Tweego was not found at $tweego. Twee export will be unavailable." }

  $start = [System.Diagnostics.ProcessStartInfo]::new($node.Source, "apps/server/dist/main.js")
  $start.WorkingDirectory = $projectRoot; $start.UseShellExecute = $false; $start.CreateNoWindow = $true
  $start.Environment["HOST"] = "127.0.0.1"; $start.Environment["PORT"] = "$Port"
  $process = [System.Diagnostics.Process]::Start($start)
  $deadline = (Get-Date).AddSeconds(20)
  do { try { $health = Invoke-RestMethod "$url/api/health" -TimeoutSec 2 } catch { Start-Sleep -Milliseconds 400 } } until ($health.ok -or (Get-Date) -gt $deadline)
  if (-not $health.ok) { $process.Dispose(); throw "The local service did not become healthy at $url." }
  Start-Process $url
  [pscustomobject]@{ ProcessId = $process.Id; Url = $url }
} finally { Pop-Location }
