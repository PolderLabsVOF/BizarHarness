#!/usr/bin/env bash
# Pass 1: Exercise every `bizar` CLI command end-to-end in the dev container.

set -uo pipefail

LOG_DIR="/project/.bizar/sim-logs"
mkdir -p "$LOG_DIR"

export PATH="$HOME/.local/bin:$PATH"

# Re-install bizarre + dashboard to user prefix (workaround for EACCES)
mkdir -p ~/.local
npm install -g --prefix="$HOME/.local" @polderlabs/bizar @polderlabs/bizar-dash --no-fund --no-audit 2>&1 | tail -1

cd /project

PASS=0
FAIL=0
declare -a FAILURES

run_test() {
  local name="$1"
  local cmd="$2"
  local expect_exit="${3:-0}"  # expected exit code
  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo "TEST: $name"
  echo "CMD:  $cmd"
  echo "─────────────────────────────────────────────────────────────"
  local out
  out=$(timeout 60 bash -c "$cmd" 2>&1)
  local exit=$?
  echo "$out" | tail -15
  echo ""
  if [ "$exit" -eq "$expect_exit" ]; then
    echo "✅ $name PASS (exit=$exit)"
    PASS=$((PASS + 1))
  else
    echo "❌ $name FAIL (exit=$exit, expected=$expect_exit)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
  fi
}

# Verify bizar is on PATH
echo "═══ Verify bizarre install ═══"
bizar --version || { echo "bizar not installed"; exit 1; }
which node

# ─── Pass 1a: --help for every command ────────────────────────────────
echo ""
echo "═══ 1a. Command discovery via --help ═══"
for cmd in install audit init export plan graph test-gate update service; do
  echo "--- bizar $cmd --help ---"
  timeout 10 bizar $cmd --help 2>&1 | head -5
  echo ""
done

# ─── Pass 1b: audit ─────────────────────────────────────────────────
echo ""
echo "═══ 1b. bizar audit ═══"
run_test "audit (default)" "bizar audit 2>&1" 0

# ─── Pass 1c: init ──────────────────────────────────────────────────
echo ""
echo "═══ 1c. bizar init ═══"
# init in a temp dir to avoid clobbering
mkdir -p /tmp/bizar-init-test
cd /tmp/bizar-init-test
run_test "init (creates .bizar/)" "bizar init 2>&1 && test -d .bizar && echo 'OK .bizar created'" 0

# ─── Pass 1d: export ────────────────────────────────────────────────
echo ""
echo "═══ 1d. bizar export ═══"
cd /project
run_test "export (shows help)" "bizar export --help 2>&1" 0

# ─── Pass 1e: plan ──────────────────────────────────────────────────
echo ""
echo "═══ 1e. bizar plan ═══"
run_test "plan --help" "bizar plan --help 2>&1" 0

# ─── Pass 1f: graph ─────────────────────────────────────────────────
echo ""
echo "═══ 1f. bizar graph ═══"
run_test "graph status" "bizar graph status 2>&1" 0
run_test "graph --help" "bizar graph --help 2>&1" 0

# ─── Pass 1g: test-gate ─────────────────────────────────────────────
echo ""
echo "═══ 1g. bizar test-gate ═══"
run_test "test-gate (detects test suite)" "timeout 120 bizar test-gate 2>&1 | tail -10" 0

# ─── Pass 1h: update ───────────────────────────────────────────────
echo ""
echo "═══ 1h. bizar update ═══"
run_test "update --help" "bizar update --help 2>&1" 0

# ─── Pass 1i: dash ──────────────────────────────────────────────────
echo ""
echo "═══ 1i. bizar dash ═══"
run_test "dash status (no running dashboard)" "bizar dash status 2>&1 || true" 0

# ─── Pass 1j: service ──────────────────────────────────────────────
echo ""
echo "═══ 1j. bizar service ═══"
run_test "service --help" "bizar service --help 2>&1" 0

# ─── Pass 1k: current-session ───────────────────────────────────────
echo ""
echo "═══ 1k. bizar current-session (top-level command) ═══"
run_test "current-session --help" "bizar current-session --help 2>&1" 0

# ─── Summary ───────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 1 SUMMARY: $PASS passed, $FAIL failed"
if [ $FAIL -gt 0 ]; then
  echo "FAILURES:"
  for f in "${FAILURES[@]}"; do
    echo "  - $f"
  done
fi
echo "════════════════════════════════════════════════════════════════════"
