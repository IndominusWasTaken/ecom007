import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { meta } from "@ecom/connectors";
import { mapCampaignToStore } from "@ecom/metrics";
import {
  adAccounts,
  adInsightsDaily,
  adSets,
  ads,
  and,
  campaigns,
  campaignStoreRules,
  creativeMedia,
  creatives,
  dailyAdMetrics,
  eq,
  excludedSet,
  getDb,
  loadFx,
  markDirty,
  sql,
  type Db,
} from "@ecom/db";
import { log } from "./log";

type Account = typeof adAccounts.$inferSelect;

export const MEDIA_DIR = resolve(process.env.MEDIA_DIR ?? "./data/media");

/** Upsert every ad account the token can see. Mapping (store_id) is kept. */
export async function discoverAccounts(db: Db, connectionId: number, token: string) {
  const list = await meta.listAdAccounts({ token });
  for (const a of list) {
    await db
      .insert(adAccounts)
      .values({ platform: "meta", connectionId, externalId: a.id, name: a.name, currency: a.currency, timeZone: a.timezone_name, accountStatus: a.account_status, raw: a as object })
      .onConflictDoUpdate({
        target: [adAccounts.platform, adAccounts.externalId],
        set: { connectionId, name: a.name, currency: a.currency, timeZone: a.timezone_name, accountStatus: a.account_status, raw: a as object, updatedAt: new Date() },
      });
  }
  return list.length;
}

/** Campaigns, ad sets, ads and creatives, including paused and archived. */
export async function syncStructure(db: Db, account: Account, token: string) {
  const ctx = { token };
  const [cs, as, adList] = await Promise.all([meta.listCampaigns(ctx, account.externalId), meta.listAdSets(ctx, account.externalId), meta.listAds(ctx, account.externalId)]);
  let n = 0;
  const campaignIds = new Map<string, number>();
  for (const c of cs) {
    const [row] = await db
      .insert(campaigns)
      .values({ adAccountId: account.id, externalId: c.id, name: c.name, status: c.status, effectiveStatus: c.effective_status, objective: c.objective, createdTime: c.created_time ? new Date(c.created_time) : null, raw: c as object })
      .onConflictDoUpdate({
        target: [campaigns.adAccountId, campaigns.externalId],
        set: { name: c.name, status: c.status, effectiveStatus: c.effective_status, objective: c.objective, raw: c as object, syncedAt: new Date() },
      })
      .returning({ id: campaigns.id });
    campaignIds.set(c.id, row.id);
    n++;
  }
  const adSetIds = new Map<string, number>();
  for (const s of as) {
    const [row] = await db
      .insert(adSets)
      .values({ adAccountId: account.id, campaignId: campaignIds.get(s.campaign_id) ?? null, externalId: s.id, name: s.name, status: s.status, effectiveStatus: s.effective_status, raw: s as object })
      .onConflictDoUpdate({
        target: [adSets.adAccountId, adSets.externalId],
        set: { campaignId: campaignIds.get(s.campaign_id) ?? null, name: s.name, status: s.status, effectiveStatus: s.effective_status, raw: s as object, syncedAt: new Date() },
      })
      .returning({ id: adSets.id });
    adSetIds.set(s.id, row.id);
    n++;
  }
  for (const a of adList) {
    const d = meta.describeCreative(a.creative);
    let creativeId: number | null = null;
    if (d) {
      const values = {
        adAccountId: account.id,
        externalId: d.externalId,
        groupKey: d.groupKey,
        name: d.name,
        format: d.format,
        primaryText: d.primaryText,
        headline: d.headline,
        description: d.description,
        callToAction: d.callToAction,
        destinationUrl: d.destinationUrl,
        videoId: d.videoId,
        imageHash: d.imageHash,
        thumbnailUrl: d.thumbnailUrl,
        postUrl: d.postUrl,
        previewUrl: a.preview_shareable_link ?? null,
        raw: a.creative as object,
      };
      const { notes: _n, ...set } = { ...values, notes: undefined };
      const [row] = await db
        .insert(creatives)
        .values(values)
        .onConflictDoUpdate({ target: [creatives.adAccountId, creatives.externalId], set: { ...set, syncedAt: new Date() } })
        .returning({ id: creatives.id });
      creativeId = row.id;
      // queue media: thumbnail, full image or video, carousel images
      const media: { kind: string; url: string | null; position: number }[] = [
        { kind: "thumbnail", url: d.thumbnailUrl, position: 0 },
        ...(d.format === "image" ? [{ kind: "image", url: d.imageUrl, position: 0 }] : []),
        ...(d.format === "video" ? [{ kind: "video", url: null, position: 0 }] : []),
        ...d.carouselImages.map((u, i) => ({ kind: "image", url: u, position: i })),
      ];
      for (const m of media) {
        await db
          .insert(creativeMedia)
          .values({ creativeId, kind: m.kind, sourceUrl: m.url, position: m.position })
          .onConflictDoNothing();
      }
    }
    await db
      .insert(ads)
      .values({
        adAccountId: account.id,
        campaignId: campaignIds.get(a.campaign_id) ?? null,
        adSetId: adSetIds.get(a.adset_id) ?? null,
        creativeId,
        externalId: a.id,
        name: a.name,
        status: a.status,
        effectiveStatus: a.effective_status,
        createdTime: a.created_time ? new Date(a.created_time) : null,
        raw: { ...a, creative: undefined } as object,
      })
      .onConflictDoUpdate({
        target: [ads.adAccountId, ads.externalId],
        set: {
          campaignId: campaignIds.get(a.campaign_id) ?? null,
          adSetId: adSetIds.get(a.adset_id) ?? null,
          creativeId,
          name: a.name,
          status: a.status,
          effectiveStatus: a.effective_status,
          syncedAt: new Date(),
        },
      });
    n++;
  }
  await remapAccount(db, account.id);
  return n;
}

