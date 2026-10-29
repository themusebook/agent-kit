# Migration — v0.3.0

v0.3 is additive for the SDK packages (all bumped 0.2.0 → 0.3.0;
`@musebook/x402-metaplex` and the starter-kit CLI keep
their own version lines). Two new packages, one deepened preset
family, one corrected claim.

## New: `@musebook/stonk`

A real client for the official Stonkfun Developer API —
`createStonkClient()` or `kit.stonk.*`. Reads (v1 envelope + v2
cursor-paged, server-side only), launch path A (prepare → caller
signs → submit → poll by payment signature), launch path B planning
(BYO Raydium LaunchLab: pricing-checked PDA validation, adoption
checklist as code), and Fee Key NFT claims with typed 403/409
errors. Full guide: docs/stonk.md.

### ⚠️ Correction: the stonk launch flow is NOT "disabled"

v0.2's `stonk-agent` preset and docs/templates.md stated the API
prepare-launch flow was disabled on the venue (grounded in a
2026-09-18 probe: `POST /launches/prepare` → 503, `/stats`
`paidLaunchesEnabled: false`). The **official Stonkfun Developer API
documentation supersedes that claim**: both launch paths are part of
the API, and which one is live is a runtime fact — `GET /stats`
reports `config.paidLaunchesEnabled` / `config.launchLabEnabled`,
and the client reads it before choosing (`chooseLaunchPath`). The
v0.2 text remains true *of that probe date*; do not hardcode either
path. The preset, templates.md and this note have been corrected.

One further disagreement, reported rather than silently resolved:
the owner's local `local-stonkfun` skill (and the RWA repo's
`agents/stonkfun.ts`) describe claim/launch details from the
September surface (e.g. a position-NFT "mint to take custody, burn
to release" custody flow). Where those conflict with the official
API documentation, **the API documentation wins** in this package;
the custody flow is not implemented here.

## New: `@musebook/perps`

Venue descriptors + pre-trade risk gate + order descriptors + the
JEV decision engine — `kit.perps.*` or standalone. Grounded in
`Solizardking/clawd-agents-perps`, `Solizardking/clawd-perps-agent`
and `Solizardking/jev-trader-solana` (inspected read-only; see
docs/perps.md for the overlap/difference analysis). Honest limits,
stated in the package itself:

- **Phoenix-direct is market-data only.** Both named venues are
  covered, but no inspected source places a native Phoenix order —
  Phoenix is reached through Imperial. The kit does not invent
  placement semantics.
- **Touch is catalog-level.** It exists in one repo as a vendored
  catalog + stream (+ demo stub) and not at all in the other; the
  Touch descriptor is explicitly not a submittable order.
- **Leverage disagreement preserved:** bot presets default up to 5x,
  the financial layer hard-caps 2x; the kit default follows 2x.
- The source repos sign with raw env keypairs; the kit's caller-
  signing doctrine is a deliberate divergence, documented in place.

## Deepened: pump-agent (finance)

`finance/pump.ts` adds flow descriptors for the fun-block agent API
(create-coin, swap, collect-fees, fee-sharing config, agent-payment
invoices) and the `pump-agent` preset now references them. The
v0.2 statement "the kit ships NO pump.fun SDK / execution stays
outside the kit" is replaced: descriptors are in the kit; signing
and broadcast stay with the caller, as everywhere else. The field
contract follows the documented skill surface (host verified live
2026-09-19; full POST flows not live-tested end-to-end — the
descriptors carry that warning on their face).

## Templates

`AGENT_TEMPLATES` grows from five to seven presets (`perps-agent`,
`decision-agent` appended after `rwa-agent`); `AgentTemplateId`
gains the two ids. Code asserting the exact five-id list must
update. `buildTemplateRegistration` is unchanged.

## Versions

Root + the eight workspace SDK packages are 0.3.0 in-tree. **No
release is cut with this change** — v0.3.0 here is an in-tree
version bump, same as the v0.2 prep. `@themusebook` npm scope
remains unclaimed; install stays `github:themusebook/agent-kit`.
