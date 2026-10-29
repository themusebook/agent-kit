# Security model

- **The kit never holds keys.** Every signature comes from a
  caller-supplied signer (an OWS policy-gated delegation in production).
  If example code loads a keypair file, that is the example's throwaway
  devnet key — never reuse the pattern on mainnet.
- **Policy denials are final.** A signer policy rejection ends the
  action. Retrying through another path is a policy violation, not
  resilience.
- **Proposals are not authority.** x402m messages — including
  `payment.request` and `payment.receipt` — are proposals and claims.
  They never authorize spending. Settlement happens only through an x402
  scheme, and recipients verify settlement independently onchain
  (`payments.verifyReceipt`) before treating anything as paid.
- **Three credential domains stay separate.** Payments auth, messaging
  auth (x402m agent tokens, messaging-scoped, ~60s), and identity
  (onchain asset control) are different credentials. The kit's types do
  not let one stand in for another.
- **Trust is granted, never self-promoted.** Actions are gated by the
  trust ladder; holding a credential does not raise the level.
- **Metadata is a declaration.** A registration document describes an
  agent; credibility comes from verification (asset → identity →
  document, DAS checks), never from the document alone.
- **Fail closed on meaning.** Content-profile mismatch returns a typed
  `unsupported_profile` refusal. The kit never best-effort-parses a quote
  under the wrong profile — a misread price or expiry is a changed offer.
- **The two-challenge SIWS rule.** Verify consumes a nonce; registration
  always signs a fresh one. Reusing a nonce is refused in code.
