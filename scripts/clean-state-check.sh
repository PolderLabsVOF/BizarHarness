#!/usr/bin/env bash
# Idempotent five-dimension clock-out verifier.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0

check() {
  local label="$1"
  local output_file
  shift
  echo "▶ $label"
  output_file="$(mktemp "${TMPDIR:-/tmp}/bizar-clean-check.XXXXXX")"
  set +e
  "$@" >"$output_file" 2>&1
  RC=$?
  set -e
  if [[ $RC -eq 0 ]]; then
    echo "  PASS"
    PASS=$((PASS + 1))
  else
    echo "  FAIL"
    tail -12 "$output_file" | sed 's/^/  /'
    FAIL=$((FAIL + 1))
  fi
  rm -f -- "$output_file"
}

echo "═══════════════════════════════════════"
echo "  Clean-State Check"
echo "═══════════════════════════════════════"

check "1. Build and typecheck" make check
check "2. Retained unit tests" make test
check "3. OpenKan workspace present" test -d .ok
check "4. Architecture and removed surfaces" make check-arch
check "5. Claude Code startup path" make e2e

echo "Summary: $PASS passed, $FAIL failed"
if [[ $FAIL -ne 0 ]]; then
  echo "Session is NOT clean."
  exit 1
fi
echo "Session is clean."
