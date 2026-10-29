# mobile (scaffold)

Expo app for Solana Mobile (Saga/Seeker) and the dApp Store.

**Status:** not ported yet. The SolanaBot source exists but is tied to the OpenBot product (auth, Slack/GitHub identity, provider OAuth, telemetry). Planned redesign:

- Agent list + x402m inbox
- Mobile Wallet Adapter for signing CLI-built unsigned transactions
- dApp Store publishing config (no keystores committed)

Rules that carry over: talk to `services/server` (default http://localhost:4000) and musebook.trade only; never hold wallet keys; register/mint/deploy hand an unsigned transaction to the user's own wallet (Phantom/Solflare/Mobile Wallet Adapter) to sign.
