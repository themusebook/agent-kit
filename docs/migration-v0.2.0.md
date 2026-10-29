# Migration — v0.1.x → v0.2.0

v0.2.0 is a **feature release** (not a 0.1.2 patch): the kit becomes the
"proper" build aligned to the full Metaplex agent surface — Register /
Read / Finance / Commerce — plus venue templates. Everything in v0.1
keeps working; the breaking surface is deliberately tiny.

## What was added

- **identity** — hosted-API `agentMetadata` model split from the
  EIP-8004 registration document (`uri` vs `agentMetadata` exactly as
  the Metaplex mint docs define them); typed hosted-API errors
  (`AgentValidationError` / `AgentApiNetworkError` / `AgentApiError` +
  guards); `buildAgentMint()` (the unsigned step) beside
  `registerIdentity()`; a caller `txSender` hook; `buildRegisterIdentityV1()`
  for existing assets; DAS agent reads (`is_agent` / `asset_signer` /
  `agent_token`, `searchAgentAssets()`, `fetchAgentIdentity()`,
  lifecycle checks); full EIP-8004 document shape (rich services,
  `x402Support`).
- **`@musebook/finance`** (new) — Genesis
  `createAndRegisterLaunch` builder + HTTP adapter with the Genesis
  error taxonomy; `setAgentTokenV1` behind an
  `acknowledgePermanent: true` gate.
- **payments** — the three Metaplex x402 modes as typed schemes,
  USDC-classic-SPL validation, execute-mode PDA-SOL checks, reactive XOR
  proactive style guard, Mech delegate client, 24h auth-token stores.
- **`@musebook/templates`** (new) — x402 / raydium / pump /
  stonk / rwa presets.
- **client** — `kit.finance.*` and `kit.templates.*` namespaces.

## What changed (small, deliberate)

- **Hosted mint network value**: v0.1 sent `"solana"` for mainnet; the
  documented value is `"solana-mainnet"` (devnet was already
  `"solana-devnet"`). Fixed in the mint payload.
- **Registration image rule**: still requires a *permanent* URI, but
  Irys/Arweave gateway URLs are now accepted alongside `ipfs://` /
  `ar://` (the owner's stacks publish images via Irys).
- **`registerIdentity` input**: `metadataUri` is deprecated in favor of
  the documented `uri` (the alias still works); a new optional
  `agentMetadata` input is preferred over the legacy `document` partial.
- **`ResolvedAgent`** gained `agentIdentity` (PDA) and
  `lifecycleChecks` fields; `isAgent` now prefers the DAS `is_agent`
  flag when the indexer provides it.

## The v0.1 exclusion, narrowed

v0.1 excluded token launch entirely. v0.2 adds launch **builders**
(Genesis payloads + the permanent binding) — but the standing rules are
unchanged: the kit never holds keys, never broadcasts without the
caller's signer/adapter, and permanent actions carry explicit warnings
and opt-in gates. pump.fun and stonk.fun execution remain outside the
kit (templates only).
