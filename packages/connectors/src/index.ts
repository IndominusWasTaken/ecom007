export * from "./types";
export * from "./http";
export * as shopify from "./shopify/index";
export * as meta from "./meta/index";
export * from "./fx/ecb";
export * from "./domains/rdap";
import { shopifyConnector } from "./shopify/index";
import { metaConnector } from "./meta/index";
import { googleAdsConnector } from "./google/index";
import { tiktokAdsConnector } from "./tiktok/index";

/** Ad platforms shown in Settings; unavailable ones render as "coming soon". */
export const AD_PLATFORMS = [metaConnector, googleAdsConnector, tiktokAdsConnector].map((c) => ({ platform: c.platform, label: c.label, available: c.available }));
export const CONNECTORS = { shopify: shopifyConnector, meta: metaConnector, google: googleAdsConnector, tiktok: tiktokAdsConnector };
