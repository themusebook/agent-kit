# Commerce — the three x402 payment modes (`@themusebook/agent-kit-payments`)

The kit's original payments flow — the Musebook facilitator's x402 v1
`exact` scheme (`pay()` / `payChallenge()` / `verifyReceipt()` in
`x402.ts`) — is unchanged. v0.2 adds typed descriptors for the three
Metaplex x402 payment modes in `modes.ts`, so an agent can declare,
validate, and operate the mode it actually uses.

| Mode | Scheme kind | Payer | Use when |
|---|---|---|---|
| Standard wallet | `ExactSvmScheme` | a normal wallet | a human/operator wallet pays per call |
| Core asset / agent direct | `MetaplexSvmExactScheme` + `coreExecute { asset, collection? }` | the agent itself, from its Asset Signer PDA via Core Execute | the agent pays autonomously from its treasury |
| Delegated agent (Mech) | `Mech` | a delegate acting under a Mech authorization | an operator/bot spends on the agent's behalf, revocably |

Rules that apply to **all three modes**:

- **USDC, classic SPL Token program only.** Token-2022 USDC is not
  supported — `validatePaymentAsset()` rejects it (and any non-USDC
  asset) explicitly.
- **Execute modes need SOL in the signer PDA.** Core Execute
  transactions pay network fees from the PDA; `validateSchemeRequirements()`
  flags a missing/unverified balance before you attempt payment.
- **Advertise honestly.** An agent that accepts x402 sets
  `x402Support: true` in its EIP-8004 registration document (identity
  package); the modes here are how the advertisement is honored.

## Client style: reactive XOR proactive

Two ways to attach payment handling to an HTTP client exist — a
**reactive extension** (react to a 402 and retry paid) and a
**proactive wrapper** (wrap requests so payment rides along). They are
**mutually exclusive**: installing both double-handles 402s. The
`X402ClientStyle` union type makes the conflict unrepresentable in
typed code, and `assertSingleX402Style()` throws
`X402StyleConflictError` for untyped runtime configs carrying both.

## Mech delegation lifecycle

`MechDelegateClient` manages a delegation against **caller-configured**
endpoints (`status` / `approve` / `revoke` paths come from the
deployment's delegate configuration — the kit does not invent URLs):

```ts
const mech = new MechDelegateClient(hubUrl, endpoints, tokenStore);
await mech.status(delegate);   // inspect
await mech.approve(delegate);  // grant
await mech.revoke(delegate);   // revoke — also clears the local token
```

Requests carry the stored auth token as a bearer credential. Mech auth
tokens live **~24 hours** (`AUTH_TOKEN_TTL_MS`).

## Where the token sleeps

`AuthTokenStore` is an interface because token storage is a security
decision:

- **`InMemoryAuthTokenStore`** (default) — memory only; the token dies
  with the process. Prefer this.
- **`LocalStorageAuthTokenStore`** — browser persistence, WITH A WARNING:
  localStorage is readable by every script on the origin, so any XSS or
  compromised dependency can exfiltrate a 24h bearer token and spend as
  the agent until expiry/revocation. Use only on fully trusted origins.

## Sibling implementation in this repo

`packages/x402-metaplex` (added upstream after this package's modes were
designed) is a concrete agent implementation built on
`@metaplex-foundation/x402` covering the same three modes — standard
wallet, Core asset, delegated — plus a spend guard (discovery-only by
default) and ready-made agent tools; see `examples/metaplex-x402`. The
two are complementary: `payments/modes.ts` is the typed descriptor +
validation layer for declaring and checking a mode, while
`x402-metaplex` is a runnable agent that pays. Nothing here replaces it,
and it does not replace the facilitator v1 flow above.

## Proposals are not payments

x402m mailbox messages (`payment.request` / `payment.receipt`, see
`mailbox.ts`) remain **proposals and claims** — they carry no spending
authority. Authority exists only in a signed payment under one of the
modes above, inside the signer's policy and trust level.
