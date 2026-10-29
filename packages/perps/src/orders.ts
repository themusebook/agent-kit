import { PerpsValidationError } from "./errors";

/**
 * Imperial order DESCRIPTORS — plans in the shapes the owner's perps
 * stacks actually use (clawd-agents-perps / clawd-perps-agent).
 * Building a descriptor signs nothing and sends nothing; the caller
 * risk-checks it (risk.ts), signs, and submits through their own
 * Imperial surface (agentgateway CLI or Rise SDK).
 *
 * Field semantics that bite (all from the source repos — read the
 * warnings on each builder):
 * - The limit price travels in `slPrice`. The CLI's JSON adapter
 *   builds `slPrice` from its price argument and REJECTS price-only
 *   orders without it — a descriptor that renames the field loses
 *   the price entirely.
 * - The working stacks always send EMPTY `orderFlags` and never use
 *   conditional TP/SL flags: take-profit/stop-loss are separate
 *   limit orders submitted AFTER the entry fills.
 * - TWAMM (placeTwammOrder — two Ms, the SDK's own spelling) is a
 *   total size segmented across duration/interval BLOCKS; it is not
 *   a recurring order, and the automation layer's place/cancel calls
 *   are stubbed in the source bot — treat TWAMM as descriptor-level.
 */

export interface ImperialPlaceOrderDescriptor {
  kind: "imperialPlaceOrder";
  venue: "imperial";
  /** Market pair id, e.g. "SOL-PERP". */
  pairId: string;
  side: "bid" | "ask";
  /** Size in base lots. A NEGATIVE size is reduce/close semantics on the same market (source: order semantics in both repos). */
  sizeInBaseLots: number;
  orderType: "limit" | "market";
  /**
   * The limit price — carried in slPrice BY DESIGN of the venue's API.
   * For market orders slPrice is 0.
   */
  slPrice: number;
  warnings: string[];
}

export function buildImperialPlaceOrder(input: {
  pairId: string;
  side: "bid" | "ask";
  sizeInBaseLots: number;
  /** Limit price in USD. Omit for a market order. */
  limitPriceUsd?: number;
}): ImperialPlaceOrderDescriptor {
  if (!input.pairId) throw new PerpsValidationError("pairId", "pairId is required (e.g. \"SOL-PERP\")");
  if (!Number.isInteger(input.sizeInBaseLots) || input.sizeInBaseLots === 0) {
    throw new PerpsValidationError("sizeInBaseLots", "sizeInBaseLots must be a non-zero integer (negative = reduce/close)");
  }
  const isLimit = input.limitPriceUsd !== undefined;
  if (isLimit && !(input.limitPriceUsd! > 0)) {
    throw new PerpsValidationError("limitPriceUsd", "limitPriceUsd must be positive");
  }
  return {
    kind: "imperialPlaceOrder",
    venue: "imperial",
    pairId: input.pairId,
    side: input.side,
    sizeInBaseLots: input.sizeInBaseLots,
    orderType: isLimit ? "limit" : "market",
    slPrice: isLimit ? input.limitPriceUsd! : 0,
    warnings: [
      "The limit price is carried in slPrice: the CLI JSON adapter builds slPrice from its price argument and rejects price-only orders — never rename this field when handing the descriptor to a transport, or the price is lost.",
      "Run evaluatePreTradeRisk BEFORE signing: kill-switch, empty-book, notional/leverage/exposure caps are refusals, not warnings.",
      ...(input.sizeInBaseLots < 0
        ? ["Negative size = reduce/close semantics (the source repos' own convention on this market)."]
        : []),
    ],
  };
}

export interface TakeProfitStopLossPlan {
  kind: "imperialTakeProfitStopLossPlan";
  venue: "imperial";
  /** Attach these as separate limit orders ONLY after the entry order fills. */
  attachAfterFill: {
    takeProfit?: { side: "bid" | "ask"; limitPriceUsd: number };
    stopLoss?: { side: "bid" | "ask"; limitPriceUsd: number };
  };
  warnings: string[];
}

/**
 * TP/SL the way the source stacks actually do it: the order bodies
 * always carry EMPTY orderFlags — conditional TP/SL flags are not
 * the mechanism. TP/SL are separate limit orders submitted once the
 * entry fills, on the opposite side of the position, with bot-preset
 * defaults (imperialBot RISK_PRESETS: stopLossPct / takeProfitPct of
 * 2–5% / 4–10% by posture).
 */
