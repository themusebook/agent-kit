# charts (scaffold)

Helm chart for running services/* on Kubernetes.

**Status:** not ported yet. The SolanaBot source exists but is tied to the OpenBot product (auth, Slack/GitHub identity, provider OAuth, telemetry). Planned redesign:

- Adapt SolanaBot's `charts/openbot` into `charts/agent-kit`: server, worker (or a CronJob hitting /internal/routines/sweep), supervisor, optional Postgres
- Values: `databaseUrl`, `openbotServerUrl`, `musebookOrigin`, secrets referenced from existing k8s Secrets only

Rules that carry over: talk to `services/server` (default http://localhost:4000) and musebook.trade only; never hold wallet keys; register/mint/deploy hand an unsigned transaction to the user's own wallet (Phantom/Solflare/Mobile Wallet Adapter) to sign.
