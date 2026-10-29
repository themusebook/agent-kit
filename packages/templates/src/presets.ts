import {
  buildRegistrationDocument,
  type RegistrationDocument,
  type RegistrationService,
  type SupportedTrustMode,
} from "@themusebook/agent-kit-identity";

/**
 * Venue agent templates: first-class presets that pair registration-
 * document defaults with finance defaults and the capabilities ("caps")
 * an operator must consciously grant. A preset is a TEMPLATE — metadata
 * plus documented behavior — not a trading integration. Where a venue
 * has no documented agent flow in our stack, the preset says so and
 * stays a metadata+finance template (see `sources` on each preset for
 * exactly what grounds every claim).
 */

export type AgentTemplateId =
  | "x402-agent"
  | "raydium-agent"
  | "pump-agent"
  | "stonk-agent"
  | "rwa-agent"
  | "perps-agent"
  | "decision-agent";

export interface TemplateServiceDefault {
  name: string;
  version?: string;
  skills?: string[];
  domains?: string[];
}

export type LaunchRoute =
  | "genesis-bonding-curve"
  | "pump-fun-bonding-curve"
  | "stonkfun-launchlab"
  | "none";

export interface AgentTemplatePreset {
  id: AgentTemplateId;
  name: string;
  summary: string;
  /** Service defaults; endpoints are supplied by the operator at build time. */
  services: TemplateServiceDefault[];
  x402Support: boolean;
  supportedTrust: SupportedTrustMode[];
  finance: {
    launchRoute: LaunchRoute;
    /** What happens at graduation, when the route has one. */
    graduation?: string;
    notes: string[];
  };
  /** Capabilities the operator must explicitly grant/accept for this venue. */
  requiredCaps: string[];
  /** Grounding: the docs/code each claim in this preset comes from. */
  sources: string[];
}

export const X402_AGENT: AgentTemplatePreset = {
  id: "x402-agent",
  name: "x402 Service Agent",
  summary:
    "A pay-per-call service agent: it sells API/tool access over x402 and settles USDC to its Asset Signer PDA.",
  services: [
    { name: "x402", version: "1", domains: ["payments"] },
    { name: "MCP", domains: ["payments", "tools"] },
  ],
  x402Support: true,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "none",
    notes: [
      "No token launch required: revenue is x402 payments, settled to the Asset Signer PDA.",
      "If a token is wanted later, use the finance package's Genesis launch — setToken stays a deliberate, permanent choice.",
    ],
  },
  requiredCaps: [
    "Accept x402 payments in USDC on the classic SPL Token program ONLY (Token-2022 unsupported).",
    "Choose exactly ONE payment mode per integration: standard wallet (ExactSvmScheme), Core asset direct (MetaplexSvmExactScheme + Core Execute), or delegated Mech — and one client style (reactive XOR proactive).",
    "Execute modes require the signer PDA to hold SOL for network fees.",
    "Mech delegation is revocable — status/approve/revoke stay operator-controlled; auth tokens live ~24h in the token store.",
  ],
  sources: [
    "agent-kit payments package (modes.ts): the three Metaplex x402 modes",
    "Musebook hub facilitator: x402 v1 `exact` as deployed (kit payments/x402.ts)",
    "identity metadata: x402Support flag on the EIP-8004 registration document",
  ],
};

