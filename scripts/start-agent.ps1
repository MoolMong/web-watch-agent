# Starts the PC agent (core/agent.ts). Started hidden at logon by the WebWatchAgent task.
# Keys come from user environment variables; nothing secret is stored in the repo.
param([switch]$Once, [string]$Watcher = "flights")
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
foreach ($name in "OPENROUTER_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY") {
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue)) {
    Set-Item "env:$name" ([Environment]::GetEnvironmentVariable($name, "User"))
  }
  if (-not (Get-Item "env:$name" -ErrorAction SilentlyContinue).Value) { throw "$name is not set (user environment variable)" }
}
Set-Location $root
if ($Once) { node core/agent.ts --once $Watcher } else { node core/agent.ts }
exit $LASTEXITCODE
