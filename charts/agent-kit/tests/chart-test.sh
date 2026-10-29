#!/usr/bin/env bash
# Render-level tests for the chart. Needs helm on PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
pass=0; fail=0
ok() { pass=$((pass+1)); echo "ok - $1"; }
no() { fail=$((fail+1)); echo "not ok - $1"; }
expect_fail() { if helm template t . "${@:2}" >/dev/null 2>&1; then no "$1"; else ok "$1"; fi; }

default=$(helm template t .)
full=$(helm template t . -f ci/full-values.yaml)

for out in "$default" "$full"; do
  grep -q '^kind: Secret$' <<<"$out" && no "renders no Secret objects" || ok "renders no Secret objects"
done
grep -q 'secretKeyRef: { name: "agent-kit", key: "WORKER_SHARED_SECRET" }' <<<"$default" && ok "worker secret is a secretKeyRef" || no "worker secret is a secretKeyRef"
grep -q 'DATABASE_URL' <<<"$default" && no "no DATABASE_URL by default (memory store)" || ok "no DATABASE_URL by default (memory store)"
grep -q 'key: "DATABASE_URL"' <<<"$full" && ok "DATABASE_URL from secret when set" || no "DATABASE_URL from secret when set"
grep -q 'docker.sock' <<<"$default" && no "supervisor off by default" || ok "supervisor off by default"
grep -q 'hostPath' <<<"$full" && ok "supervisor mounts socket when enabled" || no "supervisor mounts socket when enabled"
grep -q 'SERVER_INTERNAL_URL, value: "http://t-agent-kit-server:4000"' <<<"$default" && ok "worker points at server service" || no "worker points at server service"
grep -q 'trust_domain = "musebook.local"' <<<"$full" && ok "spire config is musebook.local" || no "spire config is musebook.local"
grep -qE 'value: ".*(sk-|AKIA|BEGIN)' <<<"$full" && no "no inline secret-looking values" || ok "no inline secret-looking values"
expect_fail "refuses a missing worker secret ref" --set secrets.workerSharedSecret.name=
expect_fail "refuses a half-filled secret ref" --set secrets.openbotServerToken.name=x
expect_fail "refuses replicas>1 without postgres" --set server.replicas=2
echo "# pass $pass fail $fail"
[ "$fail" -eq 0 ]
