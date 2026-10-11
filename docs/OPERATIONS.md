# Operations

## CLI

Run from the repo root (`C:\ecom\app`): `pnpm --filter @ecom/worker cli <command>`

| Command | What it does |
|---|---|
| `create-user <name> [--name "Display"]` | Create a user (max two). Prompts for the password. |
| `set-password <name>` / `reset-2fa <name>` / `unlock <name>` | Account recovery, from the server only |
| `phase0-check` | Fetch one real order per store and one day of ad spend from `.env` credentials |
| `import-env` | Create regions, stores and encrypted connections from `.env` |
| `fx [hist]` | Load ECB rates (hist = full history) |
| `shopify-history [storeId]` / `meta-history [adAccountId]` | (Re)load history (never deletes data; upserts) |
| `sync <orders\|products\|sessions\|fees\|reconcile\|meta-today\|meta-structure\|meta-trailing\|renewals\|domains>` | Run one job now |
| `rebuild-all` | Recompute every derived metric (after a formula change) |
| `backup` | Write an encrypted backup now |
| `restore <file.enc> [--target-db URL]` | Decrypt and restore a backup |

## Scheduled jobs (worker)

| Job | Schedule |
|---|---|
| Shopify orders | every 10 min (orders updated since the cursor) |
| Shopify products & unit costs, sessions & funnel, Payments fees | hourly |
| Shopify reconciliation vs ShopifyQL sales report (flags > 0.5%) | nightly 03:30 Sofia |
| Meta insights today | every 30 min |
| Meta insights last 28 days | nightly 04:00 Sofia |
| Meta ads, creatives, media | every 6 h |
| ECB rates | daily 17:30 CET |
| Renewals and notices | daily 08:00 Sofia |
| Domain expiry (RDAP) | weekly |
| Metric rebuild | every minute + after each sync, only dirty store-days |
| Sync monitor (alert if > 1 h behind) | every 15 min |
| Backup | 02:30 via Task Scheduler |

Every job is idempotent (upserts keyed on store + platform id, cursors), retries with backoff, and is logged in
`sync_runs` (Settings → Sync). A failure raises a dashboard notice; the "last synced" stamp turns amber after an hour.

## Restore a backup

```powershell
cd C:\ecom\app
# 1. into a scratch database to check it
createdb -U postgres ecom_restore
pnpm --filter @ecom/worker cli restore C:\path\to\ecom-2026-10-11T02-30-00.dump.gz.enc --target-db postgres://postgres:…@localhost:5432/ecom_restore
# 2. to replace production: stop services, restore into ecom, start services
Stop-Service ecom-web, ecom-worker
pnpm --filter @ecom/worker cli restore <file> --target-db postgres://ecom:…@localhost:5432/ecom
Start-Service ecom-worker, ecom-web
```
Test a restore monthly (step 1 only).

## Update

```powershell
powershell -ExecutionPolicy Bypass -File .\infra\windows\update.ps1
```
Pulls, installs, migrates, builds and restarts the services.

## API versions

Shopify Admin `2026-10` and Meta Graph `v26.0` live in `packages/core/src/config.ts` only. Shopify supports a
version for at least 12 months: add a 6-monthly "upgrade APIs" item under Expenses (one-off, 0 cost) as a reminder.
