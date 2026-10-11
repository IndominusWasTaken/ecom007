# Nightly encrypted backup (called by Task Scheduler). Writes to BACKUP_DIR from .env, keeps 30 days.
$ErrorActionPreference = "Stop"
$App = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $App
$log = "C:\ecom\logs\backup.log"
"$(Get-Date -Format o) starting" | Add-Content $log
pnpm --filter @ecom/worker cli backup *>> $log
if ($LASTEXITCODE -ne 0) { "$(Get-Date -Format o) FAILED" | Add-Content $log; exit 1 }
"$(Get-Date -Format o) ok" | Add-Content $log
