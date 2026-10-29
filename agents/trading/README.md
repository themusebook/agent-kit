# Trading agents

Five agents that read markets and build Solana transactions. They never sign or send anything. Each launch, trade, perps order and claim comes back as an **unsigned** v0 transaction (base64), and your wallet signs it. A LaunchLab or Pump.fun create transaction is the one exception: it arrives partially signed by a fresh mint keypair. That keypair is generated in memory, used once to co-sign, and never written anywhere.

| Agent | Folder | Source |
| --- | --- | --- |
| Stonk (market data, launch, trade, claim) | `src/stonk` | Stonk Developer API OpenAPI 2.0.0, plus `@raydium-io/raydium-sdk-v2` 0.2.79-alpha for the LaunchLab path and trading |
| Pump.fun founder (create, dev buy, curve and PumpSwap trades, creator fees, fee sharing) | `src/pumpfun-founder` | `pump-fun/pump-public-docs` at 639b87f, `@pump-fun/pump-sdk` 4.3.1, `@pump-fun/pump-swap-sdk` 2.2.0 |
| Perps (Phoenix and Imperial behind one `PerpsVenue`) | `src/perps` | `@ellipsis-labs/rise` 0.6.4 for Phoenix; Imperial REST routes from `Solizardking/clawd-perps-agent` at 95c87be |
| Decision | `src/decision` | `Solizardking/jev-trader-solana` `src/decision.ts` at 8faeade (MIT) |
| pumpai MCP reader | `src/pumpfun-founder/mcp.ts` | Live probe of `https://pumpai.ai/mcp` |

## Rules the code enforces

- The kit never takes a private key, a keypair file or a seed. `assertNoSecrets` rejects them in any input or CLI flag, and a test fails if a source file uses `fromSecretKey`, `PRIVATE_KEY`, `readFileSync`, dotenv or `bs58.decode`.
- There is no trading loop. The decision agent returns a `TradeProposal` with `requiresUserSignature: true`. An executor turns that proposal into one unsigned transaction.
- The network defaults to devnet. Stonk runs only on mainnet-beta. Without `--rpc`, the CLI uses a dry-run blockhash, so the transaction is for inspection only and cannot land.
- When no model is configured, the decision agent fails closed to `PAUSE`.

## CLI

```
musebook stonk tokens|recent|paths|launch|trade|claim ...
musebook pump create|buy|sell|claim|fees|distribute|mcp ...
musebook perps markets|order --venue phoenix|imperial ...
```

`musebook stonk` prints every flag. The CLI is `bun src/cli.ts` and needs bun.

## Stonk

| Guard | Where |
| --- | --- |
| `totalFundRaisingB` comes from `raise.raw`, which must be an integer string | `launchlab.ts` |
| `configId`, `allowConfig` and `curveRule` are derived with the SDK and checked against `/launchlab/pricing` before any build | `launchlab.ts` |
| `allowConfig` then `curveRule` are appended as the last two read-only accounts; `keys[10]` must be Token-2022 and `keys[11]` must be `pair.tokenProgram` | `assertCreateShape` |
| The transfer fee object has exactly `transferFeeBasePoints` and `maxinumFee` | `transferFeeParams` |
| Reward bps must be in `modes.reward.transferFeeBps`. `standardV2` must be in `transferFeeBpsRange` and enabled. Community mode needs `communityMode.offeredOnThisQuote` | `checkTax` |
| A taxed launch is refused until a standard launch is confirmed with `launchpad: "launchlab"` | `buildLaunchLabInstructions` |
| A 429 waits for `Retry-After` (or `retryAfterSeconds`), then retries up to two times | `http.ts` |
| A `creator-quote-vault` claim runs once per quote mint | `planClaim` |
| Claim submit returns `alreadySubmitted` | `submitSignedClaim` |
| v2 is server-side only and is refused when `window` exists | `StonkClient` |

The two-call `/launches` flow is not verified. The spec references `POST /launches/prepare` only in prose and publishes no request schema and no submit step. Live `/stats` reports `paidLaunchesEnabled: false`. `prepareLaunch` is therefore a passthrough that refuses to run while that flag is off. Use the LaunchLab path (`launchLabEnabled: true`).

Stonk has no trading endpoint. `stonk trade` builds Raydium LaunchLab `buyToken` and `sellToken` transactions for the pool.

## Pump.fun founder

