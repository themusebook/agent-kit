/**
 * Pre-trade risk — mirroring the source repos' actual gates
 * (config.ts in BOTH clawd-agents-perps and clawd-perps-agent; the
 * rules are the same in both, repo B adds two fallback warnings).
 *
 * The repos' model is a PREFLIGHT REPORT, not an exception:
 * `buildPreflightReport` returns { ok, mode, blocking, warnings } —
 * `ok` is false when `blocking` is non-empty, and a blocked order
 * does not proceed. The kit keeps that shape deliberately (an
 * earlier kit draft threw typed refusals with invented thresholds;
 * corrected to the repos' own numbers and verdict-object style).
 *
 * Defaults (env-overridable in the repos): symbols SOL/ETH/BTC,
 * maxNotionalUsd $250, maxLeverage 3x, maxSpreadBps 40, wallet
 * required. Live execution is refuse-by-default: mode is "live"
 * only when LIVE_TRADING && OPERATOR_CONFIRMED && !PERPS_SIM_ONLY,
 * and simOnly defaults TRUE (so the default mode is observe).
 *
 * The Imperial layer has its OWN, stricter numbers (max size $100,
 * slippage 50 bps) and a different failure style: it CLAMPS oversize
 * orders instead of blocking. Both behaviors are surfaced here —
 * the disagreement is real and callers should see it.
 *
 * What does NOT exist in either repo (do not invent it): any
 * aggregate-exposure, margin-ratio or seat-state CHECK. Margin and
 * risk fields appear on Phoenix trader views as display data only.
 */

export type TradingMode = "observe" | "paper" | "live";

export interface PerpsRiskLimits {
  allowedSymbols: string[];
  maxNotionalUsd: number;
  maxLeverage: number;
  maxSpreadBps: number;
  requireWallet: boolean;
}

/** The repos' defaults (PERPS_ALLOWED_SYMBOLS / PERPS_MAX_NOTIONAL_USD / PERPS_MAX_LEVERAGE / PERPS_MAX_SPREAD_BPS / PERPS_REQUIRE_WALLET). */
export const DEFAULT_PERPS_RISK_LIMITS: PerpsRiskLimits = {
  allowedSymbols: ["SOL", "ETH", "BTC"],
  maxNotionalUsd: 250,
  maxLeverage: 3,
  maxSpreadBps: 40,
  requireWallet: true,
};

/**
 * Resolve the trading mode the way the repos do: live requires
 * LIVE_TRADING=true AND OPERATOR_CONFIRMED=true AND sim-only off —
 * and simOnly DEFAULTS TRUE, so absent explicit arming the mode is
 * observe (or paper when the operator selected paper flows).
 */
export function resolveTradingMode(input: {
  liveTrading?: boolean;
  operatorConfirmed?: boolean;
  /** PERPS_SIM_ONLY — defaults true in the repos. */
  simOnly?: boolean;
  paper?: boolean;
}): TradingMode {
  const simOnly = input.simOnly ?? true;
  if (input.liveTrading === true && input.operatorConfirmed === true && !simOnly) {
    return "live";
  }
  return input.paper ? "paper" : "observe";
}

export type PreflightExecution = "observe" | "paper" | "vulcan-live" | "rise-live";

export interface PreflightRequest {
  symbol: string;
  notionalUsd: number;
  leverage?: number;
  expectedSpreadBps?: number;
  execution: PreflightExecution;
}

export interface PreflightContext {
  limits: PerpsRiskLimits;
  mode: TradingMode;
  /** RPC configured? (missing RPC is a blocking failure in the repos). */
  rpcUrl?: string;
  /** Wallet address configured? (pubkey only — the repos never hold a key here). */
  wallet?: string;
}

export interface PreflightReport {
  ok: boolean;
  mode: TradingMode;
  blocking: string[];
  warnings: string[];
}

