#!/usr/bin/env bash
# Installs the Solana Foundation solana-dev skill (MIT) at a pinned commit for the SVM dev agent.
# Docs only: nothing here deploys, creates keys or signs.
set -euo pipefail
REPO=https://github.com/solana-foundation/solana-dev-skill
COMMIT=a265d11
DEST="${1:-.agents/skills}"
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
git clone --quiet "$REPO" "$tmp/s" && git -C "$tmp/s" checkout --quiet "$COMMIT"
mkdir -p "$DEST" && rm -rf "$DEST/solana-dev" && cp -R "$tmp/s/skills/solana-dev" "$DEST/solana-dev" && cp "$tmp/s/LICENSE" "$DEST/solana-dev/LICENSE"
echo "solana-dev skill ($COMMIT) installed to $DEST/solana-dev"
