# Deploying on the Windows VPS ("hyperion")

Default deployment is **native Windows services** (no Docker): PostgreSQL for Windows, the web app, the worker and
Caddy (HTTPS), plus a Task Scheduler job for the nightly backup. Nothing already on the server is stopped or changed;
the install script stops and reports if a port is taken.

Memory budget (the VPS sits at ~63% of 6 GB): Postgres ≈ 300–500 MB (tuned), web ≤ 512 MB heap, worker ≤ 384 MB heap,
Caddy ≈ 30 MB. The production build needs ~1.5 GB once; if that is too much while other software runs, build on
another machine and copy `apps/web/.next` over, or run the build at a quiet hour.

## 0. Inspect (read-only)

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\windows\inspect-server.ps1 > inspect-report.txt
```
It reports services, memory, disk, what listens on 80/443/3000/5432, WSL 2/Hyper-V, and installed Node/PostgreSQL/Git.
Share the report before continuing if anything conflicts.

## 1. Prerequisites

- Node.js 22 LTS x64, then `corepack enable` and `corepack prepare pnpm@10.28.0 --activate`
- Git for Windows
- PostgreSQL for Windows 17/18 (service). Then in `psql` as postgres:
  ```sql
  create role ecom login password '…typed on the server…';
  create database ecom owner ecom;
  ```
  Append to `postgresql.conf`: `include_if_exists = 'C:/ecom/app/infra/windows/postgresql.tuning.conf'` and restart the
  PostgreSQL service (this keeps it on localhost and sizes it for this machine).
- `C:\ecom\bin\caddy.exe` (Caddy for Windows) and `C:\ecom\bin\WinSW-x64.exe` (WinSW v2 service wrapper)

## 2. Code and configuration

```powershell
git clone https://github.com/IndominusWasTaken/ecom007 C:\ecom\app
cd C:\ecom\app
copy .env.example .env   # then edit .env in Notepad ON THE SERVER
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm phase0              # one real order per store + one day of ad spend
pnpm --filter @ecom/worker cli import-env   # stores Shopify/Meta credentials encrypted in the DB
```

## 3. Install services, HTTPS, firewall, backup task

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\windows\install.ps1 -Domain dash.yourdomain.com -Email you@example.com
```
Creates services `ecom-web`, `ecom-worker`, `ecom-caddy` (auto start, restart on failure, logs in `C:\ecom\logs`),
opens only 80/443 inbound, and registers "Ecom nightly backup" at 02:30.

## 4. Users

```powershell
pnpm user:create alex --name "Alex"
pnpm user:create sam --name "Sam"
```
At first login each user scans a QR code into an authenticator app. There is no sign-up or public reset page.

## 5. Verify (phase 1 "done when")

- Both users log in over HTTPS; a stranger sees only the login page (`/robots.txt` disallows all; every response has `X-Robots-Tag: noindex`).
- `pnpm --filter @ecom/worker cli backup` writes an encrypted file to `BACKUP_DIR`, and a restore works (see OPERATIONS.md).

## Optional second gate

Put the site behind Tailscale or WireGuard so the login page is unreachable without the VPN: bind Caddy to the
tailnet address only and remove the public 80/443 rules.
