# Registers the WebWatchAgent task: starts the PC agent hidden when you log on and restarts it
# if it stops. ego lite needs your desktop session, so it runs only while you are logged on.
# Also removes the tasks from the old GitHub-issue setup.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\register-task.ps1
# Remove: Unregister-ScheduledTask -TaskName WebWatchAgent -Confirm:$false
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$vbs = Join-Path $root "scripts\hidden.vbs"
$ps1 = Join-Path $root "scripts\start-agent.ps1"

foreach ($old in "WebWatchAgent-flights", "WebWatchAgent-requests") {
  if (Get-ScheduledTask -TaskName $old -ErrorAction SilentlyContinue) { Unregister-ScheduledTask -TaskName $old -Confirm:$false; Write-Host "Removed $old" }
}

$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "`"$vbs`" `"$ps1`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries -AllowStartIfOnBatteries `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName "WebWatchAgent" -Action $action -Trigger $trigger -Settings $settings `
  -Description "web-watch-agent: PC agent (Supabase requests + scheduled checks)" -Force | Out-Null
Write-Host "Registered WebWatchAgent (at logon). Start now: Start-ScheduledTask -TaskName WebWatchAgent"
