<#
  Phase 0: READ-ONLY inspection of the VPS. Changes nothing.
  Run in an elevated PowerShell on the server:
    powershell -ExecutionPolicy Bypass -File .\infra\windows\inspect-server.ps1 > inspect-report.txt
  Then share inspect-report.txt (it contains no passwords).
#>
$ErrorActionPreference = "Continue"
function Section($t) { "`n==== $t ====" }

Section "Machine"
$os = Get-CimInstance Win32_OperatingSystem
$cs = Get-CimInstance Win32_ComputerSystem
"{0} {1} (build {2})" -f $os.Caption, $os.Version, $os.BuildNumber
"CPU cores: {0} logical: {1}" -f (Get-CimInstance Win32_Processor | Measure-Object NumberOfCores -Sum).Sum, $cs.NumberOfLogicalProcessors
"Memory total: {0:N1} GB  free: {1:N1} GB  used: {2:P0}" -f ($os.TotalVisibleMemorySize/1MB), ($os.FreePhysicalMemory/1MB), (1 - $os.FreePhysicalMemory/$os.TotalVisibleMemorySize)

Section "Disks"
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { "{0} total {1:N1} GB free {2:N1} GB" -f $_.DeviceID, ($_.Size/1GB), ($_.FreeSpace/1GB) }

Section "Top processes by memory"
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 20 Name, Id, @{n="MemMB";e={[int]($_.WorkingSet64/1MB)}}, @{n="CPUsec";e={[int]$_.CPU}} | Format-Table -AutoSize | Out-String

Section "Running services (non-Microsoft)"
Get-CimInstance Win32_Service | Where-Object { $_.State -eq "Running" -and $_.PathName -notmatch "\\Windows\\" } | Select-Object Name, DisplayName, StartMode, PathName | Format-Table -AutoSize -Wrap | Out-String

Section "Listening ports 80, 443, 3000, 5432 (and all listeners)"
foreach ($p in 80,443,3000,5432) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  if ($c) { $c | ForEach-Object { "port {0} on {1} -> PID {2} ({3})" -f $_.LocalPort, $_.LocalAddress, $_.OwningProcess, (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name } }
  else { "port $p free" }
}
""
Get-NetTCPConnection -State Listen | Sort-Object LocalPort -Unique | ForEach-Object { "{0,6} {1,-16} {2}" -f $_.LocalPort, $_.LocalAddress, (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).Name }

Section "Virtualisation (WSL 2 / Hyper-V)"
try { "Hyper-V feature: " + (Get-WindowsFeature -Name Hyper-V).InstallState } catch { "Get-WindowsFeature unavailable" }
"VirtualizationFirmwareEnabled: " + (Get-CimInstance Win32_Processor | Select-Object -First 1).VirtualizationFirmwareEnabled
"HypervisorPresent: " + $cs.HypervisorPresent
try { wsl.exe --status 2>&1 | Out-String } catch { "wsl not installed" }

Section "Installed tools"
foreach ($cmd in "node","npm","pnpm","git","psql","pg_dump","caddy","docker") {
  $p = Get-Command $cmd -ErrorAction SilentlyContinue
  if ($p) { $v = & $cmd --version 2>&1 | Select-Object -First 1; "{0,-8} {1}  ({2})" -f $cmd, $v, $p.Source } else { "{0,-8} not found" -f $cmd }
}
Get-ChildItem "C:\Program Files\PostgreSQL" -ErrorAction SilentlyContinue | ForEach-Object { "PostgreSQL install dir: $($_.FullName)" }

Section "Firewall inbound allow rules (enabled)"
Get-NetFirewallRule -Direction Inbound -Action Allow -Enabled True | Get-NetFirewallPortFilter | Where-Object { $_.LocalPort -ne "Any" } | Select-Object -Unique Protocol, LocalPort | Format-Table -AutoSize | Out-String

Section "Scheduled tasks (non-Microsoft)"
Get-ScheduledTask | Where-Object { $_.TaskPath -notlike "\Microsoft\*" } | Select-Object TaskName, State | Format-Table -AutoSize | Out-String

Section "Done"
"Inspection finished at $(Get-Date -Format o). Nothing was changed."
