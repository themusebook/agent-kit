/**
 * Spend guard for Metaplex x402.
 *
 * Default mode is "discovery": the guard never lets a payment happen. It sits
 * UNDER @x402/fetch's wrapFetchWithPayment (as the inner fetch), so it sees
 * every 402 challenge before the payer signs anything, and throws when the
 * challenge is over a cap, over the session budget, or when paying is off.
 */

/** USDC (classic SPL) uses 6 decimals. Amounts here are USD. */
export const USDC_DECIMALS = 6;

export interface SpendGuardConfig {
  /** "discovery" (default) never pays. "pay" pays within caps. */
  mode?: "discovery" | "pay";
  /** Max USD for any single request. Default 0.05. */
  maxPerRequestUsd?: number;
  /** Max USD for the whole session. Default 0.25. */
  sessionBudgetUsd?: number;
  /** Optional floor from getPricing() (e.g. chat minimum). Challenges below it are suspicious but allowed. */
  pricingMinimumUsd?: number;
  /** Only pay these assets (mints). Default: USDC mainnet. */
  allowedAssets?: string[];
}

export interface ParsedRequirement {
  scheme: string;
  network: string;
  asset: string;
  payTo: string;
  amountAtomic: bigint;
  amountUsd: number;
}

export interface ParsedChallenge {
  x402Version: number;
  accepts: ParsedRequirement[];
  resource?: unknown;
}

export class SpendGuardError extends Error {
  constructor(
    message: string,
    readonly reason: "discovery_only" | "over_request_cap" | "over_session_budget" | "asset_not_allowed" | "unparseable_challenge",
    readonly challenge?: ParsedChallenge,
  ) {
    super(message);
    this.name = "SpendGuardError";
  }
}

export const USDC_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function b64decode(s: string): string {
  return typeof Buffer !== "undefined" ? Buffer.from(s, "base64").toString("utf8") : atob(s);
}

/** Parse an x402 v2 PAYMENT-REQUIRED header (base64 JSON) or a v1 JSON body. */
export function parseChallenge(headerOrJson: string | object): ParsedChallenge {
  let raw: any;
  try {
    raw = typeof headerOrJson === "string" ? JSON.parse(headerOrJson.trim().startsWith("{") ? headerOrJson : b64decode(headerOrJson)) : headerOrJson;
  } catch {
    throw new SpendGuardError("402 challenge is not valid base64 JSON", "unparseable_challenge");
  }
  if (!raw || !Array.isArray(raw.accepts) || raw.accepts.length === 0) {
    throw new SpendGuardError("402 challenge has no accepts[]", "unparseable_challenge");
  }
  const accepts = raw.accepts.map((a: any): ParsedRequirement => {
    const amt = a.amount ?? a.maxAmountRequired;
    if (amt === undefined || !/^\d+$/.test(String(amt))) {
      throw new SpendGuardError("402 requirement has no integer amount", "unparseable_challenge");
    }
    const amountAtomic = BigInt(String(amt));
    return {
      scheme: String(a.scheme), network: String(a.network), asset: String(a.asset), payTo: String(a.payTo),
      amountAtomic, amountUsd: Number(amountAtomic) / 10 ** USDC_DECIMALS,
    };
  });
  return { x402Version: Number(raw.x402Version ?? 1), accepts, resource: raw.resource };
}

export class SpendGuard {
  readonly mode: "discovery" | "pay";
  readonly maxPerRequestUsd: number;
  readonly sessionBudgetUsd: number;
  readonly allowedAssets: string[];
  private spentUsd = 0;
  private reservedUsd = 0;

  constructor(cfg: SpendGuardConfig = {}) {
    this.mode = cfg.mode ?? "discovery";
    this.maxPerRequestUsd = cfg.maxPerRequestUsd ?? 0.05;
    this.sessionBudgetUsd = cfg.sessionBudgetUsd ?? 0.25;
    this.allowedAssets = cfg.allowedAssets ?? [USDC_MAINNET];
    if (!(this.maxPerRequestUsd >= 0) || !(this.sessionBudgetUsd >= 0)) throw new Error("caps must be >= 0");
  }

  get spent(): number { return this.spentUsd; }
  get remaining(): number { return Math.max(0, this.sessionBudgetUsd - this.spentUsd - this.reservedUsd); }

  /** Decide on a challenge. Returns the cheapest acceptable requirement or throws. */
  check(ch: ParsedChallenge): ParsedRequirement {
    const ok = ch.accepts.filter((a) => this.allowedAssets.includes(a.asset));
    if (ok.length === 0) throw new SpendGuardError("402 asks for an asset that is not allowed", "asset_not_allowed", ch);
    const req = ok.reduce((m, a) => (a.amountAtomic < m.amountAtomic ? a : m));
    if (this.mode !== "pay") {
      throw new SpendGuardError(`discovery-only: would cost $${req.amountUsd} — set mode "pay" to allow`, "discovery_only", ch);
    }
    if (req.amountUsd > this.maxPerRequestUsd) {
      throw new SpendGuardError(`$${req.amountUsd} is over the per-request cap $${this.maxPerRequestUsd}`, "over_request_cap", ch);
    }
    if (req.amountUsd > this.remaining) {
      throw new SpendGuardError(`$${req.amountUsd} is over the remaining session budget $${this.remaining}`, "over_session_budget", ch);
    }
    return req;
  }

  reserve(usd: number): void { this.reservedUsd += usd; }
  settle(usd: number, paid: boolean): void {
    this.reservedUsd = Math.max(0, this.reservedUsd - usd);
    if (paid) this.spentUsd += usd;
  }

  /**
   * Wrap the INNER fetch handed to wrapFetchWithPayment. Unpaid 402s are
   * inspected here first; a refusal throws before any signature exists.
   * Paid retries (carrying a PAYMENT-SIGNATURE / X-PAYMENT header) are counted.
   */
  wrapInnerFetch(inner: typeof fetch = globalThis.fetch): typeof fetch {
    let pendingUsd = 0;
    const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const isPaidRetry = headers.has("PAYMENT-SIGNATURE") || headers.has("X-PAYMENT");
      const res = await inner(input, init);
      if (isPaidRetry) {
        const usd = pendingUsd; pendingUsd = 0;
        this.settle(usd, res.ok);
        return res;
      }
      if (res.status === 402) {
        const hdr = res.headers.get("PAYMENT-REQUIRED");
        const ch = hdr ? parseChallenge(hdr) : parseChallenge((await res.clone().json().catch(() => ({}))) as object);
        const req = this.check(ch);
        pendingUsd = req.amountUsd;
        this.reserve(req.amountUsd);
      }
      return res;
    };
    return guarded as typeof fetch;
  }
}

/** Build guard caps from env (never reads keys). */
export function spendGuardFromEnv(env: Record<string, string | undefined> = process.env): SpendGuard {
  const num = (k: string) => (env[k] !== undefined && env[k] !== "" ? Number(env[k]) : undefined);
  return new SpendGuard({
    mode: env.X402_MODE === "pay" ? "pay" : "discovery",
    maxPerRequestUsd: num("X402_MAX_PER_REQUEST_USD"),
    sessionBudgetUsd: num("X402_SESSION_BUDGET_USD"),
  });
}
