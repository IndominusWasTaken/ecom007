import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { COUNT_COMPONENTS, MONEY_COMPONENTS } from "@ecom/metrics/components";

/** Money: exact decimals, never floats. */
const money = (name: string) => numeric(name, { precision: 20, scale: 6 });
const fx = (name: string) => numeric(name, { precision: 20, scale: 10 });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();
const updated = () => ts("updated_at").notNull().defaultNow();

// =====================================================================
// Setup
// =====================================================================

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: varchar("username", { length: 64 }).notNull().unique(),
  displayName: varchar("display_name", { length: 128 }),
  passwordHash: text("password_hash").notNull(),
  totpSecretEnc: text("totp_secret_enc"), // AES-GCM encrypted
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  totpLastStep: bigint("totp_last_step", { mode: "number" }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: ts("locked_until"),
  preferences: jsonb("preferences").$type<{ theme?: "light" | "dark" | "system"; currency?: "USD" | "EUR" }>().notNull().default({}),
  createdAt: created(),
  updatedAt: updated(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: text("id").primaryKey(), // sha256 of the cookie token
    userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** "pending" sessions have passed the password but not yet the TOTP code. */
    stage: varchar("stage", { length: 16 }).notNull().default("full"),
    createdAt: created(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const regions = pgTable("regions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  code: varchar("code", { length: 16 }).notNull().unique(), // "us", "bg"
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: created(),
});

export const stores = pgTable("stores", {
  id: serial("id").primaryKey(),
  regionId: integer("region_id").notNull().references(() => regions.id),
  name: varchar("name", { length: 128 }).notNull(),
  shopDomain: varchar("shop_domain", { length: 255 }).notNull().unique(), // xxx.myshopify.com
  currency: varchar("currency", { length: 3 }).notNull(),
  timeZone: varchar("time_zone", { length: 64 }).notNull(),
  pricesIncludeTax: boolean("prices_include_tax").notNull().default(false),
  /** Fallback COGS as % of price for SKUs with no cost (null = off). */
  cogsFallbackPercent: numeric("cogs_fallback_percent", { precision: 6, scale: 3 }),
  color: varchar("color", { length: 16 }),
  active: boolean("active").notNull().default(true),
  /** First date to load; history never older than HISTORY_MONTHS. */
  historyFrom: date("history_from"),
  historyLoadedAt: ts("history_loaded_at"),
  sessionsStatus: varchar("sessions_status", { length: 32 }).notNull().default("unknown"), // ok | not_connected | unknown
  shopifyPlan: varchar("shopify_plan", { length: 64 }),
  createdAt: created(),
  updatedAt: updated(),
});

/** A credential set for a platform. Secrets are AES-256-GCM encrypted. */
export const connections = pgTable("connections", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 32 }).notNull(), // shopify | meta | google | tiktok
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }),
  label: varchar("label", { length: 128 }).notNull(),
  /** Non-secret config such as client id or API version overrides. */
  config: jsonb("config").$type<Record<string, string>>().notNull().default({}),
  secretsEnc: text("secrets_enc"), // encrypted JSON
  status: varchar("status", { length: 32 }).notNull().default("new"), // new | ok | error | disabled
  lastError: text("last_error"),
  lastCheckedAt: ts("last_checked_at"),
  /** Cached short-lived access token (Shopify client credentials, 24 h), encrypted. */
  tokenEnc: text("token_enc"),
  tokenExpiresAt: ts("token_expires_at"),
  createdAt: created(),
  updatedAt: updated(),
});