export const RAYDIUM_AGENT: AgentTemplatePreset = {
  id: "raydium-agent",
  name: "Raydium Agent",
  summary:
    "An agent whose token graduates to Raydium and which quotes/builds Raydium swaps for its operator to sign.",
  services: [
    { name: "trading", domains: ["defi", "raydium"] },
    { name: "MCP", domains: ["defi"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "genesis-bonding-curve",
    graduation:
      "Genesis bonding-curve graduation AUTO-MIGRATES the pool to a Raydium CPMM pool — no manual migration step.",
    notes: [
      "Launch via finance.buildCreateAndRegisterLaunch (launchType 'bondingCurve'); creator fees default to the Asset Signer PDA.",
      "Spot swaps use the public Raydium Trade API (transaction-v1.raydium.io) — keyless, the same surface the Raydium UI uses.",
    ],
  },
  requiredCaps: [
    "Browser-signing rule (non-negotiable in our stack): the agent BUILDS swap transactions; the user SIGNS in their own wallet. The agent never signs for the user.",
    "Every swap needs the user's fresh approval of exact terms (input/output mint, amount, slippage) — quotes expire in ~30s and are never cached across a long conversation.",
    "setToken: true on the Genesis launch is permanent — confirm the mint is the real one before launching.",
  ],
  sources: [
    "local skill local-raydium-trading (Raydium Trade API quote/build/broadcast, browser-signing rule)",
    "agent-kit finance package: Genesis launch + Raydium CPMM graduation",
  ],
};

export const PUMP_AGENT: AgentTemplatePreset = {
  id: "pump-agent",
  name: "Pump Agent",
  summary:
    "An agent launched on the pump.fun bonding curve that watches the launch stream — now with finance-style flow descriptors for the fun-block agent API (create-coin, swap, fees, agent-payments invoices). Builders only: the API returns unsigned transactions and the user co-signs.",
  services: [
    { name: "trading", domains: ["pump-fun", "memecoins"] },
    { name: "stream", domains: ["pump-fun"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "pump-fun-bonding-curve",
    graduation: "pump.fun graduation migrates the token to the venue's AMM (PumpSwap) per pump.fun's own flow.",
    notes: [
      "v0.3 DEEPENING: the finance package ships pump.fun flow descriptors (finance/src/pump.ts): buildCreateCoinRequest, buildSwapRequest, buildCollectFeesRequest, buildFeeSharingConfigRequest, buildAgentPaymentInvoice. Each returns a request descriptor for POST https://fun-block.pump.fun/agents/... — the API answers an unsigned base64 transaction and the USER co-signs in their own wallet; the kit never signs and never broadcasts.",
      "Swap discipline: check bonding-curve vs graduated-AMM state BEFORE building (the routes differ), slippageBps is REQUIRED on every trade (buildSwapRequest refuses without it), quote first and get a fresh approval of exact terms.",
      "Agent-payments invoices are duplicate-safe via the Invoice ID PDA (@pump-fun/agent-payments-sdk); the server verifies payment ON-CHAIN before delivering — never deliver on an unverified claim.",
      "Launch observation: the Musebook PUMP LIVE stream (pump.musebook.trade, $CLAWD-holder tier; public relay wss://clawd-ws.fly.dev/ws) carries new Pump + Stonk launches.",
      "Honesty note: the fun-block field contract follows the documented agent-API surface in the owner's pump skills; the host was verified live 2026-09-19 but the full POST flows were not live-tested end-to-end — dry-run first.",
    ],
  },
  requiredCaps: [
    "The launch stream is OBSERVATION, not a trading signal — pair it with on-chain verification (supply, authorities, largest holders) and a rug check before acting.",
    "Holder-tier stream access requires a wallet signature challenge (user signs a message; no keys change hands) and any positive $CLAWD balance.",
    "Every pump flow descriptor requires the user's co-signature: the preset grants the kit no execution authority and no key custody.",
  ],
  sources: [
    "local skills local-pump-agents-create-coin / local-pump-agents-swap / local-pump-agents-fees / local-pump-agents-payments (fun-block agent API contract, unsigned-tx + user co-sign doctrine)",
    "local skill local-pump-stream (pump.musebook.trade tiers, challenge/verify auth, observation-not-signal guidance)",
    "agent-kit finance package (pump.ts): the flow descriptors this preset references",
  ],
};

export const STONK_AGENT: AgentTemplatePreset = {
  id: "stonk-agent",
  name: "Stonk Agent",
  summary:
    "An agent on stonk.fun (Stonkfun launchpad) backed by the kit's REAL Stonkfun Developer API client (@themusebook/agent-kit-stonk): reads, API-built launches, BYO LaunchLab launch plans, and Fee Key NFT fee claims. Non-custodial — no API key exists; the caller's wallet signature authorizes launches and claims.",
  services: [
    { name: "trading", domains: ["stonkfun", "launchpad"] },
    { name: "fees", domains: ["stonkfun"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "stonkfun-launchlab",
    notes: [
      "CORRECTION vs v0.2: this preset previously stated the API prepare-launch flow was DISABLED on the venue (a 2026-09-18 probe). Per the official Stonkfun Developer API documentation supplied by the owner, BOTH launch paths exist and which one is live is a runtime fact: GET /stats reports config.paidLaunchesEnabled / config.launchLabEnabled, and the client reads stats BEFORE choosing a path (kit.stonk.chooseLaunchPath). Never hardcode the path.",
      "Path A (API-built): POST /launches/prepare → caller signs the fee payment → POST /launches/submit → poll GET /launches/{paymentSignature}. Never pay twice — the payment signature identifies the launch. Standard-launch creator seat = Token-2022 position / Fee Key NFT (supply 1, decimals 0) minted to the creator.",
      "Path B (BYO LaunchLab, no platform fee): planLaunchLabLaunch validates the pair gates (launchable AND launchLabReady), the mode's tax rules and every derived PDA against GET /launchlab/pricing before returning an initializeWithToken2022 descriptor — totalFundRaisingB is pricing.raise.raw verbatim (the SDK's 85-SOL constant is a trap on non-SOL quotes), and the transfer-fee extension keys are EXACTLY transferFeeBasePoints/maxinumFee (any other key silently yields a zero-rate tax).",
      "Fee claims (locked position + Fee Key NFT launches only): GET /tokens/{mint}/fees → claim prepare → sign AS-IS → submit (idempotent per intent). 403 = no creator position (LaunchLab launches auto-forward creator fees); 409 = nothing claimable yet. A creator-quote-vault scope sweeps ALL of a creator's launches against a quote — claim once per quote, not per mint.",
      "v2 reads (no CORS → server-side only) cover recent launches, token socials and the rewards ledger; v1 keeps tokens/pairs/launches/stats. Rate limits are honored with typed 429s (StonkRateLimitError).",
    ],
  },
  requiredCaps: [
    "Caller signs, kit never does: launches and claims take a caller-supplied signer callback; the kit holds no keys and broadcasts nothing the caller did not sign.",
    "Read /stats before launching and re-fetch pricing before signing — both are priced at request time.",
    "Land a STANDARD LaunchLab launch first and confirm launchpad: \"launchlab\" in GET /tokens/{mint} before building a taxed one: an unadopted taxed mint taxes holders for nobody (the platform withhold authority is set at creation).",
  ],
  sources: [
    "Official Stonkfun Developer API documentation (owner-supplied, authoritative — supersedes the v0.2 launch-disabled claim)",
    "agent-kit stonk package (@themusebook/agent-kit-stonk): the client this preset references",
    "local skill local-stonkfun + themusebook/solana-rwa-agents agents/stonkfun.ts (earlier API surface notes; where they conflict with the official API doc, the doc wins — see docs/migration-v0.3.0.md)",
  ],
};

export const RWA_AGENT: AgentTemplatePreset = {
  id: "rwa-agent",
  name: "RWA Agent",
  summary:
    "An agent PAIRED with a tokenized real-world asset on the owner's RWA program: it trades fractional shares from its keyless Asset Signer PDA under a registered Metaplex identity.",
  services: [
    {
      name: "RWA",
      version: "1",
      domains: ["rwa", "real-estate", "commodities", "art", "equity", "ip"],
    },
    { name: "trading", domains: ["rwa"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation", "crypto-economic"],
  finance: {
    launchRoute: "genesis-bonding-curve",
    notes: [
      "Launch = the RWA stack's shapeCreateAndRegisterLaunch: Genesis createAndRegisterLaunch, launchType 'bondingCurve', agent { mint: <agent Core asset>, setToken: true }, token image on the Irys gateway (agents/launch.ts, agents/types.ts GenesisLaunchPayload).",
      "The agent token is NOT the RWA share token: pairing binds agent ↔ RWA asset ↔ RWA mint as three distinct accounts (agents/pairing.ts AgentRwaPairing).",
    ],
  },
  requiredCaps: [
    "Pairing: ONE agent per RWA asset unless replace: true — replacing a pairing drops the old agent, and it cannot sneak back via bindAgentToken (agents/pairing.ts, README).",
    "setToken is one-shot and permanent: a second bind throws. Never set it on a throwaway mint (README Safety).",
    "Trades spend FROM the Asset Signer PDA: RWA transfer_ownership is built with accounts.from === pairing.assetSigner (agents/trade.ts buildRwaTransferOwnership); fungible mint/transfer/update builders likewise source from the paired signer.",
    "RWA program surface the agent operates against (programs/rwa-tokenization): register_asset (type/name/symbol/description/uri/valuation), tokenize_asset (fractional supply to owner), transfer_ownership, update_asset_metadata, verify_ownership, redeem_asset, set_asset_status (Active · Frozen · Liquidated · Redeemed); asset types RealEstate · Commodity · Artwork · IntellectualProperty · BusinessEquity · Other; initialize carries registration/tokenization/platform-bps fees. Program id in the repo is the placeholder RWA1111111111111111111111111111111111111111.",
    "Dry-run is the default in the RWA stack: nothing broadcasts unless execute: true — the kit preset inherits that posture (builders only, caller signs).",
    "Identity builders align 1:1 with the kit: registerIdentityV1 / registerExecutiveV1 / delegateExecutionV1 / revokeExecutionV1 (agents/identity.ts) — the kit covers registerIdentityV1; executive + delegation builders are the RWA repo's own surface today.",
  ],
  sources: [
    "themusebook/solana-rwa-agents — programs/rwa-tokenization (the RWA smart contract: Anchor program + instruction table in README), agents/ (pairing.ts, launch.ts, trade.ts, identity.ts, types.ts, stonkfun.ts, vault.ts; pairing · identity · genesis · trade client), docs/agent-pairing.md, tests/agents-rwa.test.ts",
    "ONE repo, not two: Solizardking/Solana-RWA-Smart-Contract was the FORMER NAME of solana-rwa-agents (renamed; same 2026-09-11 repo) — the old URL is not a separate live repo (verified 404) and the stale org fork under the old name was deleted. Do not cite it as a separate repo.",
    "This repo grounds this preset read-only; the kit changes it not. (Transferred to the themusebook org on 2026-10-29; the earlier Solizardking/solana-rwa-agents URL redirects.)",
  ],
};

export const PERPS_AGENT: AgentTemplatePreset = {
  id: "perps-agent",
  name: "Perps Agent",
  summary:
    "A perpetuals trading agent on Phoenix-routed venues. Venue variants: Imperial (Phoenix-routed — the grounded variant, via the kit's perps package) and Phoenix-direct (market-data only in this kit: no inspected source places native Phoenix orders). Every order is a descriptor the caller risk-checks and signs — the kit never holds keys and never broadcasts.",
  services: [
    { name: "trading", domains: ["perps", "phoenix", "imperial"] },
    { name: "market-data", domains: ["perps"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "none",
    notes: [
      "No token launch is implied by this preset: a perps agent's finance is margin + risk, not a launch route. (If the agent also wants a token, the Genesis route in finance applies independently.)",
      "Venue variant IMPERIAL (grounded): @themusebook/agent-kit-perps describes orders in the shapes the owner's stacks use — limit price carried in slPrice, TP/SL attached AFTER fill as separate orders (the working bodies always send empty orderFlags), TWAMM block-segmented orders via placeTwammOrder, volatility-scaled grid plans, and Touch probability markets at catalog level (no live Touch order path exists in the sources).",
      "Venue variant PHOENIX-DIRECT (market-data only): the owner's repos reach Phoenix THROUGH Imperial; no native Phoenix placement is described anywhere in the inspected sources, so the kit describes Phoenix reads only and does not invent placement semantics.",
      "Risk gate (perps.evaluatePreTradeRisk) mirrors the source thresholds: $5 min / $1,000 max notional per order, 2x max leverage, $5,000 max total exposure, kill switch, empty-book refusal — refusals throw, they never warn-and-continue. Dry-run is the default posture.",
    ],
  },
  requiredCaps: [
    "Pre-trade risk check before EVERY order: kill switch off, book non-empty, notional/leverage/exposure inside caps — a RiskCheckError stops the trade, full stop.",
    "Caller signs: BOTH source repos sign with a raw keypair loaded from env (no session keys, no delegation anywhere in them) — the kit deliberately diverges: descriptors are plans and signing is always the caller's own arrangement; never import the repos' env-keypair posture into a kit integration.",
    "TP/SL discipline: never encode take-profit/stop-loss as conditional order flags — the working stacks always send empty orderFlags; attach separate reduce orders after the entry fills (bot presets default stopLossPct/takeProfitPct 2–5% / 4–10% by posture).",
    "Price-field discipline: the limit price travels in slPrice; the CLI adapter rejects price-only orders — a transport that drops slPrice loses the price entirely.",
    "PnL discipline: positions read through the agentgateway surface carry PnL + liquidation price; know which surface your decision read before acting on a position.",
  ],
  sources: [
    "Solizardking/clawd-agents-perps (Imperial stack: imperialAgent/imperialBot/imperialWs, twammAutomation, vulcanCatalog; agent-registry identity layers)",
    "Solizardking/clawd-perps-agent (near-identical Imperial core + financial/money.ts risk thresholds + financialClawd tests; agentgateway CLI order semantics)",
    "agent-kit perps package (@themusebook/agent-kit-perps): venue descriptors, risk gate, order descriptors grounded in those repos",
    "NOT grounded: native Phoenix order placement (absent from both repos) — see docs/perps.md for the full overlap/difference notes",
  ],
};

export const DECISION_AGENT: AgentTemplatePreset = {
  id: "decision-agent",
  name: "Decision Agent",
  summary:
    "An agent whose trades are chosen by a typed judgment (TypeSafe/JEV pattern) over a dynamic action space built from the venues reachable right now. Fail-closed to BLOCKED on any malformed or out-of-space answer; paper/dry-run by default; memory recall informs but never widens the action space.",
  services: [
    { name: "decision", domains: ["trading", "jev", "typesafe"] },
    { name: "trading", domains: ["multi-venue"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "none",
    notes: [
      "Decision loop (perps.decision): buildActionSpace(reachableVenues) → DecisionEngine.request(context incl. regime + recall) → judge(rawJudgment) validates shape, space membership and parameter bounds → verdict decided|blocked.",
      "Action conventions from the repo: the space is a closed discriminated union over the venues; sells are NEGATIVE amountUsd (one signed field decides direction — there is no separate amount), basket legs carry poolId + weight in (0,1] with Σ weights ≤ 1, and confidence (0..1) is metadata that never gates execution.",
      "Two-model split in the repo: the NARRATIVE model proposes (it never computes sizes — a numbers-only guardrail recomputes them), and a separate JUDGE model approves or objects over the structured proposal, default-deny: an unparseable verdict is an objection, and an approval with an empty objection field is itself treated as no verdict.",
      "The action space is built ONLY from reachable venues (plus the always-available hold). An action from an unreachable venue — however good the memory of it — is out of space and BLOCKED.",
      "Paper by default: the engine returns plans. The source repo is stricter — its live mode is a hard refusal ('not enabled in v1'); the kit's live verdicts exist only behind an explicit operator opt-in (allowLive: true) at construction, and even then execution stays with the caller behind the perps risk gate.",
      "Regime context (trend/volatility, CoinGecko-sourced in the source stack) rides as decision context; it informs the judgment, it does not gate or widen anything by itself.",
    ],
  },
  requiredCaps: [
    "Fail-closed is non-negotiable: malformed JSON, an unknown action, an out-of-bounds parameter or a bad confidence value all resolve to BLOCKED — never to a default trade.",
    "Memory recall is CONTEXT, never authority: recalled strategies may be described to the judge but the space is built from venue reachability alone (enforced + tested in perps/decision.ts).",
    "Every decided action still passes the venue's own gates before execution (perps risk gate for perps venues; finance builders' validation for launches/swaps). A decision is not a risk approval.",
    "Paper first: run the loop in paper mode against live data before any live opt-in; the source stack's own posture is dry-run only.",
  ],
  sources: [
    "Solizardking/jev-trader-solana (decision.ts/trader.ts decision loop, regime.ts CoinGecko regime context, dynamic venue action space across jupiter/dflow/imperial/pump/stonk modules)",
    "local skill local-clawd-jev-trading (TypeSafe JEV decision brain, dynamic action space, dry-run-only posture)",
    "agent-kit perps package (decision.ts): buildActionSpace / DecisionEngine with fail-closed judging",
  ],
};

export const AGENT_TEMPLATES: readonly AgentTemplatePreset[] = [
  X402_AGENT,
  RAYDIUM_AGENT,
  PUMP_AGENT,
  STONK_AGENT,
  RWA_AGENT,
  PERPS_AGENT,
  DECISION_AGENT,
];

export function getAgentTemplate(id: AgentTemplateId): AgentTemplatePreset {
  const preset = AGENT_TEMPLATES.find((t) => t.id === id);
  if (!preset) throw new Error(`unknown agent template: ${id}`);
  return preset;
}

/**
 * Build a complete EIP-8004 registration document from a preset.
 * Endpoints are operator-supplied per service name — a template must
 * never invent a live endpoint for someone else's agent.
 */
export function buildTemplateRegistration(
  presetOrId: AgentTemplatePreset | AgentTemplateId,
  input: {
    name: string;
    description: string;
    image: string;
    agentId?: string;
    /** Endpoint URL per service name (keys = preset service names). */
    endpoints: Record<string, string>;
    active?: boolean;
  },
): RegistrationDocument {
  const preset = typeof presetOrId === "string" ? getAgentTemplate(presetOrId) : presetOrId;
  const services: RegistrationService[] = preset.services.map((s) => {
    const endpoint = input.endpoints[s.name];
    if (!endpoint) {
      throw new Error(
        `template ${preset.id}: no endpoint supplied for service "${s.name}" — endpoints are operator-supplied, never invented`,
      );
    }
    return {
      name: s.name,
      endpoint,
      ...(s.version ? { version: s.version } : {}),
      ...(s.skills ? { skills: s.skills } : {}),
      ...(s.domains ? { domains: s.domains } : {}),
    };
  });
  return buildRegistrationDocument({
    name: input.name,
    description: input.description,
    image: input.image,
    services,
    supportedTrust: [...preset.supportedTrust],
    x402Support: preset.x402Support,
    agentId: input.agentId,
    active: input.active,
  });
}
