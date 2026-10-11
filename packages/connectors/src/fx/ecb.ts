import { XMLParser } from "fast-xml-parser";
import { fetchJson } from "../http";

/**
 * European Central Bank daily reference rates (units per 1 EUR), published around
 * 16:00 CET on TARGET working days. History file covers 1999 to today.
 */
export const ECB_DAILY = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
export const ECB_90D = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml";
export const ECB_HIST = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";

export interface EcbRate {
  date: string;
  currency: string;
  perEur: string;
}

export function parseEcbXml(xml: string, currencies?: string[]): EcbRate[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
  const doc = parser.parse(xml);
  const root = doc["gesmes:Envelope"]?.Cube?.Cube;
  const days = Array.isArray(root) ? root : root ? [root] : [];
  const out: EcbRate[] = [];
  for (const d of days) {
    const cubes = Array.isArray(d.Cube) ? d.Cube : d.Cube ? [d.Cube] : [];
    for (const c of cubes) {
      if (currencies && !currencies.includes(c.currency)) continue;
      out.push({ date: d.time, currency: c.currency, perEur: String(c.rate) });
    }
  }
  return out;
}

export async function fetchEcbRates(which: "daily" | "90d" | "hist" = "90d", currencies?: string[]): Promise<EcbRate[]> {
  const url = which === "daily" ? ECB_DAILY : which === "hist" ? ECB_HIST : ECB_90D;
  const xml = await fetchJson<string>(url, { headers: { Accept: "application/xml" } });
  return parseEcbXml(typeof xml === "string" ? xml : String(xml), currencies);
}
