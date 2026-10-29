import { PerpsValidationError } from "./errors";

/**
 * Order DESCRIPTORS in the shapes the source repos actually use
 * (clawd-agents-perps / clawd-perps-agent, file-inspected
 * 2026-10-29). Building a descriptor signs nothing and submits
 * nothing.
 *
 * Two order surfaces exist in the repos, and they are different
 * systems:
 * 1. The PERPS RUNTIME only previews: paper trades route to Vulcan
 *    (paper-buy/paper-sell, market only), live trades route to
 *    rise/order.place with a preflight `blocked` flag. The runtime
 *    never calls Rise transaction senders — signing/submission
 *    happen outside it (browser Phoenix desk, per the repos' docs).
 * 2. IMPERIAL is the real submission path: MobileCreateOrderRequest
 *    bodies POSTed to /mobile/orders (server-side) under a JWT —
 *    no local signing, wallet is pubkey-only config, dry-run unless
 *    IMPERIAL_LIVE=true and a JWT are both present.
 *
 * NOT in either repo (an earlier kit draft described them; removed
 * as ungrounded): grid quoting, TWAP slicing, Touch binaries, and
 * any slPrice-style price field. TWAMM exists only as a bridge to
 * an external spot-AMM crank workspace — see
 * buildTwammAutomationPlan.
 */

// ------------------------------------------------------------- Imperial

/** Imperial's numeric order types (identical enum in both repos). */
export const ImperialOrderType = {
  Market: 0,
  Limit: 1,
  StopLimit: 2,
  LandMine: 3,
  Ratchet: 4,
  RatchetEntry: 6,
  DCA: 9,
  FibRatchet: 10,
  FibRatchetEntry: 11,
  DcaClose: 12,
  DcaTimeClose: 13,
  DcaRatchetClose: 14,
  DcaTime: 15,
  DcaRatchet: 16,
} as const;
export type ImperialOrderTypeValue = (typeof ImperialOrderType)[keyof typeof ImperialOrderType];

/** Imperial underwriters: Imperial is a ROUTER; Phoenix (2) is the default underwriter, not the only one. */
export const ImperialUnderwriter = { Jupiter: 0, Flash: 1, Phoenix: 2, GMTrade: 3 } as const;
export type ImperialUnderwriterValue = (typeof ImperialUnderwriter)[keyof typeof ImperialUnderwriter];

export interface ImperialOrderRequest {
  wallet: string;
  /** 0..5 */
  profileIndex: number;
  /** 0 = Increase, 1 = Decrease */
  action: 0 | 1;
  /** 0 = long, 1 = short */
  side: 0 | 1;
  underwriter: ImperialUnderwriterValue;
  orderType: ImperialOrderTypeValue;
  /** 6-decimal fixed USD size (the request field is a USD amount; conversion is the transport's). */
  sizeUsd: number;
  collateralAmount?: number;
  slippageBps: number;
  fundingStatus: 0 | 1;
  priority?: number;
  /** Trigger price at 1e9 oracle scale. */
  triggerPrice?: number;
  /** 0 = Above, 1 = Below */
  triggerCondition?: 0 | 1;
  symbol?: string;
  marketMint?: string;
  extraData?: Record<string, unknown>;
}

export interface ImperialOrderDescriptor {
  kind: "imperialOrder";
  venue: "imperial";
  endpoint: "POST /mobile/orders";
  request: ImperialOrderRequest;
  /** placeOrder defaults to dry-run unless Imperial live + JWT are configured — the descriptor carries that default. */
  dryRun: boolean;
  warnings: string[];
}

const TRIGGER_SCALE = 1_000_000_000;

