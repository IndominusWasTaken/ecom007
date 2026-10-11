import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { METRICS, SECTION_LABELS, DEFAULT_PINS, AD_METRICS } from "../src/index";

const sections = Object.keys(SECTION_LABELS) as (keyof typeof SECTION_LABELS)[];
let md = `# Metrics\n\n> Generated from \`packages/metrics/src/registry.ts\` by \`pnpm metrics:doc\`. Do not edit by hand.\n\n`;
md += `Rules that apply to every metric:\n\n`;
md += `- Sales count on the order date; refunds count on the refund date (store time zone).\n`;
md += `- A customer is new or returning **per store**.\n`;
md += `- Sum metrics are stored per store per day; rates and ratios are recomputed from summed parts for each scope and range, never averaged.\n`;
md += `- Sales tax / VAT is excluded from revenue in every profit metric. Net profit is before income tax.\n`;
md += `- The All scope equals the sum of the stores for every sum metric (plus the Unassigned ad-spend bucket, which belongs to no store).\n\n`;
md += `Default pins: ${DEFAULT_PINS.map((p) => "`" + p + "`").join(", ")}\n\n`;
for (const s of sections) {
  const rows = METRICS.filter((m) => m.section === s);
  if (!rows.length) continue;
  md += `## ${SECTION_LABELS[s]}\n\n| ID | Label | Formula | Format | Source | Kind |\n|---|---|---|---|---|---|\n`;
  for (const m of rows) md += `| \`${m.id}\` | ${m.label}${m.platformReported ? " *(Meta-reported)*" : ""} | ${m.formula} | ${m.format} | ${m.source} | ${m.kind} |\n`;
  md += `\n`;
}
md += `## Ad metrics (per account, campaign, ad set, ad and day — Meta-reported)\n\n| ID | Label | Formula | Format |\n|---|---|---|---|\n`;
for (const m of AD_METRICS) md += `| \`${m.id}\` | ${m.label} | ${m.formula} | ${m.format} |\n`;
const out = fileURLToPath(new URL("../../../docs/METRICS.md", import.meta.url));
writeFileSync(out, md);
console.log(`Wrote ${out}`);
