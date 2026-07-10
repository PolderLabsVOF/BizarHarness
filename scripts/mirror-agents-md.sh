#!/usr/bin/env bash
#
# scripts/mirror-agents-md.sh — keep CLAUDE.md in sync with AGENTS.md.
#
# Both files are part of the walkinglabs/awesome-harness-engineering
# convention. AGENTS.md is the canonical source; CLAUDE.md is the
# mirror for tools that hard-code `CLAUDE.md` as the entry point.
#
# Usage: ./scripts/mirror-agents-md.sh [--check]
#
# --check exits 1 if CLAUDE.md is out of sync (for CI).

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
> FILE DIRECTLY — edit \`AGENTS.md\` and run \`make mirror-agents-md\`.
>
> Source: \`AGENTS.md\` (canonical)
> Mirrored: $(date -Iseconds) by \`scripts/mirror-agents-md.sh\`

---

$BODY
EOF

if [[ $CHECK -eq 1 ]]; then
  if [[ ! -f CLAUDE.md ]] || ! cmp -s "$TMP" CLAUDE.md; then
    echo "CLAUDE.md is out of sync with AGENTS.md" >&2
    diff CLAUDE.md "$TMP" | head -40 || true
    exit 1
  fi
  echo "CLAUDE.md is in sync"
  exit 0
fi

if [[ ! -f CLAUDE.md ]] || ! cmp -s "$TMP" CLAUDE.md; then
  mv "$TMP" CLAUDE.md
  echo "✓ CLAUDE.md updated from AGENTS.md"
else
  echo "✓ CLAUDE.md already in sync"
  rm "$TMP"
fi
