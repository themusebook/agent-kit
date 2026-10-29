# Stonkfun (`@themusebook/agent-kit-stonk`)

A real client for the **official Stonkfun Developer API**
(stonkfun.xyz) — the kit's `stonk-agent` preset is backed by this
package, reachable as `kit.stonk.*` or standalone via
`createStonkClient()`.

**Non-custodial by design: there is no API key.** Nothing to sign up
for and no dashboard. Reads are open (per-IP rate limits). Writes are
authorized by **your wallet's signature** on the fee payment / claim
transaction — the client accepts a caller-supplied signer callback
for those steps and never holds keys, never signs, and never
broadcasts anything you did not sign.

> **Correction vs v0.2:** the v0.2 templates doc stated the API
> prepare-launch flow was disabled on the venue (a 2026-09-18 probe).
> The official API documentation supersedes that: both launch paths
> exist, and which is live is a **runtime fact** read from
> `GET /stats`. See `docs/migration-v0.3.0.md`.

## Two API surfaces

| | v1 | v2 |
|---|---|---|
| Base | `https://www.stonkfun.xyz/api/public/v1` | `https://www.stonkfun.xyz/api/v2` |
| Envelope | `{ data, meta }` | bare body |
| Errors | `{ error: { code, message } }` | `{ error: string }` |
| CORS | yes | **none — server-side only** |

Use v2 for reads where a v2 endpoint exists (recent launches, token
socials, the rewards ledger); v1 keeps tokens/pairs/launches/stats,
pricing and all writes. The client maps both error shapes onto
`StonkApiError` (`statusCode`, `code` when the venue sends one) and
429s onto `StonkRateLimitError` with the `Retry-After` value.

```ts
import { createAgentKit } from "@themusebook/agent-kit";
const kit = createAgentKit({ signer });

// Which launch path is live RIGHT NOW — never hardcode it.
const stats = await kit.stonk.getStats();
const path = kit.stonk.chooseLaunchPath(stats); // "api" | "launchlab"

const tokens = await kit.stonk.listTokens({ sort: "marketCap", status: "new" });
for await (const pool of kit.stonk.iterateRecentLaunches({ limit: 100 })) { /* … */ }
```

## v2 pagination

Every v2 list pages by cursor: `limit` (1–100, default 25), `order`
(desc|asc), `cursor`; responses carry `page: { limit, order,
nextCursor }`. **Only `nextCursor: null` ends iteration** — a page
can be short or empty before the end. `paginateV2` / `collectV2`
implement this (with a repeated-cursor loop guard), and the client's
`iterate*` methods stream on top.

## Launch path A — API-built

```
prepareLaunch(input)            POST /launches/prepare   (25/min)
  → { transaction }             the fee-payment transaction
sign(transaction)               YOUR signer callback — signature IS the authorization
submitLaunch({ signedTransaction, paymentSignature })
                                POST /launches/submit    (idempotent by payment signature)
waitForLaunch(paymentSignature) GET  /launches/{paymentSignature} until status ≠ "processing"
```

**Never pay twice.** The payment signature identifies the launch; if
a signed payment's state is unclear, poll — do not prepare a second
one. On a standard launch the creator's seat is a **Token-2022
position NFT (the Fee Key NFT: supply 1, decimals 0)** minted to the
creator; creator fees accrue to its holder.

## Launch path B — BYO Raydium LaunchLab (no platform fee)

Build the launch yourself against Raydium's LaunchLab program and
the platform adopts it (token page, chart, fee ledger, holder
rewards) — **provided** the pool carries the platform id and matches
the published launch shape exactly. `planLaunchLabLaunch` consumes
`GET /launchlab/pricing?quoteMint=` + a `GET /pairs` pair and a PDA
deriver (in practice the `getPda*` helpers of
`@raydium-io/raydium-sdk-v2`, which the kit deliberately does not
depend on), validates everything, and returns an
`initializeWithToken2022` descriptor. It checks the derived
config/allow-config/curve-rule against the pricing response and
**refuses on any mismatch** ("your SDK and this API disagree").

Rules the planner encodes — all from the venue's documentation:

- The pair must be **launchable AND launchLabReady** (two different
  gates: platform rule vs. the on-chain GlobalConfig existing).
- `totalFundRaisingB` = **`pricing.raise.raw`** verbatim — a raw
  integer in the quote's decimals. ⚠️ Raydium's own 85-SOL constant
  is a trap on non-SOL quotes (850 units on an 8-decimal xStock,
  85,000 on a 6-decimal stablecoin).
