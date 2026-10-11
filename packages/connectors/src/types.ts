/**
 * Every connector implements the same three operations. Adding a platform (TikTok,
 * Google Ads) means adding one folder that implements this interface; the worker
 * discovers connectors through the registry in ./index.ts.
 */
export interface Health {
  ok: boolean;
  message: string;
  detail?: Record<string, unknown>;
}

export interface Connector<Ctx, Sink> {
  platform: string;
  label: string;
  /** false = shown as "coming soon" in Settings. */
  available: boolean;
  /** First load, at most `months` back. Must be resumable: it receives and returns a cursor. */
  loadHistory(ctx: Ctx, sink: Sink, opts: { since: string; cursor?: string | null; onProgress?: (msg: string) => void }): Promise<{ cursor: string | null; done: boolean; rows: number }>;
  /** Incremental sync of everything changed since `cursor`. Returns the new cursor. */
  syncSince(ctx: Ctx, sink: Sink, cursor: string | null): Promise<{ cursor: string | null; rows: number }>;
  checkHealth(ctx: Ctx): Promise<Health>;
}

export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}
