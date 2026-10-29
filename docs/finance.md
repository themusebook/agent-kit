# Finance — agent tokens (`@themusebook/agent-kit-finance`)

The finance package covers the agent-token lifecycle as **typed builders
plus caller-supplied submission adapters**. The kit builds and validates
payloads; it never holds keys and never broadcasts on its own — the same
posture as the RWA stack's "dry-run default, `execute: true` opt-in".

## Create + register a launch (Genesis)

`buildCreateAndRegisterLaunch(input)` shapes the Metaplex Genesis
`createAndRegisterLaunch` call — the same payload the owner's RWA stack
shapes in `agents/launch.ts`:

```
POST https://api.metaplex.com/v1/genesis/launch
{ wallet, agent: { mint, setToken }, launchType: "bondingCurve",
  token: { name, symbol, image, description?, externalLinks? },
  launch: { firstBuyAmount?, ... }, network? }
```

Validation (all client-side, `GenesisValidationError` with `.field`):

| Field | Rule |
|---|---|
| `token.name` | 1–32 characters |
| `token.symbol` | 1–10 characters |
| `token.image` | MUST be an Irys gateway URL (`https://gateway.irys.xyz/...`) |
| `token.description` | ≤ 250 characters |
| `wallet`, `agent.mint` | valid public keys |

Semantics worth knowing before you launch:

- **`launch.firstBuyAmount`** — the first buy is **fee-free**.
- **Creator fees** route to the agent's **Asset Signer PDA** by default
  (the keyless identity treasury). `creatorFeeWallet` overrides —
  deliberately, never silently.
- **Graduation** — at curve completion the pool **auto-migrates to a
  Raydium CPMM pool**. `AgentLaunchStatus` models the two phases
  (`bondingCurve` → `graduated`); there is no manual migration step.
- **Devnet** — test the flow on `solana-devnet` with
  **`setToken: false`** (see below why).

Submission: `createGenesisHttpAdapter()` POSTs a built payload and maps
failures onto the Genesis taxonomy — `GenesisValidationError` /
`GenesisApiNetworkError` / `GenesisApiError` (with `statusCode` +
`responseBody`), guarded by `isGenesisValidationError` /
`isGenesisApiNetworkError` / `isGenesisApiError`. Or bring your own
`GenesisLaunchAdapter` (an operator's signing pipeline, a queue, a
dry-run logger).

## setAgentTokenV1 — the permanent bind

`buildSetAgentTokenV1({ asset, tokenMint, acknowledgePermanent: true })`

An agent's canonical token (`agent_token` in DAS reads) is bound in one
of two ways:

1. **Atomically at launch** — `createAndRegisterLaunch` with
   `agent.setToken: true`.
2. **After the fact** — `setAgentTokenV1`, wrapped in MPL Core Execute
   so the Asset Signer PDA is the executing authority.

⚠️ **The binding is ONE-SHOT and IRREVERSIBLE.** Once set it cannot be
changed or cleared, and a second bind fails. The builder therefore
**refuses** — `PermanentBindingRefusalError` — unless the caller passes
`acknowledgePermanent: true`. This is deliberate friction, modeled on
the RWA stack's "setToken: true is permanent. Do not set it on a
throwaway mint."

Until a token is bound, DAS reads show **no `agent_token`** for the
asset — `identity.resolve()` returns `agentToken: null`, which is a
normal state, not an error.

## pump.fun flows (v0.3) — descriptors for the fun-block agent API

`finance/pump.ts` deepens the `pump-agent` preset from metadata into
flow descriptors for `POST https://fun-block.pump.fun/agents/...`,
grounded in the owner's pump skill family. Same doctrine as Genesis:
builders validate and return a `PumpRequestDescriptor`
(`{ kind, endpoint, body, transactionEncoding: "base64",
requiresUserSignature: true, warnings }`); `createPumpHttpAdapter()`
POSTs only when the caller invokes it, and the API's answer is an
**unsigned transaction the user co-signs** — the agent never signs
for the user.

| Builder | Endpoint | Notes |
|---|---|---|
| `buildCreateCoinRequest` | `/agents/create-coin` | metadata + optional initial buy / cashback / mayhem / tokenized-agent & buyback bps |
| `buildSwapRequest` | `/agents/swap` | **`slippageBps` REQUIRED** (no default exists to invent); `marketState` (`bonding-curve` \| `graduated-amm`) must be checked first — the routes differ; exactly one of `amountSol`/`amountTokens` |
| `buildCollectFeesRequest` | `/agents/collect-fees` | creator fees or cashback; inspect the fee destination first |
| `buildFeeSharingConfigRequest` | `/agents/sharing-config` | recipient shares are bps and **must sum to exactly 10000** |
| `buildAgentPaymentInvoice` | (@pump-fun/agent-payments-sdk) | invoice descriptor anchored by the **Invoice ID PDA** (duplicate-safe); server MUST verify payment **on-chain before delivering** |

Errors: `PumpValidationError` (`.field`) / `PumpApiNetworkError` /
`PumpApiError`, with `is*` guards. Honesty note: the field contract
follows the skills' documented API surface — the fun-block host was
verified live (2026-09-19) but the full POST flows were not
live-tested end-to-end; dry-run first and verify the returned
transaction before signing.

## What finance does NOT do

- No bonding-curve trading, sniping, or market making — launch +
  binding, plus the pump flow descriptors above.
- No stonk.fun surface — that venue has its own real client package
  now (`@themusebook/agent-kit-stonk`, docs/stonk.md).
- No custody: payloads are data; signing belongs to the caller.
