# @musebook/x402-metaplex

Metaplex x402 agents for the kit: paid inference (OpenAI-compatible chat + images), paid Solana RPC/DAS,
free discovery (`getModels`, `getPricing`) and delegate status — built on
[`@metaplex-foundation/x402@0.1.0`](https://github.com/metaplex-foundation/x402), behind a **spend guard
that never pays unless you configure it to.**

| Mode | Factory | Who pays | Needs |
|---|---|---|---|
| Standard wallet | `createStandardPayer(signer, { guard })` | the wallet (ExactSvmScheme) | USDC, no SOL |
| Core asset / agent direct | `createCoreAssetPayer(signer, { asset, rpcUrl, guard })` | the asset's **Asset Signer PDA** (`MetaplexSvmExactScheme` + `coreExecute`) | PDA holds USDC + SOL; owner signs each payment |
| Delegated | `createDelegatedPayer(signer, { asset, rpcUrl, guard, strategy })` | Asset Signer PDA, executed by Metaplex | one `delegateApprove` (on-chain), then **either** `"reactive"` (client extension) **or** `"proactive"` (fetch wrapper) — never both; in-memory 24h SIWX token; `delegateRevoke` anytime |

## Spend guard (default: discovery-only)

```ts
const guard = spendGuardFromEnv(); // X402_MODE=pay, X402_MAX_PER_REQUEST_USD, X402_SESSION_BUDGET_USD
```
- `mode: "discovery"` (default) — every 402 is decoded and **refused** before anything is signed.
- `mode: "pay"` — pays only if the challenge's cheapest USDC requirement is ≤ `maxPerRequestUsd` (default $0.05)
  and ≤ the remaining `sessionBudgetUsd` (default $0.25). Failed paid retries are not counted.
- Non-USDC assets are refused. `checkCapsAgainstPricing(guard)` warns when your cap is below the live
  `/x402/pricing` minimum (currently $0.001/request; RPC $0.00001 default).
- The guard is installed as the *inner* fetch of `wrapFetchWithPayment`, so it sees the 402 first.

## Tools

`createX402Tools({ fetch, guard, owner? })` → `x402_models`, `x402_pricing`, `x402_chat`, `x402_image`, `x402_rpc`,
`x402_das_get_asset`, `x402_das_assets_by_owner`, `x402_delegate_status`, `x402_delegate_approve`
(pay mode + `confirm: true`), `x402_delegate_revoke` (`confirm: true`), `x402_budget`.

Providers: `new OpenAI(openAIOptions(fetchWithPayment))`, `createOpenAICompatible(vercelProviderOptions(fetchWithPayment))`.

RWA + Raydium tie-in: `rwaAgentX402Tools({ ownerSigner, agentAsset, solanaRpcUrl, guard, via })` — the RWA
agent's Asset Signer PDA (its keyless treasury) pays via `coreExecute`, or via the delegate.

## Keys
`SVM_PRIVATE_KEY` (base58 64-byte) from env only, via `signerFromEnv()`. Never logged, returned, or put in errors.

## Notes
- `@metaplex-foundation/x402@0.1.0` ships ESM with extensionless relative imports: run with `tsx`/a bundler
  (plain `node` ESM cannot resolve it). Vitest inlines it (see `vitest.config.ts`).
- Paid endpoints are mainnet USDC (`solana:5eykt4…`). Live tests here only hit the free endpoints:
  `X402_LIVE=1 pnpm vitest run packages/x402-metaplex/test/live.test.ts`.
