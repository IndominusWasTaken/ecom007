# Metrics

> Generated from `packages/metrics/src/registry.ts` by `pnpm metrics:doc`. Do not edit by hand.

Rules that apply to every metric:

- Sales count on the order date; refunds count on the refund date (store time zone).
- A customer is new or returning **per store**.
- Sum metrics are stored per store per day; rates and ratios are recomputed from summed parts for each scope and range, never averaged.
- Sales tax / VAT is excluded from revenue in every profit metric. Net profit is before income tax.
- The All scope equals the sum of the stores for every sum metric (plus the Unassigned ad-spend bucket, which belongs to no store).

Default pins: `total_sales`, `net_profit`, `blended_roas`, `blended_ad_spend`, `adjusted_cogs`, `handling_fees`, `conversion_rate`

## Store

| ID | Label | Formula | Format | Source | Kind |
|---|---|---|---|---|---|
| `gross_sales` | Gross sales | Unit price × quantity, before discounts, returns, shipping and tax | money | shopify | sum |
| `discounts` | Discounts | Line and order discounts | money | shopify | sum |
| `sales_reversals` | Sales reversals | Value of refunded items, counted on the refund date | money | shopify | sum |
| `net_sales` | Net sales | Gross sales − discounts − sales reversals | money | shopify | derived |
| `shipping_charges` | Shipping charges | Shipping paid by customers, less shipping refunded | money | shopify | derived |
| `return_fees` | Return fees | Fees charged to customers on returns | money | shopify | sum |
| `sale_taxes` | Sale taxes | Tax collected on orders | money | shopify | sum |
| `net_taxes` | Net taxes | Sale taxes − tax refunded | money | shopify | derived |
| `total_sales` | Total sales | Net sales + shipping charges + return fees + net taxes | money | shopify | derived |
| `order_revenue` | Order revenue | Gross sales − discounts + shipping + taxes for orders placed in the period, before refunds | money | shopify | sum |
| `orders` | Orders | Orders placed in the period, test orders excluded | number | shopify | sum |
| `non_zero_orders` | Non-zero orders | Orders with order revenue above zero | number | shopify | sum |
| `units_sold` | Units sold | Sum of line item quantities | number | shopify | sum |
| `aov` | AOV | (Order revenue − shipping − taxes) ÷ orders | money | shopify | derived |
| `true_aov` | True AOV | (Order revenue − shipping − taxes) ÷ non-zero orders | money | shopify | derived |
| `new_customer_orders` | New customer orders | Orders that are the customer's first in that store | number | shopify | sum |
| `returning_customer_orders` | Returning customer orders | Orders from customers who ordered before in that store | number | shopify | sum |
| `new_customers` | New customers | Distinct customers whose first order in the store falls in the period | number | shopify | sum |
| `returning_customers` | Returning customers | Distinct customers who ordered in the period and had ordered before | number | shopify | sum |
| `new_customers_pct` | New customers % | New customers ÷ all customers who ordered in the period | percent | shopify | derived |
| `returning_customers_pct` | Returning customers % | Returning customers ÷ all customers who ordered in the period (Shopify: returning customer rate) | percent | shopify | derived |
| `new_customer_revenue` | New customer revenue | Order revenue from new customers | money | shopify | sum |
| `returning_customer_revenue` | Returning customer revenue | Order revenue from returning customers | money | shopify | sum |
| `orders_fulfilled` | Orders fulfilled | Orders fulfilled in the period | number | shopify | sum |
| `refund_rate` | Refund rate | Refunded sales ÷ order revenue | percent | shopify | derived |

## Web analytics

| ID | Label | Formula | Format | Source | Kind |
|---|---|---|---|---|---|
| `sessions` | Sessions | Read from Shopify (ShopifyQL sessions) | number | shopify-sessions | sum |
| `added_to_cart` | Added to cart | Sessions with an add to cart, read from Shopify | number | shopify-sessions | sum |
| `reached_checkout` | Reached checkout | Sessions that reached checkout, read from Shopify | number | shopify-sessions | sum |
| `completed_checkout` | Completed checkout | Sessions that completed checkout, read from Shopify | number | shopify-sessions | sum |
| `conversion_rate` | Conversion rate | Sessions that completed checkout ÷ sessions | percent | shopify-sessions | derived |
| `revenue_per_session` | Revenue per session | Total sales ÷ sessions | money | blended | derived |

## Ads

