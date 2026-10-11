import { API_VERSIONS } from "@ecom/core/config";
import { fetchJson, sleep } from "../http";
import { ConnectorError } from "../types";

export interface ShopifyCredentials {
  shopDomain: string; // xxx.myshopify.com
  clientId: string;
  clientSecret: string;
}

export interface TokenCache {
  get(): Promise<{ token: string; expiresAt: Date } | null>;
  set(token: string, expiresAt: Date): Promise<void>;
}

/** In-memory cache, used by scripts and tests. The worker persists tokens encrypted in `connections`. */
export function memoryTokenCache(): TokenCache {
  let v: { token: string; expiresAt: Date } | null = null;
  return { get: async () => v, set: async (token, expiresAt) => void (v = { token, expiresAt }) };
}

function normalizeDomain(d: string): string {
  const host = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim().toLowerCase();
  return host.includes(".") ? host : `${host}.myshopify.com`;
}

/**
 * Client credentials grant: exchanges the app's client id/secret for a 24 h token.
 * Works only when the app and the store belong to the same Shopify organization.
 */
export async function requestAccessToken(c: ShopifyCredentials): Promise<{ token: string; expiresAt: Date; scope: string }> {
  const url = `https://${normalizeDomain(c.shopDomain)}/admin/oauth/access_token`;
  const body = new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" });
  const res = await fetchJson<{ access_token: string; scope: string; expires_in: number }>(
    url,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body },
    { retries: 3 },
  );
  return { token: res.access_token, scope: res.scope, expiresAt: new Date(Date.now() + res.expires_in * 1000) };
}

interface GqlResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost: number; actualQueryCost: number; throttleStatus: { maximumAvailable: number; currentlyAvailable: number; restoreRate: number } } };
}

export class ShopifyClient {
  readonly shop: string;
  private scope = "";
  constructor(
    private creds: ShopifyCredentials,
    private cache: TokenCache = memoryTokenCache(),
    private version: string = API_VERSIONS.shopifyAdmin,
  ) {
    this.shop = normalizeDomain(creds.shopDomain);
  }

  get grantedScopes(): string[] {
    return this.scope ? this.scope.split(",") : [];
  }

  /** Cached token, renewed 30 minutes before its 24 h expiry. */
  async token(): Promise<string> {
    const cached = await this.cache.get();
    if (cached && cached.expiresAt.getTime() - Date.now() > 30 * 60_000) return cached.token;
    const t = await requestAccessToken(this.creds);
    this.scope = t.scope;
    await this.cache.set(t.token, t.expiresAt);
    return t.token;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const url = `https://${this.shop}/admin/api/${this.version}/graphql.json`;
    for (let attempt = 0; attempt < 8; attempt++) {
      const token = await this.token();
      const res = await fetchJson<GqlResponse<T>>(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
      });
      const throttled = res.errors?.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled) {
        const t = res.extensions?.cost?.throttleStatus;
        const need = res.extensions?.cost?.requestedQueryCost ?? 100;
        const wait = t ? Math.ceil(((need - t.currentlyAvailable) / Math.max(t.restoreRate, 1)) * 1000) + 250 : 2000 * (attempt + 1);
        await sleep(Math.max(wait, 500));
        continue;
      }
      if (res.errors?.length) {
        const accessDenied = res.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
        throw new ConnectorError(`Shopify GraphQL: ${res.errors.map((e) => e.message).join("; ")}`, accessDenied ? 403 : 400, false, res.errors);
      }
      // be polite: if the bucket is low, wait for it to refill a little
      const t = res.extensions?.cost?.throttleStatus;
      if (t && t.currentlyAvailable < 200) await sleep(Math.ceil(((200 - t.currentlyAvailable) / Math.max(t.restoreRate, 1)) * 1000));
      return res.data as T;
    }
    throw new ConnectorError("Shopify GraphQL: still throttled after retries", 429, true);
  }

  /** Iterate a connection; `pick` returns the connection object from the response. */
  async *paginate<TNode>(
    query: string,
    variables: Record<string, unknown>,
    pick: (data: any) => { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: TNode[] } | null | undefined,
  ): AsyncGenerator<TNode[], void> {
    let after: string | null = null;
    for (;;) {
      const data = await this.graphql<any>(query, { ...variables, after });
      const conn = pick(data);
      if (!conn) return;
      yield conn.nodes;
      if (!conn.pageInfo.hasNextPage) return;
      after = conn.pageInfo.endCursor;
    }
  }
}
