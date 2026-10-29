import type { FetchLike } from "../http.ts";
import { retryAfterMs } from "../http.ts";

export const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

/** Remove any api-key value from text before it reaches an error or a log. */
export function redactApiKey(s: string): string {
  return s.replace(/([?&]api[-_]key=)[^&\s"']+/gi, "$1[REDACTED]").replace(/("?x-api-key"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1[REDACTED]");
}

/** The key is read from the server's environment at call time. It is never stored on disk by the kit. */
export function heliusApiKey(env: Record<string, string | undefined> = process.env): string {
  if (typeof window !== "undefined") throw new Error("HELIUS_API_KEY is server-side only; proxy requests through your backend");
  const k = env.HELIUS_API_KEY;
  if (!k) throw new Error("HELIUS_API_KEY is not set. Create a key yourself at dashboard.helius.dev (see README: Helius manual steps).");
  return k;
}

export class HeliusError extends Error {
  constructor(readonly status: number, message: string, readonly body?: unknown) {
    super(redactApiKey(message));
    this.name = "HeliusError";
  }
}

export interface RetryOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  maxAttempts?: number;
}

/** Docs backoff: 1s doubling to a 30s cap, ±25% jitter, 5 attempts. Retry-After wins when present. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.75 + random() * 0.5));
}

export async function fetchWithRetry(url: string, init: RequestInit, o: RetryOptions = {}): Promise<Response> {
  const f = o.fetch ?? fetch;
  const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const max = o.maxAttempts ?? 5;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await f(url, init);
    } catch (e) {
      if (attempt + 1 >= max) throw new HeliusError(0, `network error: ${(e as Error).message} (${url})`);
      await sleep(backoffMs(attempt, o.random));
      continue;
    }
    if (RETRYABLE.has(res.status) && attempt + 1 < max) {
      await sleep(retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt, o.random));
      continue;
    }
    return res;
  }
}

export interface HeliusOptions extends RetryOptions {
  network?: "mainnet" | "devnet";
  apiKey?: string;
  env?: Record<string, string | undefined>;
}

export class Helius {
  readonly rpcUrl: string;
  readonly apiBase = "https://api.helius.xyz";
  private readonly key: string;
  constructor(private readonly o: HeliusOptions = {}) {
    this.key = o.apiKey ?? heliusApiKey(o.env);
    this.rpcUrl = `https://${o.network === "devnet" ? "devnet" : "mainnet"}.helius-rpc.com/`;
  }

  private async json(url: string, init: RequestInit) {
    const res = await fetchWithRetry(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }, this.o);
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) throw new HeliusError(res.status, `${res.status} from ${url}: ${typeof body === "string" ? body : JSON.stringify(body)}`, body);
    return body;
  }

  async rpc<T = any>(method: string, params: unknown): Promise<T> {
    const body = await this.json(`${this.rpcUrl}?api-key=${this.key}`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: "musebook", method, params }) });
    if (body?.error) throw new HeliusError(200, `${method}: ${body.error.message ?? JSON.stringify(body.error)}`, body);
    return body.result as T;
  }

  private rest(path: string, q: Record<string, string | number | undefined> = {}) {
    const s = new URLSearchParams({ "api-key": this.key });
    for (const [k, v] of Object.entries(q)) if (v !== undefined) s.set(k, String(v));
    return this.json(`${this.apiBase}${path}?${s}`, { method: "GET" });
  }

  /** DAS getAssetsByOwner, fungibles and native balance included. */
  assetsByOwner(ownerAddress: string, o: { page?: number; limit?: number; showZeroBalance?: boolean } = {}) {
    return this.rpc("getAssetsByOwner", {
      ownerAddress, page: o.page ?? 1, limit: o.limit ?? 100,
      options: { showFungible: true, showNativeBalance: true, showZeroBalance: o.showZeroBalance ?? false },
    });
  }

  searchAssets(q: { ownerAddress?: string; tokenType?: "fungible" | "nonFungible" | "regularNft" | "compressedNft" | "all"; grouping?: [string, string]; page?: number; limit?: number }) {
    return this.rpc("searchAssets", { page: 1, limit: 100, ...q });
  }

  /** getTransactionsForAddress (Helius-only RPC). */
  async transactionsForAddress(address: string, o: {
    transactionDetails?: "signatures" | "full"; sortOrder?: "asc" | "desc"; limit?: number; paginationToken?: string;
    filters?: { status?: "succeeded" | "failed"; tokenAccounts?: "none" | "balanceChanged"; blockTime?: { gte?: number; lt?: number; lte?: number }; slot?: { gte?: number; lt?: number; lte?: number } };
  } = {}) {
    if (o.limit !== undefined && (o.limit < 1 || o.limit > 1000)) throw new Error("limit must be 1..1000");
    return this.rpc("getTransactionsForAddress", [address, { transactionDetails: "signatures", sortOrder: "desc", limit: 100, ...o }]);
  }

  /** getPriorityFeeEstimate. Fees always come from here, never a hard-coded number. */
  async priorityFee(q: { transaction?: string; accountKeys?: string[]; priorityLevel?: "Min" | "Low" | "Medium" | "High" | "VeryHigh" | "UnsafeMax"; includeAllPriorityFeeLevels?: boolean; lookbackSlots?: number; recommended?: boolean }) {
    if (!q.transaction && !q.accountKeys?.length) throw new Error("pass a base64 transaction or accountKeys");
    if (q.lookbackSlots !== undefined && (q.lookbackSlots < 1 || q.lookbackSlots > 150)) throw new Error("lookbackSlots must be 1..150");
    const { transaction, accountKeys, ...options } = q;
    return this.rpc<{ priorityFeeEstimate?: number; priorityFeeLevels?: Record<string, number> }>("getPriorityFeeEstimate", [
      { ...(transaction ? { transaction } : { accountKeys }), options: { ...(transaction ? { transactionEncoding: "Base64" } : {}), priorityLevel: "Medium", ...options } },
    ]);
  }

  walletBalances(wallet: string) { return this.rest(`/v1/wallet/${wallet}/balances`); }
  walletHistory(wallet: string, o: { limit?: number; before?: string } = {}) { return this.rest(`/v1/wallet/${wallet}/history`, o); }
}

/** Server-side JSON-RPC proxy so the browser never sees the key. Only listed read methods pass. */
export const PROXY_READ_METHODS = new Set([
  "getLatestBlockhash", "getBalance", "getAccountInfo", "getMultipleAccounts", "getTokenAccountsByOwner", "getSignatureStatuses",
  "getPriorityFeeEstimate", "simulateTransaction", "getAssetsByOwner", "searchAssets", "getAsset", "getTransactionsForAddress", "getSlot",
]);

export function rpcProxyHandler(helius: Pick<Helius, "rpc">) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== "POST") return new Response("POST only", { status: 405 });
    let body: any;
    try { body = await req.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
    if (!PROXY_READ_METHODS.has(body?.method)) return Response.json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32601, message: `method not allowed through proxy: ${body?.method}` } }, { status: 403 });
    try {
      return Response.json({ jsonrpc: "2.0", id: body.id ?? null, result: await helius.rpc(body.method, body.params) });
    } catch (e) {
      return Response.json({ jsonrpc: "2.0", id: body.id ?? null, error: { code: -32000, message: redactApiKey((e as Error).message) } }, { status: 502 });
    }
  };
}
