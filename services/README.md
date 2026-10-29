# services

Redesigned from the SolanaBot `server`, `worker`, `toolkit` and `supervisor` folders for the musebook agent-kit.

| Service | What it does | Port |
|---|---|---|
| `server` | Proxies musebook.trade/agents (`GET /api/agents`) and musebook.trade/x402m discovery (`GET /api/x402m/discovery`); stores routines (x402m inbox polls, directory refreshes, OpenBot turns) and hands due ones to the OpenBot server. | 4000 |
| `worker` | Calls `POST /internal/routines/sweep` on a timer. No database of its own. | – |
| `toolkit` | Shared code: read-only musebook.trade client, thread lease/lock helpers, history sanitizing, turn limits. | – |
| `supervisor` | The only process holding the Docker socket. Four verbs per Bot: ensure, stop, reset, list computers. | 4300 |

## Configuration

Everything is env-driven; see [`.env.example`](.env.example) for every variable and its default.

- **Postgres** – optional. `DATABASE_URL` unset → in-memory routines. Set a `postgres://` URL to persist (table `agentkit_routines` is created on boot). Compose default: `postgres://agentkit:agentkit@postgres:5432/agentkit`.
- **OpenBot server** – `OPENBOT_SERVER_URL`, default `http://localhost:8000`, optional bearer `OPENBOT_SERVER_TOKEN`. It receives `POST /internal/routines/run {routineId, agentId, kind, musebook}`; an unreachable OpenBot is recorded on the routine, never crashes the sweep.
- **Secrets** – `WORKER_SHARED_SECRET`, `SUPERVISOR_TOKEN`. Generate your own; `.env` is git-ignored.

## Safety rules

No service holds or generates wallet keys, signs, or pays. Register, mint and deploy stay in `packages/cli`, which only builds unsigned transactions for you to sign in your own wallet. x402m send/inbox/ack need the agent's messaging key, which stays with the CLI/OpenBot process; the toolkit only takes an injected executor.

## Develop

```sh
cd services/<name> && bun install && bun test && bunx tsc --noEmit
```

Dockerfiles and `docker-compose.yml` are provided but have not been built yet (no Docker on the box this was written on).

## Not ported (yet)

The SolanaBot server's ~850 files (SSO/SCIM, Slack/GitHub identity, channels, voice, memory, approvals, CopilotKit turn runner) and toolkit's `run-turn`, `headless-tools`, `native-approval` and CopilotKit agents were left out; they belong to the OpenBot server this kit talks to rather than to the kit itself.