/** Download media files that are still pending. Meta's CDN URLs expire, so this runs soon after discovery. */
export async function downloadPendingMedia(db: Db, token: string, limit = 50) {
  const pending = await db.execute<any>(sql`select m.id, m.kind, m.source_url, m.position, c.id creative_id, c.video_id, c.ad_account_id
    from creative_media m join creatives c on c.id = m.creative_id
    where m.status = 'pending' or (m.status = 'failed' and m.fetched_at < now() - interval '1 day')
    order by m.id limit ${limit}`);
  let ok = 0;
  for (const m of pending.rows) {
    try {
      let url: string | null = m.source_url;
      if (m.kind === "video") {
        if (!m.video_id) throw new Error("no video id");
        const v = await meta.videoSource({ token }, m.video_id);
        url = v.source ?? null;
        if (!url) throw new Error("video source not available to this token (kept thumbnail and post link)");
      }
      if (!url) throw new Error("no media url");
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get("content-type") ?? (m.kind === "video" ? "video/mp4" : "image/jpeg");
      const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : type.includes("mp4") || m.kind === "video" ? "mp4" : "jpg";
      const dir = join(MEDIA_DIR, String(m.ad_account_id));
      await mkdir(dir, { recursive: true });
      const rel = join(String(m.ad_account_id), `${m.creative_id}-${m.kind}-${m.position}.${ext}`);
      await writeFile(join(MEDIA_DIR, rel), buf);
      await db.update(creativeMedia).set({ status: "ok", localPath: rel.replace(/\\/g, "/"), mimeType: type, bytes: buf.length, fetchedAt: new Date(), error: null, sourceUrl: url }).where(eq(creativeMedia.id, m.id));
      ok++;
    } catch (e) {
      await db.update(creativeMedia).set({ status: "failed", error: (e as Error).message.slice(0, 500), fetchedAt: new Date() }).where(eq(creativeMedia.id, m.id));
    }
  }
  return ok;
}

/** Store raw insights, then derive daily_ad_metrics (store mapping + USD/EUR). */
export function insightsSink(db: Db = getDb()): meta.MetaSink {
  return {
    async insights(actExternalId, rows) {
      if (!rows.length) return 0;
      const [account] = await db.select().from(adAccounts).where(and(eq(adAccounts.platform, "meta"), eq(adAccounts.externalId, actExternalId)));
      if (!account) throw new Error(`Unknown ad account ${actExternalId}`);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          adAccountId: account.id,
          adExternalId: r.adId,
          date: r.date,
          currency: r.currency ?? account.currency,
          attributionSetting: r.attributionSetting,
          spend: r.spend,
          impressions: r.impressions,
          reach: r.reach,
          frequency: r.frequency,
          clicks: r.clicks,
          linkClicks: r.linkClicks,
          landingPageViews: r.landingPageViews,
          addsToCart: r.addsToCart,
          checkoutsStarted: r.checkoutsStarted,
          purchases: String(r.purchases),
          purchaseValue: r.purchaseValue,
          video3sPlays: r.video3sPlays,
          thruplays: r.thruplays,
          videoP25: r.videoP25,
          videoP50: r.videoP50,
          videoP75: r.videoP75,
          videoP100: r.videoP100,
          raw: r.raw as object,
          syncedAt: new Date(),
        }));
        await db
          .insert(adInsightsDaily)
          .values(chunk)
          .onConflictDoUpdate({
            target: [adInsightsDaily.adAccountId, adInsightsDaily.adExternalId, adInsightsDaily.date],
            set: excludedSet(adInsightsDaily, ["adAccountId", "adExternalId", "date"]),
          });
      }
      if (rows.some((r) => r.attributionSetting)) {
        await db.update(adAccounts).set({ attributionSetting: rows.find((r) => r.attributionSetting)!.attributionSetting }).where(eq(adAccounts.id, account.id));
      }
      const dates = [...new Set(rows.map((r) => r.date))];
      await deriveAdMetrics(db, account.id, dates);
      return rows.length;
    },
  };
}