export function buildTakeProfitStopLossPlan(input: {
  positionSide: "long" | "short";
  takeProfitPriceUsd?: number;
  stopLossPriceUsd?: number;
}): TakeProfitStopLossPlan {
  if (input.takeProfitPriceUsd === undefined && input.stopLossPriceUsd === undefined) {
    throw new PerpsValidationError(
      "takeProfitPriceUsd",
      "a TP/SL plan needs at least one of takeProfitPriceUsd / stopLossPriceUsd",
    );
  }
  const exitSide = input.positionSide === "long" ? "ask" : "bid";
  return {
    kind: "imperialTakeProfitStopLossPlan",
    venue: "imperial",
    attachAfterFill: {
      ...(input.takeProfitPriceUsd !== undefined
        ? { takeProfit: { side: exitSide, limitPriceUsd: input.takeProfitPriceUsd } }
        : {}),
      ...(input.stopLossPriceUsd !== undefined
        ? { stopLoss: { side: exitSide, limitPriceUsd: input.stopLossPriceUsd } }
        : {}),
    },
    warnings: [
      "Do NOT encode TP/SL as conditional order flags: the working stacks always send empty orderFlags, and no conditional-flag order exists anywhere in either repo. Submit these as separate limit orders AFTER the entry fills, sized as reduce/close (negative size) against the filled position.",
    ],
  };
}

export interface TwammOrderDescriptor {
  kind: "imperialTwammOrder";
  venue: "imperial";
  /** On-chain market id (numeric in the Rise SDK's placeTwammOrder). */
  marketId: number;
  side: "bid" | "ask";
  /** Total size across the whole TWAMM, in base units. */
  totalSize: number;
  /** Distribution window, in BLOCKS (not seconds). */
  durationBlocks: number;
  /** Sub-order cadence, in blocks, when given. */
  intervalBlocks?: number;
  startSlot?: number;
  warnings: string[];
}

/**
 * TWAMM (the SDK spells it placeTwammOrder, two Ms): a total size
 * executed as a series of smaller sub-orders, one per interval,
 * across durationBlocks. The source repos call it through a vendored
 * Rise SDK adapter; the bot's automation-layer place/cancel calls
 * are stubbed, so this stays descriptor-level.
 */
export function buildTwammOrder(input: {
  marketId: number;
  side: "bid" | "ask";
  totalSize: number;
  durationBlocks: number;
  intervalBlocks?: number;
  startSlot?: number;
}): TwammOrderDescriptor {
  if (!Number.isInteger(input.marketId) || input.marketId < 0) {
    throw new PerpsValidationError("marketId", "marketId must be a non-negative integer (the Rise SDK takes the numeric market id)");
  }
  if (!(input.totalSize > 0)) {
    throw new PerpsValidationError("totalSize", "totalSize must be positive");
  }
  if (!Number.isInteger(input.durationBlocks) || input.durationBlocks <= 0) {
    throw new PerpsValidationError("durationBlocks", "durationBlocks must be a positive integer — TWAMM distributes over BLOCKS, not seconds");
  }
  if (input.intervalBlocks !== undefined && (!Number.isInteger(input.intervalBlocks) || input.intervalBlocks <= 0)) {
    throw new PerpsValidationError("intervalBlocks", "intervalBlocks must be a positive integer when given");
  }
  return {
    kind: "imperialTwammOrder",
    venue: "imperial",
    marketId: input.marketId,
    side: input.side,
    totalSize: input.totalSize,
    durationBlocks: input.durationBlocks,
    ...(input.intervalBlocks !== undefined ? { intervalBlocks: input.intervalBlocks } : {}),
    ...(input.startSlot !== undefined ? { startSlot: input.startSlot } : {}),
    warnings: [
      "TWAMM segments a TOTAL size across durationBlocks at intervalBlocks cadence — it is not a recurring order and not a per-interval size.",
      "Descriptor-level only: in the source bot the automation layer's TWAMM place/cancel calls are stubbed ('not wired'); the working call path is the vendored Rise SDK's placeTwammOrder.",
    ],
  };
}

export interface GridPlanLevel {
  side: "bid" | "ask";
  /** Price as a multiple of mid. */
  priceFactor: number;
  priceUsd: number;
  band: "inner" | "outer";
}

