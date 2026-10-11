import { ConnectorError } from "./types";

export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Extra retry signal from a successful-looking response (e.g. GraphQL THROTTLED). */
  shouldRetry?: (status: number, body: unknown) => number | null; // ms to wait, or null
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch + JSON with exponential backoff on 429, 5xx and network errors. */
export async function fetchJson<T = unknown>(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 6;
  const base = opts.baseDelayMs ?? 1000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(120_000) });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON */
      }
      const extra = opts.shouldRetry?.(res.status, body) ?? null;
      if (res.status === 429 || res.status >= 500 || extra !== null) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const wait = extra ?? (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : base * 2 ** attempt);
        lastErr = new ConnectorError(`HTTP ${res.status} from ${new URL(url).host}`, res.status, true, body);
        if (attempt < retries) {
          await sleep(Math.min(wait, 60_000));
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) throw new ConnectorError(errorMessage(body) ?? `HTTP ${res.status}`, res.status, false, body);
      return body as T;
    } catch (e) {
      if (e instanceof ConnectorError && !e.retryable) throw e;
      lastErr = e;
      if (attempt < retries) {
        await sleep(Math.min(base * 2 ** attempt, 60_000));
        continue;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

function errorMessage(body: unknown): string | null {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b.error_description === "string") return b.error_description;
    if (b.error && typeof b.error === "object" && typeof (b.error as Record<string, unknown>).message === "string") return (b.error as { message: string }).message;
    if (typeof b.error === "string") return b.error;
    if (typeof b.errors === "string") return b.errors;
  }
  return typeof body === "string" ? body.slice(0, 300) : null;
}