export const adAccounts = pgTable("ad_accounts", {
  id: serial("id").primaryKey(),
  platform: varchar("platform", { length: 32 }).notNull().default("meta"),
  connectionId: integer("connection_id").references(() => connections.id, { onDelete: "set null" }),
  externalId: varchar("external_id", { length: 64 }).notNull(), // act_123
  name: varchar("name", { length: 255 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  timeZone: varchar("time_zone", { length: 64 }).notNull(),
  accountStatus: integer("account_status"),
  /** Default store for spend. null = Unassigned unless a campaign rule matches. */
  storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
  enabled: boolean("enabled").notNull().default(true),
  historyLoadedAt: ts("history_loaded_at"),
  attributionSetting: varchar("attribution_setting", { length: 64 }),
  raw: jsonb("raw"),
  createdAt: created(),
  updatedAt: updated(),
}, (t) => [uniqueIndex("ad_accounts_platform_ext_uq").on(t.platform, t.externalId)]);

export const campaignStoreRules = pgTable("campaign_store_rules", {
  id: serial("id").primaryKey(),
  adAccountId: integer("ad_account_id").references(() => adAccounts.id, { onDelete: "cascade" }),
  campaignExternalId: varchar("campaign_external_id", { length: 64 }),
  pattern: varchar("pattern", { length: 255 }),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  priority: integer("priority").notNull().default(100),
  createdAt: created(),
});

/** Key/value app settings: profit_tax_rate, default_currency, etc. */
export const appSettings = pgTable("app_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updated(),
});

// =====================================================================
// Shopify
// =====================================================================

export const orders = pgTable(
  "orders",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(), // gid://shopify/Order/…
    name: varchar("name", { length: 64 }).notNull(),
    createdAtUtc: ts("created_at_utc").notNull(),
    updatedAtUtc: ts("updated_at_utc").notNull(),
    cancelledAtUtc: ts("cancelled_at_utc"),
    localDate: date("local_date").notNull(),
    test: boolean("test").notNull().default(false),
    currency: varchar("currency", { length: 3 }).notNull(), // shop currency
    presentmentCurrency: varchar("presentment_currency", { length: 3 }),
    taxesIncluded: boolean("taxes_included").notNull().default(false),
    sourceName: varchar("source_name", { length: 64 }),
    channel: varchar("channel", { length: 128 }),
    customerId: varchar("customer_id", { length: 64 }),
    customerOrderIndex: integer("customer_order_index"),
    /** Computed per store from our own history: is this the customer's first order here? */
    isFirstOrder: boolean("is_first_order").notNull().default(false),
    shippingCountry: varchar("shipping_country", { length: 2 }),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    totalWeightGrams: integer("total_weight_grams").notNull().default(0),
    financialStatus: varchar("financial_status", { length: 32 }),
    fulfillmentStatus: varchar("fulfillment_status", { length: 32 }),
    fulfilledAtUtc: ts("fulfilled_at_utc"),
    fulfilledLocalDate: date("fulfilled_local_date"),
    subtotal: money("subtotal"),
    totalDiscounts: money("total_discounts"),
    shippingAmount: money("shipping_amount").notNull().default("0"),
    shippingTax: money("shipping_tax").notNull().default("0"),
    totalTax: money("total_tax").notNull().default("0"),
    totalPrice: money("total_price").notNull().default("0"),
    /** Order revenue in native, USD and EUR (gross − discounts + shipping + taxes). */
    orderRevenue: money("order_revenue").notNull().default("0"),
    orderRevenueUsd: money("order_revenue_usd").notNull().default("0"),
    orderRevenueEur: money("order_revenue_eur").notNull().default("0"),
    fxToUsd: fx("fx_to_usd").notNull().default("1"),
    fxToEur: fx("fx_to_eur").notNull().default("1"),
    utmSource: varchar("utm_source", { length: 255 }),
    utmMedium: varchar("utm_medium", { length: 255 }),
    utmCampaign: varchar("utm_campaign", { length: 255 }),
    utmContent: varchar("utm_content", { length: 255 }),
    utmTerm: varchar("utm_term", { length: 255 }),
    landingPage: text("landing_page"),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("orders_store_shopify_uq").on(t.storeId, t.shopifyId),
    index("orders_store_date_idx").on(t.storeId, t.localDate),
    index("orders_customer_idx").on(t.storeId, t.customerId, t.createdAtUtc),
    index("orders_fulfilled_idx").on(t.storeId, t.fulfilledLocalDate),
  ],
);

