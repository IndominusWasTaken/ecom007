import { fetchJson } from "../http";

/**
 * Domain expiry through RDAP, where the registry publishes it (.com, .net, .shop, .co …).
 * Some ccTLD registries (including .bg) do not run RDAP: those return null and the date
 * is typed by hand in Expenses.
 */
export async function lookupDomainExpiry(domain: string): Promise<{ expiry: string | null; source: string }> {
  const d = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  try {
    const res = await fetchJson<{ events?: { eventAction: string; eventDate: string }[] }>(`https://rdap.org/domain/${encodeURIComponent(d)}`, {
      headers: { Accept: "application/rdap+json" },
      redirect: "follow",
    }, { retries: 2 });
    const exp = res.events?.find((e) => e.eventAction === "expiration")?.eventDate;
    return { expiry: exp ? exp.slice(0, 10) : null, source: "rdap" };
  } catch {
    return { expiry: null, source: "unavailable" };
  }
}
