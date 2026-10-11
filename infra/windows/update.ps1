# One-step update: pull, install, migrate, build, restart services. Run elevated from the repo root.
param([string]$Branch = "main")
$ErrorActionPreference = "Stop"
$App = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $App
git fetch origin $Branch
git checkout $Branch
git pull --ff-only origin $Branch
pnpm install --frozen-lockfile
pnpm db:migrate
$env:NODE_OPTIONS = "--max-old-space-size=1536"
pnpm --filter @ecom/web build
Remove-Item Env:\NODE_OPTIONS
$sa = "apps\web\.next\standalone\apps\web"
Copy-Item -Recurse -Force "apps\web\.next\static" "$sa\.next\static"
if (Test-Path "apps\web\public") { Copy-Item -Recurse -Force "apps\web\public" "$sa\public" }
foreach ($s in "ecom-worker", "ecom-web") { Restart-Service $s }
Write-Host "Updated and restarted."
