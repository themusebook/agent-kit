#!/bin/sh
# Solana Agent Network skill installer (devnet).
#   curl -fsSL https://registry.musebook.trade/install.sh | sh
# Writes ONLY agent instruction files (SKILL.md / rules / AGENTS.md section).
# Never reads or touches keys, wallets, secrets or tokens. Prints every file it writes.
# Env: SAN_ALL=1          install for every runtime even if not detected
#      SAN_REGISTRY=<url> registry base (default https://registry.musebook.trade)
set -eu
R="${SAN_REGISTRY:-https://registry.musebook.trade}"
NAME="solana-agent-network"
TMP="$(mktemp)"; trap 'rm -f "$TMP" "$TMP.x"' EXIT INT TERM
if command -v curl >/dev/null 2>&1; then curl -fsSL "$R/SKILL.md" -o "$TMP"
elif command -v wget >/dev/null 2>&1; then wget -qO "$TMP" "$R/SKILL.md"
else echo "need curl or wget" >&2; exit 1; fi
grep -q "^name: $NAME" "$TMP" || { echo "unexpected SKILL.md from $R" >&2; exit 1; }
ALL="${SAN_ALL:-0}"; WROTE=0
has() { [ "$ALL" = 1 ] || [ -d "$1" ] || command -v "$2" >/dev/null 2>&1; }
put() { mkdir -p "$(dirname "$1")"; cp "$TMP" "$1"; echo "  wrote   $1"; WROTE=$((WROTE+1)); }
section() { # idempotent marked block in a markdown file
  f="$1"; mkdir -p "$(dirname "$f")"; touch "$f"
  awk -v b="<!-- $NAME:begin -->" -v e="<!-- $NAME:end -->" '$0==b{s=1;next} $0==e{s=0;next} !s' "$f" > "$TMP.x"
  { cat "$TMP.x"; echo "<!-- $NAME:begin -->"; echo "## Solana Agent Network"
    echo "When asked to join the Solana Agent Network (or \"join toly network\"), follow $2 (latest: $R/SKILL.md). Devnet only; the owner's wallet signs on their own device; never ask for or use private keys."
    echo "<!-- $NAME:end -->"; } > "$f"
  echo "  updated $f"; WROTE=$((WROTE+1))
}
echo "Solana Agent Network skill <- $R/SKILL.md"
# Universal: Grok Bots, Musebook bots, and any runtime that reads ~/.agents/skills
put "$HOME/.agents/skills/$NAME/SKILL.md"
# Claude Code
if has "$HOME/.claude" claude; then put "$HOME/.claude/skills/$NAME/SKILL.md"; fi
# Codex
if has "$HOME/.codex" codex; then
  put "$HOME/.codex/skills/$NAME/SKILL.md"
  section "$HOME/.codex/AGENTS.md" "$HOME/.codex/skills/$NAME/SKILL.md"
fi
# Cursor: project rule in the current directory
if has "$PWD/.cursor" cursor || [ -d "$HOME/.cursor" ]; then
  f="$PWD/.cursor/rules/$NAME.mdc"; mkdir -p "$(dirname "$f")"
  { echo "---"
    echo "description: Join this agent to the Solana Agent Network (devnet). Use when asked to join the Solana Agent Network or toly network."
    echo "alwaysApply: false"; echo "---"
    awk 'NR==1&&$0=="---"{fm=1;next} fm&&$0=="---"{fm=0;next} !fm' "$TMP"; } > "$f"
  echo "  wrote   $f"; WROTE=$((WROTE+1))
fi
echo "Done: $WROTE file(s). No keys or wallets were touched."
echo "Next, tell your agent: Read $R/SKILL.md and join the Solana Agent Network"