/**
 * The repos' preflight, faithfully: collect ALL blocking reasons
 * (missing RPC, missing wallet, symbol not allowlisted, notional
 * out of bounds, leverage over cap, spread over cap, live execution
 * while mode ≠ live) plus warnings. `ok = blocking.length === 0`.
 */
export function buildPreflightReport(
  ctx: PreflightContext,
  req: PreflightRequest,
): PreflightReport {
  const { limits } = ctx;
  const blocking: string[] = [];
  const warnings: string[] = [];

  if (!ctx.rpcUrl) blocking.push("missing-rpc: no Solana RPC configured");
  if (limits.requireWallet && !ctx.wallet) {
    blocking.push("missing-wallet: no wallet configured (CLAWD_PERPS_WALLET / LOCK_WALLET_ADDRESS)");
  }
  if (!limits.allowedSymbols.includes(req.symbol)) {
    blocking.push(`symbol-not-allowed: ${req.symbol} is not in [${limits.allowedSymbols.join(", ")}]`);
  }
  if (!(req.notionalUsd > 0)) {
    blocking.push("notional-invalid: notionalUsd must be positive");
  } else if (req.notionalUsd > limits.maxNotionalUsd) {
    blocking.push(
      `notional-cap: $${req.notionalUsd} exceeds the $${limits.maxNotionalUsd} max (PERPS_MAX_NOTIONAL_USD)`,
    );
  }
  if (req.leverage !== undefined && req.leverage > limits.maxLeverage) {
    blocking.push(`leverage-cap: ${req.leverage}x exceeds the ${limits.maxLeverage}x max (PERPS_MAX_LEVERAGE)`);
  }
  if (req.expectedSpreadBps !== undefined && req.expectedSpreadBps > limits.maxSpreadBps) {
    blocking.push(
      `spread-cap: ${req.expectedSpreadBps}bps exceeds the ${limits.maxSpreadBps}bps max (PERPS_MAX_SPREAD_BPS)`,
    );
  }
  const wantsLive = req.execution === "vulcan-live" || req.execution === "rise-live";
  if (wantsLive && ctx.mode !== "live") {
    blocking.push(
      `live-not-armed: execution "${req.execution}" requires mode "live" (LIVE_TRADING + OPERATOR_CONFIRMED + PERPS_SIM_ONLY off); current mode is "${ctx.mode}"`,
    );
  }
  if (ctx.mode !== "live") {
    warnings.push(
      "Live execution must still simulate and sign outside this layer — preflight approval is not a submission.",
    );
  }

  return { ok: blocking.length === 0, mode: ctx.mode, blocking, warnings };
}

// ------------------------------------------------------- Imperial layer

export interface ImperialRiskDefaults {
  /** IMPERIAL_MAX_SIZE_USD default. */
  maxSizeUsd: number;
  /** IMPERIAL_SLIPPAGE_BPS default. */
  slippageBps: number;
  /** IMPERIAL_ALLOWED_SYMS default. */
  allowedSymbols: string[];
}

export const DEFAULT_IMPERIAL_RISK: ImperialRiskDefaults = {
  maxSizeUsd: 100,
  slippageBps: 50,
  allowedSymbols: ["SOL", "ETH", "BTC"],
};

/**
 * The Imperial layer's size handling — a CLAMP, not a block:
 * buildOrderRequest throws on a non-allowlisted symbol, silently
 * clamps size to min(sizeUsd, maxSizeUsd), and throws if the result
 * is ≤ 0. Surfaced explicitly because it differs from preflight:
 * an order the preflight would BLOCK at $250 can be silently
 * resized to $100 by this layer. The kit reports the clamp; what a
 * caller does with a resized order is their decision.
 */
export function clampImperialSize(
  sizeUsd: number,
  maxSizeUsd: number = DEFAULT_IMPERIAL_RISK.maxSizeUsd,
): { sizeUsd: number; clamped: boolean } {
  const clamped = sizeUsd > maxSizeUsd;
  return { sizeUsd: Math.min(sizeUsd, maxSizeUsd), clamped };
}
