/**
 * Platform API versions live here and nowhere else.
 * Shopify supports each version for at least 12 months; Meta for ~2 years.
 * An "upgrade APIs" reminder is seeded into the renewal calendar every 6 months.
 */
export const API_VERSIONS = {
  shopifyAdmin: "2026-10",
  metaGraph: "v26.0",
} as const;

/** How far back the first history load reaches, in months. */
export const HISTORY_MONTHS = Number(process.env.HISTORY_MONTHS ?? 24);

/** Display currencies. Every money amount is stored natively and in both of these. */
export const DISPLAY_CURRENCIES = ["USD", "EUR"] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

/** A source is "stale" (amber stamp) when it is this many minutes behind. */
export const STALE_AFTER_MINUTES = 60;

/** Reconciliation tolerance against Shopify's own sales report. */
export const RECONCILE_TOLERANCE = 0.005;

/** Meta: re-pull this many trailing days nightly, conversions keep arriving. */
export const META_TRAILING_DAYS = 28;

/** Time zone for business jobs such as renewal reminders. */
export const BUSINESS_TZ = "Europe/Sofia";
