# Perps + decision agents (`@musebook/perps`)

Two v0.3 additions share one package: **perps venue descriptors, the
preflight risk report and order descriptors** (for the `perps-agent`
preset) and the **JEV decision engine** (for the `decision-agent`
preset). Both are descriptor/plan level: the kit never holds keys
and never broadcasts.

Grounding: the owner's perps stacks — `Solizardking/clawd-agents-perps`
("repo A") and `Solizardking/clawd-perps-agent` ("repo B") — and the
decision stack `Solizardking/jev-trader-solana`, all inspected
read-only at file level. This repo changes none of them.

> **Grounding correction (2026-10-29):** an earlier draft of this
> package was built on a faulty research pass (it described an
> "agentgateway" CLI, an `slPrice` price field, `money.ts`
> thresholds, grid/TWAP/Touch support — none of which exist in
> either repo). Everything below follows the file-level inspection;
> the correction is recorded here rather than silently rewritten.

## The two source repos: overlap and differences

Same package name/version/bin (`@solanaclawd/clawd-agents-perps@0.1.0`);
`api.ts` / `env.ts` / `errors.ts` are blob-identical across both, and
the Imperial client/bot code is recognisably the same lineage — A is
the evolved copy:

- **Repo A (clawd-agents-perps)** — the perps-specialised one: real
  `@ellipsis-labs/rise@0.4.19` read adapter (13 typed methods),
  HTTP server + Telegram + frontend, Imperial normalisers, four
  perps test files. RPC priority: Solana Tracker first.
- **Repo B (clawd-perps-agent)** — A's ancestor forked into a
  multi-rail "Financial Clawd": its Phoenix adapter wraps a vendored
  **stub** (`@openclawdsolana/clawd-perps`, empty-success results)
  with a Vulcan-binary fallback; its new code is mostly NON-perps
  (0x swaps, Robinhood Chain launch, RWA hints, Blockscout truth).
  RPC priority: Helius first (opposite of A). Only tests: the
  financial-clawd + zeroex suites.
- A third copy lives privately inside `clawd-core-ai` — not
  separately audited for this package.

## Topology — read this before choosing

The owner named "Phoenix perps" and "Imperial (Phoenix-routed)".
The repos' actual topology is different, and the kit describes it
as found:

| Piece | What it actually is |
|---|---|
| **Phoenix** | The perps venue. Read via the Rise SDK (`perp-api.phoenix.trade`) in A; via the stub in B. |
| **Vulcan** | Phoenix's own CLI/MCP — the execution-PLAN + catalog layer. The runtime builds Vulcan plans and previews; market orders only. |
| **Imperial** | A ROUTER across four underwriters — Jupiter (0), Flash Trade (1), **Phoenix (2, default)**, GMTrade (3) — at `api.imperial.space`. The one real submission path: `POST /mobile/orders`, server-side under JWT. |

Neither repo is a live-trading codebase by default: both are
observe/paper/preview systems. The perps runtime **never signs and
never calls Rise transaction senders** ("live execution must still
simulate and sign outside this adapter" — the browser Phoenix desk
in A's deployment). Imperial doesn't sign locally either: its JWT
comes from an externally-signed mobile-connect challenge, wallet
config is pubkey-only, and `placeOrder` defaults to dry-run unless
`IMPERIAL_LIVE=true` + JWT.

## Order descriptors (`orders.ts`)

`kit.perps.*` or standalone:

- `buildImperialOrder` — a `MobileCreateOrderRequest` descriptor:
  action Increase|Decrease, side long|short, underwriter (default
  Phoenix), numeric `OrderType` (0 Market, 1 Limit, 2 StopLimit,
  3 LandMine, 4 Ratchet, 6 RatchetEntry, 9 DCA, 10 FibRatchet,
  11 FibRatchetEntry, 12–16 DCA-close family), `sizeUsd`,
  `slippageBps` (default 50), `triggerPrice` converted to the
  **1e9 oracle scale** + `triggerCondition` Above|Below,
  `profileIndex` 0..5, `dryRun: true` unless live+JWT are asserted.
- `buildImperialBatchPlan` — TP/SL the repos' way: submitted WITH
  the entry via `placeBatch({entry, closeOrders})`; TP = Decrease
  Limit (Above for a long), SL = Decrease StopLimit (Below);
  conditions invert for shorts.
- `buildPerpsTradePreview` — the runtime's preview shape: paper →
  Vulcan `paper-buy`/`paper-sell`; live → `rise/order.place` with
  `blocked: !preflightOk` riding in the payload. A blocked live
  preview is a refusal record, not an order.
- `buildTwammAutomationPlan` — TWAMM is a bridge to an EXTERNAL
  Anchor TWAMM (time-weighted AMM, **spot**) workspace crank —
  triple-gated (CLAWD_TWAMM_LIVE + OPERATOR_CONFIRMED + --yes). Not
  a perps order type, not TWAP.

**Absent from both repos** (searched explicitly): grid quoting,
TWAP slicing, Touch binaries. The closest exotic surface is
Imperial's DCA/Ratchet/FibRatchet/LandMine order codes.

## The preflight report (`risk.ts`)

`buildPreflightReport(ctx, req)` — the repos' own model (config.ts,
same rules in both): a verdict object `{ ok, mode, blocking,
warnings }`, never an exception. Defaults:

