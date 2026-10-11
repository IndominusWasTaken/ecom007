# Profit Dashboard

A private, self-hosted profit dashboard for a two-person e-commerce team. It pulls every
Shopify store and Meta ad account into one PostgreSQL database and reports sales, costs,
ad spend and net profit **by region and by store**. It is built to replace Triple Whale where
running several stores at once (a US store in USD, a Bulgarian store in EUR, more later)
needs clean separation and a correct combined view.

- **Scope switcher** on every page: All, a region (US, Bulgaria…), or any single store. Kept in the URL.
- **USD / EUR toggle.** Every amount is stored natively and converted at that day's ECB rate. Different currencies are never added.
- **All = sum of the stores** for every additive metric, tested against the database.
- **One metric registry** (`packages/metrics`) drives tiles, charts and exports. See [docs/METRICS.md](docs/METRICS.md).
- **Costs:** dated COGS per SKU (grid + CSV, Shopify prefill, % fallback), shipping (flat / table / imported actuals), handling, payment fees (actual Shopify Payments fee from the API).
- **Expenses:** subscriptions with a renewal calendar, reminders, iCal feed, shared costs split across stores; cash basis.
- **Meta ads:** Ads Manager-style table, creative library with media copied locally, tags and saved tabs; ad accounts and campaigns mapped to stores, with a visible Unassigned bucket.
- **Security:** two accounts created from the CLI, Argon2id + required TOTP, lockout, HTTPS via Caddy, encrypted credentials and backups, read-only API scopes.

## Repository layout

```
apps/web              Next.js pages and API routes
apps/worker           sync jobs (pg-boss), metric rebuild, CLI
packages/db           Drizzle schema, migrations, analytics queries
packages/connectors   shopify, meta, fx (ECB), domains (RDAP), google + tiktok stubs
packages/metrics      metric registry and formulas (pure, unit-tested)
packages/core         money, FX table, dates, crypto, TOTP, recurrence, CSV
infra                 Caddyfile, Windows install/update/backup scripts, Postgres tuning
docs                  PLAN.md, METRICS.md, DEPLOY.md, OPERATIONS.md, SETUP-CHECKLIST.md
```

## Quick start (development)

Requires Node 22+, pnpm 10 and PostgreSQL.

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL, APP_ENCRYPTION_KEY, BACKUP_ENCRYPTION_KEY
pnpm db:migrate
pnpm db:seed-demo               # optional: synthetic demo stores (never on production)
pnpm dev                        # web on :3000 + worker
pnpm test                       # unit tests; set TEST_DATABASE_URL to also run the DB identity test
```

The demo seed prints a login (`demo` / `demo-password-123`) and a TOTP secret to add to an authenticator app.

## Going live

1. Work through [docs/SETUP-CHECKLIST.md](docs/SETUP-CHECKLIST.md) (Shopify apps, Meta System User, subdomain).
2. Run the read-only server inspection: `infra/windows/inspect-server.ps1` (phase 0).
3. `pnpm phase0` — fetches one real order per store and one day of ad spend using the `.env` values.
4. Install: [docs/DEPLOY.md](docs/DEPLOY.md). Day-to-day: [docs/OPERATIONS.md](docs/OPERATIONS.md).
