import "server-only";
import { getDb, sql, type Currency, type ResolvedScope } from "@ecom/db";
import { daysBetween, type DateRange } from "@ecom/core/dates";
import { adScopeWhere, adSumSelect, adValues, statusOf, totalsOf, type AdValues } from "@/lib/ads";
import type { AdStatus } from "@/components/ads/StatusPill";
import type { MediaInfo } from "./CreativeMedia";

export type TagRef = {
  id: number;
  name: string;
  kind: string;
};

export interface GroupAd {
  id: number;
  name: string;
  status: AdStatus;
  campaign: string | null;
  adSet: string | null;
  store: string;
  values: AdValues;
}

export interface CreativeGroup {
  key: string;
  name: string;
  headline: string | null;
  primaryText: string | null;
  format: string;
  postUrl: string | null;
  status: AdStatus;
  firstActive: string | null;
  lastActive: string | null;
  daysRunning: number | null;
  values: AdValues;
  media: MediaInfo;
  tags: TagRef[];
  ads: GroupAd[];
}

/** Public path for a file under MEDIA_DIR (served by app/media/[...path]). */
export const mediaUrl = (localPath: string | null) => (localPath ? `/media/${localPath.split("/").map(encodeURIComponent).join("/")}` : null);

/** A group is active when any of its ads is active, else paused when any is paused, else archived. */
function groupStatus(statuses: AdStatus[]): AdStatus {
  if (statuses.includes("active")) return "active";
  if (statuses.includes("paused")) return "paused";
  return "archived";
}

/**
 * Creative groups (creatives.group_key) with delivery in the scope at any time, their summed
 * metrics for the range, first/last day with spend (overall), media, tags and ads.
 */
export async function loadCreativeGroups(scope: ResolvedScope, range: DateRange, currency: Currency, onlyKey?: string): Promise<CreativeGroup[]> {
  const db = getDb();
  const where = adScopeWhere(scope);
  const inRange = sql`m.date between ${range.from} and ${range.to}`;
  const keyFilter = onlyKey ? sql` and m.creative_group_key = ${onlyKey}` : sql``;

  const groupsRes = await db.execute<Record<string, string | null>>(
    sql`select m.creative_group_key as gk, ${adSumSelect(currency, inRange)},
          min(m.date) filter (where m.spend_native > 0)::text as first_active,
          max(m.date) filter (where m.spend_native > 0)::text as last_active
        from daily_ad_metrics m
        where m.creative_group_key is not null and ${where}${keyFilter}
        group by 1`,
  );
  const keys = groupsRes.rows.map((r) => r.gk as string);
  if (!keys.length) return [];
  const keyParam = sql`${sql.param(keys)}::text[]`;

  const [infoRes, mediaRes, adsRes, adMetricRes, tagRes] = await Promise.all([
    db.execute<{ group_key: string; name: string | null; headline: string | null; primary_text: string | null; format: string; post_url: string | null }>(
      sql`select distinct on (group_key) group_key, name, headline, primary_text, format, post_url
          from creatives where group_key = any(${keyParam}) order by group_key, id`,
    ),
    // Best file per kind in each group: a downloaded one if any creative has it.
    db.execute<{ group_key: string; kind: string; status: string; local_path: string | null; mime_type: string | null; error: string | null }>(
      sql`select distinct on (c.group_key, cm.kind) c.group_key, cm.kind, cm.status, cm.local_path, cm.mime_type, cm.error
          from creative_media cm join creatives c on c.id = cm.creative_id
          where c.group_key = any(${keyParam})
          order by c.group_key, cm.kind, (cm.status = 'ok') desc, cm.position, cm.id`,
    ),
    db.execute<{ id: number; name: string; effective_status: string | null; group_key: string; campaign: string | null; ad_set: string | null; store: string | null }>(
      sql`select a.id, a.name, a.effective_status, c.group_key, camp.name as campaign, s.name as ad_set, st.name as store
          from ads a join creatives c on c.id = a.creative_id
          left join campaigns camp on camp.id = a.campaign_id
          left join ad_sets s on s.id = a.ad_set_id
          left join stores st on st.id = camp.store_id
          where c.group_key = any(${keyParam}) order by a.name`,
    ),
    db.execute<Record<string, string | number | null>>(
      sql`select m.ad_id, ${adSumSelect(currency)} from daily_ad_metrics m
          where ${inRange} and ${where} and m.creative_group_key = any(${keyParam}) group by 1`,
    ),
    db.execute<{ group_key: string; id: number; name: string; kind: string }>(
      sql`select ct.group_key, t.id, t.name, t.kind from creative_tags ct join tags t on t.id = ct.tag_id
          where ct.group_key = any(${keyParam}) order by t.kind, t.name`,
    ),
  ]);

  const info = new Map(infoRes.rows.map((r) => [r.group_key, r]));
  const adMetrics = new Map(adMetricRes.rows.map((r) => [Number(r.ad_id), r]));
  const media = new Map<string, MediaInfo>();
  for (const r of mediaRes.rows) {
    const m = media.get(r.group_key) ?? { video: null, image: null, thumbnail: null, status: "pending", error: null };
    const kind = r.kind === "video" ? "video" : r.kind === "image" ? "image" : "thumbnail";
    if (r.status === "ok") m[kind] = mediaUrl(r.local_path);
    // overall status: ok if anything usable, else failed beats pending
    m.status = m.video || m.image || m.thumbnail ? "ok" : r.status === "failed" || m.status === "failed" ? "failed" : "pending";
    if (r.error) m.error = r.error;
    media.set(r.group_key, m);
  }
  const ads = new Map<string, GroupAd[]>();
  for (const r of adsRes.rows) {
    const list = ads.get(r.group_key) ?? [];
    const metric = adMetrics.get(r.id);
    list.push({
      id: r.id,
      name: r.name,
      status: statusOf(r.effective_status),
      campaign: r.campaign,
      adSet: r.ad_set,
      store: r.store ?? "Unassigned",
      values: adValues(totalsOf(metric ?? {})),
    });
    ads.set(r.group_key, list);
  }
  const tags = new Map<string, TagRef[]>();
  for (const r of tagRes.rows) tags.set(r.group_key, [...(tags.get(r.group_key) ?? []), { id: r.id, name: r.name, kind: r.kind }]);

  return groupsRes.rows.map((r) => {
    const key = r.gk as string;
    const i = info.get(key);
    const groupAds = (ads.get(key) ?? []).sort((a, b) => (b.values.spend ?? 0) - (a.values.spend ?? 0));
    return {
      key,
      name: i?.name || key,
      headline: i?.headline ?? null,
      primaryText: i?.primary_text ?? null,
      format: i?.format ?? "image",
      postUrl: i?.post_url ?? null,
      status: groupStatus(groupAds.map((a) => a.status)),
      firstActive: r.first_active,
      lastActive: r.last_active,
      daysRunning: r.first_active && r.last_active ? daysBetween(r.first_active, r.last_active) + 1 : null,
      values: adValues(totalsOf(r)),
      media: media.get(key) ?? { video: null, image: null, thumbnail: null, status: "pending", error: null },
      tags: tags.get(key) ?? [],
      ads: groupAds,
    };
  });
}

export async function allTags(): Promise<TagRef[]> {
  const res = await getDb().execute<TagRef>(sql`select id, name, kind from tags order by kind, name`);
  return res.rows;
}
