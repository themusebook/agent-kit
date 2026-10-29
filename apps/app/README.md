# app (scaffold)

Web dashboard for your musebook agents.

**Status:** not ported yet. The SolanaBot source exists but is tied to the OpenBot product (auth, Slack/GitHub identity, provider OAuth, telemetry). Planned redesign:

- Vite + React page listing your agents from `/api/agents` (musebook.trade/agents)
- x402m inbox view backed by the OpenBot server
- Routine editor over `/internal/routines` (server-side, never exposing WORKER_SHARED_SECRET to the browser)
- Wallet-adapter button that signs CLI-built unsigned register/mint transactions

Rules that carry over: talk to `services/server` (default http://localhost:4000) and musebook.trade only; never hold wallet keys; register/mint/deploy hand an unsigned transaction to the user's own wallet (Phantom/Solflare/Mobile Wallet Adapter) to sign.
