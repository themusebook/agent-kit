import { PerpsValidationError, RiskCheckError } from "./errors";

/**
 * Pre-trade risk checks — the gate EVERY perps order descriptor must
 * pass before a caller signs anything. Two layers in the owner's
 * perps stacks, both mirrored here:
 *
 * - The FINANCIAL layer (clawd-perps-agent src/financial/money.ts,
 *   surfaced through financialClawd.evaluateRisk): hard constants
 *   MIN_NOTIONAL $5 · MAX_NOTIONAL $1,000 · MAX_LEVERAGE 2x ·
 *   MAX_TOTAL_EXPOSURE $5,000, an env kill switch (default off), and
 *   sizing that floors to lot multiples and refuses sub-lot results.
 * - The BOT layer (imperialBot.ts in both repos): named posture
 *   presets (PERPS_RISK_PRESETS below) with per-preset position /
 *   daily-loss / leverage / TP / SL defaults, a `checkRisk` that
 *   returns { allowed, reason }, dry-run DEFAULT true in both env
 *   layers, and a portfolio circuit breaker.
 *
 * Where the layers disagree, this package takes the STRICTER reading
 * and says so: the bot presets allow up to 5x default leverage while
 * the financial layer hard-caps at 2x — the kit's default policy uses
 * 2x. And where the repos return a verdict object, the kit THROWS
 * `RiskCheckError` (a deliberate strengthening: a refusal that can be
 * accidentally ignored is not a gate).
 */

export interface PerpsRiskPolicy {
  /** Hard stop: when true, every order is refused. Default true (fail-closed). */
  killSwitch: boolean;
  /** Minimum order notional in USD (source default 5). */
  minNotionalUsd: number;
  /** Maximum single-order notional in USD (source default 1000). */
  maxNotionalUsd: number;
  /** Maximum leverage (source default 2). */
  maxLeverage: number;
  /** Maximum total open exposure in USD (source default 5000). */
  maxTotalExposureUsd: number;
  /** Maximum realized loss per day in USD before the circuit breaker trips (bot layer). Optional. */
  maxDailyLossUsd?: number;
  /** Default posture: dry-run unless the operator explicitly goes live (both repos default dryRun true). */
  dryRun: boolean;
}

/** The source repos' defaults. dryRun: true and killSwitch semantics as documented per field. */
export const DEFAULT_PERPS_RISK_POLICY: PerpsRiskPolicy = {
  killSwitch: false,
  minNotionalUsd: 5,
  maxNotionalUsd: 1000,
  maxLeverage: 2,
  maxTotalExposureUsd: 5000,
  dryRun: true,
};

/**
 * imperialBot's RISK_PRESETS, verbatim values (identical in both
 * repos). NOTE the disagreement with the financial layer: the bot's
 * aggressive preset defaults to 5x leverage where money.ts hard-caps
 * 2x. The kit's DEFAULT_PERPS_RISK_POLICY follows the stricter 2x;
 * adopting a preset's leverage is an explicit operator choice.
 */
export const PERPS_RISK_PRESETS = {
  conservative: { maxPositionUsd: 50, maxDailyLossUsd: 25, defaultLeverage: 2, stopLossPct: 2, takeProfitPct: 4 },
  balanced: { maxPositionUsd: 200, maxDailyLossUsd: 100, defaultLeverage: 3, stopLossPct: 3, takeProfitPct: 6 },
  aggressive: { maxPositionUsd: 500, maxDailyLossUsd: 250, defaultLeverage: 5, stopLossPct: 5, takeProfitPct: 10 },
} as const;

export type PerpsRiskPresetName = keyof typeof PERPS_RISK_PRESETS;

export interface PreTradeRiskInput {
  policy: PerpsRiskPolicy;
  /** Best bid/ask available? An empty book refuses (source: empty-book refusal in money.ts). */
  bookNonEmpty: boolean;
  /** The order's notional in USD (size × price). */
  notionalUsd: number;
  /** Requested leverage for the order. */
  leverage: number;
  /** Current total open exposure in USD, before this order. */
  currentExposureUsd: number;
  /** Realized loss so far today in USD (positive number), when the policy carries a daily-loss cap. */
  dailyLossUsd?: number;
}

