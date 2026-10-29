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
  | "rwa-agent";

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
    "An agent launched on the pump.fun bonding curve that watches the launch stream. Metadata + finance template: pump.fun execution tooling lives OUTSIDE the kit.",
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
      "The kit ships NO pump.fun SDK: launches/trades run through the operator's pump.fun tooling; this preset standardizes the agent's identity, metadata and caps only.",
      "Launch observation: the Musebook PUMP LIVE stream (pump.musebook.trade, $CLAWD-holder tier; public relay wss://clawd-ws.fly.dev/ws) carries new Pump + Stonk launches.",
    ],
  },
  requiredCaps: [
    "The launch stream is OBSERVATION, not a trading signal — pair it with on-chain verification (supply, authorities, largest holders) and a rug check before acting.",
    "Holder-tier stream access requires a wallet signature challenge (user signs a message; no keys change hands) and any positive $CLAWD balance.",
    "Bonding-curve buys/sells are the operator's explicit actions through their own tooling — the preset grants the kit no execution authority.",
  ],
  sources: [
    "local skill local-pump-stream (pump.musebook.trade tiers, challenge/verify auth, observation-not-signal guidance)",
    "themusebook/skills pump-fun family (pump/pumpfun/*) for the venue's playbooks",
  ],
};

export const STONK_AGENT: AgentTemplatePreset = {
  id: "stonk-agent",
  name: "Stonk Agent",
  summary:
    "An agent on stonk.fun (Stonkfun launchpad). Honest status: the API prepare-launch flow is currently DISABLED on the venue; the live launch path is the self-built Raydium LaunchLab flow.",
  services: [
    { name: "trading", domains: ["stonkfun", "launchpad"] },
    { name: "fees", domains: ["stonkfun"] },
  ],
  x402Support: false,
  supportedTrust: ["reputation"],
  finance: {
    launchRoute: "stonkfun-launchlab",
    notes: [
      "Live launch path (verified 2026-09-18): self-built against Raydium LaunchLab — a launch PLAN is built and validated first (quote pair launchable + LaunchLab-ready, pricing, tax tier); the plan signs NOTHING.",
      "API flow (prepare → sign → submit via POST /launches/prepare) exists in the venue's API and in the owner's RWA repo (agents/stonkfun.ts), but POST /launches/prepare currently returns 503 service_unavailable ('New launches on this venue are disabled; launch through LaunchLab instead', /stats paidLaunchesEnabled: false). Do not present the API-prepare flow as available.",
      "Creator seat on a standard launch is a Token-2022 position NFT (decimals 0, supply 1): mint it to take custody, burn it to release; claim fees as its holder (GET /tokens/{mint}/fees → claim prepare → sign → submit).",
    ],
  },
  requiredCaps: [
    "Prepare → browser-sign → submit everywhere: the API builds unsigned transactions; the user signs in their own wallet; no endpoint signs on anyone's behalf.",
    "Never pay a launch fee twice: after submit, poll GET /launches/{paymentSignature}; a service_unavailable with charged: false means unpaid — take a fresh prepare.",
    "Keep the creator position NFT in a Backpack wallet (per the RWA repo's stonkfun notes).",
  ],
  sources: [
    "local skill local-stonkfun (API surface, verified 2026-09-18 launch-disabled note, LaunchLab planner)",
    "themusebook/solana-rwa-agents agents/stonkfun.ts + README StonkFun section (prepare/submit/poll, position NFT, fee claims) — that repo's former name was Solana-RWA-Smart-Contract",
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

export const AGENT_TEMPLATES: readonly AgentTemplatePreset[] = [
  X402_AGENT,
  RAYDIUM_AGENT,
  PUMP_AGENT,
  STONK_AGENT,
  RWA_AGENT,
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
