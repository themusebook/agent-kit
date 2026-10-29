# desktop (scaffold)

Tauri desktop shell around apps/app.

**Status:** not ported yet. The SolanaBot source exists but is tied to the OpenBot product (auth, Slack/GitHub identity, provider OAuth, telemetry). Planned redesign:

- Reuse the app build in a Tauri window; keep code-signing material out of git (SolanaBot's `signing/` is not copied)
- Local supervisor/computer control for running an agent on your own machine

Rules that carry over: talk to `services/server` (default http://localhost:4000) and musebook.trade only; never hold wallet keys; register/mint/deploy hand an unsigned transaction to the user's own wallet (Phantom/Solflare/Mobile Wallet Adapter) to sign.
