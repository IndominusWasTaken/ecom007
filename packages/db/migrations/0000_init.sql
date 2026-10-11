CREATE TABLE "ad_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(32) DEFAULT 'meta' NOT NULL,
	"connection_id" integer,
	"external_id" varchar(64) NOT NULL,
	"name" varchar(255) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"time_zone" varchar(64) NOT NULL,
	"account_status" integer,
	"store_id" integer,
	"enabled" boolean DEFAULT true NOT NULL,
	"history_loaded_at" timestamp with time zone,
	"attribution_setting" varchar(64),
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_insights_daily" (
	"ad_account_id" integer NOT NULL,
	"ad_external_id" varchar(64) NOT NULL,
	"date" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"attribution_setting" varchar(64),
	"spend" numeric(20, 6) DEFAULT '0' NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"frequency" numeric(12, 6),
	"clicks" bigint DEFAULT 0 NOT NULL,
	"link_clicks" bigint DEFAULT 0 NOT NULL,
	"landing_page_views" bigint DEFAULT 0 NOT NULL,
	"adds_to_cart" bigint DEFAULT 0 NOT NULL,
	"checkouts_started" bigint DEFAULT 0 NOT NULL,
	"purchases" numeric(14, 2) DEFAULT '0' NOT NULL,
	"purchase_value" numeric(20, 6) DEFAULT '0' NOT NULL,
	"video_3s_plays" bigint DEFAULT 0 NOT NULL,
	"thruplays" bigint DEFAULT 0 NOT NULL,
	"video_p25" bigint DEFAULT 0 NOT NULL,
	"video_p50" bigint DEFAULT 0 NOT NULL,
	"video_p75" bigint DEFAULT 0 NOT NULL,
	"video_p100" bigint DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_insights_daily_ad_account_id_ad_external_id_date_pk" PRIMARY KEY("ad_account_id","ad_external_id","date")
);
--> statement-breakpoint
CREATE TABLE "ad_sets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_account_id" integer NOT NULL,
	"campaign_id" integer,
	"external_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"status" varchar(32),
	"effective_status" varchar(32),
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_tags" (
	"ad_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "ad_tags_ad_id_tag_id_pk" PRIMARY KEY("ad_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "ads" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_account_id" integer NOT NULL,
	"campaign_id" integer,
	"ad_set_id" integer,
	"creative_id" integer,
	"external_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"status" varchar(32),
	"effective_status" varchar(32),
	"created_time" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" varchar(64) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" integer,
	"action" varchar(64) NOT NULL,
	"entity" varchar(64),
	"entity_id" varchar(64),
	"old_value" jsonb,
	"new_value" jsonb,
	"ip" varchar(64),
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"stage" varchar(16) DEFAULT 'full' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" varchar(64),
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "calendar_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaign_store_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_account_id" integer,
	"campaign_external_id" varchar(64),
	"pattern" varchar(255),
	"store_id" integer NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_account_id" integer NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"status" varchar(32),
	"effective_status" varchar(32),
	"objective" varchar(64),
	"store_id" integer,
	"created_time" timestamp with time zone,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chart_notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"text" varchar(255) NOT NULL,
	"store_id" integer,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" varchar(32) NOT NULL,
	"store_id" integer,
	"label" varchar(128) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"secrets_enc" text,
	"status" varchar(32) DEFAULT 'new' NOT NULL,
	"last_error" text,
	"last_checked_at" timestamp with time zone,
	"token_enc" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creative_media" (
	"id" serial PRIMARY KEY NOT NULL,
	"creative_id" integer NOT NULL,
	"kind" varchar(16) NOT NULL,
	"source_url" text,
	"local_path" text,
	"mime_type" varchar(64),
	"bytes" integer,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error" text,
	"position" integer DEFAULT 0 NOT NULL,
	"fetched_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creative_tags" (
	"group_key" varchar(128) NOT NULL,
	"tag_id" integer NOT NULL,
	CONSTRAINT "creative_tags_group_key_tag_id_pk" PRIMARY KEY("group_key","tag_id")
);
--> statement-breakpoint
CREATE TABLE "creatives" (
	"id" serial PRIMARY KEY NOT NULL,
	"ad_account_id" integer NOT NULL,
	"external_id" varchar(64) NOT NULL,
	"group_key" varchar(128) NOT NULL,
	"name" text,
	"format" varchar(16) DEFAULT 'image' NOT NULL,
	"primary_text" text,
	"headline" text,
	"description" text,
	"call_to_action" varchar(64),
	"destination_url" text,
	"video_id" varchar(64),
	"image_hash" varchar(128),
	"thumbnail_url" text,
	"post_url" text,
	"preview_url" text,
	"notes" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_ad_metrics" (
	"ad_account_id" integer NOT NULL,
	"ad_external_id" varchar(64) NOT NULL,
	"date" date NOT NULL,
	"store_id" integer,
	"campaign_id" integer,
	"ad_set_id" integer,
	"ad_id" integer,
	"creative_group_key" varchar(128),
	"spend_native" numeric(20, 6) DEFAULT '0' NOT NULL,
	"spend_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"spend_eur" numeric(20, 6) DEFAULT '0' NOT NULL,
	"purchase_value_native" numeric(20, 6) DEFAULT '0' NOT NULL,
	"purchase_value_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"purchase_value_eur" numeric(20, 6) DEFAULT '0' NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"reach" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"link_clicks" bigint DEFAULT 0 NOT NULL,
	"landing_page_views" bigint DEFAULT 0 NOT NULL,
	"adds_to_cart" bigint DEFAULT 0 NOT NULL,
	"checkouts_started" bigint DEFAULT 0 NOT NULL,
	"purchases" numeric(14, 2) DEFAULT '0' NOT NULL,
	"video_3s_plays" bigint DEFAULT 0 NOT NULL,
	"thruplays" bigint DEFAULT 0 NOT NULL,
	"video_p25" bigint DEFAULT 0 NOT NULL,
	"video_p50" bigint DEFAULT 0 NOT NULL,
	"video_p75" bigint DEFAULT 0 NOT NULL,
	"video_p100" bigint DEFAULT 0 NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_ad_metrics_ad_account_id_ad_external_id_date_pk" PRIMARY KEY("ad_account_id","ad_external_id","date")
);
--> statement-breakpoint
CREATE TABLE "daily_store_metrics" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"gross_sales" numeric(20, 6) DEFAULT '0' NOT NULL,
	"discounts" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shipping_gross" numeric(20, 6) DEFAULT '0' NOT NULL,
	"order_taxes" numeric(20, 6) DEFAULT '0' NOT NULL,
	"order_revenue" numeric(20, 6) DEFAULT '0' NOT NULL,
	"new_customer_revenue" numeric(20, 6) DEFAULT '0' NOT NULL,
	"returning_customer_revenue" numeric(20, 6) DEFAULT '0' NOT NULL,
	"sales_reversals" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shipping_refunded" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax_refunded" numeric(20, 6) DEFAULT '0' NOT NULL,
	"return_fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"cogs" numeric(20, 6) DEFAULT '0' NOT NULL,
	"refunded_restocked_cogs" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shipping_cost" numeric(20, 6) DEFAULT '0' NOT NULL,
	"handling_fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"payment_fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"cogs_missing_revenue" numeric(20, 6) DEFAULT '0' NOT NULL,
	"ad_spend_meta" numeric(20, 6) DEFAULT '0' NOT NULL,
	"ad_spend_google" numeric(20, 6) DEFAULT '0' NOT NULL,
	"ad_spend_tiktok" numeric(20, 6) DEFAULT '0' NOT NULL,
	"ad_spend_manual" numeric(20, 6) DEFAULT '0' NOT NULL,
	"meta_purchase_value" numeric(20, 6) DEFAULT '0' NOT NULL,
	"operating_expenses" numeric(20, 6) DEFAULT '0' NOT NULL,
	"orders" numeric(20, 4) DEFAULT '0' NOT NULL,
	"non_zero_orders" numeric(20, 4) DEFAULT '0' NOT NULL,
	"units_sold" numeric(20, 4) DEFAULT '0' NOT NULL,
	"new_customer_orders" numeric(20, 4) DEFAULT '0' NOT NULL,
	"returning_customer_orders" numeric(20, 4) DEFAULT '0' NOT NULL,
	"orders_fulfilled" numeric(20, 4) DEFAULT '0' NOT NULL,
	"cogs_missing_units" numeric(20, 4) DEFAULT '0' NOT NULL,
	"sessions" numeric(20, 4) DEFAULT '0' NOT NULL,
	"added_to_cart" numeric(20, 4) DEFAULT '0' NOT NULL,
	"reached_checkout" numeric(20, 4) DEFAULT '0' NOT NULL,
	"completed_checkout" numeric(20, 4) DEFAULT '0' NOT NULL,
	"meta_purchases" numeric(20, 4) DEFAULT '0' NOT NULL,
	"impressions" numeric(20, 4) DEFAULT '0' NOT NULL,
	"link_clicks" numeric(20, 4) DEFAULT '0' NOT NULL,
	"clicks" numeric(20, 4) DEFAULT '0' NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_store_metrics_store_id_date_currency_pk" PRIMARY KEY("store_id","date","currency")
);
--> statement-breakpoint
CREATE TABLE "dashboard_layouts" (
	"user_id" integer PRIMARY KEY NOT NULL,
	"layout" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dirty_store_days" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"marked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dirty_store_days_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"name" varchar(255) NOT NULL,
	"category" varchar(32) DEFAULT 'other' NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"scope" varchar(16) DEFAULT 'shared' NOT NULL,
	"store_id" integer,
	"region_id" integer,
	"allocation" varchar(16) DEFAULT 'equal' NOT NULL,
	"allocation_percents" jsonb,
	"counts_as_ad_spend" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"currency" varchar(3) NOT NULL,
	"per_eur" numeric(20, 10) NOT NULL,
	CONSTRAINT "fx_rates_date_currency_pk" PRIMARY KEY("date","currency")
);
--> statement-breakpoint
CREATE TABLE "handling_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"per_order" numeric(20, 6) DEFAULT '0' NOT NULL,
	"per_item" numeric(20, 6) DEFAULT '0' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" varchar(32) NOT NULL,
	"severity" varchar(16) DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"link" text,
	"dedupe_key" varchar(255),
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"order_id" bigint NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"product_shopify_id" varchar(64),
	"variant_shopify_id" varchar(64),
	"sku" varchar(255),
	"title" text NOT NULL,
	"variant_title" text,
	"quantity" integer NOT NULL,
	"unit_price" numeric(20, 6) NOT NULL,
	"discount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"gross_ex" numeric(20, 6) DEFAULT '0' NOT NULL,
	"discount_ex" numeric(20, 6) DEFAULT '0' NOT NULL,
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"weight_grams" integer DEFAULT 0 NOT NULL,
	"unit_cost" numeric(20, 6),
	"cost_source" varchar(16) DEFAULT 'missing' NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "order_shipping_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"order_name" varchar(64) NOT NULL,
	"cost" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"carrier" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"name" varchar(64) NOT NULL,
	"created_at_utc" timestamp with time zone NOT NULL,
	"updated_at_utc" timestamp with time zone NOT NULL,
	"cancelled_at_utc" timestamp with time zone,
	"local_date" date NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"currency" varchar(3) NOT NULL,
	"presentment_currency" varchar(3),
	"taxes_included" boolean DEFAULT false NOT NULL,
	"source_name" varchar(64),
	"channel" varchar(128),
	"customer_id" varchar(64),
	"customer_order_index" integer,
	"is_first_order" boolean DEFAULT false NOT NULL,
	"shipping_country" varchar(2),
	"requires_shipping" boolean DEFAULT true NOT NULL,
	"total_weight_grams" integer DEFAULT 0 NOT NULL,
	"financial_status" varchar(32),
	"fulfillment_status" varchar(32),
	"fulfilled_at_utc" timestamp with time zone,
	"fulfilled_local_date" date,
	"subtotal" numeric(20, 6),
	"total_discounts" numeric(20, 6),
	"shipping_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shipping_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_price" numeric(20, 6) DEFAULT '0' NOT NULL,
	"order_revenue" numeric(20, 6) DEFAULT '0' NOT NULL,
	"order_revenue_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"order_revenue_eur" numeric(20, 6) DEFAULT '0' NOT NULL,
	"fx_to_usd" numeric(20, 10) DEFAULT '1' NOT NULL,
	"fx_to_eur" numeric(20, 10) DEFAULT '1' NOT NULL,
	"utm_source" varchar(255),
	"utm_medium" varchar(255),
	"utm_campaign" varchar(255),
	"utm_content" varchar(255),
	"utm_term" varchar(255),
	"landing_page" text,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_fee_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"gateway" varchar(128) NOT NULL,
	"percent" numeric(8, 4) DEFAULT '0' NOT NULL,
	"fixed" numeric(20, 6) DEFAULT '0' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"effective_from" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments_balance_txns" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"type" varchar(64) NOT NULL,
	"test" boolean DEFAULT false NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"fee" numeric(20, 6) NOT NULL,
	"net" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"order_shopify_id" varchar(64),
	"source_order_transaction_id" varchar(64),
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"title" text NOT NULL,
	"status" varchar(32),
	"product_type" varchar(255),
	"vendor" varchar(255),
	"image_url" text,
	"raw" jsonb,
	"updated_at_shopify" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"our_total_sales" numeric(20, 6),
	"shopify_total_sales" numeric(20, 6),
	"our_orders" integer,
	"shopify_orders" integer,
	"sales_gap_pct" numeric(12, 6),
	"orders_gap_pct" numeric(12, 6),
	"flagged" boolean DEFAULT false NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliation_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "refund_lines" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"refund_id" bigint NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"order_line_shopify_id" varchar(64) NOT NULL,
	"quantity" integer NOT NULL,
	"subtotal" numeric(20, 6) DEFAULT '0' NOT NULL,
	"tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"restock_type" varchar(32),
	"restocked" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"order_id" bigint NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"created_at_utc" timestamp with time zone NOT NULL,
	"local_date" date NOT NULL,
	"total_refunded" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_refunded_usd" numeric(20, 6) DEFAULT '0' NOT NULL,
	"total_refunded_eur" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shipping_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"shipping_tax" numeric(20, 6) DEFAULT '0' NOT NULL,
	"other_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"return_fees" numeric(20, 6) DEFAULT '0' NOT NULL,
	"note" text,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"code" varchar(16) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "regions_name_unique" UNIQUE("name"),
	CONSTRAINT "regions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"page" varchar(32) NOT NULL,
	"name" varchar(64) NOT NULL,
	"query" text NOT NULL,
	"created_by" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions_daily" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"added_to_cart" integer DEFAULT 0 NOT NULL,
	"reached_checkout" integer DEFAULT 0 NOT NULL,
	"completed_checkout" integer DEFAULT 0 NOT NULL,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_daily_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "shipping_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"mode" varchar(16) NOT NULL,
	"flat_amount" numeric(20, 6) DEFAULT '0' NOT NULL,
	"currency" varchar(3) NOT NULL,
	"table" jsonb,
	"effective_from" date NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopify_daily_report" (
	"store_id" integer NOT NULL,
	"date" date NOT NULL,
	"total_sales" numeric(20, 6),
	"orders" integer,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shopify_daily_report_store_id_date_pk" PRIMARY KEY("store_id","date")
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" serial PRIMARY KEY NOT NULL,
	"region_id" integer NOT NULL,
	"name" varchar(128) NOT NULL,
	"shop_domain" varchar(255) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"time_zone" varchar(64) NOT NULL,
	"prices_include_tax" boolean DEFAULT false NOT NULL,
	"cogs_fallback_percent" numeric(6, 3),
	"color" varchar(16),
	"active" boolean DEFAULT true NOT NULL,
	"history_from" date,
	"history_loaded_at" timestamp with time zone,
	"sessions_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"shopify_plan" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stores_shop_domain_unique" UNIQUE("shop_domain")
);
--> statement-breakpoint
CREATE TABLE "subscription_occurrences" (
	"id" serial PRIMARY KEY NOT NULL,
	"subscription_id" integer NOT NULL,
	"charge_date" date NOT NULL,
	"expected_amount" numeric(20, 6) NOT NULL,
	"actual_amount" numeric(20, 6),
	"currency" varchar(3) NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(128) NOT NULL,
	"vendor" varchar(128),
	"category" varchar(32) DEFAULT 'tools' NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"cycle" varchar(16) NOT NULL,
	"every_n_months" integer,
	"anchor_date" date NOT NULL,
	"next_renewal" date,
	"start_date" date,
	"end_date" date,
	"scope" varchar(16) DEFAULT 'shared' NOT NULL,
	"store_id" integer,
	"region_id" integer,
	"allocation" varchar(16) DEFAULT 'equal' NOT NULL,
	"allocation_percents" jsonb,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"payment_method" varchar(128),
	"manage_url" text,
	"notes" text,
	"counts_as_ad_spend" boolean DEFAULT false NOT NULL,
	"reminder_days" integer,
	"domain" varchar(255),
	"domain_expiry" date,
	"domain_checked_at" timestamp with time zone,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_cursors" (
	"key" varchar(128) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job" varchar(64) NOT NULL,
	"source" varchar(64) NOT NULL,
	"status" varchar(16) DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rows_changed" integer DEFAULT 0 NOT NULL,
	"error" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(64) NOT NULL,
	"kind" varchar(32) DEFAULT 'other' NOT NULL,
	"color" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"order_id" bigint NOT NULL,
	"shopify_id" varchar(64) NOT NULL,
	"kind" varchar(32) NOT NULL,
	"status" varchar(32) NOT NULL,
	"gateway" varchar(128) NOT NULL,
	"amount" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"processed_at_utc" timestamp with time zone,
	"actual_fee" numeric(20, 6),
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" varchar(64) NOT NULL,
	"display_name" varchar(128),
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"totp_last_step" bigint,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "variant_costs" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"sku" varchar(255),
	"variant_shopify_id" varchar(64),
	"cost" numeric(20, 6) NOT NULL,
	"currency" varchar(3) NOT NULL,
	"effective_from" date NOT NULL,
	"source" varchar(16) DEFAULT 'typed' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"store_id" integer NOT NULL,
	"product_id" integer,
	"shopify_id" varchar(64) NOT NULL,
	"product_shopify_id" varchar(64),
	"sku" varchar(255),
	"title" text,
	"price" numeric(20, 6),
	"shopify_cost" numeric(20, 6),
	"weight_grams" integer,
	"inventory_quantity" integer,
	"raw" jsonb,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_insights_daily" ADD CONSTRAINT "ad_insights_daily_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_sets" ADD CONSTRAINT "ad_sets_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_tags" ADD CONSTRAINT "ad_tags_ad_id_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_tags" ADD CONSTRAINT "ad_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_ad_set_id_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."ad_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ads" ADD CONSTRAINT "ads_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_tokens" ADD CONSTRAINT "calendar_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_store_rules" ADD CONSTRAINT "campaign_store_rules_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_store_rules" ADD CONSTRAINT "campaign_store_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chart_notes" ADD CONSTRAINT "chart_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_media" ADD CONSTRAINT "creative_media_creative_id_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_tags" ADD CONSTRAINT "creative_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creatives" ADD CONSTRAINT "creatives_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_metrics" ADD CONSTRAINT "daily_ad_metrics_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_metrics" ADD CONSTRAINT "daily_ad_metrics_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_store_metrics" ADD CONSTRAINT "daily_store_metrics_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_layouts" ADD CONSTRAINT "dashboard_layouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dirty_store_days" ADD CONSTRAINT "dirty_store_days_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handling_rules" ADD CONSTRAINT "handling_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handling_rules" ADD CONSTRAINT "handling_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_lines" ADD CONSTRAINT "order_lines_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_shipping_costs" ADD CONSTRAINT "order_shipping_costs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_fee_rules" ADD CONSTRAINT "payment_fee_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments_balance_txns" ADD CONSTRAINT "payments_balance_txns_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation" ADD CONSTRAINT "reconciliation_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions_daily" ADD CONSTRAINT "sessions_daily_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_rules" ADD CONSTRAINT "shipping_rules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_daily_report" ADD CONSTRAINT "shopify_daily_report_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stores" ADD CONSTRAINT "stores_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_occurrences" ADD CONSTRAINT "subscription_occurrences_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_platform_ext_uq" ON "ad_accounts" USING btree ("platform","external_id");--> statement-breakpoint
CREATE INDEX "ad_insights_date_idx" ON "ad_insights_daily" USING btree ("date");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_sets_account_ext_uq" ON "ad_sets" USING btree ("ad_account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ads_account_ext_uq" ON "ads" USING btree ("ad_account_id","external_id");--> statement-breakpoint
CREATE INDEX "ads_creative_idx" ON "ads" USING btree ("creative_id");--> statement-breakpoint
CREATE INDEX "audit_log_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "campaigns_account_ext_uq" ON "campaigns" USING btree ("ad_account_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_media_uq" ON "creative_media" USING btree ("creative_id","kind","position");--> statement-breakpoint
CREATE UNIQUE INDEX "creatives_account_ext_uq" ON "creatives" USING btree ("ad_account_id","external_id");--> statement-breakpoint
CREATE INDEX "creatives_group_idx" ON "creatives" USING btree ("group_key");--> statement-breakpoint
CREATE INDEX "dam_store_date_idx" ON "daily_ad_metrics" USING btree ("store_id","date");--> statement-breakpoint
CREATE INDEX "dam_group_idx" ON "daily_ad_metrics" USING btree ("creative_group_key","date");--> statement-breakpoint
CREATE INDEX "dsm_date_idx" ON "daily_store_metrics" USING btree ("date","currency");--> statement-breakpoint
CREATE UNIQUE INDEX "notices_dedupe_uq" ON "notices" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "order_lines_store_shopify_uq" ON "order_lines" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "order_lines_order_idx" ON "order_lines" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_lines_variant_idx" ON "order_lines" USING btree ("store_id","variant_shopify_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_shipping_costs_uq" ON "order_shipping_costs" USING btree ("store_id","order_name");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_store_shopify_uq" ON "orders" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "orders_store_date_idx" ON "orders" USING btree ("store_id","local_date");--> statement-breakpoint
CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("store_id","customer_id","created_at_utc");--> statement-breakpoint
CREATE INDEX "orders_fulfilled_idx" ON "orders" USING btree ("store_id","fulfilled_local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "pbt_store_shopify_uq" ON "payments_balance_txns" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "pbt_order_idx" ON "payments_balance_txns" USING btree ("store_id","order_shopify_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_shopify_uq" ON "products" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_lines_store_shopify_uq" ON "refund_lines" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "refund_lines_refund_idx" ON "refund_lines" USING btree ("refund_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refunds_store_shopify_uq" ON "refunds" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "refunds_store_date_idx" ON "refunds" USING btree ("store_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "sub_occ_uq" ON "subscription_occurrences" USING btree ("subscription_id","charge_date");--> statement-breakpoint
CREATE INDEX "sync_runs_source_idx" ON "sync_runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "sync_runs_job_idx" ON "sync_runs" USING btree ("job","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_kind_name_uq" ON "tags" USING btree ("kind","name");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_store_shopify_uq" ON "transactions" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "transactions_order_idx" ON "transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "variant_costs_lookup_idx" ON "variant_costs" USING btree ("store_id","sku","effective_from");--> statement-breakpoint
CREATE INDEX "variant_costs_variant_idx" ON "variant_costs" USING btree ("store_id","variant_shopify_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_store_shopify_uq" ON "variants" USING btree ("store_id","shopify_id");--> statement-breakpoint
CREATE INDEX "variants_store_sku_idx" ON "variants" USING btree ("store_id","sku");