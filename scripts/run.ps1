# One check for one watcher: pull latest config -> watchers\<name>\scrape.mjs (ego-browser)
# -> watchers\<name>\judge.ts (Jev via OpenRouter) -> commit and push docs\<name>\data so the
# GitHub Pages dashboard updates. Never books or pays.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\run.ps1 -Watcher flights [-NoPush]
param([string]$Watcher = "flights", [switch]$NoPush)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$dir = Join-Path $root "watchers\$Watcher"
if (-not (Test-Path $dir)) { throw "Unknown watcher: $Watcher" }
$log = Join-Path $dir ".tmp\run.log"
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Log($m) { $line = "[$(Get-Date -Format s)] $m"; Write-Host $line; Add-Content -Path $log -Value $line -Encoding UTF8 }

$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
if (-not $env:OPENROUTER_API_KEY) { $env:OPENROUTER_API_KEY = [Environment]::GetEnvironmentVariable("OPENROUTER_API_KEY","User") }
if (-not $env:OPENROUTER_API_KEY) { Log "OPENROUTER_API_KEY is not set"; exit 1 }

Push-Location $root
try {
  if (-not $NoPush) { git pull --rebase --quiet; if ($LASTEXITCODE -ne 0) { Log "git pull failed"; exit 1 } }

  $url = "file:///" + ($root -replace '\\','/') + "/watchers/$Watcher/scrape.mjs"
  ego-browser nodejs -e "await import('$url')"
  if ($LASTEXITCODE -ne 0) { Log "scrape failed"; exit 1 }

  $verdict = node "watchers/$Watcher/judge.ts"
  if ($LASTEXITCODE -ne 0) { Log "judge failed: $verdict"; exit 1 }
  Log ($verdict | Select-Object -Last 1)

  if (-not $NoPush) {
    git add "docs/$Watcher/data"
    git diff --cached --quiet
    if ($LASTEXITCODE -ne 0) {
      git commit --quiet -m "data($Watcher): check $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
      git push --quiet
      if ($LASTEXITCODE -ne 0) { Log "git push failed"; exit 1 }
      Log "pushed"
    }
  }
} finally { Pop-Location }
