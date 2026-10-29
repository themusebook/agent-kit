import {
  StonkApiError,
  StonkNetworkError,
  StonkRateLimitError,
  type StonkRateLimitInfo,
} from "./errors";

/**
 * HTTP core for the Stonkfun Developer API (stonkfun.xyz).
 *
 * There is NO API key and nothing to sign up for: reads are open
 * (per-IP rate limits), and writes are authorized by the caller's own
 * wallet signature on the fee payment / claim transaction. This client
 * never holds keys and never signs anything itself — signing is a
 * caller-supplied callback wherever a flow needs it.
 *
 * Two surfaces:
 * - v1 — `https://www.stonkfun.xyz/api/public/v1`. Responses are
 *   wrapped in a `{ data, meta }` envelope; errors are
 *   `{ error: { code, message } }`.
 * - v2 — `https://www.stonkfun.xyz/api/v2`. Responses are the bare
 *   body; errors are `{ error: string }`. v2 sends NO CORS headers —
 *   call it from a server, never from a browser. Use v2 for reads
 *   where a v2 endpoint exists; v1 endpoints that v2 replaces are
 *   deprecated by the venue but continue to work.
 *
 * Rate limits are per IP per minute (see docs/stonk.md for the table).
 * Every response carries X-RateLimit-Remaining / X-RateLimit-Reset;
 * the client tracks the latest snapshot on `client.rateLimit` and maps
 * 429s to `StonkRateLimitError` with the Retry-After value.
 */

export const STONK_V1_BASE = "https://www.stonkfun.xyz/api/public/v1";
export const STONK_V2_BASE = "https://www.stonkfun.xyz/api/v2";

export interface StonkClientConfig {
  /** Defaults to the global fetch. Tests inject a mock here. */
  fetchImpl?: typeof fetch;
  /** Override for the v1 base URL (default STONK_V1_BASE). */
  v1Base?: string;
  /** Override for the v2 base URL (default STONK_V2_BASE). */
  v2Base?: string;
}

/** Sign a base64 transaction locally; returns the signed base64. The key never leaves the caller. */
export type StonkSignTransaction = (transactionBase64: string) => Promise<string>;

export function buildQuery(
  params: Record<string, string | number | boolean | undefined>,
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

function parseRateLimit(headers: Headers): StonkRateLimitInfo {
  const num = (h: string): number | undefined => {
    const v = headers.get(h);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    remaining: num("x-ratelimit-remaining"),
    reset: num("x-ratelimit-reset"),
    retryAfterSeconds: num("retry-after"),
  };
}

interface ParsedError {
  code?: string;
  message: string;
}

/** v1 errors are { error: { code, message } }; v2 errors are { error: string }. */
function parseErrorBody(body: unknown, status: number): ParsedError {
  if (body && typeof body === "object" && "error" in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === "string") return { message: err };
    if (err && typeof err === "object") {
      const e = err as { code?: unknown; message?: unknown };
      return {
        code: typeof e.code === "string" ? e.code : undefined,
        message: typeof e.message === "string" ? e.message : `HTTP ${status}`,
      };
    }
  }
  return { message: `HTTP ${status}` };
}

export class StonkHttp {
  readonly v1Base: string;
  readonly v2Base: string;
  /** Rate-limit snapshot from the most recent response. */
  rateLimit: StonkRateLimitInfo = {};
  private readonly fetchImpl: typeof fetch;

  constructor(config: StonkClientConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.v1Base = (config.v1Base ?? STONK_V1_BASE).replace(/\/$/, "");
    this.v2Base = (config.v2Base ?? STONK_V2_BASE).replace(/\/$/, "");
  }

  private async request(
    base: string,
    path: string,
    init: RequestInit,
    envelope: boolean,
  ): Promise<unknown> {
    const url = `${base}${path}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (e) {
      throw new StonkNetworkError(`Could not reach the Stonkfun API at ${url}`, e);
    }
    this.rateLimit = parseRateLimit(res.headers);
    const text = await res.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep raw text */
    }
    if (!res.ok) {
      const parsed = parseErrorBody(body, res.status);
      if (res.status === 429) {
        throw new StonkRateLimitError(
          `Stonkfun API rate limit: ${parsed.message}`,
          { responseBody: body, rateLimit: this.rateLimit },
        );
      }
      throw new StonkApiError(res.status, parsed.message, {
        code: parsed.code,
        responseBody: body,
        rateLimit: this.rateLimit,
      });
    }
    if (envelope) {
      // v1 wraps payloads in { data, meta }; tolerate a bare body too.
      if (body && typeof body === "object" && "data" in body) {
        return (body as { data: unknown }).data;
      }
      return body;
    }
    return body;
  }

  /** v1 GET (envelope-unwrapped). */
  async v1Get<T>(path: string): Promise<T> {
    return (await this.request(this.v1Base, path, { method: "GET" }, true)) as T;
  }

  /** v1 POST with a JSON body (envelope-unwrapped). */
  async v1Post<T>(path: string, body: unknown): Promise<T> {
    return (await this.request(
      this.v1Base,
      path,
      { method: "POST", body: JSON.stringify(body) },
      true,
    )) as T;
  }

  /** v2 GET (bare body). Server-side only — v2 sends no CORS headers. */
  async v2Get<T>(path: string): Promise<T> {
    return (await this.request(this.v2Base, path, { method: "GET" }, false)) as T;
  }
}
