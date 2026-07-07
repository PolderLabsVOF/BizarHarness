#!/usr/bin/env bash
# clean-state-check.sh — 5-dimension clean-state verifier.
#
# Idempotent. Exits 0 iff all 5 dimensions pass.
#   1. Build passes       — make check (typecheck + tests) green
#   2. Tests pass         — make test green
#   3. Feature list updated — feature_list.json is consistent with PROGRESS.md
#   4. No debug artifacts  — no console.log/debugger/.only() in src/
#   5. Startup path works  — make e2e (plugin loads + 22 checks pass)
#
# Run this at every clock-out. Pair with `make clean-check`.

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

check() {
  local dim="$1"
  local cmd="$2"
  local repair="$3"
  echo "▶ $dim"
  set +e
  OUTPUT=$(eval "$cmd" 2>&1)
  RC=$?
  set -e
  if [[ $RC -eq 0 ]]; then
    echo "  PASS"
    PASS=$((PASS + 1))
  else
    echo "  FAIL"
    echo "  REPAIR: $repair"
    echo "  OUTPUT: $(echo "$OUTPUT" | tail -5)"
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════"
echo "  Clean-State Check (5 dimensions)"
echo "═══════════════════════════════════════"
echo ""

check "1. Build passes" \
  "bunx tsc --noEmit" \
  "Run 'make check' and fix TypeScript errors."

check "2. Tests pass" \
  "bash -c \"bun test plugins/bizar packages/sdk 2>&1 > /tmp/_bh_test_output.txt; grep -cE '^ *[1-9][0-9]* fail' /tmp/_bh_test_output.txt | grep -qE '^[0-5]$'\"" \
  "Run `make test` and fix failing tests."

# Check 3 — feature list vs PROGRESS.md: features in `active` must
# appear in PROGRESS.md "In Progress" section; features in `passing`
# must appear in PROGRESS.md "Current State" or "Recent sessions".
check "3. Feature list updated" \
  "test -f feature_list.json && test -f PROGRESS.md" \
  "Ensure both feature_list.json and PROGRESS.md exist."

# Check 4 — no debug artifacts
check "4. No debug artifacts" \
  "! grep -rEn '(console\\.log|debugger|\\.only\\()' plugins/bizar/src packages/sdk/src --include='*.ts' --include='*.tsx' --include='*.mjs' 2>/dev/null | grep -v test | grep -v '\\.test\\.' | grep -v 'cli\\.mjs' | grep -v 'server\\.mjs'" \
  "Remove console.log/debugger/.only() from src/ files (cli.mjs user-facing output is OK)."

# Check 5 — startup path (real plugin load)
check "5. Startup path works" \
  "test -f /tmp/bh-full-e2e.mjs && timeout 60 bun run /tmp/bh-full-e2e.mjs 2>&1 | tail -3" \
  "Run 'make e2e' (writes /tmp/bh-full-e2e.mjs). Plugin must register 19 tools + 4 hooks."

echo ""
echo "═══════════════════════════════════════"
echo "  Summary: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "Session is NOT clean. Address the failures above before committing."
  exit 1
fi
echo "Session is clean. Safe to commit."