export const orderLines = pgTable(
  "order_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    productShopifyId: varchar("product_shopify_id", { length: 64 }),
    variantShopifyId: varchar("variant_shopify_id", { length: 64 }),
    sku: varchar("sku", { length: 255 }),
    title: text("title").notNull(),
    variantTitle: text("variant_title"),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
    discount: money("discount").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    /** Ex-tax amounts used by the metric engine. */
    grossEx: money("gross_ex").notNull().default("0"),
    discountEx: money("discount_ex").notNull().default("0"),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    weightGrams: integer("weight_grams").notNull().default(0),
    /** Snapshot of the unit cost used (store currency) and where it came from. */
    unitCost: money("unit_cost"),
    costSource: varchar("cost_source", { length: 16 }).notNull().default("missing"),
    raw: jsonb("raw"),
  },
  (t) => [
    uniqueIndex("order_lines_store_shopify_uq").on(t.storeId, t.shopifyId),
    index("order_lines_order_idx").on(t.orderId),
    index("order_lines_variant_idx").on(t.storeId, t.variantShopifyId),
  ],
);

export const refunds = pgTable(
  "refunds",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    createdAtUtc: ts("created_at_utc").notNull(),
    localDate: date("local_date").notNull(),
    totalRefunded: money("total_refunded").notNull().default("0"),
    totalRefundedUsd: money("total_refunded_usd").notNull().default("0"),
    totalRefundedEur: money("total_refunded_eur").notNull().default("0"),
    shippingAmount: money("shipping_amount").notNull().default("0"),
    shippingTax: money("shipping_tax").notNull().default("0"),
    otherAmount: money("other_amount").notNull().default("0"),
    returnFees: money("return_fees").notNull().default("0"),
    note: text("note"),
    raw: jsonb("raw"),
  },
  (t) => [uniqueIndex("refunds_store_shopify_uq").on(t.storeId, t.shopifyId), index("refunds_store_date_idx").on(t.storeId, t.localDate)],
);

export const refundLines = pgTable(
  "refund_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    refundId: bigint("refund_id", { mode: "number" }).notNull().references(() => refunds.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    orderLineShopifyId: varchar("order_line_shopify_id", { length: 64 }).notNull(),
    quantity: integer("quantity").notNull(),
    subtotal: money("subtotal").notNull().default("0"),
    tax: money("tax").notNull().default("0"),
    restockType: varchar("restock_type", { length: 32 }),
    restocked: boolean("restocked").notNull().default(false),
  },
  (t) => [uniqueIndex("refund_lines_store_shopify_uq").on(t.storeId, t.shopifyId), index("refund_lines_refund_idx").on(t.refundId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    orderId: bigint("order_id", { mode: "number" }).notNull().references(() => orders.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    gateway: varchar("gateway", { length: 128 }).notNull(),
    amount: money("amount").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    processedAtUtc: ts("processed_at_utc"),
    /** Actual fee from Shopify Payments balance transactions, store currency. */
    actualFee: money("actual_fee"),
    raw: jsonb("raw"),
  },
  (t) => [uniqueIndex("transactions_store_shopify_uq").on(t.storeId, t.shopifyId), index("transactions_order_idx").on(t.orderId)],
);

/** Shopify Payments balance transactions: the real processing fee per order. */
export const paymentsBalanceTxns = pgTable(
  "payments_balance_txns",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    type: varchar("type", { length: 64 }).notNull(),
    test: boolean("test").notNull().default(false),
    amount: money("amount").notNull(),
    fee: money("fee").notNull(),
    net: money("net").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    transactionDate: ts("transaction_date").notNull(),
    orderShopifyId: varchar("order_shopify_id", { length: 64 }),
    sourceOrderTransactionId: varchar("source_order_transaction_id", { length: 64 }),
    raw: jsonb("raw"),
  },
  (t) => [uniqueIndex("pbt_store_shopify_uq").on(t.storeId, t.shopifyId), index("pbt_order_idx").on(t.storeId, t.orderShopifyId)],
);

