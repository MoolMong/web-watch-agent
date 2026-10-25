# Registers a Windows scheduled task that runs scripts\run.ps1 for one watcher every N hours
# while you are logged on (ego lite needs your desktop session).
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Watcher flights -Hours 3
# Remove: Unregister-ScheduledTask -TaskName WebWatchAgent-flights -Confirm:$false
param([string]$Watcher = "flights", [int]$Hours = 3)
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$run = Join-Path $root "scripts\run.ps1"
$name = "WebWatchAgent-$Watcher"

$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$run`" -Watcher $Watcher" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Hours $Hours)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Description "web-watch-agent: $Watcher check every $Hours h" -Force | Out-Null
Write-Host "Registered $name (every $Hours h)."