| ID | Label | Formula | Format | Source | Kind |
|---|---|---|---|---|---|
| `ad_spend_meta` | Meta spend | Spend from Meta ad accounts mapped to the scope | money | meta | sum |
| `ad_spend_google` | Google spend | Spend from Google Ads (coming soon) | money | blended | sum |
| `ad_spend_tiktok` | TikTok spend | Spend from TikTok Ads (coming soon) | money | blended | sum |
| `ad_spend_manual` | Manual ad spend | Expenses flagged “counts as ad spend” | money | expenses | sum |
| `blended_ad_spend` | Blended ad spend | Spend from all ad platforms + manual ad spend | money | blended | derived |
| `blended_roas` | Blended ROAS | Order revenue ÷ blended ad spend | ratio | blended | derived |
| `mer` | MER | Blended ad spend ÷ order revenue | percent | blended | derived |
| `ncpa` | NCPA | Blended ad spend ÷ new customer orders | money | blended | derived |
| `nc_roas` | NC-ROAS | New customer revenue ÷ blended ad spend | ratio | blended | derived |
| `meta_purchases` | Purchases (Meta) | Purchases attributed by Meta | number | meta | sum |
| `meta_purchase_value` | Purchase value (Meta) | Purchase value attributed by Meta | money | meta | sum |
| `meta_roas` | ROAS (Meta-reported) *(Meta-reported)* | Purchase value ÷ spend | ratio | meta | derived |
| `meta_cpa` | CPA (Meta-reported) *(Meta-reported)* | Spend ÷ purchases | money | meta | derived |
| `impressions` | Impressions | Ad impressions | number | meta | sum |
| `link_clicks` | Link clicks | Clicks on ad links | number | meta | sum |
| `cpm` | CPM | Spend ÷ impressions × 1,000 | money | meta | derived |
| `ctr` | CTR | Link clicks ÷ impressions | percent | meta | derived |
| `cpc` | CPC | Spend ÷ link clicks | money | meta | derived |

## Costs

| ID | Label | Formula | Format | Source | Kind |
|---|---|---|---|---|---|
| `cogs` | COGS | Units sold × the unit cost in force on the order date | money | costs | sum |
| `adjusted_cogs` | Adjusted COGS | COGS − cost of refunded units that were restocked | money | costs | derived |
| `shipping_cost` | Shipping cost | What you pay carriers: flat, table, or imported actuals per order | money | costs | sum |
| `handling_fees` | Handling fees | Per-order plus per-item packing cost | money | costs | sum |
| `payment_fees` | Payment fees | Actual Shopify Payments fee; other gateways % + fixed fee | money | costs | sum |
| `cogs_missing_revenue` | Revenue without COGS | Revenue on lines whose SKU has no unit cost | money | costs | sum |
| `cogs_missing_units` | Units without COGS | Units sold whose SKU has no unit cost | number | costs | sum |

## Expenses

| ID | Label | Formula | Format | Source | Kind |
|---|---|---|---|---|---|
| `operating_expenses` | Operating expenses | Recurring and one-off expenses allocated to the scope, full amount on the charge date | money | expenses | sum |

## Profit

| ID | Label | Formula | Format | Source | Kind |
|---|---|---|---|---|---|
| `net_revenue` | Net revenue | Total sales − net taxes | money | shopify | derived |
| `gross_profit` | Gross profit | Net revenue − adjusted COGS | money | blended | derived |
| `contribution_margin` | Contribution margin | Gross profit − shipping cost − handling fees − payment fees | money | blended | derived |
| `net_profit` | Net profit | Contribution margin − blended ad spend − operating expenses | money | blended | derived |
| `net_margin` | Net margin | Net profit ÷ net revenue | percent | blended | derived |
| `profit_tax` | Profit tax | Net profit × profit tax rate (only when net profit is positive; setting, default 0) | money | blended | derived |
| `profit_after_tax` | Profit after tax | Net profit − profit tax (shown only when a profit tax rate is set) | money | blended | derived |
| `break_even_roas` | Break-even ROAS | Order revenue ÷ contribution margin | ratio | blended | derived |

## Ad metrics (per account, campaign, ad set, ad and day — Meta-reported)

| ID | Label | Formula | Format |
|---|---|---|---|
| `spend` | Spend | Amount spent | money |
| `impressions` | Impressions | Times ads were on screen | number |
| `reach` | Reach | Accounts reached (summed across days; not deduplicated) | number |
| `frequency` | Frequency | Impressions ÷ reach | ratio |
| `clicks` | Clicks (all) | All clicks | number |
| `link_clicks` | Link clicks | Clicks on ad links | number |
| `landing_page_views` | Landing page views | Landing page views | number |
| `adds_to_cart` | Adds to cart | Adds to cart | number |
| `checkouts_started` | Checkouts started | Checkouts initiated | number |
| `purchases` | Purchases | Purchases (Meta-reported) | number |
| `purchase_value` | Purchase value | Purchase conversion value (Meta-reported) | money |
| `roas` | ROAS | Purchase value ÷ spend | ratio |
| `cpa` | CPA | Spend ÷ purchases | money |
| `cpm` | CPM | Spend ÷ impressions × 1,000 | money |
| `ctr` | CTR | Link clicks ÷ impressions | percent |
| `cpc` | CPC | Spend ÷ link clicks | money |
| `hook_rate` | Hook rate | 3-second plays ÷ impressions | percent |
| `hold_rate` | Hold rate | ThruPlays ÷ 3-second plays | percent |
| `video_3s_plays` | 3-second plays | Video plays of at least 3 seconds | number |
| `thruplays` | ThruPlays | Plays to completion or 15 s | number |
| `video_p25` | Video 25% | Watched to 25% | number |
| `video_p50` | Video 50% | Watched to 50% | number |
| `video_p75` | Video 75% | Watched to 75% | number |
| `video_p100` | Video 100% | Watched to 100% | number |