export interface GridPlan {
  kind: "imperialGridPlan";
  venue: "imperial";
  midUsd: number;
  /** Inner band half-width as a fraction (volatility + 0.5%); outer is volatility + (volatility + 2.5%). */
  innerBandPct: number;
  levels: GridPlanLevel[];
  warnings: string[];
}

/**
 * Grid market-making levels, mirroring imperialBot's grid math:
 * inner quotes at ±(volatility + 0.5%) around mid, outer quotes at
 * ±(volatility + (volatility + 2.5%)). Pure computation — and note
 * the source bot's placeGridOrders/cancelGridOrders are stubs: the
 * quoting loop itself is the caller's to wire.
 */
export function buildGridPlan(input: { midUsd: number; volatilityPct: number }): GridPlan {
  if (!(input.midUsd > 0)) throw new PerpsValidationError("midUsd", "midUsd must be positive");
  if (!(input.volatilityPct >= 0)) {
    throw new PerpsValidationError("volatilityPct", "volatilityPct must be >= 0 (a fraction, e.g. 0.012)");
  }
  const inner = input.volatilityPct + 0.005;
  const outer = input.volatilityPct + (input.volatilityPct + 0.025);
  const lvl = (side: "bid" | "ask", factor: number, band: "inner" | "outer"): GridPlanLevel => ({
    side,
    priceFactor: factor,
    priceUsd: input.midUsd * factor,
    band,
  });
  return {
    kind: "imperialGridPlan",
    venue: "imperial",
    midUsd: input.midUsd,
    innerBandPct: inner,
    levels: [
      lvl("bid", 1 - inner, "inner"),
      lvl("ask", 1 + inner, "inner"),
      lvl("bid", 1 - outer, "outer"),
      lvl("ask", 1 + outer, "outer"),
    ],
    warnings: [
      "Levels are a PLAN at one mid snapshot: re-quote as mid moves, and gate every placement with evaluatePreTradeRisk (exposure accumulates across grid levels).",
      "The source bot's grid place/cancel methods are stubs ('not wired') — this plan is the grounded part; the live quoting loop is yours.",
    ],
  };
}

export interface TouchOrderDescriptor {
  kind: "imperialTouchOrder";
  venue: "imperial";
  /** Touch market id (strike + expiry identify the contract). */
  marketId: string;
  /** YES buys the probability the strike is touched by expiry; NO sells it. */
  side: "YES" | "NO";
  /** Limit probability price, 0 < p < 1 (Touch prices ARE probabilities). */
  probabilityPrice: number;
  size: number;
  warnings: string[];
}
/**
 * Touch binaries: probability-priced contracts on whether a strike
 * is touched by expiry. GROUNDING STATUS — catalog-level only: in
 * clawd-agents-perps, Touch exists as a real catalog + live
 * bid/ask-probability stream in the vendored Vulcan catalog, plus a
 * conversational stub that answers with hardcoded demo data; in
 * clawd-perps-agent it does not appear at all. NO live Touch order
 * path is implemented in either repo, so this descriptor models the
 * catalog shape and is explicitly NOT a submittable order.
 */
export function buildTouchOrder(input: {
  marketId: string;
  side: "YES" | "NO";
  probabilityPrice: number;
  size: number;
}): TouchOrderDescriptor {
  if (!input.marketId) throw new PerpsValidationError("marketId", "marketId is required");
  if (!(input.probabilityPrice > 0 && input.probabilityPrice < 1)) {
    throw new PerpsValidationError(
      "probabilityPrice",
      "Touch prices are probabilities: probabilityPrice must be in (0, 1)",
    );
  }
  if (!(input.size > 0)) throw new PerpsValidationError("size", "size must be positive");
  return {
    kind: "imperialTouchOrder",
    venue: "imperial",
    marketId: input.marketId,
    side: input.side,
    probabilityPrice: input.probabilityPrice,
    size: input.size,
    warnings: [
      "NOT A LIVE ORDER PATH: in the source repos Touch is a vendored catalog + probability stream (and a demo stub) — no Touch order submission is implemented anywhere inspected. This descriptor exists so agents can reason about Touch markets, not submit them.",
      "Price from the live Touch bid/ask probability stream; a stale probability is a wrong price, not an approximation.",
    ],
  };
}
