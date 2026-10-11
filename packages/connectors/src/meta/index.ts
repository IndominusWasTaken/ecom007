import { API_VERSIONS } from "@ecom/core/config";
import { fetchJson, sleep } from "../http";
import { ConnectorError, type Connector, type Health } from "../types";

/**
 * Meta Marketing API (Graph API version in @ecom/core/config). System User token with ads_read.
 * We never request the removed 7d_view / 28d_view windows: insights use the ad account's
 * unified attribution setting, and the setting is stored with every row.
 */
export interface MetaCtx {
  token: string;
  version?: string;
}

const base = (ctx: MetaCtx) => `https://graph.facebook.com/${ctx.version ?? API_VERSIONS.metaGraph}`;

const ALL_STATUSES = ["ACTIVE", "PAUSED", "ARCHIVED", "DELETED", "IN_PROCESS", "WITH_ISSUES", "CAMPAIGN_PAUSED", "ADSET_PAUSED", "PENDING_REVIEW", "DISAPPROVED", "PREAPPROVED", "PENDING_BILLING_INFO"];

function metaRetry(status: number, body: unknown): number | null {
  // Rate limiting: codes 4, 17, 32, 613, 80000-80014
  const code = (body as { error?: { code?: number } })?.error?.code;
  if (status === 400 && code !== undefined && [4, 17, 32, 613].concat(Array.from({ length: 15 }, (_, i) => 80000 + i)).includes(code)) return 60_000;
  return null;
}

