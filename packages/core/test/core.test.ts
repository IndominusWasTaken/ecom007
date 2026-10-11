import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { FxTable } from "../src/fx";
import { encryptSecret, decryptSecret } from "../src/crypto";
import { hotp, totp, verifyTotp, base32Decode, base32Encode } from "../src/totp";
import { chargeDates, nextChargeDate, monthlyEquivalent } from "../src/recurrence";
import { allocate } from "../src/allocation";
import { resolveRange, compareRange, localDate, bucketOf } from "../src/dates";
import { parseCsv, toCsv } from "../src/csv";

describe("fx", () => {
  const fx = new FxTable(
    new Map([
      ["2026-10-08", { USD: "1.1000" }],
      ["2026-10-09", { USD: "1.1200" }],
    ]),
  );
  it("uses the last rate on or before the date (weekends)", () => {
    expect(fx.perEur("USD", "2026-10-11").toString()).toBe("1.12");
    expect(fx.convert(112, "USD", "EUR", "2026-10-10").toFixed(2)).toBe("100.00");
    expect(fx.convert(100, "EUR", "USD", "2026-10-08").toFixed(2)).toBe("110.00");
    expect(fx.convert(5, "USD", "USD", "2026-10-08").toFixed(2)).toBe("5.00");
  });
});

describe("crypto", () => {
  it("round-trips AES-256-GCM and rejects tampering", () => {
    const k = randomBytes(32);
    const enc = encryptSecret("shpss_secret", k);
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc, k)).toBe("shpss_secret");
    const bad = enc.slice(0, -2) + (enc.endsWith("A") ? "BB" : "AA");
    expect(() => decryptSecret(bad, k)).toThrow();
  });
});

describe("totp", () => {
  it("matches RFC 4226 test vectors", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(hotp(secret, 0)).toBe("755224");
    expect(hotp(secret, 1)).toBe("287082");
    expect(hotp(secret, 9)).toBe("520489");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });
  it("verifies with drift and blocks replay", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_790_000_000_000;
    const code = totp(secret, now);
    const step = verifyTotp(secret, code, now);
    expect(step).not.toBeNull();
    expect(verifyTotp(secret, code, now, step)).toBeNull();
    expect(verifyTotp(secret, "000000", now)).toBeNull();
  });
});

describe("recurrence", () => {
  it("monthly anchored on the 31st clamps to month end", () => {
    expect(chargeDates({ cycle: "monthly", anchorDate: "2026-01-31" }, "2026-01-01", "2026-04-30")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });
  it("yearly and every N months, with start and end", () => {
    expect(chargeDates({ cycle: "yearly", anchorDate: "2025-03-15" }, "2026-01-01", "2027-12-31")).toEqual(["2026-03-15", "2027-03-15"]);
    expect(chargeDates({ cycle: "every_n_months", everyNMonths: 3, anchorDate: "2026-01-10", endDate: "2026-08-01" }, "2026-01-01", "2026-12-31")).toEqual(["2026-01-10", "2026-04-10", "2026-07-10"]);
    expect(chargeDates({ cycle: "one_off", anchorDate: "2026-05-05" }, "2026-01-01", "2026-12-31")).toEqual(["2026-05-05"]);
    expect(nextChargeDate({ cycle: "monthly", anchorDate: "2026-01-05" }, "2026-10-11")).toBe("2026-11-05");
    expect(monthlyEquivalent(120, { cycle: "yearly" })).toBe(10);
  });
});

describe("allocation", () => {
  it("splits equally and sums exactly", () => {
    const m = allocate({ amount: "100.00", storeIds: [1, 2, 3], method: "equal" });
    const total = [...m.values()].reduce((a, b) => a.plus(b));
    expect(total.toFixed(6)).toBe("100.000000");
  });
  it("fixed percent and revenue share", () => {
    expect(allocate({ amount: 100, storeIds: [1, 2], method: "fixed", fixedPercents: { 1: 70, 2: 30 } }).get(1)?.toFixed(2)).toBe("70.00");
    expect(allocate({ amount: 100, storeIds: [1, 2], method: "revenue", revenueByStore: { 1: 300, 2: 100 } }).get(2)?.toFixed(2)).toBe("25.00");
    expect(allocate({ amount: 100, storeIds: [1, 2], method: "revenue", revenueByStore: {} }).get(2)?.toFixed(2)).toBe("50.00");
  });
});

describe("dates", () => {
  it("resolves presets like Shopify", () => {
    expect(resolveRange("7d", "2026-10-11")).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(resolveRange("mtd", "2026-10-11")).toEqual({ from: "2026-10-01", to: "2026-10-11" });
    expect(compareRange({ from: "2026-10-04", to: "2026-10-10" }, "previous")).toEqual({ from: "2026-09-27", to: "2026-10-03" });
    expect(compareRange({ from: "2026-10-04", to: "2026-10-10" }, "lastyear")).toEqual({ from: "2025-10-04", to: "2025-10-10" });
  });
  it("store-local dates follow the store time zone", () => {
    expect(localDate("2026-10-11T03:30:00Z", "America/New_York")).toBe("2026-10-10");
    expect(localDate("2026-10-11T22:30:00Z", "Europe/Sofia")).toBe("2026-10-12");
    expect(bucketOf("2026-10-11", "week")).toBe("2026-10-05");
  });
});

describe("csv", () => {
  it("parses quotes and round-trips", () => {
    const rows = parseCsv('﻿store,sku,cost\r\nUS,"A,1",5\nBG,"say ""hi""",6\n');
    expect(rows).toEqual([
      { store: "US", sku: "A,1", cost: "5" },
      { store: "BG", sku: 'say "hi"', cost: "6" },
    ]);
    expect(parseCsv(toCsv(["a", "b"], [["x,y", 1]]))).toEqual([{ a: "x,y", b: "1" }]);
  });
});
