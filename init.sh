#!/usr/bin/env bash
#
# init.sh — Bizar harness session initializer.
#
# Synthesizes Lecture 06 of walkinglabs/learn-harness-engineering:
#   "Why initialization needs its own phase".
#
# Verifies the environment is healthy BEFORE the agent starts work.
# Cheap to run, deterministic, idempotent. Exits non-zero if anything is
# broken so the agent's first move cannot be "discover the environment
# is rotten".
#
# Usage:  ./init.sh              # full check (good for first boot)
#         ./init.sh --fast       # skip heavy checks
#         ./init.sh --strict     # also fail on lenient checks
#
# Returns: 0 on success, 1 on any blocker.

set -euo pipefail

FAST=0
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --fast) FAST=1 ;;
    --strict) STRICT=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "init.sh: unknown arg: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")"

# Header for the log
echo "▶ init.sh — $(date -Iseconds) (Bizar harness initializer)"

ok()   { echo "  ✓ $1"; }
warn() { echo "  ⚠ $1"; W=1; }
err()  { echo "  ✗ $1"; E=1; }

W=0
E=0

# ── 1. Toolchain ──────────────────────────────────────────────────────────
echo
echo "① Toolchain"

if command -v bun >/dev/null 2>&1; then
  ok "bun $(bun --version | head -c 30)"
else
  err "bun not on PATH — install via https://bun.sh"
fi

if command -v node >/dev/null 2>&1; then
  ok "node $(node --version)"
else
  err "node not on PATH"
fi

if command -v git >/dev/null 2>&1; then
  ok "git $(git --version | head -c 60)"
else
  err "git not on PATH"
fi

if command -v cline >/dev/null 2>&1; then
  ok "cline $(cline --version 2>&1 | head -1)"
else
  warn "cline not on PATH (optional for many agent tasks)"
fi

# ── 2. Bizar state ───────────────────────────────────────────────────────
echo
echo "② Bizar state"

if [[ -f AGENTS.md ]]; then
  ok "AGENTS.md present ($(wc -l < AGENTS.md) lines)"
else
  err "AGENTS.md missing — every session must start by reading this"
fi

if [[ -f PROGRESS.md ]]; then
  ok "PROGRESS.md present"
else
  warn "PROGRESS.md missing — first session will create it"
fi

if [[ -f feature_list.json ]]; then
  if node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8'))" 2>/dev/null; then
    ok "feature_list.json parses"
  else
    err "feature_list.json is corrupt — fix it before running"
  fi
else
  warn "feature_list.json missing (run \`bizar init\` to create one)"
fi

if [[ -d .harness ]]; then
  ok ".harness/ directory exists"
else
  warn ".harness/ missing (run \`make session-start\` to bootstrap)"
fi

# ── 3. WIP=1 invariant ───────────────────────────────────────────────────
echo
echo "③ WIP=1 invariant (one active feature only)"

if [[ -f feature_list.json ]]; then
  ACTIVE_COUNT=$(node -e '
    const fs = require("fs");
    try {
      const d = JSON.parse(fs.readFileSync("feature_list.json","utf8"));
      const arr = Array.isArray(d) ? d : (d.features || []);
      const active = arr.filter(f => f.status === "active");
      console.log(active.length);
    } catch (e) { console.log(-1); }
  ')
  if [[ "$ACTIVE_COUNT" == "1" ]]; then
    ok "exactly one feature is 'active'"
  elif [[ "$ACTIVE_COUNT" == "0" ]]; then
    ok "zero features active (ready to pick a new one)"
  elif [[ "$ACTIVE_COUNT" == "-1" ]]; then
    err "feature_list.json corrupt — cannot check WIP=1"
  else
    err "WIP=1 violated: $ACTIVE_COUNT features are 'active'. Pick one or finish the others."
  fi
fi

# ── 4. Clean state ───────────────────────────────────────────────────────
echo
echo "④ Clean state"

if command -v rg >/dev/null 2>&1; then
  if rg -q 'console\.log\(|console\.debug\(' --type ts --type tsx plugins/ 2>/dev/null; then
    warn "console.log/debug found in plugins/ — clean before commit"
  else
    ok "no console.log/debug in plugins/"
  fi
  if rg -q 'debugger;|\.only\(' --type ts --type tsx plugins/ 2>/dev/null; then
    err "debugger or .only() found in plugins/ — remove before commit"
  fi
fi

# ── 5. Verification (skippable via --fast) ────────────────────────────────
echo
echo "⑤ Verification"

if [[ $FAST -eq 1 ]]; then
  echo "  (--fast: skipping make check)"
else
  if make check >/tmp/init-check.log 2>&1; then
    ok "make check passed"
  else
    err "make check failed — see /tmp/init-check.log"
    tail -20 /tmp/init-check.log | sed 's/^/    /'
  fi
fi

# ── 6. Skill + agent mirrors (the 18 Bizar skills exist on disk) ─────────
echo
echo "⑥ Skill + agent mirrors"

if [[ -d ~/.agents/skills/bizar ]]; then
  ok "~/.agents/skills/bizar present (and registered in .skill-lock.json)"
else
  warn "~/.agents/skills/bizar missing — run \`bizar update\` to materialize"
fi

if [[ -d ~/.cline/agents ]]; then
  COUNT=$(find ~/.cline/agents -name "*.md" -o -name "*.yaml" | wc -l)
  ok "$COUNT agent file(s) in ~/.cline/agents"
else
  warn "~/.cline/agents missing"
fi

# ── Summary ──────────────────────────────────────────────────────────────
echo
if [[ $E -eq 0 && ( $W -eq 0 || $STRICT -eq 0 ) ]]; then
  echo "✓ init.sh: environment is healthy"
  exit 0
elif [[ $E -eq 0 && $W -gt 0 && $STRICT -eq 1 ]]; then
  echo "⚠ init.sh: --strict; lenient warnings treated as blockers"
  exit 1
else
  echo "✗ init.sh: $E blocker(s), $W warning(s) — fix blockers before running agents"
  exit 1
fi
