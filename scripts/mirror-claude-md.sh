#!/usr/bin/env bash
#
# scripts/mirror-claude-md.sh — keep .claude/CLAUDE.md in sync with AGENTS.md.
#
# Both files are part of the walkinglabs/awesome-harness-engineering
# convention. AGENTS.md is the canonical source; .claude/CLAUDE.md is
# the mirror for tools that hard-code `CLAUDE.md` as the entry point.
#
# Usage: ./scripts/mirror-claude-md.sh [--check]
#
# --check exits 1 if .claude/CLAUDE.md is out of sync (for CI).
#
# v6.3.0 — Migrated from mirror-agents-md.sh to mirror-claude-md.sh.
# The mirror now lives at .claude/CLAUDE.md (Claude Code's standard
# project-scope settings dir) instead of the repo root.

set -euo pipefail

cd "$(dirname "$0")/.."

CHECK=0
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

if [[ ! -f AGENTS.md ]]; then
  echo "AGENTS.md missing — cannot mirror" >&2
  exit 1
fi

MIRROR_DIR=".claude"
MIRROR="$MIRROR_DIR/CLAUDE.md"

mkdir -p "$MIRROR_DIR"

# Mirror script: extract everything from AGENTS.md past the first `# `
# heading, prepend a banner. Idempotent.
BODY=$(awk '/^# / { if (seen) exit; seen=1; next } { print }' AGENTS.md)

TMP=$(mktemp)
trap "rm -f '$TMP'" EXIT

cat > "$TMP" <<EOF
# CLAUDE.md — Mirror of AGENTS.md for Claude Code compatibility

> **This file is auto-mirrored from \`AGENTS.md\` for tools that look for
> \`CLAUDE.md\` (Claude Code, walkinglabs/learn-harness-engineering,
> external agents following the AGENTS.md convention). DO NOT EDIT THIS
> FILE DIRECTLY — edit \`AGENTS.md\` and run \`make mirror-claude-md\`.
>
> Source: \`AGENTS.md\` (canonical)
> Mirrored: $(date -Iseconds) by \`scripts/mirror-claude-md.sh\`

---

$BODY
EOF

if [[ $CHECK -eq 1 ]]; then
  if [[ ! -f "$MIRROR" ]] || ! cmp -s "$TMP" "$MIRROR"; then
    echo "$MIRROR is out of sync with AGENTS.md" >&2
    diff "$MIRROR" "$TMP" | head -40 || true
    exit 1
  fi
  echo "$MIRROR is in sync"
  exit 0
fi

if [[ ! -f "$MIRROR" ]] || ! cmp -s "$TMP" "$MIRROR"; then
  mv "$TMP" "$MIRROR"
  echo "✓ $MIRROR updated from AGENTS.md"
else
  echo "✓ $MIRROR already in sync"
  rm "$TMP"
fi