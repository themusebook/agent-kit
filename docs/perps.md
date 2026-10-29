# Perps + decision agents (`@themusebook/agent-kit-perps`)

Two v0.3 additions share one package: **perps venue descriptors +
a pre-trade risk gate** (for the `perps-agent` preset) and the
**JEV decision engine** (for the `decision-agent` preset). Both are
descriptor/plan level: the kit never holds keys and never broadcasts;
the caller risk-checks, signs, and submits.

Grounding: the owner's perps stacks — `Solizardking/clawd-agents-perps`
and `Solizardking/clawd-perps-agent` — and the decision stack
`Solizardking/jev-trader-solana`. All three were inspected read-only;
this repo changes none of them.

## The two source repos: overlap and differences

`clawd-agents-perps` and `clawd-perps-agent` are **near-identical
Imperial stacks** (same Imperial agent/bot/WS core, same `.gitignore`;
the perps-agent files run somewhat smaller). They differ at the edges:

- **clawd-agents-perps** adds Solana agent-registry/identity layers
  (clawd.json, imperial-state) on top of the trading core.
- **clawd-perps-agent** adds financial-research modules
  (`financialClawd` / `financialDomain` / `grokCore`, 0x swaps,
  Blockscout truth checks) and the one real test suite
  (`financial-clawd.test.ts`, `zeroex-swap.test.ts`); its
  `financial/money.ts` carries the canonical risk thresholds the
  kit's risk gate mirrors.
- A third copy of the perps-agent package also lives privately
  inside `clawd-core-ai` — the standalone repos above are the
  grounding sources; the core-ai copy was not separately audited for
  this package.

## Venue variants — read this before choosing

The owner named two venues: **Phoenix perps** and **Imperial
(Phoenix-routed)**. The inspected sources support them asymmetrically,
and the kit says so rather than papering over it:

| Variant | Status in the kit | Why |
|---|---|---|
| **Imperial (Phoenix-routed)** | GROUNDED descriptors | Both repos trade Imperial: placement via the agentgateway MCP/CLI with Rise SDK order functions vendored in-repo; Phoenix is the routing venue underneath. |
| **Phoenix (direct)** | Market-data ONLY | Phoenix appears in the repos as Imperial's underlying venue + market-data surfaces (Rise perp API, Phoenix autobahn WS, `@phoenix-sdk/perps` types). **No inspected repo places a native Phoenix order.** The kit describes reads and refuses to invent placement semantics; integrate the Phoenix SDK directly for native placement. |

Program anchor as configured in both repos' `src/config.ts`:
Phoenix V1 `4TNDfZHMtp4NsV3jNnH4KzJpDTxNuYJUoV2qerFKBE`
(Plaza: `5nz4FqHvWcVL7wFaECB4cTXMkSxhF4rTVNULoWGrCDLF`).

## Imperial order descriptors (`orders.ts`)

Plans in the shapes the stacks use, `kit.perps.*` or standalone:

