import { requestJson, type RequestOptions } from "../http.ts";

export const BACKPACK_API = "https://api.backpack.exchange";
export const DEFAULT_WINDOW = 5000;
export const MAX_WINDOW = 60000;

type Params = Record<string, string | number | boolean | undefined>;

const qs = (p: Params) =>
  Object.keys(p)
    .filter((k) => p[k] !== undefined)
    .sort()
    .map((k) => `${k}=${p[k]}`)
    .join("&");

/**
 * The exact string Backpack expects to be signed: `instruction=<i>&` + params
 * sorted alphabetically + `&timestamp=<ms>&window=<ms>`. For a batch, each
 * order gets its own `instruction=` prefix and the parts are joined with `&`.
 */
export function signingString(instruction: string, params: Params | Params[], timestamp: number, window = DEFAULT_WINDOW): string {
  if (!Number.isInteger(window) || window <= 0 || window > MAX_WINDOW) throw new Error(`window must be 1..${MAX_WINDOW} ms`);
  const parts = (Array.isArray(params) ? params : [params]).map((p) => [`instruction=${instruction}`, qs(p)].filter(Boolean).join("&"));
  return `${parts.join("&")}&timestamp=${timestamp}&window=${window}`;
}

export interface OrderInput {
  symbol: string;
  side: "Bid" | "Ask";
  orderType: "Limit" | "Market";
  quantity?: string;
  quoteQuantity?: string;
  price?: string;
  timeInForce?: "GTC" | "IOC" | "FOK";
  postOnly?: boolean;
  reduceOnly?: boolean;
  clientId?: number;
}

export function checkOrder(o: OrderInput): void {
  if (!/^[A-Z0-9]+_[A-Z0-9]+(_PERP)?$/.test(o.symbol)) throw new Error("symbol must look like SOL_USDC or SOL_USDC_PERP");
  if (o.side !== "Bid" && o.side !== "Ask") throw new Error("side must be Bid or Ask");
  if (o.orderType !== "Limit" && o.orderType !== "Market") throw new Error("orderType must be Limit or Market");
  const dec = /^\d+(\.\d+)?$/;
  if (!o.quantity && !o.quoteQuantity) throw new Error("quantity or quoteQuantity is required");
  for (const k of ["quantity", "quoteQuantity", "price"] as const) if (o[k] !== undefined && !dec.test(o[k]!)) throw new Error(`${k} must be a decimal string`);
  if (o.orderType === "Limit" && !o.price) throw new Error("a Limit order needs price");
}

export interface SignedRequestPreview {
  status: "preview";
  method: "POST" | "DELETE" | "GET";
  url: string;
  body: unknown;
  /** Headers to send once you have signed. X-API-Key and X-Signature are yours to add. */
  headers: { "X-Timestamp": string; "X-Window": string; "X-API-Key": "<your base64 ED25519 public key>"; "X-Signature": "<base64 ED25519 signature of signingString>" };
  signingString: string;
  note: string;
}

/**
 * Backpack signs requests with the user's ED25519 API secret. The kit never
 * reads, stores or logs that secret, so an order is a preview: the exact
 * string to sign and the request to send once signed, by the user, locally.
 */
export function previewOrder(o: OrderInput, now = Date.now(), window = DEFAULT_WINDOW): SignedRequestPreview {
  checkOrder(o);
  const body = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  return {
    status: "preview",
    method: "POST",
    url: `${BACKPACK_API}/api/v1/order`,
    body,
    headers: { "X-Timestamp": String(now), "X-Window": String(window), "X-API-Key": "<your base64 ED25519 public key>", "X-Signature": "<base64 ED25519 signature of signingString>" },
    signingString: signingString("orderExecute", body as Params, now, window),
    note: `Sign signingString with your Backpack API secret on your own machine within ${window} ms, then send. The kit holds no Backpack key.`,
  };
}

/** DepthLimit enum from the OpenAPI spec. */
export const DEPTH_LIMITS = [5, 10, 20, 50, 100, 500, 1000];

export class BackpackPublic {
  constructor(private readonly opts: RequestOptions & { base?: string } = {}) {}
  private async get(path: string, p: Params = {}) {
    const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();
    return (await requestJson(`${this.opts.base ?? BACKPACK_API}${path}${q ? `?${q}` : ""}`, {}, this.opts)).body;
  }
  markets(marketType?: string) { return this.get("/api/v1/markets", { marketType }); }
  ticker(symbol: string, interval?: string) { return this.get("/api/v1/ticker", { symbol, interval }); }
  depth(symbol: string, limit?: number) {
    if (limit !== undefined && !DEPTH_LIMITS.includes(limit)) return Promise.reject(new Error(`depth limit must be one of ${DEPTH_LIMITS.join(", ")}`));
    return this.get("/api/v1/depth", { symbol, limit });
  }
  klines(symbol: string, interval: string, startTime: number, endTime?: number) { return this.get("/api/v1/klines", { symbol, interval, startTime, endTime }); }
  trades(symbol: string, limit?: number) { return this.get("/api/v1/trades", { symbol, limit }); }
}
