# Restarts the PC agent: stops the WebWatchAgent task and any agent.ts node process, then starts it again.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\restart-agent.ps1
Stop-ScheduledTask -TaskName WebWatchAgent -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*core*agent.ts*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "stopped agent pid $($_.ProcessId)" }
Start-Sleep -Seconds 1
Start-ScheduledTask -TaskName WebWatchAgent
Write-Host "WebWatchAgent started"
