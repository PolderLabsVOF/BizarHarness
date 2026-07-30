#!/usr/bin/env bash
# Idempotent five-dimension clock-out verifier.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

check() {
  local label="$1"
  shift
  echo "▶ $label"
  set +e
  OUTPUT=$("$@" 2>&1)
  RC=$?
  set -e
  if [[ $RC -eq 0 ]]; then
    echo "  PASS"
    PASS=$((PASS + 1))
  else
    echo "  FAIL"
    echo "$OUTPUT" | tail -12 | sed 's/^/  /'
    FAIL=$((FAIL + 1))
  fi
}

echo "═══════════════════════════════════════"
echo "  Clean-State Check"
echo "═══════════════════════════════════════"

check "1. Build and typecheck" make check
check "2. Retained unit tests" make test
check "3. Feature ledger integrity" node scripts/feature-state-machine.mjs
check "4. Architecture and removed surfaces" make check-arch
check "5. Claude Code startup path" make e2e

echo "Summary: $PASS passed, $FAIL failed"
if [[ $FAIL -ne 0 ]]; then
  echo "Session is NOT clean."
  exit 1
fi
echo "Session is clean."
