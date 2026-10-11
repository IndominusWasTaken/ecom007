import { addDays, addMonths, todayIn } from "@ecom/core/dates";
import { BUSINESS_TZ } from "@ecom/core/config";
import { sha256 } from "@ecom/core/crypto";
import { getDb, sql } from "@ecom/db";
import { chargesBetween } from "@/lib/expenseCalendar";
import { cycleLabel } from "@/app/(app)/expenses/constants";

/*
 * Private iCal feed of subscription renewals. No session: the unguessable token in the URL is
 * the credential, and only its sha256 is stored (calendar_tokens). Revoking deletes the hash.
 */

/** RFC 5545 TEXT escaping. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Fold content lines at 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let cur = "";
  let len = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (len + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      len = 0;
    }
    cur += ch;
    len += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

const ymd = (d: string) => d.replace(/-/g, "");

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const raw = token.replace(/\.ics$/, "");
  const db = getDb();
  const found = await db.execute<{ n: number }>(sql`select count(*)::int n from calendar_tokens where token_hash = ${sha256(raw)}`);
  if (!raw || !found.rows[0]?.n) return new Response("Not found", { status: 404 });

  const today = todayIn(BUSINESS_TZ);
  const charges = (await chargesBetween(db, addMonths(today, -3), addMonths(today, 12))).filter((c) => c.kind === "subscription");
  const origin = new URL(req.url).origin;
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ecom-profit//renewals//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Subscription renewals", "X-PUBLISHED-TTL:PT6H"];
  for (const c of charges) {
    const summary = `${c.name} – ${c.amount.toFixed(2)} ${c.currency}${c.trial ? " (trial)" : ""}`;
    const desc = [c.vendor && `Vendor: ${c.vendor}`, c.cycle && `Billing: ${cycleLabel(c.cycle)}`, c.manageUrl && `Manage: ${c.manageUrl}`, `Dashboard: ${origin}/expenses?tab=calendar&month=${c.date.slice(0, 7)}`]
      .filter(Boolean)
      .join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:sub-${c.id}-${ymd(c.date)}@ecom-profit`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${ymd(c.date)}`,
      `DTEND;VALUE=DATE:${ymd(addDays(c.date, 1))}`,
      `SUMMARY:${esc(summary)}`,
      `DESCRIPTION:${esc(desc)}`,
      ...(c.manageUrl ? [`URL:${c.manageUrl.replace(/[\r\n]/g, "")}`] : []),
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="renewals.ics"',
      "Cache-Control": "private, max-age=900",
    },
  });
}
