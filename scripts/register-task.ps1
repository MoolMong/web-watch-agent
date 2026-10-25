# Registers the Windows scheduled tasks (they run only while you are logged on, because
# ego lite needs your desktop session; windows stay hidden via hidden.vbs):
#   WebWatchAgent-<watcher>  runs scripts\run.ps1 every N hours
#   WebWatchAgent-requests   runs scripts\poll.ps1 every 2 minutes for dashboard "지금 검색" requests
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1 -Watcher flights -Hours 3
# Remove: Unregister-ScheduledTask -TaskName WebWatchAgent-flights -Confirm:$false
#         Unregister-ScheduledTask -TaskName WebWatchAgent-requests -Confirm:$false
param([string]$Watcher = "flights", [int]$Hours = 3)
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs = Join-Path $root "scripts\hidden.vbs"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -MultipleInstances IgnoreNew

function Register($name, $script, $extra, $interval, $desc) {
  $action = New-ScheduledTaskAction -Execute "wscript.exe" `
    -Argument "`"$vbs`" `"$(Join-Path $root $script)`" $extra" -WorkingDirectory $root
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval $interval
  Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description $desc -Force | Out-Null
  Write-Host "Registered $name"
}

Register "WebWatchAgent-$Watcher" "scripts\run.ps1" "-Watcher $Watcher" (New-TimeSpan -Hours $Hours) "web-watch-agent: $Watcher check every $Hours h"
Register "WebWatchAgent-requests" "scripts\poll.ps1" "" (New-TimeSpan -Minutes 2) "web-watch-agent: handle dashboard search requests"
