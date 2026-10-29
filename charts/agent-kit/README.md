# agent-kit Helm chart

Adapted from SolanaBot's `charts/openbot` (Helm, not UI charts) for `services/` and `apps/app`.

| Component | Default | Notes |
|---|---|---|
| server | on | `services/server`, Service on 4000, `/health` probes |
| worker | on | `services/worker`, sweeps the server every `worker.tickMs` |
| app | on | `apps/app` behind nginx; proxies `/server` (adds the worker bearer) and `/rpc` |
| supervisor | **off** | mounts the node Docker socket via hostPath, which is root-equivalent on the node |
| spire | ConfigMap only | ported `server.conf`/`agent.conf` for use with the official SPIRE chart |
| ingress | off | exposes only the dashboard; server `/internal` stays in-cluster |

## Secrets

The chart takes **references only** and renders no `Secret` objects. Create them first:

```sh
kubectl create secret generic agent-kit \
  --from-literal=WORKER_SHARED_SECRET="$(openssl rand -hex 32)"
# optional: OPENBOT_SERVER_TOKEN, SOLANA_RPC_URL (keyed DAS RPC), SUPERVISOR_TOKEN
# optional Postgres: kubectl create secret generic agent-kit-db --from-literal=DATABASE_URL=postgres://...
helm install agent-kit charts/agent-kit
```

Postgres is optional (`database.urlSecret`). Without it, routines are in memory and `server.replicas` must stay 1; the chart refuses more.

## Images

`ghcr.io/themusebook/agent-kit-{server,worker,app,supervisor}:<appVersion>` from the Dockerfiles in `services/*` and `apps/app`. **No images are published yet**, so build and push your own and set `image.registry`.

## Dropped from charts/openbot

Bundled Bitnami Postgres subchart, migrations Job, learning/attachments/routines CronJobs, per-cloud values (EKS/GKE/AKS), ExternalSecret, HTTPRoute, NetworkPolicy, HPA/PDB, and the computer-per-Bot runtime class config.

## Test

```sh
helm lint charts/agent-kit && helm lint charts/agent-kit -f charts/agent-kit/ci/full-values.yaml
charts/agent-kit/tests/chart-test.sh
```