/**
 * Rebuild daily_ad_metrics for an account and dates: resolve each ad's store through its
 * campaign (account default or rule), convert spend at the day's ECB rate, and mark the
 * affected store-days dirty (both the old and the new store, if the mapping moved).
 */
export async function deriveAdMetrics(db: Db, adAccountId: number, dates: string[]) {
  if (!dates.length) return;
  const fx = await loadFx(db);
  const before = await db.execute<any>(sql`select distinct store_id, date::text d from daily_ad_metrics where ad_account_id = ${adAccountId} and date = any(${sql.param(dates)}::date[]) and store_id is not null`);
  const rows = await db.execute<any>(sql`
    select i.*, i.date::text d, a.id ad_id, a.ad_set_id, a.campaign_id, c.store_id, cr.group_key
    from ad_insights_daily i
    left join ads a on a.ad_account_id = i.ad_account_id and a.external_id = i.ad_external_id
    left join campaigns c on c.id = a.campaign_id
    left join creatives cr on cr.id = a.creative_id
    where i.ad_account_id = ${adAccountId} and i.date = any(${sql.param(dates)}::date[])`);
  const [acct] = await db.select().from(adAccounts).where(eq(adAccounts.id, adAccountId));
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from daily_ad_metrics where ad_account_id = ${adAccountId} and date = any(${sql.param(dates)}::date[])`);
    const values = rows.rows.map((r: any) => {
      const storeId = r.store_id ?? (r.campaign_id ? null : acct?.storeId ?? null);
      return {
        adAccountId,
        adExternalId: r.ad_external_id,
        date: r.d,
        storeId,
        campaignId: r.campaign_id,
        adSetId: r.ad_set_id,
        adId: r.ad_id,
        creativeGroupKey: r.group_key,
        spendNative: r.spend,
        spendUsd: fx.convert(r.spend, r.currency, "USD", r.d).toFixed(6),
        spendEur: fx.convert(r.spend, r.currency, "EUR", r.d).toFixed(6),
        purchaseValueNative: r.purchase_value,
        purchaseValueUsd: fx.convert(r.purchase_value, r.currency, "USD", r.d).toFixed(6),
        purchaseValueEur: fx.convert(r.purchase_value, r.currency, "EUR", r.d).toFixed(6),
        impressions: r.impressions,
        reach: r.reach,
        clicks: r.clicks,
        linkClicks: r.link_clicks,
        landingPageViews: r.landing_page_views,
        addsToCart: r.adds_to_cart,
        checkoutsStarted: r.checkouts_started,
        purchases: r.purchases,
        video3sPlays: r.video_3s_plays,
        thruplays: r.thruplays,
        videoP25: r.video_p25,
        videoP50: r.video_p50,
        videoP75: r.video_p75,
        videoP100: r.video_p100,
      };
    });
    for (let i = 0; i < values.length; i += 500) await tx.insert(dailyAdMetrics).values(values.slice(i, i + 500));
  });
  const after = await db.execute<any>(sql`select distinct store_id, date::text d from daily_ad_metrics where ad_account_id = ${adAccountId} and date = any(${sql.param(dates)}::date[]) and store_id is not null`);
  const byStore = new Map<number, Set<string>>();
  for (const r of [...before.rows, ...after.rows]) {
    const s = byStore.get(Number(r.store_id)) ?? new Set();
    s.add(r.d);
    byStore.set(Number(r.store_id), s);
  }
  for (const [sid, ds] of byStore) await markDirty(db, sid, ds);
}

/** Re-resolve campaign → store for an account (after mapping or rule changes) and re-derive its metrics. */
export async function remapAccount(db: Db, adAccountId: number) {
  const [acct] = await db.select().from(adAccounts).where(eq(adAccounts.id, adAccountId));
  if (!acct) return;
  const rules = await db.select().from(campaignStoreRules);
  const cs = await db.select().from(campaigns).where(eq(campaigns.adAccountId, adAccountId));
  let changed = false;
  for (const c of cs) {
    const storeId = acct.enabled
      ? mapCampaignToStore(
          { id: c.externalId, name: c.name, adAccountId },
          acct.storeId,
          rules.map((r) => ({ adAccountId: r.adAccountId, campaignId: r.campaignExternalId, pattern: r.pattern, storeId: r.storeId, priority: r.priority })),
        )
      : null;
    if (storeId !== c.storeId) {
      await db.update(campaigns).set({ storeId }).where(eq(campaigns.id, c.id));
      changed = true;
    }
  }
  if (changed) {
    const ds = await db.execute<any>(sql`select distinct date::text d from ad_insights_daily where ad_account_id = ${adAccountId}`);
    const dates = ds.rows.map((r: any) => r.d);
    for (let i = 0; i < dates.length; i += 60) await deriveAdMetrics(db, adAccountId, dates.slice(i, i + 60));
    log.info("remapped ad account", { account: acct.name, days: dates.length });
  }
}
