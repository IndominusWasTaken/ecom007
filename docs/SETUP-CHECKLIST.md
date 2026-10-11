# Setup checklist (things only you can do)

Put every value straight into `C:\ecom\app\.env` **on the server**. Never paste a secret into a chat, an email or git.

## Shopify — once per Shopify organization

1. Open the **Dev Dashboard** (dev.shopify.com) → Apps → *Create app*. Give it a name such as "Profit Dashboard".
2. Create a version with these **read-only** Admin API scopes:
   `read_orders`, `read_all_orders`, `read_products`, `read_inventory`, `read_customers`, `read_reports`,
   `read_shopify_payments`, `read_shopify_payments_accounts`.
   > ⚠️ The plan listed `read_shopify_payments_payouts`. Checking the 2026-10 Admin schema, the Shopify Payments
   > balance transactions (the actual fee per order) require `read_shopify_payments` / `read_shopify_payments_accounts`.
   > Request those; without them the dashboard falls back to the % + fixed fee rules you enter under Costs.
3. Install the app on each store. The app and the store must be in the **same organization** (client credentials grant).
   If the US and Bulgarian stores are in different organizations, create one app in each.
4. In the app's API access requests, ask for **Read all orders** (otherwise only 60 days of history) and **protected
   customer data access** (level 2 for sessions/conversion rate via ShopifyQL).
5. Copy each store's **Client ID** and **Client secret** into `.env`:
   `SHOPIFY_US_DOMAIN`, `SHOPIFY_US_CLIENT_ID`, `SHOPIFY_US_CLIENT_SECRET` (and the `BG` block).

## Meta

6. developers.facebook.com → create a **Business** app → add the **Marketing API** product.
7. Business settings → System users → create one, assign it the app and **both ad accounts** (view performance is enough).
8. Generate a token with `ads_read` → `.env` `META_SYSTEM_USER_TOKEN`.
9. Note each ad account's ID, currency and time zone (Settings will show them and flag a time zone that differs from its store).
10. Add the URL parameter template to every ad so Shopify records which ad drove each order (enables version 2, ad-level profit):
    `utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.id}}&utm_content={{ad.id}}&utm_term={{adset.id}}`

## Server and data

11. Point a subdomain (e.g. `dash.yourdomain.com`) at the VPS IP (DNS A record).
12. Change the VPS administrator password before the site goes public; type it only on the server.
13. Generate `APP_ENCRYPTION_KEY` and `BACKUP_ENCRYPTION_KEY` (command in `.env.example`) and store a copy **off the server**.
14. Pick backup storage off the VPS (a mapped network drive, or a folder synced by rclone to Backblaze/S3/Google Drive) → `BACKUP_DIR`.
15. Export your COGS as CSV: `store, sku, cost, currency, effective_from` (import under Costs → COGS).
16. List every subscription and domain with amount, billing cycle and next renewal (enter under Expenses).
