import { requestJson, HttpError, type RequestOptions } from "../http.ts";

export const STONK_ORIGIN = "https://www.stonkfun.xyz";
export const V1 = "/api/public/v1";
export const V2 = "/api/v2";

/** Per-minute per-IP limits from the Developer API docs. */
export const RATE_LIMITS = {
  v1: 300,
  launchesPrepare: 25,
  claimPrepare: 20,
  v2Summary: 30,
  v2: 240,
} as const;

export interface StonkClientOptions extends RequestOptions {
  origin?: string;
  /** v2 sends no CORS headers; it is refused in a browser unless overridden for tests. */
  serverSide?: boolean;
}

export interface V2Page {
  limit: number;
  order: "asc" | "desc";
  nextCursor: string | null;
}

export class StonkClient {
  readonly origin: string;
  constructor(private readonly opts: StonkClientOptions = {}) {
    this.origin = (opts.origin ?? STONK_ORIGIN).replace(/\/$/, "");
  }

  /** v1: {data, meta} envelope; errors {error:{code,message}}. */
  async v1<T = any>(path: string, init: RequestInit = {}): Promise<T> {
    const { body } = await requestJson(`${this.origin}${V1}${path}`, init, this.opts);
    if (!body || typeof body !== "object" || !("data" in body)) throw new Error(`v1 ${path}: missing {data} envelope`);
    return body.data as T;
  }

  /** v2: no envelope; errors {error: string}; server-side only (no CORS). */
  async v2<T = any>(path: string): Promise<T> {
    const browser = typeof (globalThis as any).window !== "undefined" && typeof (globalThis as any).document !== "undefined";
    if (browser && this.opts.serverSide !== true) throw new Error("Stonk /api/v2 sends no CORS headers: call it from a server, not a browser");
    const { body } = await requestJson(`${this.origin}${V2}${path}`, {}, this.opts);
    return body as T;
  }

  /** Walk a v2 cursor list; stops only when nextCursor is null. */
  async *v2Pages<T = any>(path: string, params: { limit?: number; order?: "asc" | "desc" } = {}, maxPages = 50): AsyncGenerator<T> {
    let cursor: string | null = null;
    for (let i = 0; i < maxPages; i++) {
      const q = new URLSearchParams();
      if (params.limit) q.set("limit", String(params.limit));
      if (params.order) q.set("order", params.order);
      if (cursor) q.set("cursor", cursor);
      const sep = path.includes("?") ? "&" : "?";
      const page: any = await this.v2(`${path}${q.size ? sep + q : ""}`);
      yield page as T;
      cursor = (page?.page as V2Page | undefined)?.nextCursor ?? null;
      if (cursor === null) return;
    }
  }

  stats() { return this.v1<any>("/stats"); }
  pairs(q: { launchable?: boolean; launchLabReady?: boolean; communityMode?: boolean; category?: string } = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined) p.set(k, String(v));
    return this.v1<{ pairs: any[] }>(`/pairs${p.size ? "?" + p : ""}`);
  }
  pricing(quoteMint: string) { return this.v1<any>(`/launchlab/pricing?quoteMint=${encodeURIComponent(quoteMint)}`); }
  platforms() { return this.v1<any>("/launchlab/platforms"); }
  token(mint: string) { return this.v1<any>(`/tokens/${encodeURIComponent(mint)}`); }
  tokens(q: Record<string, string | number> = {}) {
    const p = new URLSearchParams(Object.entries(q).map(([k, v]) => [k, String(v)]));
    return this.v1<any>(`/tokens${p.size ? "?" + p : ""}`);
  }
  fees(mint: string) { return this.v1<any>(`/tokens/${encodeURIComponent(mint)}/fees`); }
  launchStatus(paymentSignature: string) { return this.v1<any>(`/launches/${encodeURIComponent(paymentSignature)}`); }
  intent(mint: string) { return this.v1<any>(`/launchlab/intent/${encodeURIComponent(mint)}`); }
  recentLaunches(q: { limit?: number; order?: "asc" | "desc"; cursor?: string } = {}) {
    const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    return this.v2<any>(`/launches/recent${p.size ? "?" + p : ""}`);
  }

  /** Which launch path is live, from /stats config. */
  async launchPaths(): Promise<{ apiFlow: boolean; launchLab: boolean }> {
    const s = await this.stats();
    return { apiFlow: s?.config?.paidLaunchesEnabled === true, launchLab: s?.config?.launchLabEnabled === true };
  }

  /**
   * Step 1 of the two-call /launches flow. The OpenAPI spec (2.0.0) references
   * POST /launches/prepare but does not publish its request schema, so the body
   * is passed through as given. Refused unless /stats says the flow is live.
   */
  async prepareLaunch(body: Record<string, unknown>): Promise<any> {
    const { apiFlow } = await this.launchPaths();
    if (!apiFlow) throw new Error("the two-call /launches flow is off (stats.config.paidLaunchesEnabled=false); use the LaunchLab build path");
    return this.v1("/launches/prepare", { method: "POST", body: JSON.stringify(body) });
  }

  /** Step 1 of a claim: an unsigned tx (valid 90s) plus intentId. */
  async prepareClaim(mint: string, creatorWallet: string): Promise<{ transaction: string; intentId: string; [k: string]: unknown }> {
    return this.v1(`/tokens/${encodeURIComponent(mint)}/fees/claim/prepare`, { method: "POST", body: JSON.stringify({ creatorWallet }) });
  }

  /** Step 2: relay the user-signed claim. Idempotent per intentId. */
  async submitClaim(mint: string, body: { creatorWallet: string; intentId: string; signedTransaction: string }): Promise<{ signature: string; alreadySubmitted?: boolean }> {
    return this.v1(`/tokens/${encodeURIComponent(mint)}/fees/claim/submit`, { method: "POST", body: JSON.stringify(body) });
  }
}

export { HttpError };