export function buildImperialOrder(input: {
  wallet: string;
  profileIndex?: number;
  action: "increase" | "decrease";
  side: "long" | "short";
  underwriter?: ImperialUnderwriterValue;
  orderType?: ImperialOrderTypeValue;
  sizeUsd: number;
  collateralAmount?: number;
  /** Default: the Imperial layer's 50 bps (IMPERIAL_SLIPPAGE_BPS). */
  slippageBps?: number;
  fundingStatus?: 0 | 1;
  priority?: number;
  /** Human USD trigger price — converted to the 1e9 oracle scale the API carries. */
  triggerPriceUsd?: number;
  triggerCondition?: "above" | "below";
  symbol?: string;
  marketMint?: string;
  extraData?: Record<string, unknown>;
  /** Set true only when IMPERIAL_LIVE=true AND a JWT are configured — mirrors placeOrder's dryRun default. */
  live?: boolean;
}): ImperialOrderDescriptor {
  if (!input.wallet) throw new PerpsValidationError("wallet", "wallet (pubkey) is required");
  const profileIndex = input.profileIndex ?? 0;
  if (!Number.isInteger(profileIndex) || profileIndex < 0 || profileIndex > 5) {
    throw new PerpsValidationError("profileIndex", "profileIndex must be an integer in 0..5");
  }
  if (!(input.sizeUsd > 0)) throw new PerpsValidationError("sizeUsd", "sizeUsd must be positive");
  const orderType = input.orderType ?? ImperialOrderType.Market;
  const needsTrigger = orderType === ImperialOrderType.Limit || orderType === ImperialOrderType.StopLimit;
  if (needsTrigger && input.triggerPriceUsd === undefined) {
    throw new PerpsValidationError(
      "triggerPriceUsd",
      `orderType ${orderType} (Limit/StopLimit) requires triggerPriceUsd — it is carried at 1e9 oracle scale as triggerPrice`,
    );
  }
  if (input.triggerPriceUsd !== undefined && !(input.triggerPriceUsd > 0)) {
    throw new PerpsValidationError("triggerPriceUsd", "triggerPriceUsd must be positive");
  }
  return {
    kind: "imperialOrder",
    venue: "imperial",
    endpoint: "POST /mobile/orders",
    request: {
      wallet: input.wallet,
      profileIndex,
      action: input.action === "increase" ? 0 : 1,
      side: input.side === "long" ? 0 : 1,
      underwriter: input.underwriter ?? ImperialUnderwriter.Phoenix,
      orderType,
      sizeUsd: input.sizeUsd,
      ...(input.collateralAmount !== undefined ? { collateralAmount: input.collateralAmount } : {}),
      slippageBps: input.slippageBps ?? 50,
      fundingStatus: input.fundingStatus ?? 0,
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.triggerPriceUsd !== undefined
        ? { triggerPrice: Math.round(input.triggerPriceUsd * TRIGGER_SCALE) }
        : {}),
      ...(input.triggerCondition !== undefined
        ? { triggerCondition: (input.triggerCondition === "above" ? 0 : 1) as 0 | 1 }
        : {}),
      ...(input.symbol ? { symbol: input.symbol } : {}),
      ...(input.marketMint ? { marketMint: input.marketMint } : {}),
      ...(input.extraData ? { extraData: input.extraData } : {}),
    },
    dryRun: input.live !== true,
    warnings: [
      "Submission is server-side under a JWT (mobile-connect: the caller signs `imperial:mobile-connect:{wallet}:{nonce}` EXTERNALLY to obtain it). This descriptor is not submittable without IMPERIAL_LIVE=true + JWT, and the kit holds neither.",
      "Check buildPreflightReport first — and note the Imperial layer CLAMPS sizeUsd to its $100 default max instead of blocking (see risk.ts clampImperialSize).",
    ],
  };
}

export interface ImperialBatchPlan {
  kind: "imperialBatchPlan";
  venue: "imperial";
  endpoint: "POST /mobile/orders/batch";
  entry: ImperialOrderRequest;
  /** TP/SL as Decrease orders submitted WITH the entry (placeBatch) — the repos' actual mechanism. */
  closeOrders: ImperialOrderRequest[];
  dryRun: boolean;
  warnings: string[];
}

/**
 * TP/SL the repos' way: imperialBot builds the take-profit as a
 * Decrease LIMIT (triggerCondition Above for a long) and the
 * stop-loss as a Decrease STOPLIMIT (Below for a long), submitted
 * together with the entry via placeBatch({entry, closeOrders}).
 * (For a short entry the conditions invert: TP Below, SL Above.)
 */
export function buildImperialBatchPlan(input: {
  entry: Parameters<typeof buildImperialOrder>[0];
  takeProfitPriceUsd?: number;
  stopLossPriceUsd?: number;
}): ImperialBatchPlan {
  if (input.takeProfitPriceUsd === undefined && input.stopLossPriceUsd === undefined) {
    throw new PerpsValidationError(
      "takeProfitPriceUsd",
      "a batch plan needs at least one of takeProfitPriceUsd / stopLossPriceUsd (a plain order is buildImperialOrder)",
    );
  }
  const entryDesc = buildImperialOrder(input.entry);
  const entry = entryDesc.request;
  const isLong = entry.side === 0;
  const closeBase = {
    wallet: entry.wallet,
    profileIndex: entry.profileIndex,
    action: 1 as const, // Decrease
    side: entry.side,
    underwriter: entry.underwriter,
    sizeUsd: entry.sizeUsd,
    slippageBps: entry.slippageBps,
    fundingStatus: entry.fundingStatus,
    ...(entry.symbol ? { symbol: entry.symbol } : {}),
  };
  const closeOrders: ImperialOrderRequest[] = [];
  if (input.takeProfitPriceUsd !== undefined) {
    closeOrders.push({
      ...closeBase,
      orderType: ImperialOrderType.Limit,
      triggerPrice: Math.round(input.takeProfitPriceUsd * TRIGGER_SCALE),
      triggerCondition: isLong ? 0 : 1, // long TP triggers Above; short TP Below
    });
  }
  if (input.stopLossPriceUsd !== undefined) {
    closeOrders.push({
      ...closeBase,
      orderType: ImperialOrderType.StopLimit,
      triggerPrice: Math.round(input.stopLossPriceUsd * TRIGGER_SCALE),
      triggerCondition: isLong ? 1 : 0, // long SL triggers Below; short SL Above
    });
  }
  return {
    kind: "imperialBatchPlan",
    venue: "imperial",
    endpoint: "POST /mobile/orders/batch",
    entry,
    closeOrders,
    dryRun: entryDesc.dryRun,
    warnings: entryDesc.warnings,
  };
}