- Curve from `pricing.curve` (ConstantCurve, `migrateType: "cpmm"`,
  venue supply/totalSellA); platform id per mode from the **same**
  pricing response (`platform.standard/.reward/.community/.standardV2`).
- Append the platform **allow-config, then curve-rule**, as the last
  two accounts, both read-only (missing → error 6018; off-shape →
  6025). `validateBuiltLaunchLabInstruction` checks a built
  instruction's keys; `validateLaunchLabAdoptionShape` encodes the
  full adoption checklist as a pure function.
- Modes: **standard** (untaxed), **reward** (published
  `transferFeeBps` tiers only), **community** (reward + the quote
  offers it), **standardV2** (whole-bps inside
  `modes.standardV2.transferFeeBpsRange`, fee recipients, never
  community).

### ⚠️ The two silent failures

1. **Transfer-fee extension keys.** The extension parameters take the
   EXACT key names the Raydium SDK declares: `transferFeeBasePoints`
   and **`maxinumFee`** (sic). Any other key is silently ignored —
   you get an extension with a **zero rate**: a mint that looks like
   a reward coin and taxes nobody.
2. **Quote token program at account 11.** The SDK supplies the
   **classic SPL** program there. A Token-2022 quote (every xStock)
   needs that key substituted with the pair's `tokenProgram` before
   signing. Read it from the pair — never assume. (Account 10, the
   base token program, is always Token-2022.)

And the adoption warning: **an unadopted taxed mint taxes holders for
nobody** — the transfer tax accrues to the platform withhold
authority set at creation, undistributed, forever. Land a **standard**
launch first and confirm `launchpad: "launchlab"` in
`GET /tokens/{mint}` before building a taxed one. Pricing is priced
at request time — re-fetch if you sat on the response.

## Fee claims

For launches carrying a creator position (locked position + Fee Key
NFT — the API-built standard path):

```
getTokenFees(mint)                       → { claimable, scope?, reason? }  (no wallet needed)
prepareFeeClaim(mint, creatorWallet)     → unsigned tx, 90s validity      (20/min)
sign AS-IS                               altering the instructions invalidates it
submitFeeClaim(mint, { creatorWallet, intentId, signedTransaction })
                                         idempotent: a timed-out intent resubmits to the
                                         ORIGINAL signature + alreadySubmitted: true
```

`claimTokenFees(mint, wallet, sign)` runs the whole flow. Typed
errors: **403 → `StonkClaimForbiddenError`** (no creator position:
LaunchLab launches auto-forward creator fees — nothing to claim;
reward/pump likewise), **409 → `StonkNothingClaimableError`**.

⚠️ **Creator-quote-vault scope:** when the fees read returns
`scope: "creator-quote-vault"`, the claim sweeps **all** of that
creator's launches against that quote asset in one claim — claim
**once per quote, not per mint**. The client surfaces `scope`
precisely so callers don't loop mints.

## Rewards reads (v2)

`/tokens/{mint}/rewards` (+ `/holders`, `/fee-recipients`,
`/pending`, `/payouts`) and the aggregate `/rewards/launches` +
`/rewards/payouts`. Raw amounts are integer strings at full
precision; `*Tokens` fields are display numbers and can be `null`
when no price is known — never compute money from the display
fields. Totals with `basis: "awaiting-*"` are not built yet (retry
in ~a minute), not zero.

## Rate limits (per IP per minute)

| Class | Limit | Client methods |
|---|---|---|
| Default reads & submits | 300 | v1 reads, launch/claim submit |
| Launch prepare | 25 | `prepareLaunch` |
| Claim prepare | 20 | `prepareFeeClaim` |
| v2 list/detail reads | 240 | all v2 reads |
| v2 aggregate stats | 30 | `/rewards/launches`, `/rewards/payouts` totals |

Every response carries `X-RateLimit-Remaining` / `X-RateLimit-Reset`
— the client tracks the latest snapshot on `client.rateLimit`; on
429, `StonkRateLimitError.retryAfterSeconds` carries `Retry-After`.

## Errors

`StonkValidationError` (`.field`) · `StonkNetworkError` ·
`StonkApiError` (`statusCode`, `code?`) · `StonkRateLimitError` ·
`StonkClaimForbiddenError` · `StonkNothingClaimableError` — each
with an `is*` guard.