export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    title: text("title").notNull(),
    status: varchar("status", { length: 32 }),
    productType: varchar("product_type", { length: 255 }),
    vendor: varchar("vendor", { length: 255 }),
    imageUrl: text("image_url"),
    raw: jsonb("raw"),
    updatedAtShopify: ts("updated_at_shopify"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("products_store_shopify_uq").on(t.storeId, t.shopifyId)],
);

export const variants = pgTable(
  "variants",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id),
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    productShopifyId: varchar("product_shopify_id", { length: 64 }),
    sku: varchar("sku", { length: 255 }),
    title: text("title"),
    price: money("price"),
    /** Shopify "Cost per item" (inventory item unit cost), store currency. */
    shopifyCost: money("shopify_cost"),
    weightGrams: integer("weight_grams"),
    inventoryQuantity: integer("inventory_quantity"),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("variants_store_shopify_uq").on(t.storeId, t.shopifyId), index("variants_store_sku_idx").on(t.storeId, t.sku)],
);

export const sessionsDaily = pgTable(
  "sessions_daily",
  {
    storeId: integer("store_id").notNull().references(() => stores.id),
    date: date("date").notNull(),
    sessions: integer("sessions").notNull().default(0),
    addedToCart: integer("added_to_cart").notNull().default(0),
    reachedCheckout: integer("reached_checkout").notNull().default(0),
    completedCheckout: integer("completed_checkout").notNull().default(0),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.date] })],
);

/** Shopify's own daily totals, for nightly reconciliation. */
export const shopifyDailyReport = pgTable(
  "shopify_daily_report",
  {
    storeId: integer("store_id").notNull().references(() => stores.id),
    date: date("date").notNull(),
    totalSales: money("total_sales"),
    orders: integer("orders"),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.date] })],
);

// =====================================================================
// Ads
// =====================================================================

