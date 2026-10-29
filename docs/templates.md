# Venue templates (`@themusebook/agent-kit-templates`)

Seven first-class presets. Each pairs **registration-document defaults**
(services, `x402Support`, supported trust) with **finance defaults**
(launch route, graduation) and the **required caps** — the capabilities
an operator must consciously grant for that venue. Every preset lists
its `sources`: the docs/code its claims are grounded in.

A preset is a template, not an execution integration:
`buildTemplateRegistration(preset, { name, description, image, agentId?,
endpoints })` produces a complete, valid EIP-8004 document — and it
**refuses to invent endpoints** (service endpoints are operator-supplied
per service name).

| Preset | Launch route | x402 | One-line shape |
|---|---|---|---|
| `x402-agent` | none (revenue = payments) | ✅ | sells pay-per-call services, settles USDC to the Asset Signer PDA |
| `raydium-agent` | Genesis bonding curve → Raydium CPMM graduation | — | launches via Genesis, quotes/builds Raydium swaps for the user to sign |
| `pump-agent` | pump.fun bonding curve | — | finance pump flow descriptors (create-coin/swap/fees/invoices); user co-signs everything |
| `stonk-agent` | stonk.fun — API path or BYO LaunchLab, chosen from `/stats` at runtime | — | backed by the real `@themusebook/agent-kit-stonk` client (see stonk.md) |
| `rwa-agent` | Genesis bonding curve | — | agent paired 1:1 with a tokenized real-world asset; trades from the Asset Signer PDA |
| `perps-agent` | none (margin + risk, not a launch) | — | Phoenix venue via Rise/Vulcan + Imperial router orders; preflight-report risk model (see perps.md) |
| `decision-agent` | none | — | JEV typed judgment over a dynamic, reachability-built action space; fail-closed, paper default (see perps.md) |

## The venues, honestly

- **x402-agent** — the only preset advertising `x402Support: true`.
  Caps encode the commerce rules: USDC classic SPL only, one payment
  mode per integration, reactive XOR proactive client style, signer-PDA
  SOL for execute modes, revocable Mech delegation.
- **raydium-agent** — the non-negotiable from our Raydium stack: the
  agent **builds**, the user **signs** (browser wallet). Quotes expire
  in ~30s; exact terms get fresh approval every time.
- **pump-agent** — **deepened in v0.3**: the finance package now
  ships pump.fun flow descriptors for the fun-block agent API
  (create-coin, swap, collect-fees, fee-sharing config, agent-payment
  invoices). The API returns unsigned transactions; the user
  co-signs; `slippageBps` is required on every swap; the launch
  stream (pump.musebook.trade) remains **observation, not a trading
  signal** — verify on-chain and rug-check before acting.
- **stonk-agent** — **corrected in v0.3**: the v0.2 claim that the
  API prepare-launch flow was disabled (a 2026-09-18 probe) is
  superseded by the official Stonkfun Developer API documentation.
  The preset is now backed by the real client
  (`@themusebook/agent-kit-stonk`, docs/stonk.md): both launch paths
  exist, `/stats` decides which is live at runtime, BYO LaunchLab
  launches are planned + adoption-validated, and Fee Key NFT claims
  carry typed 403/409 semantics. See docs/migration-v0.3.0.md.
- **perps-agent** — grounded in the owner's two perps repos with
  the topology stated plainly: Phoenix is the venue (Rise SDK read
  plane in clawd-agents-perps; a vendored stub in clawd-perps-agent),
  Vulcan is the plan/preview layer, and Imperial is a
  multi-underwriter router + the one real (JWT, server-side,
  dry-run-default) submission path. The preflight report, Imperial
  order/batch descriptors and the absent-features list (no grid,
  TWAP, Touch, or exposure checks in either repo) live in
  `@themusebook/agent-kit-perps` (docs/perps.md).
- **decision-agent** — the JEV pattern from jev-trader-solana:
  typed judgment over a dynamic action space built from reachable
  venues, fail-closed to BLOCKED, paper by default, memory recall
  as context only (docs/perps.md).
- **rwa-agent** — grounded in the owner's RWA repo (see below):
  pairing (one agent per RWA unless `replace: true`), the Genesis
  launch shape, Asset-Signer-sourced trades, the program's instruction
  surface and asset classes, and the dry-run-default posture.

## RWA grounding + schema mapping

The `rwa-agent` preset is drawn from
**themusebook/solana-rwa-agents** (read-only source; transferred to the
themusebook org on 2026-10-29 — the earlier
`Solizardking/solana-rwa-agents` URL redirects). The RWA smart contract
lives **inside this same repo** at `programs/rwa-tokenization`.

> **Former name — not a separate repo:** `Solana-RWA-Smart-Contract` was
> the former name of this same repo (renamed to `solana-rwa-agents`;
> same 2026-09-11 creation, same tree). The old
> `Solizardking/Solana-RWA-Smart-Contract` URL no longer resolves
> (verified 404), and the stale org fork under the old name was deleted.
> Do not cite it as a separate live repo.

The kit changes this repo in no way.

Mapping between the RWA repo's own types (`agents/types.ts`) and the
kit:

| RWA repo | Kit equivalent |
|---|---|
| `Erc8004Registration` (`type`, name, description, image, services, active, registrations, supportedTrust) | `identity.RegistrationDocument` — same shape, plus the `x402Support` field from the fuller EIP-8004 profile |
| `AgentService` { name, endpoint, version?, skills?, domains? } | `identity.RegistrationService` — identical fields |
| `AgentRwaPairing` { agentAsset, agentIdentity, assetSigner, rwaAsset, rwaAssetId, rwaMint?, agentToken?, agentTokenBound } | no kit type — pairing is RWA-specific state; the kit resolves its pieces via `identity.resolve()` (asset, identity PDA, signer, `agentToken`) |
| `GenesisLaunchPayload` / `shapeCreateAndRegisterLaunch` | `finance.buildCreateAndRegisterLaunch` — same endpoint, same body shape |
| `buildSetAgentToken` (Core Execute wrap) | `finance.buildSetAgentTokenV1` — same wrap, plus the `acknowledgePermanent: true` gate |
| `buildRegisterIdentity` → `registerIdentityV1` | `identity.buildRegisterIdentityV1` — typed descriptor |
| `registerExecutiveV1` / `delegateExecutionV1` / `revokeExecutionV1` builders (`agents/identity.ts`) | **not in the kit yet** — executive/delegation execution stays on the RWA repo's surface (the kit's auth package reads delegation state only) |

| Program `programs/rwa-tokenization` (placeholder id `RWA1111111111111111111111111111111111111111`) | referenced in the preset's caps (instruction surface, asset types, status lifecycle); the kit ships no RWA program client |

Related, and distinct: this repo's own `examples/rwa-raydium-agent`
(added upstream) registers/tokenizes RWAs against a devnet program
(`8CM5WK2EXXY9goXaTRnmKvFAxiSfVAmmTWBVX7X5zvBc`) and trades on the
clawd AMM/Raydium — a runnable example, not the solana-rwa-agents
program the preset's caps describe. Do not conflate the two program ids.

Program facts baked into the preset's caps: asset types RealEstate ·
Commodity · Artwork · IntellectualProperty · BusinessEquity · Other;
instructions initialize (registration/tokenization/platform-bps fees) ·
register_asset · tokenize_asset · transfer_ownership ·
update_asset_metadata · verify_ownership · redeem_asset ·
set_asset_status (Active · Frozen · Liquidated · Redeemed).