// -------------------------------------------------------- Vulcan preview

export interface PerpsTradePreview {
  kind: "perpsTradePreview";
  symbol: string;
  side: "buy" | "sell";
  notionalUsd: number;
  execution: "paper" | "live";
  route: { adapter: "vulcan" | "rise"; action: string; payload: Record<string, unknown> };
  warnings: string[];
}

/**
 * The perps runtime's preview shape (TraderActionPreview): paper
 * trades route to Vulcan paper-buy/paper-sell; live trades route to
 * rise/order.place with the preflight verdict riding as `blocked`.
 * Market orders only — Vulcan's live/paper actions have no limit
 * variant in either repo. A preview is not a submission: the runtime
 * never signs or sends.
 */
export function buildPerpsTradePreview(input: {
  symbol: string;
  side: "buy" | "sell";
  notionalUsd: number;
  leverage?: number;
  expectedSpreadBps?: number;
  execution: "paper" | "live";
  /** The caller's preflight verdict — live previews carry it as `blocked: !ok`. */
  preflightOk: boolean;
}): PerpsTradePreview {
  if (!input.symbol) throw new PerpsValidationError("symbol", "symbol is required");
  if (!(input.notionalUsd > 0)) throw new PerpsValidationError("notionalUsd", "notionalUsd must be positive");
  const paper = input.execution === "paper";
  return {
    kind: "perpsTradePreview",
    symbol: input.symbol,
    side: input.side,
    notionalUsd: input.notionalUsd,
    execution: input.execution,
    route: paper
      ? {
          adapter: "vulcan",
          action: input.side === "buy" ? "paper-buy" : "paper-sell",
          payload: { symbol: input.symbol, side: input.side, notionalUsd: input.notionalUsd },
        }
      : {
          adapter: "rise",
          action: "order.place",
          payload: {
            symbol: input.symbol,
            side: input.side,
            notionalUsd: input.notionalUsd,
            ...(input.leverage !== undefined ? { leverage: input.leverage } : {}),
            ...(input.expectedSpreadBps !== undefined
              ? { expectedSpreadBps: input.expectedSpreadBps }
              : {}),
            blocked: !input.preflightOk,
          },
        },
    warnings: [
      "Preview only: the perps runtime never calls Rise transaction senders and never signs — live execution must still simulate and sign outside this layer (browser Phoenix desk in the repos' deployment).",
      ...(paper
        ? []
        : ["A live preview with blocked: true is a REFUSAL record, not an order — fix the preflight blockers first."]),
    ],
  };
}

// --------------------------------------------------- TWAMM (external)

export interface TwammAutomationPlan {
  kind: "twammAutomationPlan";
  /** build | test | crank — the bridge's only modes. */
  mode: "build" | "test" | "crank";
  externalWorkspace: string;
  warnings: string[];
}

/**
 * TWAMM in the repos is NOT a perps order type and NOT TWAP: it is a
 * bridge plan to an EXTERNAL Anchor TWAMM (time-weighted AMM, spot)
 * workspace's crank (Perps/twamm-master, app/src/crank.ts). The
 * runner refuses (exit 3) unless CLAWD_TWAMM_LIVE=true +
 * OPERATOR_CONFIRMED=true + an explicit --yes. This descriptor
 * exists so agents do not mistake TWAMM for an order the perps
 * venues can take.
 */
export function buildTwammAutomationPlan(input: {
  mode: "build" | "test" | "crank";
}): TwammAutomationPlan {
  if (!["build", "test", "crank"].includes(input.mode)) {
    throw new PerpsValidationError("mode", 'mode must be "build" | "test" | "crank"');
  }
  return {
    kind: "twammAutomationPlan",
    mode: input.mode,
    externalWorkspace: "Perps/twamm-master (external Anchor workspace; app/src/crank.ts)",
    warnings: [
      "TWAMM here is a spot time-weighted AMM crank in an external workspace — not a perps TWAP/slicing order, and nothing in the perps venues accepts it.",
      "The crank runner is triple-gated (CLAWD_TWAMM_LIVE + OPERATOR_CONFIRMED + --yes) and exits 3 otherwise; this plan authorizes nothing.",
    ],
  };
}
