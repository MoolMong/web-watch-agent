' Runs a PowerShell script with no visible window (used by the scheduled tasks).
' Usage: wscript.exe hidden.vbs <script.ps1> [args...]
Set sh = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " " & WScript.Arguments(i)
Next
WScript.Quit sh.Run(cmd, 0, True)
