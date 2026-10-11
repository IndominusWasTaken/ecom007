<#
  Installs the dashboard as Windows services. Idempotent: re-running updates in place.
  Prerequisites (install yourself first; versions are the ones the repo is tested with):
    - Node.js 22 LTS (x64)            https://nodejs.org
    - pnpm via corepack                 corepack enable; corepack prepare pnpm@10.28.0 --activate
    - Git for Windows
    - PostgreSQL for Windows (17 or 18) installed as a service, listening on localhost only
    - Caddy for Windows (caddy.exe)    https://caddyserver.com/download
    - WinSW v2 (WinSW-x64.exe)          https://github.com/winsw/winsw/releases  (service wrapper)
  Usage (elevated PowerShell, from the repo root C:\ecom\app):
    powershell -ExecutionPolicy Bypass -File .\infra\windows\install.ps1 -Domain dash.example.com -Email you@example.com
  It STOPS (and changes nothing) if ports 80/443/3000 are taken by something else.
#>
param(
  [Parameter(Mandatory = $true)][string]$Domain,
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Root = "C:\ecom",
  [string]$WinSW = "C:\ecom\bin\WinSW-x64.exe",
  [string]$Caddy = "C:\ecom\bin\caddy.exe",
  [int]$WebPort = 3000,
  [switch]$SkipBuild
)
$ErrorActionPreference = "Stop"
$App = Join-Path $Root "app"
function Step($t) { Write-Host "`n>> $t" -ForegroundColor Cyan }

Step "Checking prerequisites"
foreach ($c in "node", "pnpm", "git", "pg_dump") { if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { throw "$c is not on PATH. Install it first." } }
foreach ($f in $WinSW, $Caddy) { if (-not (Test-Path $f)) { throw "Missing $f" } }
if (-not (Test-Path (Join-Path $App ".env"))) { throw "Create $App\.env from .env.example first (fill the values on the server only)." }

Step "Checking ports (nothing existing is stopped or changed)"
$ours = "caddy", "node"
foreach ($p in 80, 443, $WebPort) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) {
    $name = (Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue).Name
    if ($ours -notcontains $name) { throw "Port $p is used by '$name' (PID $($c.OwningProcess)). Stopping so nothing existing is disturbed - decide how to resolve it first." }
  }
}
$pg = Get-NetTCPConnection -State Listen -LocalPort 5432 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pg -and $pg.LocalAddress -notin "127.0.0.1", "::1") { Write-Warning "PostgreSQL listens on $($pg.LocalAddress). Set listen_addresses='localhost' (see postgresql.tuning.conf)." }

Step "Folders"
foreach ($d in "logs", "media", "backups", "bin", "services") { New-Item -ItemType Directory -Force -Path (Join-Path $Root $d) | Out-Null }
# .env readable by Administrators and SYSTEM only
icacls (Join-Path $App ".env") /inheritance:r /grant:r "Administrators:F" "SYSTEM:F" | Out-Null

if (-not $SkipBuild) {
  Step "Install dependencies, migrate, build"
  Push-Location $App
  pnpm install --frozen-lockfile
  pnpm db:migrate
  $env:NODE_OPTIONS = "--max-old-space-size=1536"
  pnpm --filter @ecom/web build
  Remove-Item Env:\NODE_OPTIONS
  # standalone server needs static assets next to it
  $sa = Join-Path $App "apps\web\.next\standalone\apps\web"
  Copy-Item -Recurse -Force (Join-Path $App "apps\web\.next\static") (Join-Path $sa ".next\static")
  if (Test-Path (Join-Path $App "apps\web\public")) { Copy-Item -Recurse -Force (Join-Path $App "apps\web\public") (Join-Path $sa "public") }
  Pop-Location
}

function Install-Svc($id, $name, $exe, $arguments, $workdir, $envs) {
  $dir = Join-Path $Root "services\$id"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Copy-Item -Force $WinSW (Join-Path $dir "$id.exe")
  $envXml = ($envs.GetEnumerator() | ForEach-Object { "  <env name=`"$($_.Key)`" value=`"$($_.Value)`"/>" }) -join "`n"
  @"
<service>
  <id>$id</id>
  <name>$name</name>
  <description>$name (profit dashboard)</description>
  <executable>$exe</executable>
  <arguments>$arguments</arguments>
  <workingdirectory>$workdir</workingdirectory>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>5</keepFiles></log>
  <logpath>$Root\logs</logpath>
$envXml
</service>
"@ | Set-Content -Encoding UTF8 (Join-Path $dir "$id.xml")
  $svc = Get-Service -Name $id -ErrorAction SilentlyContinue
  if ($svc) { & (Join-Path $dir "$id.exe") stop | Out-Null; & (Join-Path $dir "$id.exe") refresh | Out-Null }
  else { & (Join-Path $dir "$id.exe") install | Out-Null }
  & (Join-Path $dir "$id.exe") start | Out-Null
  Write-Host "  $id running"
}

Step "Services"
$node = (Get-Command node).Source
$common = @{ NODE_ENV = "production"; DOTENV_PATH = "$App\.env"; MEDIA_DIR = "$Root\media" }
Install-Svc "ecom-worker" "Ecom Worker" $node "--max-old-space-size=384 --import tsx src/main.ts" "$App\apps\worker" $common
Install-Svc "ecom-web" "Ecom Web" $node "--max-old-space-size=512 server.js" "$App\apps\web\.next\standalone\apps\web" ($common + @{ PORT = "$WebPort"; HOSTNAME = "127.0.0.1" })
Install-Svc "ecom-caddy" "Ecom Caddy" $Caddy "run --config `"$App\infra\Caddyfile`" --adapter caddyfile" "$Root" @{ DASH_DOMAIN = $Domain; ACME_EMAIL = $Email; WEB_PORT = "$WebPort" }

Step "Firewall: only 80 and 443 open to everyone"
foreach ($p in 80, 443) {
  if (-not (Get-NetFirewallRule -DisplayName "Ecom HTTP $p" -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName "Ecom HTTP $p" -Direction Inbound -Protocol TCP -LocalPort $p -Action Allow | Out-Null
  }
}
Write-Host "  (Existing rules were not modified. Make sure no rule exposes 5432 or $WebPort publicly.)"

Step "Nightly encrypted backup (Task Scheduler, 02:30)"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$App\infra\windows\backup.ps1`"" -WorkingDirectory $App
$trigger = New-ScheduledTaskTrigger -Daily -At 2:30am
Register-ScheduledTask -TaskName "Ecom nightly backup" -Action $action -Trigger $trigger -User "SYSTEM" -RunLevel Highest -Force | Out-Null

Step "Done"
Write-Host "Create the two users:  pnpm user:create <name>   (run twice, once per person)"
Write-Host "Open https://$Domain  - first login asks each user to enrol their authenticator app."
