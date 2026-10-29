# apps/app: musebook agent-kit dashboard

A small Vite + React dashboard, redesigned from the SolanaBot web app. It reads through `services/server` and the SDK packages in `packages/` (discovery, identity, payments, wallet).

| Tab | Source |
|---|---|
| Directory | `GET /api/agents` on the server (musebook.trade/agents), normalized with `@themusebook/agent-kit-discovery` |
| Messaging | `GET /api/x402m/discovery` (endpoint, capabilities, content profiles) plus inbox status from `x402m.inbox-poll` jobs |
| Jobs | `GET /internal/routines` on the server (scheduled jobs and their last result) |
| Identity | Metaplex Core asset → Agent Identity binding, owner, Asset Signer PDA, registration URI (`resolveAgent`, via a DAS RPC) |
| Mint | Builds the registration document; the Metaplex hosted API returns an unsigned tx that **your wallet** signs |

## Keys and signing

- The app holds no keys and never signs. Mint and payment builders produce unsigned transactions and hand them to your injected wallet (Phantom or a compatible `window.solana` provider), which shows its own prompt.
- Nothing signs on the server. Directory registration (SIWS) and paying for x402 resources are still done with `packages/cli` (`musebook register`, `musebook pay`).
- `WORKER_SHARED_SECRET` and a keyed `SOLANA_RPC_URL` stay in the Vite dev/preview proxy (`proxy.config.ts`). Only `VITE_*` values are bundled. In production, put the same two proxy rules in your reverse proxy: `/server` goes to the server with the bearer added, and `/rpc` goes to your RPC.

## Run

```sh
cd apps/app && npm ci
cp .env.example .env    # git-ignored
npm run dev             # needs services/server on SERVER_URL (default http://localhost:4000)
npm test && npm run typecheck && npm run build
```

## Dropped from the SolanaBot app

OpenBot-only product features were not ported. That covers sign-in/SSO/SCIM, admin and organization settings, CopilotKit chat and threads, approvals, channels (Slack and others), connections/provider OAuth, memory, passwords vault, plugins, skills gallery, suggestions, onboarding, bot profiles and bot lifecycle, responsibilities, delivery, the computer/browser live view, demonstrations, voice/dictation, telemetry and the TanStack router/shadcn UI kit.