export const campaigns = pgTable(
  "campaigns",
  {
    id: serial("id").primaryKey(),
    adAccountId: integer("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    status: varchar("status", { length: 32 }),
    effectiveStatus: varchar("effective_status", { length: 32 }),
    objective: varchar("objective", { length: 64 }),
    /** Resolved store (account default or a rule), null = Unassigned. */
    storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
    createdTime: ts("created_time"),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("campaigns_account_ext_uq").on(t.adAccountId, t.externalId)],
);

export const adSets = pgTable(
  "ad_sets",
  {
    id: serial("id").primaryKey(),
    adAccountId: integer("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    status: varchar("status", { length: 32 }),
    effectiveStatus: varchar("effective_status", { length: 32 }),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ad_sets_account_ext_uq").on(t.adAccountId, t.externalId)],
);

export const creatives = pgTable(
  "creatives",
  {
    id: serial("id").primaryKey(),
    adAccountId: integer("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    /** Grouping key: the same image hash / video id used by several ads shows as one card. */
    groupKey: varchar("group_key", { length: 128 }).notNull(),
    name: text("name"),
    format: varchar("format", { length: 16 }).notNull().default("image"), // image | video | carousel | catalog
    primaryText: text("primary_text"),
    headline: text("headline"),
    description: text("description"),
    callToAction: varchar("call_to_action", { length: 64 }),
    destinationUrl: text("destination_url"),
    videoId: varchar("video_id", { length: 64 }),
    imageHash: varchar("image_hash", { length: 128 }),
    thumbnailUrl: text("thumbnail_url"),
    postUrl: text("post_url"),
    previewUrl: text("preview_url"),
    notes: text("notes"),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("creatives_account_ext_uq").on(t.adAccountId, t.externalId), index("creatives_group_idx").on(t.groupKey)],
);

export const creativeMedia = pgTable(
  "creative_media",
  {
    id: serial("id").primaryKey(),
    creativeId: integer("creative_id").notNull().references(() => creatives.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).notNull(), // thumbnail | image | video
    sourceUrl: text("source_url"),
    localPath: text("local_path"),
    mimeType: varchar("mime_type", { length: 64 }),
    bytes: integer("bytes"),
    status: varchar("status", { length: 16 }).notNull().default("pending"), // pending | ok | failed
    error: text("error"),
    position: integer("position").notNull().default(0),
    fetchedAt: ts("fetched_at"),
  },
  (t) => [uniqueIndex("creative_media_uq").on(t.creativeId, t.kind, t.position)],
);

export const ads = pgTable(
  "ads",
  {
    id: serial("id").primaryKey(),
    adAccountId: integer("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    campaignId: integer("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    adSetId: integer("ad_set_id").references(() => adSets.id, { onDelete: "set null" }),
    creativeId: integer("creative_id").references(() => creatives.id, { onDelete: "set null" }),
    externalId: varchar("external_id", { length: 64 }).notNull(),
    name: text("name").notNull(),
    status: varchar("status", { length: 32 }),
    effectiveStatus: varchar("effective_status", { length: 32 }),
    createdTime: ts("created_time"),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ads_account_ext_uq").on(t.adAccountId, t.externalId), index("ads_creative_idx").on(t.creativeId)],
);

/** Raw Meta insights: one row per ad per day, in the ad account currency. */
export const adInsightsDaily = pgTable(
  "ad_insights_daily",
  {
    adAccountId: integer("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    adExternalId: varchar("ad_external_id", { length: 64 }).notNull(),
    date: date("date").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    attributionSetting: varchar("attribution_setting", { length: 64 }),
    spend: money("spend").notNull().default("0"),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    reach: bigint("reach", { mode: "number" }).notNull().default(0),
    frequency: numeric("frequency", { precision: 12, scale: 6 }),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    linkClicks: bigint("link_clicks", { mode: "number" }).notNull().default(0),
    landingPageViews: bigint("landing_page_views", { mode: "number" }).notNull().default(0),
    addsToCart: bigint("adds_to_cart", { mode: "number" }).notNull().default(0),
    checkoutsStarted: bigint("checkouts_started", { mode: "number" }).notNull().default(0),
    purchases: numeric("purchases", { precision: 14, scale: 2 }).notNull().default("0"),
    purchaseValue: money("purchase_value").notNull().default("0"),
    video3sPlays: bigint("video_3s_plays", { mode: "number" }).notNull().default(0),
    thruplays: bigint("thruplays", { mode: "number" }).notNull().default(0),
    videoP25: bigint("video_p25", { mode: "number" }).notNull().default(0),
    videoP50: bigint("video_p50", { mode: "number" }).notNull().default(0),
    videoP75: bigint("video_p75", { mode: "number" }).notNull().default(0),
    videoP100: bigint("video_p100", { mode: "number" }).notNull().default(0),
    raw: jsonb("raw"),
    syncedAt: ts("synced_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.adAccountId, t.adExternalId, t.date] }), index("ad_insights_date_idx").on(t.date)],
);

export const tags = pgTable("tags", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  kind: varchar("kind", { length: 32 }).notNull().default("other"), // product | angle | creator | winner | other
  color: varchar("color", { length: 16 }),
  createdAt: created(),
}, (t) => [uniqueIndex("tags_kind_name_uq").on(t.kind, t.name)]);

export const creativeTags = pgTable(
  "creative_tags",
  {
    groupKey: varchar("group_key", { length: 128 }).notNull(),
    tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupKey, t.tagId] })],
);

export const adTags = pgTable(
  "ad_tags",
  {
    adId: integer("ad_id").notNull().references(() => ads.id, { onDelete: "cascade" }),
    tagId: integer("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.adId, t.tagId] })],
);

/** Saved filters shown as named tabs (creative library, ads table). */
export const savedViews = pgTable("saved_views", {
  id: serial("id").primaryKey(),
  page: varchar("page", { length: 32 }).notNull(), // creatives | ads
  name: varchar("name", { length: 64 }).notNull(),
  query: text("query").notNull(), // URL search string
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: created(),
});

// =====================================================================
// Costs
// =====================================================================

/** Typed COGS per variant/SKU. A new cost is a new dated row: history is never overwritten. */
export const variantCosts = pgTable(
  "variant_costs",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    sku: varchar("sku", { length: 255 }),
    variantShopifyId: varchar("variant_shopify_id", { length: 64 }),
    cost: money("cost").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    effectiveFrom: date("effective_from").notNull(),
    source: varchar("source", { length: 16 }).notNull().default("typed"), // typed | csv | prefill
    createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("variant_costs_lookup_idx").on(t.storeId, t.sku, t.effectiveFrom), index("variant_costs_variant_idx").on(t.storeId, t.variantShopifyId)],
);

export const shippingRules = pgTable("shipping_rules", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  mode: varchar("mode", { length: 16 }).notNull(), // flat | table | actual
  flatAmount: money("flat_amount").notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull(),
  table: jsonb("table").$type<{ country: string; basis: "weight" | "items"; min: number; max: number | null; amount: string }[]>(),
  effectiveFrom: date("effective_from").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const orderShippingCosts = pgTable(
  "order_shipping_costs",
  {
    id: serial("id").primaryKey(),
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    orderName: varchar("order_name", { length: 64 }).notNull(), // "#1001" as in the carrier CSV
    cost: money("cost").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    carrier: varchar("carrier", { length: 64 }),
    importedAt: created(),
  },
  (t) => [uniqueIndex("order_shipping_costs_uq").on(t.storeId, t.orderName)],
);

export const handlingRules = pgTable("handling_rules", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  perOrder: money("per_order").notNull().default("0"),
  perItem: money("per_item").notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const paymentFeeRules = pgTable("payment_fee_rules", {
  id: serial("id").primaryKey(),
  storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
  gateway: varchar("gateway", { length: 128 }).notNull(), // "*" = any other gateway
  percent: numeric("percent", { precision: 8, scale: 4 }).notNull().default("0"),
  fixed: money("fixed").notNull().default("0"),
  currency: varchar("currency", { length: 3 }).notNull(),
  effectiveFrom: date("effective_from").notNull(),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

// =====================================================================
// Expenses
// =====================================================================

/** scope: store (storeId), region (regionId) or shared (all stores). */
const scopeCols = () => ({
  scope: varchar("scope", { length: 16 }).notNull().default("shared"),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
  regionId: integer("region_id").references(() => regions.id, { onDelete: "set null" }),
  allocation: varchar("allocation", { length: 16 }).notNull().default("equal"), // equal | fixed | revenue
  allocationPercents: jsonb("allocation_percents").$type<Record<string, number>>(),
});

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  vendor: varchar("vendor", { length: 128 }),
  category: varchar("category", { length: 32 }).notNull().default("tools"), // tools | apps | domains | shopify_plan | hosting | contractors | other
  amount: money("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  cycle: varchar("cycle", { length: 16 }).notNull(), // monthly | yearly | every_n_months | one_off
  everyNMonths: integer("every_n_months"),
  anchorDate: date("anchor_date").notNull(), // a known charge date; drives the schedule
  nextRenewal: date("next_renewal"),
  startDate: date("start_date"),
  endDate: date("end_date"),
  ...scopeCols(),
  status: varchar("status", { length: 16 }).notNull().default("active"), // active | trial | cancelled
  paymentMethod: varchar("payment_method", { length: 128 }),
  manageUrl: text("manage_url"),
  notes: text("notes"),
  countsAsAdSpend: boolean("counts_as_ad_spend").notNull().default(false),
  reminderDays: integer("reminder_days"),
  /** For domains: looked up via RDAP where the registry publishes it. */
  domain: varchar("domain", { length: 255 }),
  domainExpiry: date("domain_expiry"),
  domainCheckedAt: ts("domain_checked_at"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
  updatedAt: updated(),
});

/** One row per charge date. Generated on each renewal; the amount can be corrected. */
export const subscriptionOccurrences = pgTable(
  "subscription_occurrences",
  {
    id: serial("id").primaryKey(),
    subscriptionId: integer("subscription_id").notNull().references(() => subscriptions.id, { onDelete: "cascade" }),
    chargeDate: date("charge_date").notNull(),
    expectedAmount: money("expected_amount").notNull(),
    actualAmount: money("actual_amount"),
    currency: varchar("currency", { length: 3 }).notNull(),
    note: text("note"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("sub_occ_uq").on(t.subscriptionId, t.chargeDate)],
);

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 32 }).notNull().default("other"),
  amount: money("amount").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  ...scopeCols(),
  countsAsAdSpend: boolean("counts_as_ad_spend").notNull().default(false),
  notes: text("notes"),
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

/** In-dashboard notices (renewal reminders, sync failures, reconciliation gaps). */
export const notices = pgTable(
  "notices",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 32 }).notNull(), // renewal | sync_error | reconcile | info | login
    severity: varchar("severity", { length: 16 }).notNull().default("info"), // info | warning | error
    title: text("title").notNull(),
    body: text("body"),
    link: text("link"),
    dedupeKey: varchar("dedupe_key", { length: 255 }),
    dismissedAt: ts("dismissed_at"),
    createdAt: created(),
  },
  (t) => [uniqueIndex("notices_dedupe_uq").on(t.dedupeKey)],
);

// =====================================================================
// Reference
// =====================================================================

/** ECB reference rates: units of `currency` per 1 EUR. */
export const fxRates = pgTable(
  "fx_rates",
  {
    date: date("date").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    perEur: numeric("per_eur", { precision: 20, scale: 10 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.date, t.currency] })],
);

// =====================================================================
// Derived
// =====================================================================

const componentColumns = Object.fromEntries([
  ...MONEY_COMPONENTS.map((c) => [c, money(c).notNull().default("0")]),
  ...COUNT_COMPONENTS.map((c) => [c, numeric(c, { precision: 20, scale: 4 }).notNull().default("0")]),
]) as Record<(typeof MONEY_COMPONENTS)[number] | (typeof COUNT_COMPONENTS)[number], ReturnType<typeof money>>;

/** One row per store, per day, per display currency. Pages read these. */
export const dailyStoreMetrics = pgTable(
  "daily_store_metrics",
  {
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(), // USD | EUR
    ...componentColumns,
    rebuiltAt: ts("rebuilt_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.date, t.currency] }), index("dsm_date_idx").on(t.date, t.currency)],
);

/** One row per ad per day with the store it is mapped to (null = Unassigned), converted. */
export const dailyAdMetrics = pgTable(
  "daily_ad_metrics",
  {
    adAccountId: integer("ad_account_id").notNull().references(() => adAccounts.id, { onDelete: "cascade" }),
    adExternalId: varchar("ad_external_id", { length: 64 }).notNull(),
    date: date("date").notNull(),
    storeId: integer("store_id").references(() => stores.id, { onDelete: "set null" }),
    campaignId: integer("campaign_id"),
    adSetId: integer("ad_set_id"),
    adId: integer("ad_id"),
    creativeGroupKey: varchar("creative_group_key", { length: 128 }),
    spendNative: money("spend_native").notNull().default("0"),
    spendUsd: money("spend_usd").notNull().default("0"),
    spendEur: money("spend_eur").notNull().default("0"),
    purchaseValueNative: money("purchase_value_native").notNull().default("0"),
    purchaseValueUsd: money("purchase_value_usd").notNull().default("0"),
    purchaseValueEur: money("purchase_value_eur").notNull().default("0"),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    reach: bigint("reach", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    linkClicks: bigint("link_clicks", { mode: "number" }).notNull().default(0),
    landingPageViews: bigint("landing_page_views", { mode: "number" }).notNull().default(0),
    addsToCart: bigint("adds_to_cart", { mode: "number" }).notNull().default(0),
    checkoutsStarted: bigint("checkouts_started", { mode: "number" }).notNull().default(0),
    purchases: numeric("purchases", { precision: 14, scale: 2 }).notNull().default("0"),
    video3sPlays: bigint("video_3s_plays", { mode: "number" }).notNull().default(0),
    thruplays: bigint("thruplays", { mode: "number" }).notNull().default(0),
    videoP25: bigint("video_p25", { mode: "number" }).notNull().default(0),
    videoP50: bigint("video_p50", { mode: "number" }).notNull().default(0),
    videoP75: bigint("video_p75", { mode: "number" }).notNull().default(0),
    videoP100: bigint("video_p100", { mode: "number" }).notNull().default(0),
    rebuiltAt: ts("rebuilt_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.adAccountId, t.adExternalId, t.date] }),
    index("dam_store_date_idx").on(t.storeId, t.date),
    index("dam_group_idx").on(t.creativeGroupKey, t.date),
  ],
);

// =====================================================================
// Operations
// =====================================================================

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    job: varchar("job", { length: 64 }).notNull(),
    source: varchar("source", { length: 64 }).notNull(), // e.g. "shopify:3", "meta:2", "fx"
    status: varchar("status", { length: 16 }).notNull().default("running"), // running | ok | error
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
    rowsChanged: integer("rows_changed").notNull().default(0),
    error: text("error"),
    detail: jsonb("detail"),
  },
  (t) => [index("sync_runs_source_idx").on(t.source, t.startedAt), index("sync_runs_job_idx").on(t.job, t.startedAt)],
);

export const syncCursors = pgTable("sync_cursors", {
  key: varchar("key", { length: 128 }).primaryKey(), // "shopify:orders:3"
  value: text("value").notNull(),
  updatedAt: updated(),
});

/** Store-days whose derived metrics must be rebuilt. */
export const dirtyStoreDays = pgTable(
  "dirty_store_days",
  {
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    markedAt: ts("marked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.date] })],
);

export const reconciliation = pgTable(
  "reconciliation",
  {
    storeId: integer("store_id").notNull().references(() => stores.id, { onDelete: "cascade" }),
    date: date("date").notNull(),
    ourTotalSales: money("our_total_sales"),
    shopifyTotalSales: money("shopify_total_sales"),
    ourOrders: integer("our_orders"),
    shopifyOrders: integer("shopify_orders"),
    salesGapPct: numeric("sales_gap_pct", { precision: 12, scale: 6 }),
    ordersGapPct: numeric("orders_gap_pct", { precision: 12, scale: 6 }),
    flagged: boolean("flagged").notNull().default(false),
    checkedAt: ts("checked_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storeId, t.date] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    action: varchar("action", { length: 64 }).notNull(), // login.ok | login.fail | cost.create | expense.update …
    entity: varchar("entity", { length: 64 }),
    entityId: varchar("entity_id", { length: 64 }),
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    ip: varchar("ip", { length: 64 }),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);

export const chartNotes = pgTable("chart_notes", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  text: varchar("text", { length: 255 }).notNull(),
  storeId: integer("store_id").references(() => stores.id, { onDelete: "cascade" }), // null = all
  createdBy: integer("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: created(),
});

export const dashboardLayouts = pgTable("dashboard_layouts", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  layout: jsonb("layout").$type<{ pins: string[]; order: Record<string, string[]>; hidden?: string[] }>().notNull(),
  updatedAt: updated(),
});

/** Private iCal feed tokens. */
export const calendarTokens = pgTable("calendar_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: created(),
});

