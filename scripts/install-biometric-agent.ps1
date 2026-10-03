$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$launcher = Join-Path $PSScriptRoot 'start-biometric-agent.ps1'
$taskName = 'HR - ZKTeco MB2000'
# Remove the task registered under the previous product name so the agent is not scheduled twice.
$legacyTaskName = 'Sanad HR - ZKTeco MB2000'
if (Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue) { Stop-ScheduledTask -TaskName $legacyTaskName; Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false }
$userIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$powershellPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -WindowStyle Hidden -File "' + $launcher + '"'
$action = New-ScheduledTaskAction -Execute $powershellPath -Argument $arguments -WorkingDirectory $projectPath
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userIdentity
$principal = New-ScheduledTaskPrincipal -UserId $userIdentity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read-only ZKTeco attendance sync for the devices configured in the HR app without an office connector; runs while this Windows user is signed in.' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State
