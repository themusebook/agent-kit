# Venue templates (`@themusebook/agent-kit-templates`)

Five first-class presets. Each pairs **registration-document defaults**
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
| `pump-agent` | pump.fun bonding curve | — | identity/metadata template; pump.fun execution stays in the operator's own tooling |
| `stonk-agent` | stonk.fun via Raydium LaunchLab | — | LaunchLab plan-first launches; position-NFT creator seat; fee claims |
| `rwa-agent` | Genesis bonding curve | — | agent paired 1:1 with a tokenized real-world asset; trades from the Asset Signer PDA |

## The venues, honestly

- **x402-agent** — the only preset advertising `x402Support: true`.
  Caps encode the commerce rules: USDC classic SPL only, one payment
  mode per integration, reactive XOR proactive client style, signer-PDA
  SOL for execute modes, revocable Mech delegation.
- **raydium-agent** — the non-negotiable from our Raydium stack: the
  agent **builds**, the user **signs** (browser wallet). Quotes expire
  in ~30s; exact terms get fresh approval every time.
- **pump-agent** — **the kit ships no pump.fun SDK.** The preset
  standardizes identity + caps; the launch stream (pump.musebook.trade)
  is **observation, not a trading signal** — verify on-chain and rug-
  check before acting on anything it shows.
- **stonk-agent** — carries a live-status warning: the venue's API
  prepare-launch flow (`POST /launches/prepare`) currently returns 503
  ("launch through LaunchLab instead", verified 2026-09-18 against
  `/stats`). The preset therefore routes launches through the LaunchLab
  planner (plan first, signs nothing) and documents the creator
  position NFT + fee-claim flow from the RWA repo's `agents/stonkfun.ts`.
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