| Check | Default | Blocking reason |
|---|---|---|
| RPC configured | required | `missing-rpc` |
| Wallet configured | required | `missing-wallet` |
| Symbol allowlist | SOL, ETH, BTC | `symbol-not-allowed` |
| Max notional | $250 | `notional-cap` |
| Max leverage | 3x | `leverage-cap` |
| Max spread | 40 bps | `spread-cap` |
| Live execution | mode must be `live` | `live-not-armed` |

Mode resolution (`resolveTradingMode`): `live` only when
LIVE_TRADING && OPERATOR_CONFIRMED && !PERPS_SIM_ONLY — and sim-only
**defaults true**, so the unarmed mode is observe/paper.

The **Imperial layer** runs stricter numbers ($100 max size,
50 bps slippage) with a different failure style: it **clamps**
oversize orders (`clampImperialSize` surfaces this) where
preflight blocks. Both behaviors are exposed; merging them
silently would hide a real resize of the caller's order.

What does NOT exist in either repo: any aggregate-exposure,
margin-ratio or seat-state **check**. Margin/risk fields appear on
Phoenix trader views as display data only — the kit does not
invent gates the repos don't have.

## The decision engine (`decision.ts`) — JEV pattern

From `jev-trader-solana` — precisely: its `decision.ts` offers a
**fixed operation enum** (BUY_SPOT / SELL_SPOT / LONG_PERP /
SHORT_PERP / HOLD / PAUSE) plus slippage-target heads (s10/s25/s50)
to a TypeSafe/JEV judgment; the model never chooses size, venue or
price. Answers follow the `validateChoice` contract (probability
keys exactly the id set, finite in [0,1], sum ≈ 1, choice = argmax);
failures return a **PAUSE sentinel** (`jevOk: false` + reason);
sub-0.9-confidence directional answers downgrade to HOLD; venue
reachability/staleness is enforced after the judgment in
deterministic code. A separate regime judgment (bullish/bearish/chop
+ momentum + volatility) can pause the cycle outright. Paper is the
repo's only implemented mode.

The kit generalizes the reachability enforcement INTO the space —
the dynamic-space form the repo's README attributes to the
companion `clawd-jev-trading-machine`:

```
buildActionSpace(reachableVenues)   // ONLY reachable venues contribute actions; hold is always present
engine.request({ regime, recall })  // recall rides as CONTEXT
engine.judge(rawJudgment)           // → { status: "decided", … } | { status: "blocked", reason }
```

Invariants, enforced and tested:

- **Fail-closed.** Malformed judgments, unknown actions,
  out-of-bounds parameters, bad confidence → `blocked` (the kit's
  verdict name; the repo's equivalent is the PAUSE sentinel with
  `jevOk: false`). Never a default action, never a coercion.
- **Recall never widens the space.** Memory notes inform the judge;
  the space is built from venue reachability alone. A judgment
  naming a recalled-but-unreachable action is blocked, with the
  reason saying exactly that. (Kit design: jev-trader-solana itself
  has NO cross-run memory — in-process state plus an append-only
  events journal only.)
- **Paper by default.** The repo is stricter still — paper is its
  only implemented mode, with no live path and no signing code. The
  kit's `mode: "live"` requires `allowLive: true` at construction
  as an explicit operator extension, and the engine still only
  returns verdicts; execution stays with the caller behind the
  risk gate above.

> Grounding precision: the portable pieces mirrored from
> jev-trader-solana are the choice-answer contract
> (`validateChoice`), the fail-closed sentinel discipline, the
> confidence downgrade, deterministic sizing/routing outside the
> model, and the regime-gate shape. The reachability-built action
> space, `decided|blocked` verdict names, and recall-as-context are
> the kit's generalizations — the dynamic-space pattern is
> attributed by jev-trader-solana's README to the companion repo
> `clawd-jev-trading-machine`, which was not the inspection target
> here. (An earlier draft of this doc misattributed companion-repo
> shapes — signed amountUsd, basket legs, narrative/judge two-model
> split, decay-weighted recall — to jev-trader-solana; corrected
> against the file-level inspection.)
