$ErrorActionPreference = 'Stop'
$projectPath = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$agentPath = Join-Path $projectPath 'scripts\zkteco-sync.mjs'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$logDirectory = Join-Path $projectPath 'outputs\biometric-agent'
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null
$mutex = New-Object System.Threading.Mutex($false, 'Local\SanadHRBiometricMB2000')
if (-not $mutex.WaitOne(0, $false)) { exit 0 }
try {
  while ($true) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $process = Start-Process -FilePath $nodePath -ArgumentList @('--experimental-strip-types', ('"' + $agentPath + '"'), '--watch') -WorkingDirectory $projectPath -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDirectory ($stamp + '.out.log')) -RedirectStandardError (Join-Path $logDirectory ($stamp + '.err.log'))
    $process.WaitForExit()
    Start-Sleep -Seconds 15
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
