# Makes Digital Kaizen start with the machine and restart if it stops.
# Run in PowerShell opened with "Run as administrator":
#   powershell -ExecutionPolicy Bypass -File deploy\install-windows-service.ps1
#
# Uses the Task Scheduler that is already part of Windows, so nothing
# extra has to be downloaded. To remove it again:
#   Unregister-ScheduledTask -TaskName "Digital Kaizen" -Confirm:$false

$ErrorActionPreference = 'Stop'
$name = 'Digital Kaizen'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'deploy\run-windows.cmd'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
  ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { Write-Host 'Open PowerShell with "Run as administrator" and run this again.'; exit 1 }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Host 'node was not found. Install Node.js 22 or newer first, then open a NEW PowerShell window.'; exit 1 }

# Node is normally installed for all users, but the task runs as SYSTEM,
# so put its folder on the machine-wide PATH if it is not there already.
$nodeDir = Split-Path -Parent $node
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if (($machinePath -split ';') -notcontains $nodeDir) {
  [Environment]::SetEnvironmentVariable('Path', "$machinePath;$nodeDir", 'Machine')
}

$action   = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$runner`"" -WorkingDirectory $root
$trigger  = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $name
Start-Sleep -Seconds 4

# Let other computers on the factory network open the dashboard.
$port = 4310
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $m = Select-String -Path $envFile -Pattern '^\s*DK_WEB_PORT\s*=\s*(\d+)' | Select-Object -First 1
  if ($m) { $port = [int]$m.Matches[0].Groups[1].Value }
}
if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null
}

$state = (Get-ScheduledTask -TaskName $name).State
Write-Host "Task '$name' is $state. Dashboard port $port is open in the firewall."
Write-Host "Log file: $(Join-Path $root 'data\digital-kaizen.log')"