async function get<T>(ctx: MetaCtx, path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${base(ctx)}/${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return fetchJson<T>(url.toString(), { headers: { Authorization: `Bearer ${ctx.token}` } }, { shouldRetry: metaRetry });
}

async function post<T>(ctx: MetaCtx, path: string, params: Record<string, string | number>): Promise<T> {
  const body = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  return fetchJson<T>(`${base(ctx)}/${path}`, { method: "POST", headers: { Authorization: `Bearer ${ctx.token}` }, body }, { shouldRetry: metaRetry });
}

async function* paged<T>(ctx: MetaCtx, path: string, params: Record<string, string | number | undefined>): AsyncGenerator<T[]> {
  let res = await get<{ data: T[]; paging?: { next?: string } }>(ctx, path, params);
  for (;;) {
    yield res.data ?? [];
    if (!res.paging?.next) return;
    res = await get(ctx, res.paging.next);
  }
}

// ---------------- accounts ----------------
export interface MetaAdAccount {
  id: string; // act_123
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export async function listAdAccounts(ctx: MetaCtx): Promise<MetaAdAccount[]> {
  const out: MetaAdAccount[] = [];
  for await (const page of paged<MetaAdAccount>(ctx, "me/adaccounts", { fields: "id,name,currency,timezone_name,account_status", limit: 100 })) out.push(...page);
  return out;
}

// ---------------- structure ----------------
export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  objective?: string;
  created_time?: string;
}
export interface MetaAdSet {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  campaign_id: string;
}
export interface MetaCreative {
  id: string;
  name?: string;
  object_type?: string;
  thumbnail_url?: string;
  image_url?: string;
  image_hash?: string;
  video_id?: string;
  body?: string;
  title?: string;
  call_to_action_type?: string;
  link_url?: string;
  effective_object_story_id?: string;
  instagram_permalink_url?: string;
  object_story_spec?: any;
  asset_feed_spec?: any;
}
export interface MetaAd {
  id: string;
  name: string;
  status: string;
  effective_status: string;
  created_time?: string;
  campaign_id: string;
  adset_id: string;
  creative?: MetaCreative;
  preview_shareable_link?: string;
}

const statusFilter = JSON.stringify([{ field: "effective_status", operator: "IN", value: ALL_STATUSES }]);

export async function listCampaigns(ctx: MetaCtx, act: string): Promise<MetaCampaign[]> {
  const out: MetaCampaign[] = [];
  for await (const p of paged<MetaCampaign>(ctx, `${act}/campaigns`, { fields: "id,name,status,effective_status,objective,created_time", filtering: statusFilter, limit: 500 })) out.push(...p);
  return out;
}

export async function listAdSets(ctx: MetaCtx, act: string): Promise<MetaAdSet[]> {
  const out: MetaAdSet[] = [];
  for await (const p of paged<MetaAdSet>(ctx, `${act}/adsets`, { fields: "id,name,status,effective_status,campaign_id", filtering: statusFilter, limit: 500 })) out.push(...p);
  return out;
}

const CREATIVE_FIELDS =
  "id,name,object_type,thumbnail_url,image_url,image_hash,video_id,body,title,call_to_action_type,link_url,effective_object_story_id,instagram_permalink_url,object_story_spec,asset_feed_spec";

export async function listAds(ctx: MetaCtx, act: string): Promise<MetaAd[]> {
  const out: MetaAd[] = [];
  for await (const p of paged<MetaAd>(ctx, `${act}/ads`, {
    fields: `id,name,status,effective_status,created_time,campaign_id,adset_id,preview_shareable_link,creative{${CREATIVE_FIELDS}}`,
    filtering: statusFilter,
    thumbnail_width: 600,
    thumbnail_height: 600,
    limit: 200,
  }))
    out.push(...p);
  return out;
}

export async function videoSource(ctx: MetaCtx, videoId: string): Promise<{ source?: string; picture?: string; permalink_url?: string }> {
  return get(ctx, videoId, { fields: "source,picture,permalink_url" });
}

/** Normalised creative: format, copy, media and a grouping key shared by ads that reuse it. */
export function describeCreative(c: MetaCreative | undefined) {
  if (!c) return null;
  const spec = c.object_story_spec ?? {};
  const link = spec.link_data ?? {};
  const video = spec.video_data ?? {};
  const isCarousel = Array.isArray(link.child_attachments) && link.child_attachments.length > 1;
  const videoId = c.video_id ?? video.video_id ?? c.asset_feed_spec?.videos?.[0]?.video_id ?? null;
  const imageHash = c.image_hash ?? link.image_hash ?? c.asset_feed_spec?.images?.[0]?.hash ?? null;
  const format = isCarousel ? "carousel" : videoId ? "video" : c.object_type === "SHARE" && !imageHash && !c.image_url ? "catalog" : "image";
  const carouselImages: string[] = isCarousel ? link.child_attachments.map((a: any) => a.picture).filter(Boolean) : [];
  const postId = c.effective_object_story_id;
  return {
    externalId: c.id,
    name: c.name ?? null,
    format,
    groupKey: videoId ? `video:${videoId}` : imageHash ? `image:${imageHash}` : `creative:${c.id}`,
    primaryText: c.body ?? link.message ?? video.message ?? c.asset_feed_spec?.bodies?.[0]?.text ?? null,
    headline: c.title ?? link.name ?? video.title ?? c.asset_feed_spec?.titles?.[0]?.text ?? null,
    description: link.description ?? video.link_description ?? null,
    callToAction: c.call_to_action_type ?? link.call_to_action?.type ?? video.call_to_action?.type ?? null,
    destinationUrl: c.link_url ?? link.link ?? video.call_to_action?.value?.link ?? null,
    videoId,
    imageHash,
    imageUrl: c.image_url ?? link.picture ?? null,
    thumbnailUrl: c.thumbnail_url ?? video.image_url ?? null,
    carouselImages,
    postUrl: c.instagram_permalink_url ?? (postId ? `https://www.facebook.com/${postId.replace("_", "/posts/")}` : null),
  };
}

// ---------------- insights ----------------
export const INSIGHT_FIELDS = [
  "ad_id",
  "ad_name",
  "adset_id",
  "campaign_id",
  "date_start",
  "date_stop",
  "account_currency",
  "attribution_setting",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
].join(",");

type ActionList = { action_type: string; value: string }[] | undefined;

/** First present action type wins, so omni_ and pixel variants are not double counted. */
function pick(list: ActionList, types: string[]): number {
  if (!list) return 0;
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    if (hit) return Number(hit.value) || 0;
  }
  return 0;
}

export interface InsightRow {
  adId: string;
  campaignId: string;
  adSetId: string;
  date: string;
  currency: string;
  attributionSetting: string | null;
  spend: string;
  impressions: number;
  reach: number;
  frequency: string | null;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  addsToCart: number;
  checkoutsStarted: number;
  purchases: number;
  purchaseValue: string;
  video3sPlays: number;
  thruplays: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP100: number;
  raw: unknown;
}

const PURCHASE = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
const ATC = ["omni_add_to_cart", "add_to_cart", "offsite_conversion.fb_pixel_add_to_cart"];
const IC = ["omni_initiated_checkout", "initiate_checkout", "offsite_conversion.fb_pixel_initiate_checkout"];

