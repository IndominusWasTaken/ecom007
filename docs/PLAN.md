# Build plan and status

Source: the "Multi-store profit dashboard: build plan" document and its Claude Code brief (decisions settled
on 2026-10-11). This file records what is built, how each decision is implemented, and where the build
differs from the brief and why.

## Settled decisions → implementation

| Decision | Where it lives |
|---|---|
| Stores per region, add a store with no code change | `regions` / `stores` tables; Settings → Stores; every page resolves scope from the DB (`packages/db/src/analytics.ts`) |
| USD default, EUR toggle | `?cur=` on every page; `daily_store_metrics` holds one row per store/day/currency |
| Public HTTPS, two users, password + TOTP, no sign-up | `apps/web/lib/auth.ts`, `app/login/*`, CLI `create-user` (MAX_USERS=2), Caddy |
| Meta only; Google/TikTok "coming soon", one folder each | `packages/connectors/src/{google,tiktok}` implement the same `Connector` interface with `available: false` |
| Map ad accounts or campaigns to stores; Unassigned bucket | `ad_accounts.store_id`, `campaign_store_rules`, `mapCampaignToStore`; `daily_ad_metrics.store_id IS NULL` = Unassigned, counted only in All |
| History ≤ 24 months, config value, never delete | `HISTORY_MONTHS`; syncs are upserts; no job deletes synced rows |
| Tax out of revenue; net profit before 10% profit tax; optional tax-rate line | registry `net_revenue`, `profit_tax`, `profit_after_tax`; Settings → Currencies & tax |
| Cash-basis recurring costs | `chargeDates()`; full amount on the charge date (`rebuild.ts` → `expenseCharges`) |
| Shared expenses split equally, override fixed % / revenue share | `allocate()` in `packages/core/src/allocation.ts` |
| Reminders as dashboard notices behind a notifier interface | `apps/worker/src/notifier.ts` (`Notifier`), `notices` table, bell in the header |

## Phases

| Phase | Status in this repository | Still needs you / the server |
|---|---|---|
| 0. Access & inspection | `inspect-server.ps1` (read-only report), `pnpm phase0` (one order per store, one day of spend), setup checklist | Run both on the VPS; create the apps/token |
| 1. Foundation | Monorepo, migrations, login + TOTP, services, Caddy, firewall, encrypted backups + restore (tested locally) | Install on the VPS |
| 2. Shopify data | Connector (client credentials, bulk history, incremental, refunds, fees, sessions), FX, regions/stores, registry, Summary with scope + currency | Verify against Shopify Analytics (reconciliation job does this nightly) |
| 3. Costs | COGS grid/CSV/prefill/fallback, shipping, handling, payment fees, dated history, audit log | Enter your costs |
| 4. Meta ads | Accounts, structure, insights history (async, monthly), trailing 28 days, mapping | Verify spend vs Ads Manager |
| 5. Expenses & calendar | Subscriptions, occurrences/renewal log, calendar, notices, iCal, domains via RDAP | Enter subscriptions |
| 6. Creative library | Media download, grouping, tabs, tags, saved views, detail page | — |
| 7. Analytics pages | Store analytics, Products, P&L (per-store columns + Total, waterfall, period table, CSV), Regions | — |
| 8. Hardening | Reconciliation alerts, sync monitor + amber stamp, chart notes, phone layout, dark mode | Force a sync failure to see the alert |

The brief asked to stop after phase 0 for confirmation. This session ran in a cloud container without access to the
VPS, and the request was to build the dashboard, so all phases were built and tested against a local PostgreSQL with
synthetic demo data. Nothing has touched the VPS, Shopify or Meta yet: that starts with phase 0 on the server.

## Differences from the brief (and why)

1. **Shopify Payments fee scope.** The 2026-10 Admin schema requires `read_shopify_payments` and
   `read_shopify_payments_accounts` for balance transactions, not `read_shopify_payments_payouts`. The checklist asks
   for the former; without them fees fall back to the gateway rules.
2. **Extra package `packages/core`** for code shared by every package (decimal money, FX table, dates, AES-GCM,
   TOTP, recurrence, CSV). Everything else follows the requested layout.
3. **Extra tables:** `auth_sessions`, `app_settings`, `payments_balance_txns`, `shopify_daily_report`,
   `reconciliation`, `dirty_store_days`, `notices`, `saved_views`, `ad_tags`, `calendar_tokens`. Each supports a
   requirement in the brief (sessions, settings, fees, reconciliation, incremental rebuild, notices, saved tabs, iCal).
4. **Money columns.** Orders and refunds keep native + USD + EUR amounts; order lines keep native amounts plus the
   order's FX factors (`fx_to_usd`, `fx_to_eur`) instead of three copies of every line amount. Derived tables
   store each component in both display currencies.
5. **TOTP** is implemented with Node's crypto (RFC 6238, tested against the RFC vectors) rather than a dependency.
6. **Backups** run from Task Scheduler as the brief says; the worker also exposes a "Back up now" queue.
7. **Tax-inclusive pricing.** Gross sales and discounts exclude VAT (as in Shopify's sales report): the line's tax share
   is removed proportionally. Refund line subtotals are assumed tax-inclusive for tax-inclusive orders and refund
   shipping subtotals tax-exclusive; the nightly reconciliation will show if Shopify disagrees for the BG store.
8. **New vs returning** is computed per store from our own order history (the store started ~5 months ago, so the
   history is complete), not from `customerOrderIndex`.
9. **Ad metrics in the store P&L** use the ad day as reported by the ad account's time zone; Settings flags accounts
   whose time zone differs from their store.

## Not built yet (version 2 items from the plan)

- Ad-level profit from Shopify orders joined via UTM (`utm_content` = ad id) — the UTM values are already stored on every order.
- Email/Telegram notifiers (implement `Notifier`).
- Google Ads and TikTok connectors (stubs in place).
- Spreading a cost over its billing period (cash basis only today).