- `buildImperialPlaceOrder` — limit/market. **The limit price travels
  in `slPrice`**: the CLI's JSON adapter builds `slPrice` from its
  price argument and rejects price-only orders — a transport that
  drops or renames the field loses the price entirely. Size in base
  lots; **negative size = reduce/close** (the repos' own convention).
- `buildTakeProfitStopLossPlan` — TP/SL **after fill**, as separate
  limit orders on the exit side. The working order bodies always
  carry empty `orderFlags` — conditional TP/SL flags are not the
  mechanism anywhere in either repo. Bot preset defaults:
  stopLossPct / takeProfitPct 2–5% / 4–10% by posture.
- `buildTwammOrder` — TWAMM (`placeTwammOrder`, the SDK's spelling):
  a total size segmented across `durationBlocks` at `intervalBlocks`
  cadence. Not a recurring order. Descriptor-level: the bot's
  automation-layer place/cancel calls are stubbed.
- `buildGridPlan` — grid levels in imperialBot's math: inner quotes
  at ±(volatility + 0.5%), outer at ±(volatility + (volatility +
  2.5%)) around mid, as a pure plan. (The source bot's grid
  place/cancel are stubs — the loop is the caller's to wire.)
- `buildTouchOrder` — Touch binaries, **catalog-level only**: in
  clawd-agents-perps Touch is a vendored catalog + live probability
  stream (plus a demo stub); in clawd-perps-agent it does not appear
  at all. No live Touch order path exists in the sources, so the
  descriptor is marked NOT a submittable order.

Signing in the source stacks is a **raw keypair from env**
(`RISE_WALLET_PRIVATE_KEY` / `SOLANA_PRIVATE_KEY_BASE58` /
`IMPERIAL_PRIVATE_KEY_BASE58`) — no session keys or delegation
anywhere. The kit deliberately diverges: caller signing, no keys.

## The risk gate (`risk.ts`)

`evaluatePreTradeRisk` runs BEFORE any order is signed. Thresholds
mirror `clawd-perps-agent`'s `financial/money.ts`:

| Gate | Default | Refusal code |
|---|---|---|
| Kill switch | off (engage = refuse all) | `kill-switch` |
| Empty order book | refuse | `empty-market` |
| Min notional | $5 | `sizing-floor` |
| Max notional / order | $1,000 | `notional-cap` |
| Max leverage | 2x | `leverage-cap` |
| Max total exposure | $5,000 | `exposure-cap` |

Refusals throw `RiskCheckError` — there is no warn-and-continue.
(The repos' own checks return `{ allowed, reason }` verdicts; the
kit throws deliberately, because a refusal that can be ignored is
not a gate.) `sizePerpsOrder` mirrors `calculatePositionSize`:
equity × pct, refused above the per-order cap, base size floored to
lot multiples, sub-floor results refused. The bot layer adds posture
presets (`PERPS_RISK_PRESETS`, verbatim: conservative $50 position /
$25 daily loss / 2x; balanced $200 / $100 / 3x; aggressive $500 /
$250 / 5x, with stopLossPct / takeProfitPct) and a daily-loss
circuit breaker (`maxDailyLossUsd` gate). ⚠️ **The layers disagree
on leverage**: bot presets default up to 5x; the financial layer
hard-caps 2x. The kit's default policy follows the stricter 2x.
**Dry-run is the default** in both repos and in
`PerpsRiskPolicy.dryRun`.

## The decision engine (`decision.ts`) — JEV pattern

From `jev-trader-solana` (decision loop in `decision.ts`/`trader.ts`,
CoinGecko regime context in `regime.ts`, venue modules for
jupiter/dflow/imperial/pump/stonk):

```
buildActionSpace(reachableVenues)   // ONLY reachable venues contribute actions; hold is always present
engine.request({ regime, recall })  // recall rides as CONTEXT
engine.judge(rawJudgment)           // → { status: "decided", … } | { status: "blocked", reason }
```

Invariants, enforced and tested:

- **Fail-closed.** Malformed judgments, unknown actions,
  out-of-bounds parameters, bad confidence → `blocked`. Never a
  default action, never a coercion. (The repo's judge gate is
  default-deny the same way: an unparseable verdict is an objection;
  an approval carrying an empty objection field is itself no
  verdict.)
- **Recall never widens the space.** Memory notes inform the judge;
  the space is built from venue reachability alone. A judgment
  naming a recalled-but-unreachable action is blocked, with the
  reason saying exactly that.
- **Paper by default.** The repo is stricter still — `runLive()`
  throws "not enabled in v1". The kit's `mode: "live"` requires
  `allowLive: true` at construction as an explicit operator
  extension, and the engine still only returns verdicts; execution
  stays with the caller behind the risk gate above.

> Grounding precision: jev-trader-solana has **no single canonical
> "judgment" type** — the pattern is a pipeline (decision.ts's
> discriminated `TradeAction` union + `TradeDecision`, book.ts's
> numbers-only `Book`/`LegPlan` guardrail, jev.ts's approve/objection
> gate, trader.ts's paper-only loop, memory.ts's decay-weighted
> journal recall, regime.ts's CoinGecko narrative labels
> calm_uptrend/chop/panic/rebound/mania). The kit mirrors those
> seams with its own type names; it does not claim the repo's exact
> exported identifiers beyond the ones named here. The repo's memory
> is a LOCAL append-only journal with tau-decay recall (~7-day
> half-life) — not Supermemory (that lives in the separate
> clawd-jev-trading-machine project).