export function normalizeInsight(r: any): InsightRow {
  const first = (l: ActionList) => (l && l.length ? Number(l[0].value) || 0 : 0);
  return {
    adId: r.ad_id,
    campaignId: r.campaign_id,
    adSetId: r.adset_id,
    date: r.date_start,
    currency: r.account_currency,
    attributionSetting: r.attribution_setting ?? null,
    spend: r.spend ?? "0",
    impressions: Number(r.impressions ?? 0),
    reach: Number(r.reach ?? 0),
    frequency: r.frequency ?? null,
    clicks: Number(r.clicks ?? 0),
    linkClicks: Number(r.inline_link_clicks ?? pick(r.actions, ["link_click"])),
    landingPageViews: pick(r.actions, ["landing_page_view", "omni_landing_page_view"]),
    addsToCart: pick(r.actions, ATC),
    checkoutsStarted: pick(r.actions, IC),
    purchases: pick(r.actions, PURCHASE),
    purchaseValue: String(pick(r.action_values, PURCHASE)),
    video3sPlays: pick(r.actions, ["video_view"]),
    thruplays: first(r.video_thruplay_watched_actions),
    videoP25: first(r.video_p25_watched_actions),
    videoP50: first(r.video_p50_watched_actions),
    videoP75: first(r.video_p75_watched_actions),
    videoP100: first(r.video_p100_watched_actions),
    raw: r,
  };
}

const insightParams = (since: string, until: string) => ({
  level: "ad",
  time_increment: 1,
  time_range: JSON.stringify({ since, until }),
  fields: INSIGHT_FIELDS,
  use_unified_attribution_setting: "true",
  filtering: JSON.stringify([{ field: "ad.effective_status", operator: "IN", value: ALL_STATUSES }]),
  limit: 500,
});

/** Synchronous insights, for short ranges (today, a few days). */
export async function insightsSync(ctx: MetaCtx, act: string, since: string, until: string): Promise<InsightRow[]> {
  const out: InsightRow[] = [];
  for await (const p of paged<any>(ctx, `${act}/insights`, insightParams(since, until))) out.push(...p.map(normalizeInsight));
  return out;
}

/** Asynchronous report job, for history (one month at a time) and the nightly 28-day re-pull. */
export async function insightsAsync(ctx: MetaCtx, act: string, since: string, until: string, onProgress?: (m: string) => void): Promise<InsightRow[]> {
  const job = await post<{ report_run_id: string }>(ctx, `${act}/insights`, insightParams(since, until) as Record<string, string | number>);
  const id = job.report_run_id;
  for (let i = 0; i < 360; i++) {
    const s = await get<{ async_status: string; async_percent_completion: number }>(ctx, id, { fields: "async_status,async_percent_completion" });
    onProgress?.(`Meta report ${since}..${until}: ${s.async_status} ${s.async_percent_completion}%`);
    if (s.async_status === "Job Completed") break;
    if (s.async_status === "Job Failed" || s.async_status === "Job Skipped") throw new ConnectorError(`Meta report job ${s.async_status}`, 500, true);
    await sleep(Math.min(2000 + i * 1000, 15_000));
  }
  const out: InsightRow[] = [];
  for await (const p of paged<any>(ctx, `${id}/insights`, { limit: 500 })) out.push(...p.map(normalizeInsight));
  return out;
}

export interface MetaSink {
  insights(adAccountExternalId: string, rows: InsightRow[]): Promise<number>;
}

export const metaConnector: Connector<MetaCtx & { account: string }, MetaSink> = {
  platform: "meta",
  label: "Meta Ads",
  available: true,
  async loadHistory(ctx, sink, opts) {
    // One month per call. cursor = first day of the next month to load, so a restart resumes there.
    const today = new Date().toISOString().slice(0, 10);
    const start = opts.cursor ?? opts.since.slice(0, 8) + "01";
    if (start > today) return { cursor: null, done: true, rows: 0 };
    const from = start < opts.since ? opts.since : start;
    const end = minDate(endOfMonth(start), today);
    const data = await insightsAsync(ctx, ctx.account, from, end, opts.onProgress);
    const rows = await sink.insights(ctx.account, data);
    opts.onProgress?.(`Loaded ${start.slice(0, 7)}: ${data.length} rows`);
    const next = nextMonth(start);
    return next <= today ? { cursor: next, done: false, rows } : { cursor: null, done: true, rows };
  },
  async syncSince(ctx, sink) {
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const data = await insightsSync(ctx, ctx.account, yesterday, today);
    return { cursor: today, rows: await sink.insights(ctx.account, data) };
  },
  async checkHealth(ctx): Promise<Health> {
    try {
      const me = await get<{ id: string; name: string }>(ctx, "me", { fields: "id,name" });
      const accounts = await listAdAccounts(ctx);
      return { ok: true, message: `Token for ${me.name}; ${accounts.length} ad account(s) visible`, detail: { accounts } };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  },
};

function nextMonth(d: string): string {
  const [y, m] = d.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}
function endOfMonth(d: string): string {
  const n = nextMonth(d);
  return new Date(Date.parse(n + "T00:00:00Z") - 86_400_000).toISOString().slice(0, 10);
}
const minDate = (a: string, b: string) => (a < b ? a : b);
export const _dates = { nextMonth, endOfMonth };
