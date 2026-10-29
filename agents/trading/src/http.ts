export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface RequestOptions {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  maxRetries?: number;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Seconds from a Retry-After header (delta-seconds or HTTP date). */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s) && s >= 0) return s * 1000;
  const t = Date.parse(header);
  return Number.isNaN(t) ? null : Math.max(0, t - now);
}

/** JSON request that waits out a 429 for exactly Retry-After before retrying. */
export async function requestJson(
  url: string,
  init: RequestInit = {},
  opts: RequestOptions = {},
): Promise<{ status: number; body: any; headers: Headers }> {
  const f = opts.fetch ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 2;
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, {
      ...init,
      headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let body: any = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (res.status === 429 && attempt < maxRetries) {
      const wait = retryAfterMs(res.headers.get("retry-after")) ?? (body?.error?.retryAfterSeconds ?? 1) * 1000;
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const err = body?.error;
      const code = typeof err === "object" && err ? String(err.code ?? res.status) : String(res.status);
      const message = typeof err === "string" ? err : typeof err === "object" && err ? String(err.message ?? res.statusText) : res.statusText;
      throw new HttpError(res.status, code, `${res.status} ${code}: ${message}`, body);
    }
    return { status: res.status, body, headers: res.headers };
  }
}