| Step | Doc | SDK call |
| --- | --- | --- |
| Create (`create_v2`, name ≤ 32, symbol ≤ 13, uri ≤ 200) | `docs/instructions/COIN_CREATION.md` | `PUMP_SDK.createV2Instruction` |
| Create with a dev buy | `docs/instructions/COIN_CREATION.md`, `docs/instructions/BUY.md` | `createV2AndBuyV2Instructions`, `getBuyTokenAmountFromSolAmount` |
| Bonding-curve buy and sell | `docs/instructions/TRADE_V3.md` | `buyExactQuoteInV3Instructions`, `sellV3Instructions` |
| PumpSwap trade after graduation | `docs/instructions/PUMP_SWAP_TRADE_V2.md`, `docs/PUMP_SWAP_SDK_README.md` | `swapSolanaState`, `buyQuoteInput`, `sellBaseInput` |
| Collect creator fees | `docs/instructions/COLLECT_CREATOR_FEE.md`, `docs/PUMP_CREATOR_FEE_README.md` | `collectCoinCreatorFeeAllQuotesInstructions` |
| Fee sharing config (shares total 10000 bps) | `docs/instructions/CREATOR_FEE_SHARING.md`, `docs/FEE_PROGRAM_README.md` | `createFeeSharingConfig`, `updateFeeSharesV2` |
| Distribute shared fees | `docs/instructions/CREATOR_FEE_SHARING.md` | `transferCreatorFeesToPumpV2`, `distributeCreatorFeesV2` |
| Program ids and IDLs | `README.md`, `idl/` | `PUMP_PROGRAM_ID`, `PUMP_AMM_PROGRAM_ID`, `PUMP_FEE_PROGRAM_ID` |

Gaps in the docs:

- **Metadata and image upload is not documented.** The docs only show `"<your ipfs uri>"`, so `pump create` requires `--uri` and uploads nothing.
- Cashback is deprecated, so it is not offered.
- Collecting creator fees does not apply to a coin that has a sharing config. Use `pump distribute` for those.

## Perps

`PerpsVenue` has `markets`, `positions` and `buildOrder`. Every order needs a `priceLimitUsd`.

- **Phoenix:** Rise builds the market order packet and the instruction. `kitToWeb3` converts the instruction from `@solana/kit` account roles into a web3 instruction, and the result is wrapped in an unsigned transaction.
- **Imperial:** reads use `/status`, `/phoenix/markets`, `/gmtrade/funding-rates`, `/positions` and `/orders`. `buildDeposit` calls `POST /deposit/build-tx` and hands back the transaction unsigned. Imperial is a multi-underwriter router (Jupiter 0, Flash 1, Phoenix 2 as default, GMTrade 3, the codes in clawd-perps-agent `src/imperialAgent.ts`). Its only order submit is `POST /mobile/orders` under a JWT session, which upstream keeps dry-run unless `IMPERIAL_LIVE=true` plus a token. No wallet-signable order tx comes back, which breaks the user-signs-every-transaction rule, so `buildOrder` returns `status: "disabled"` with a preview.

## pumpai MCP

Probed on 2026-10-29 with `initialize` and `tools/list` only:

- Transport is Streamable HTTP with JSON responses. The server issues an `mcp-session-id` and allows CORS `*`.
- No auth is required.
- The server is `clawd-pump` 2.1.0, protocol `2025-06-18`, with capabilities tools, resources and logging.
- It lists three tools, all with `readOnlyHint: true`: `get_health`, `get_recent_launches` and `render_launch_feed`.

`PUMPAI_MCP_URL` overrides the default URL. A tool is exposed only when it has `readOnlyHint` and its name does not start with a write verb. Every other tool is disabled because the kit has no way to route a remote write through your wallet.

## Ported and dropped

| From | Kept | Dropped, and why |
| --- | --- | --- |
| jev-trader-solana | The decision state, question heads, `validateChoice`, confidence downgrade and fail-closed path | `askJev` (needs model credentials), `PRIVATE_KEY` config and `.env` loading (key rule), and the trading loop and executors (no unsigned-tx boundary) |
| clawd-perps-agent | Imperial routes and the Phoenix venue choice | Telegram, the server, market-maker and TWAMM loops (they auto-trade), vulcan CLI shelling, and the Fly and Docker files |
| clawd-agents-perps | Nothing. Its venue code is a subset of clawd-perps-agent | It has no Pump.fun code, so the founder agent is built from pump-public-docs |

## Tests

`bun test` runs 48 tests offline. They use fixtures from the Stonk spec, a live-captured pricing response, the Pump IDLs and the pumpai probe, with mocked HTTP.
