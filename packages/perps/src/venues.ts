/**
 * Perps venue descriptors — grounded in the file-level inspection of
 * Solizardking/clawd-agents-perps ("repo A") and
 * Solizardking/clawd-perps-agent ("repo B"), 2026-10-29.
 *
 * The topology is NOT "two venues, Phoenix and Imperial":
 * - **Phoenix** is the perps venue. It is read through the Rise SDK
 *   (`@ellipsis-labs/rise`, perp-api.phoenix.trade) in repo A; repo B
 *   wraps a vendored STUB of the same surface (empty-success results)
 *   with a fallback to the Vulcan binary. Vulcan is Phoenix's own
 *   CLI/MCP execution-plan + catalog layer in both repos.
 * - **Imperial** (api.imperial.space) is a ROUTER across four
 *   underwriters — Jupiter (0), Flash Trade (1), Phoenix (2),
 *   GMTrade (3) — with Phoenix the default. It is the one real
 *   submission path in either repo, and it does not sign locally:
 *   orders are submitted server-side under a JWT.
 *
 * Neither repo is a live-trading codebase by default: both are
 * observe/paper/preview systems with refuse-by-default live gates,
 * and the kit's descriptors inherit that posture — plans only, the
 * kit never holds keys and never broadcasts.
 *
 * Repo differences that matter: A is the evolved perps copy (real
 * Rise adapter, 13 typed read methods; HTTP server + Telegram +
 * frontend; four perps test files). B is A's ancestor forked into a
 * multi-rail "Financial Clawd" (0x swaps, RH launch, RWA hints,
 * Blockscout truth) whose perps read plane is the stub. Same package
 * name/version/bin (@solanaclawd/clawd-agents-perps@0.1.0);
 * api.ts/env.ts/errors.ts are blob-identical across both.
 */

export type PerpsVenueId = "phoenix" | "imperial";

export interface PerpsVenueDescriptor {
  id: PerpsVenueId;
  name: string;
  role: string;
  /** Read surfaces an agent may rely on (all read-only). */
  marketDataReads: string[];
  /** Order capabilities this descriptor covers. */
  orderCapabilities: string[];
  /** Endpoints / identifiers from the source repos. */
  anchors: Record<string, string>;
  notes: string[];
}

export const phoenixVenue: PerpsVenueDescriptor = {
  id: "phoenix",
  name: "Phoenix (via Rise SDK + Vulcan)",
  role:
    "The perps venue itself. Market data and trader state are read through the Rise SDK (repo A) against perp-api.phoenix.trade; repo B substitutes a vendored stub with identical method names and empty-success results, falling back to the Vulcan binary. Vulcan (Phoenix's CLI/MCP) is the execution-plan/catalog layer: the runtime builds Vulcan plans and paper/live PREVIEWS — market orders only — and never calls Rise transaction senders.",
  marketDataReads: [
    "listMarkets / getTicker / getAllTickers (PhoenixPerpMarketView / PhoenixTickerView: mark, spot, funding, OI, best bid/ask, mid, spreadBps)",
    "getOrderbook(symbol, depth≤100), getCandles, getFundingRates, getMarketStats (repo A adapter)",
    "getTraderState / getTraderSnapshot / getMarginView / getPositions (subaccounts carry collateral, margins, riskState/riskTier as DISPLAY fields)",
    "health()",
  ],
  orderCapabilities: [
    "preview-only in the perps runtime: previewPaperTrade (Vulcan paper-buy/paper-sell) and previewLiveTrade (route rise/order.place, blocked unless preflight ok) — nothing is signed or submitted by this layer",
  ],
  anchors: {
    riseApiBase: "https://perp-api.phoenix.trade",
    riseSdk: "@ellipsis-labs/rise@0.4.19 (repo A; repo B vendors @openclawdsolana/clawd-perps stub instead)",
  },
  notes: [
    "Repo B's read plane is a STUB: its adapter returns empty-success results ({success:true, data:[]}) — treat B's Phoenix reads as placeholders, A's as the real surface.",
    "No seat-state, margin-ratio or aggregate-exposure CHECK exists in either repo: margin/risk fields are displayed on trader views, never gated on.",
  ],
};

export const imperialVenue: PerpsVenueDescriptor = {
  id: "imperial",
  name: "Imperial (multi-underwriter router)",
  role:
    "A router across four underwriters — Jupiter (0), Flash Trade (1), Phoenix (2, the default), GMTrade (3) — not a venue itself. The one real submission path in either repo: POST /mobile/orders, server-side, under a JWT obtained by an externally-signed mobile-connect challenge. The client never sees a private key (wallet config is pubkey-only).",
  marketDataReads: [
    "getStatus, getFundingRates, getMarkPrices, getPhoenixMarkPrices, getPhoenixDepth, getPhoenixMarkets",
    "getFlashMarkets, getGMTradeMarkets, getGMTradeFundingRates (the router's reads span all four underwriters)",
    "getPositions / getOrders / getTrades (?walletAddress=), getPassthroughOrders, getRoute (route recommendation), getPriorityFee",
    "scoreImperialMarket: composite signal (momentum 0.40 + funding 0.40 + liquidity 0.20), ±0.25 → buy|sell|watch",
  ],
  orderCapabilities: [
    "MobileCreateOrderRequest: action Increase|Decrease, side long|short, numeric OrderType (0 Market, 1 Limit, 2 StopLimit, 3 LandMine, 4 Ratchet, 6 RatchetEntry, 9 DCA, 10 FibRatchet, 11 FibRatchetEntry, 12 DcaClose, 13 DcaTimeClose, 14 DcaRatchetClose, 15 DcaTime, 16 DcaRatchet), sizeUsd (6-dec fixed), triggerPrice at 1e9 oracle scale + triggerCondition Above|Below",
    "TP/SL via placeBatch({entry, closeOrders}): TP = Decrease Limit (condition Above), SL = Decrease StopLimit (condition Below), submitted WITH the entry as one batch",
    "cancelOrder / updateOrder / editCollateral; buildDepositTx returns an UNSIGNED transaction",
    "dry-run by default: placeOrder(req, dryRun = !config.live); a real submit requires IMPERIAL_LIVE=true AND a JWT",
  ],
  anchors: {
    imperialApiBase: "https://api.imperial.space/api/v1",
    ordersEndpoint: "POST /mobile/orders",
    batchEndpoint: "POST /mobile/orders/batch",
  },
  notes: [
    "Imperial is not Phoenix-routed-by-default in the sense of a single venue: Phoenix is one of four underwriters (the default). Kit copy that calls Imperial 'the Phoenix venue' is wrong.",
    "The Imperial layer CLAMPS oversize orders to its max (min(sizeUsd, maxSizeUsd)) where the perps preflight BLOCKS — see risk.ts; the kit surfaces both behaviors rather than picking one silently.",
  ],
};

export const PERPS_VENUES: readonly PerpsVenueDescriptor[] = [phoenixVenue, imperialVenue];

export function getPerpsVenue(id: PerpsVenueId): PerpsVenueDescriptor {
  const v = PERPS_VENUES.find((x) => x.id === id);
  if (!v) throw new Error(`unknown perps venue: ${id}`);
  return v;
}