export interface PreTradeRiskVerdict {
  ok: true;
  /** The order proceeds as a DRY RUN (plan only) when the policy says so. */
  dryRun: boolean;
}

/**
 * Evaluate the pre-trade gates. Returns a verdict or THROWS
 * RiskCheckError — callers must not catch-and-continue.
 */
export function evaluatePreTradeRisk(input: PreTradeRiskInput): PreTradeRiskVerdict {
  const { policy } = input;
  if (policy.killSwitch) {
    throw new RiskCheckError("kill-switch", "kill switch is engaged — all perps orders are refused");
  }
  if (!input.bookNonEmpty) {
    throw new RiskCheckError("empty-market", "order book is empty — refusing to price an order into no liquidity");
  }
  if (!(input.notionalUsd > 0)) {
    throw new PerpsValidationError("notionalUsd", "notionalUsd must be positive");
  }
  if (input.notionalUsd < policy.minNotionalUsd) {
    throw new RiskCheckError(
      "sizing-floor",
      `notional $${input.notionalUsd} is below the $${policy.minNotionalUsd} minimum`,
    );
  }
  if (input.notionalUsd > policy.maxNotionalUsd) {
    throw new RiskCheckError(
      "notional-cap",
      `notional $${input.notionalUsd} exceeds the $${policy.maxNotionalUsd} per-order cap`,
    );
  }
  if (input.leverage > policy.maxLeverage) {
    throw new RiskCheckError(
      "leverage-cap",
      `leverage ${input.leverage}x exceeds the ${policy.maxLeverage}x cap`,
    );
  }
  if (input.currentExposureUsd + input.notionalUsd > policy.maxTotalExposureUsd) {
    throw new RiskCheckError(
      "exposure-cap",
      `exposure $${input.currentExposureUsd} + order $${input.notionalUsd} exceeds the $${policy.maxTotalExposureUsd} total cap`,
    );
  }
  if (
    policy.maxDailyLossUsd !== undefined &&
    input.dailyLossUsd !== undefined &&
    input.dailyLossUsd >= policy.maxDailyLossUsd
  ) {
    throw new RiskCheckError(
      "daily-loss-cap",
      `daily loss $${input.dailyLossUsd} has reached the $${policy.maxDailyLossUsd} circuit-breaker cap`,
    );
  }
  return { ok: true, dryRun: policy.dryRun };
}

/**
 * Equity-fraction sizing, mirroring money.ts calculatePositionSize:
 * orderUsd = equity × pct, refused above the per-order notional cap;
 * base size = orderUsd / reserve price, FLOORED to a lot multiple
 * (floor(rawSize / lotSize) × lotSize); a result below MIN_ORDER_FLOOR
 * (0.001 in money.ts) REFUSES instead of rounding up into an
 * unintended size.
 */
export function sizePerpsOrder(input: {
  policy: PerpsRiskPolicy;
  equityUsd: number;
  pctOfEquity: number;
  priceUsd: number;
  /** Venue lot size (money.ts floors to lot multiples). Default 1. */
  lotSize?: number;
  /** Minimum order floor in base units (money.ts MIN_ORDER_FLOOR). Default 0.001. */
  minOrderFloor?: number;
}): { notionalUsd: number; lots: number } {
  const { policy } = input;
  if (!(input.equityUsd > 0)) throw new PerpsValidationError("equityUsd", "equityUsd must be positive");
  if (!(input.pctOfEquity > 0 && input.pctOfEquity <= 1)) {
    throw new PerpsValidationError("pctOfEquity", "pctOfEquity must be in (0, 1]");
  }
  if (!(input.priceUsd > 0)) throw new PerpsValidationError("priceUsd", "priceUsd must be positive");
  const lotSize = input.lotSize ?? 1;
  const floor = input.minOrderFloor ?? 0.001;
  const notionalUsd = Math.min(policy.maxNotionalUsd, input.equityUsd * input.pctOfEquity);
  const rawSize = notionalUsd / input.priceUsd;
  const lots = Math.floor(rawSize / lotSize) * lotSize;
  if (lots < floor || lots <= 0) {
    throw new RiskCheckError(
      "sizing-floor",
      `sized ${rawSize} base units at $${input.priceUsd} floors to ${lots} — below the order floor; refusing rather than rounding up`,
    );
  }
  return { notionalUsd, lots };
}
