/** DEMO DATA ONLY: synthetic Meta campaigns, creatives and daily insights for seed-demo. */
import { addDays, eachDay } from "@ecom/core/dates";
import { adAccounts, adSets, ads, campaigns, creatives, creativeMedia, type Db } from "@ecom/db";
import type { meta } from "@ecom/connectors";
import { remapAccount } from "./meta";

type Account = typeof adAccounts.$inferSelect;

const ANGLES = ["Before/after", "Dermatologist", "UGC unboxing", "Routine", "Problem/solution", "Testimonial"];

export async function syncStructureFromFixtures(db: Db, accounts: Account[], start: string, today: string, rnd: () => number) {
  const insights = new Map<string, meta.InsightRow[]>();
  let adN = 0;
  for (const acct of accounts) {
    const isB = acct.externalId.endsWith("2");
    const campaignNames = isB ? ["BG – Serum – ABO", "BG – Bundle – CBO", "Retargeting – mixed"] : ["US – Serum – ABO test", "US – Bundle – CBO", "US – Broad scale"];
    const rows: meta.InsightRow[] = [];
    for (const [ci, cname] of campaignNames.entries()) {
      const cExt = `${acct.externalId.slice(4)}${ci}`;
      const [c] = await db.insert(campaigns).values({ adAccountId: acct.id, externalId: cExt, name: cname, status: "ACTIVE", effectiveStatus: ci === 2 && !isB ? "PAUSED" : "ACTIVE", objective: "OUTCOME_SALES" }).returning();
      const [s] = await db.insert(adSets).values({ adAccountId: acct.id, campaignId: c.id, externalId: `${cExt}1`, name: `${cname} · Adset 1`, status: "ACTIVE", effectiveStatus: "ACTIVE" }).returning();
      for (let k = 0; k < 4; k++) {
        adN++;
        const isVideo = k % 2 === 0;
        // creative 0 of each account is reused by two ads (grouping demo)
        const groupKey = k === 3 ? `video:shared-${acct.id}` : isVideo ? `video:v${adN}` : `image:h${adN}`;
        const angle = ANGLES[(adN + ci) % ANGLES.length];
        const [cr] = await db
          .insert(creatives)
          .values({
            adAccountId: acct.id,
            externalId: `cr${adN}`,
            groupKey,
            name: `${angle} ${isVideo ? "video" : "image"} #${adN}`,
            format: k === 1 && ci === 1 ? "carousel" : isVideo || k === 3 ? "video" : "image",
            primaryText: `${angle}: the serum that made my skin glow in 14 days ✨`,
            headline: ci === 1 ? "Bundle & save 25%" : "Vitamin C Serum",
            callToAction: "SHOP_NOW",
            destinationUrl: "https://example.com/products/serum",
            videoId: isVideo ? `v${adN}` : null,
          })
          .onConflictDoNothing()
          .returning();
        if (cr) await db.insert(creativeMedia).values({ creativeId: cr.id, kind: "thumbnail", status: "failed", error: "demo data: no media" });
        const ageStart = addDays(start, Math.floor(rnd() * 90));
        const paused = rnd() < 0.3;
        const ageEnd = paused ? addDays(ageStart, 20 + Math.floor(rnd() * 30)) : today;
        const [ad] = await db
          .insert(ads)
          .values({
            adAccountId: acct.id,
            campaignId: c.id,
            adSetId: s.id,
            creativeId: cr?.id ?? null,
            externalId: `ad${adN}`,
            name: `${angle} – ${isVideo ? "VID" : "IMG"} ${adN}`,
            status: paused ? "PAUSED" : "ACTIVE",
            effectiveStatus: paused ? (rnd() < 0.5 ? "ARCHIVED" : "PAUSED") : "ACTIVE",
            createdTime: new Date(ageStart + "T10:00:00Z"),
          })
          .returning();
        const quality = 0.6 + rnd() * 1.4;
        for (const d of eachDay(ageStart, ageEnd > today ? today : ageEnd)) {
          const spend = +(8 + rnd() * 30).toFixed(2);
          const impressions = Math.round(spend * (55 + rnd() * 40));
          const plays = isVideo ? Math.round(impressions * (0.22 + rnd() * 0.15) * quality) : 0;
          const linkClicks = Math.round(impressions * (0.009 + rnd() * 0.01) * quality);
          const purchases = Math.round(linkClicks * (0.025 + rnd() * 0.03) * quality);
          rows.push({
            adId: ad.externalId,
            campaignId: c.externalId,
            adSetId: s.externalId,
            date: d,
            currency: acct.currency,
            attributionSetting: "7d_click_1d_view",
            spend: spend.toFixed(2),
            impressions,
            reach: Math.round(impressions * 0.8),
            frequency: "1.25",
            clicks: Math.round(linkClicks * 1.6),
            linkClicks,
            landingPageViews: Math.round(linkClicks * 0.8),
            addsToCart: Math.round(linkClicks * 0.12),
            checkoutsStarted: Math.round(linkClicks * 0.06),
            purchases,
            purchaseValue: (purchases * (isB ? 42 : 52) * (0.9 + rnd() * 0.3)).toFixed(2),
            video3sPlays: plays,
            thruplays: Math.round(plays * (0.18 + rnd() * 0.12)),
            videoP25: Math.round(plays * 0.5),
            videoP50: Math.round(plays * 0.3),
            videoP75: Math.round(plays * 0.18),
            videoP100: Math.round(plays * 0.1),
            raw: {},
          });
        }
      }
    }
    insights.set(acct.externalId, rows);
    await remapAccount(db, acct.id);
  }
  return { insights };
}
