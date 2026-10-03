# Installs (or updates) the HR biometric office connector as a Windows startup task.
# Run in an elevated PowerShell on a computer that is on the same network as the biometric devices.
# The HR app shows the exact command, including the connector token, under Attendance > Biometric device.
param(
  [string]$ServerUrl,
  [string]$Token,
  [string]$InstallPath = (Join-Path $env:ProgramData 'HRBiometricConnector'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$taskName = 'HR Biometric Connector'

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run PowerShell as Administrator, then run this command again.' }

if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
if ($Uninstall) {
  if (Test-Path $InstallPath) { Remove-Item -Recurse -Force $InstallPath }
  Write-Host 'HR biometric connector removed. Imported attendance in the HR app is not affected.'
  return
}

$ServerUrl = ($ServerUrl + '').Trim().TrimEnd('/')
$Token = ($Token + '').Trim()
if (-not $ServerUrl -or -not $Token) { throw 'Both -ServerUrl and -Token are required. Copy the full command from the HR app.' }
$serverUri = [Uri]$ServerUrl
if ($serverUri.Scheme -ne 'https' -and @('localhost', '127.0.0.1') -notcontains $serverUri.Host) { throw 'ServerUrl must start with https://' }
if (-not $Token.StartsWith('hrag_')) { throw 'The token is not a connector token. Copy the full command from the HR app.' }

$node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $node) { throw 'Node.js is not installed. Install the LTS version from https://nodejs.org, then run this command again.' }
$nodeMajor = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { throw ('Node.js 20 or newer is required; found ' + (& $node.Source --version) + '. Install the LTS version from https://nodejs.org.') }

New-Item -ItemType Directory -Force -Path $InstallPath | Out-Null
foreach ($file in @('agent.mjs', 'zkteco-read.mjs', 'package.json')) {
  $local = if ($PSScriptRoot) { Join-Path $PSScriptRoot $file } else { $null }
  if ($local -and (Test-Path $local) -and ((Resolve-Path $PSScriptRoot).Path -ne (Resolve-Path $InstallPath).Path)) { Copy-Item -Force $local (Join-Path $InstallPath $file) }
  else { Invoke-WebRequest -UseBasicParsing -Uri ($ServerUrl + '/biometric-agent/' + $file) -OutFile (Join-Path $InstallPath $file) }
}

$npm = Join-Path (Split-Path $node.Source) 'npm.cmd'
Push-Location $InstallPath
try {
  & $npm install --omit=dev --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed; check the internet connection and try again.' }
} finally { Pop-Location }

# UTF-8 without BOM: Node's JSON.parse rejects a BOM.
$configPath = Join-Path $InstallPath 'agent.config.json'
$config = @{ serverUrl = $ServerUrl; token = $Token } | ConvertTo-Json
[IO.File]::WriteAllText($configPath, $config, (New-Object Text.UTF8Encoding($false)))
# The token file is readable only by SYSTEM and Administrators (SIDs, so this works on any Windows language).
& icacls.exe $configPath /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' | Out-Null

$action = New-ScheduledTaskAction -Execute $node.Source -Argument ('"' + (Join-Path $InstallPath 'agent.mjs') + '"') -WorkingDirectory $InstallPath
$trigger = New-ScheduledTaskTrigger -AtStartup
$taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $taskPrincipal -Settings $settings -Description 'Reads the biometric devices on this network and sends attendance to the HR app. Starts with Windows; no sign-in needed.' | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host ''
Write-Host ('HR biometric connector installed in ' + $InstallPath)
Write-Host 'It starts automatically with Windows. Keep this computer on and connected to the device network.'
Start-Sleep -Seconds 8
$log = Get-ChildItem (Join-Path $InstallPath 'logs') -Filter 'agent-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($log) { Write-Host ''; Write-Host 'Latest connector log:'; Get-Content $log.FullName -Tail 5 }
