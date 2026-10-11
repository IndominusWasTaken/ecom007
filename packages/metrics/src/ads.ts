import { D, Decimal, type DecimalLike } from "@ecom/core/money";

/** Raw ad metrics stored per ad per day (Meta-reported). */
export const AD_COUNT_FIELDS = [
  "impressions",
  "reach",
  "clicks",
  "link_clicks",
  "landing_page_views",
  "adds_to_cart",
  "checkouts_started",
  "purchases",
  "video_3s_plays",
  "thruplays",
  "video_p25",
  "video_p50",
  "video_p75",
  "video_p100",
] as const;
export const AD_MONEY_FIELDS = ["spend", "purchase_value"] as const;

export type AdTotals = Record<(typeof AD_COUNT_FIELDS)[number] | (typeof AD_MONEY_FIELDS)[number], Decimal>;

export function emptyAdTotals(): AdTotals {
  return Object.fromEntries([...AD_COUNT_FIELDS, ...AD_MONEY_FIELDS].map((k) => [k, new Decimal(0)])) as AdTotals;
}

export function addAdTotals(a: AdTotals, row: Partial<Record<keyof AdTotals, DecimalLike>>): AdTotals {
  for (const k of Object.keys(a) as (keyof AdTotals)[]) if (row[k] !== undefined && row[k] !== null) a[k] = a[k].plus(D(row[k]));
  return a;
}

const r = (a: Decimal, b: Decimal) => (b.isZero() ? null : a.div(b));

export interface AdDerived {
  roas: Decimal | null;
  cpa: Decimal | null;
  cpm: Decimal | null;
  ctr: Decimal | null;
  cpc: Decimal | null;
  hook_rate: Decimal | null;
  hold_rate: Decimal | null;
  frequency: Decimal | null;
}

/** Ad metric definitions (Meta-reported). Ratios are computed from summed parts. */
export const AD_METRICS: { id: keyof AdDerived | keyof AdTotals; label: string; format: "money" | "number" | "percent" | "ratio"; formula: string; higherIsBetter: boolean }[] = [
  { id: "spend", label: "Spend", format: "money", formula: "Amount spent", higherIsBetter: false },
  { id: "impressions", label: "Impressions", format: "number", formula: "Times ads were on screen", higherIsBetter: true },
  { id: "reach", label: "Reach", format: "number", formula: "Accounts reached (summed across days; not deduplicated)", higherIsBetter: true },
  { id: "frequency", label: "Frequency", format: "ratio", formula: "Impressions ÷ reach", higherIsBetter: false },
  { id: "clicks", label: "Clicks (all)", format: "number", formula: "All clicks", higherIsBetter: true },
  { id: "link_clicks", label: "Link clicks", format: "number", formula: "Clicks on ad links", higherIsBetter: true },
  { id: "landing_page_views", label: "Landing page views", format: "number", formula: "Landing page views", higherIsBetter: true },
  { id: "adds_to_cart", label: "Adds to cart", format: "number", formula: "Adds to cart", higherIsBetter: true },
  { id: "checkouts_started", label: "Checkouts started", format: "number", formula: "Checkouts initiated", higherIsBetter: true },
  { id: "purchases", label: "Purchases", format: "number", formula: "Purchases (Meta-reported)", higherIsBetter: true },
  { id: "purchase_value", label: "Purchase value", format: "money", formula: "Purchase conversion value (Meta-reported)", higherIsBetter: true },
  { id: "roas", label: "ROAS", format: "ratio", formula: "Purchase value ÷ spend", higherIsBetter: true },
  { id: "cpa", label: "CPA", format: "money", formula: "Spend ÷ purchases", higherIsBetter: false },
  { id: "cpm", label: "CPM", format: "money", formula: "Spend ÷ impressions × 1,000", higherIsBetter: false },
  { id: "ctr", label: "CTR", format: "percent", formula: "Link clicks ÷ impressions", higherIsBetter: true },
  { id: "cpc", label: "CPC", format: "money", formula: "Spend ÷ link clicks", higherIsBetter: false },
  { id: "hook_rate", label: "Hook rate", format: "percent", formula: "3-second plays ÷ impressions", higherIsBetter: true },
  { id: "hold_rate", label: "Hold rate", format: "percent", formula: "ThruPlays ÷ 3-second plays", higherIsBetter: true },
  { id: "video_3s_plays", label: "3-second plays", format: "number", formula: "Video plays of at least 3 seconds", higherIsBetter: true },
  { id: "thruplays", label: "ThruPlays", format: "number", formula: "Plays to completion or 15 s", higherIsBetter: true },
  { id: "video_p25", label: "Video 25%", format: "number", formula: "Watched to 25%", higherIsBetter: true },
  { id: "video_p50", label: "Video 50%", format: "number", formula: "Watched to 50%", higherIsBetter: true },
  { id: "video_p75", label: "Video 75%", format: "number", formula: "Watched to 75%", higherIsBetter: true },
  { id: "video_p100", label: "Video 100%", format: "number", formula: "Watched to 100%", higherIsBetter: true },
];

export function deriveAd(t: AdTotals): AdDerived {
  const cpm = r(t.spend, t.impressions);
  return {
    roas: r(t.purchase_value, t.spend),
    cpa: r(t.spend, t.purchases),
    cpm: cpm === null ? null : cpm.mul(1000),
    ctr: r(t.link_clicks, t.impressions),
    cpc: r(t.spend, t.link_clicks),
    hook_rate: r(t.video_3s_plays, t.impressions),
    hold_rate: r(t.thruplays, t.video_3s_plays),
    frequency: r(t.impressions, t.reach),
  };
}

/**
 * Campaign → store mapping. Rules are checked in priority order; the first whose pattern
 * matches the campaign name (case-insensitive substring, or /regex/) wins. Otherwise the
 * account's default store applies, otherwise the spend is Unassigned (null).
 */
export interface CampaignRule {
  adAccountId: number | null; // null = any account
  campaignId?: string | null; // exact campaign id match
  pattern?: string | null; // name contains, or /regex/i
  storeId: number;
  priority: number;
}

export function mapCampaignToStore(
  campaign: { id: string; name: string; adAccountId: number },
  accountDefaultStoreId: number | null,
  rules: CampaignRule[],
): number | null {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of sorted) {
    if (rule.adAccountId !== null && rule.adAccountId !== campaign.adAccountId) continue;
    if (rule.campaignId && rule.campaignId === campaign.id) return rule.storeId;
    if (rule.pattern) {
      const p = rule.pattern;
      if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
        try {
          const re = new RegExp(p.slice(1, p.lastIndexOf("/")), p.slice(p.lastIndexOf("/") + 1) || "i");
          if (re.test(campaign.name)) return rule.storeId;
        } catch {
          /* invalid regex: ignore rule */
        }
      } else if (campaign.name.toLowerCase().includes(p.toLowerCase())) return rule.storeId;
    }
  }
  return accountDefaultStoreId;
}
