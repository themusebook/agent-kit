/**
 * Perps venue descriptors.
 *
 * Grounding (inspected 2026-10-29): Solizardking/clawd-agents-perps
 * and Solizardking/clawd-perps-agent are near-identical Imperial
 * stacks (the former adds Solana agent-registry/identity layers; the
 * latter financial-research modules). In BOTH, the tradeable venue is
 * **Imperial** — Phoenix-routed perps on Solana via the Vulcan / Rise
 * SDK (market making) and the `imperial` CLI (operator trading over
 * the agentgateway). Phoenix appears as Imperial's underlying routing
 * venue plus Phoenix market-data surfaces (Rise `PhoenixPerpsClient`,
 * orderbook/trades/funding readers); NEITHER repo contains a native
 * Phoenix order-placement integration.
 *
 * So this module is honest about its two venue variants:
 * - `imperialVenue` — GROUNDED. Descriptors mirror the repos' actual
 *   shapes (see orders.ts for the field-level semantics).
 * - `phoenixDirectVenue` — NOT GROUNDED in the inspected repos. It is
 *   a market-data descriptor only (the workspace's local-phoenix skill
 *   covers Phoenix perps market data); order placement through a
 *   native Phoenix SDK is deliberately NOT described here, because
 *   nothing inspected implements it. Callers who need Phoenix-native
 *   placement integrate the Phoenix SDK directly — the kit will not
 *   invent its semantics.
 *
 * Trading doctrine (same as finance): descriptors and plans only.
 * The kit never holds keys and never broadcasts; the caller signs.
 */

export type PerpsVenueId = "imperial" | "phoenix-direct";

export interface PerpsVenueDescriptor {
  id: PerpsVenueId;
  name: string;
  /** What routes the orders (for Imperial: Phoenix, via Vulcan/Rise + the agentgateway CLI). */
  routing: string;
  /** "grounded" = shapes mirror inspected source; "market-data-only" = reads grounded, placement NOT described. */
  grounding: "grounded" | "market-data-only";
  /** Read surfaces an agent may rely on (all read-only). */
  marketDataReads: string[];
  /** Order capabilities this descriptor covers (empty = placement not described). */
  orderCapabilities: string[];
  /** Program / SDK anchors from the source repos, when known. */
  anchors: Record<string, string>;
  notes: string[];
}

export const imperialVenue: PerpsVenueDescriptor = {
  id: "imperial",
  name: "Imperial (Phoenix-routed)",
  routing:
    "Phoenix perps, routed through Imperial: order placement goes through the agentgateway MCP/CLI (an `imperial-mcp` stdio tool surface, or the hosted HTTP gateway), with Rise SDK order functions vendored in-repo (placeLimitOrder / placeTwammOrder); market data comes from the Rise perp API and the Phoenix autobahn WebSocket; the `@phoenix-sdk/perps` package supplies Phoenix types (vendored type-only). A separate Rust Vulcan workspace in the source repos is a quoting catalog, not the TS order path.",
  grounding: "grounded",
  marketDataReads: [
    "Markets / order books / trades / funding / open interest (Rise perp API, keyless: perp-api.rise.trade)",
    "Trader state, positions, balances, open orders (agentgateway MCP intel + trade reads; positions via this surface carry PnL + liquidation price)",
    "Phoenix autobahn WebSocket: order books, trades, funding, price and trader-state streams",
    "Touch market catalog + live bid/ask probability stream (touch.phoenix.trade) — catalog-level in the source repos; see the Touch note in orders.ts",
  ],
  orderCapabilities: [
    "limit orders — the price travels in the slPrice field (see orders.ts: the CLI JSON adapter builds slPrice and rejects price-only orders; a plain price never reaches the venue)",
    "market orders with sizeInBaseLots",
    "take-profit / stop-loss — attached AFTER the entry fills, as separate limit orders (the working stacks always send empty orderFlags; conditional flags are not the mechanism)",
    "TWAMM orders (placeTwammOrder): a total size segmented across durationBlocks / intervalBlocks",
    "grid market-making — volatility-scaled two-sided quote bands around mid (plan math grounded; the source bot's place/cancel grid loop is stubbed 'not wired')",
    "reduce/close via negative sizeInBaseLots on the same market (the repos' own convention, not a documented API semantic)",
  ],
  anchors: {
    phoenixProgram: "4TNDfZHMtp4NsV3jNnH4KzJpDTxNuYJUoV2qerFKBE",
    phoenixPlaza: "5nz4FqHvWcVL7wFaECB4cTXMkSxhF4rTVNULoWGrCDLF",
    riseMarketData: "https://perp-api.rise.trade",
    agentgatewayMcp: "https://mcp.agentgateway.dev",
    phoenixAutobahnWs: "wss://autobahn.phoenix.trade/v2/ws",
    touchRest: "https://touch.phoenix.trade",
  },
  notes: [
    "Signing in BOTH source repos is a raw local keypair loaded from env (RISE_WALLET_PRIVATE_KEY / SOLANA_PRIVATE_KEY_BASE58 / IMPERIAL_PRIVATE_KEY_BASE58); there are NO session keys or delegation anywhere in either repo. The kit deliberately diverges: its descriptors assume CALLER signing and hold no key at all — do not import the repos' env-keypair posture into a kit integration.",
    "The two repos are near-identical: clawd.json is byte-identical, imperialBot.ts is byte-identical (30,817B); imperialAgent.ts and imperialWs.ts differ (agents-perps runs larger — it adds registry/identity layers; perps-agent adds financial-research modules + the only real tests).",
  ],
};

export const phoenixDirectVenue: PerpsVenueDescriptor = {
  id: "phoenix-direct",
  name: "Phoenix (direct)",
  routing:
    "Native Phoenix perps on Solana (program id as configured in the source repos: 4TNDfZHMtp4NsV3jNnH4KzJpDTxNuYJUoV2qerFKBE; Plaza 5nz4FqHvWcVL7wFaECB4cTXMkSxhF4rTVNULoWGrCDLF). In the owner's stacks Phoenix is reached THROUGH Imperial; no inspected repo places orders natively.",
  grounding: "market-data-only",
  marketDataReads: [
    "Phoenix perps market data (workspace skill local-phoenix)",
    "Markets / books / trades / funding via the Rise perp API (public, keyless) and the Phoenix autobahn WebSocket",
  ],
  orderCapabilities: [],
  anchors: {
    phoenixProgram: "4TNDfZHMtp4NsV3jNnH4KzJpDTxNuYJUoV2qerFKBE",
  },
  notes: [
    "Order placement is NOT described: nothing in clawd-agents-perps / clawd-perps-agent implements native Phoenix placement, and the kit does not invent venue semantics. Use the imperialVenue descriptors (Phoenix-routed) or integrate the Phoenix SDK directly.",
  ],
};

export const PERPS_VENUES: readonly PerpsVenueDescriptor[] = [
  imperialVenue,
  phoenixDirectVenue,
];

export function getPerpsVenue(id: PerpsVenueId): PerpsVenueDescriptor {
  const v = PERPS_VENUES.find((x) => x.id === id);
  if (!v) throw new Error(`unknown perps venue: ${id}`);
  return v;
}
