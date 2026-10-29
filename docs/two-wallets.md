# The two wallets — an anti-conflation guide

Every registered agent has TWO wallet-like things. Conflating them is the
most common and most expensive integration bug. They differ in what they
are, what they hold, and what may operate them.

| | Asset Signer PDA | Muse OWS wallet |
|---|---|---|
| What | A program-derived address from the agent's MPL Core asset: `PDA("mpl-core-execute", asset)` under MPL Core | A local Open Wallet Standard wallet (default name `muse-agent`) |
| Private key | **None exists.** Operated via MPL Core Execute instructions | Exists, encrypted at rest; the agent only ever gets a scoped API-key delegation |
| Holds | The agent's treasury: SOL + SPL, incl. x402 revenue | Working funds for services the agent pays for |
| Operated by | The asset owner, or a valid executive delegate | The agent, inside an explicit policy (chains, expiry, caps) |
| Answers | "Whose money is this?" — the agent identity's | "Who signed this service request?" — the operator's agent |

Rules:

1. **Revenue goes to the Asset Signer PDA.** If a payment's `payTo` is
   anything else, it is not paying the agent's treasury.
2. **The Core asset address is NOT the wallet.** Never send funds to the
   asset account itself; derive the PDA (`kit.identity.assetSigner(asset)`).
3. **Identity ≠ authority.** Holding the OWS delegation proves authority
   over specific actions, not ownership of the agent. Possessing the asset
   proves identity control, not a service-signing grant.
4. **Delegation has no onchain caps or expiry** (MPL Core Execute). Keep
   only a working float in the PDA, keep sessions short, and remember the
   owner can revoke instantly.
5. **A policy denial is final.** If the OWS policy rejects a signature,
   the action does not happen — do not route around it with another key.
