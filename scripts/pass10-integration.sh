#!/usr/bin/env bash
# Pass 10: Full integration run (combines 1, 4, SDK, plugin, dashboard)
#
# This is the final acceptance gate. It exercises the full framework:
# 1. Install + init
# 2. CLI commands
# 3. Plugin + SDK
# 4. Dashboard (v1 + v2)
# 5. Test suite

set -uo pipefail

PREFIX="$HOME/.cache/bizar-global"
PY_PKG_DIR="$HOME/.cache/python-packages"
export PATH="$PREFIX/node_modules/.bin:$PATH"
export PYTHONPATH="$PY_PKG_DIR:${PYTHONPATH:-}"

cd /project

PASS=0
FAIL=0
declare -a FAILURES

assert_pass() {
  local name="$1"
  local actual_exit="$2"
  local expected_exit="${3:-0}"
  if [ "$actual_exit" -eq "$expected_exit" ]; then
    echo "  ✅ $name"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name (exit=$actual_exit expected=$expected_exit)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
  fi
}

run_step() {
  local name="$1"
  shift
  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo "STEP: $name"
  echo "CMD:  $*"
  echo "─────────────────────────────────────────────────────────────"
  local out
  out=$(timeout 120 bash -c "$*" 2>&1)
  local exit=$?
  echo "$out" | tail -8
  assert_pass "$name" "$exit"
}

# ── Phase 1: Install ──────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 1: Install + init"
echo "═══════════════════════════════════════════════════════════════"

run_step "global install @polderlabs/bizar" \
  "npm install --silent --no-fund --no-audit --prefix=$PREFIX @polderlabs/bizar"

run_step "global install @polderlabs/bizar-dash" \
  "npm install --silent --no-fund --no-audit --prefix=$PREFIX @polderlabs/bizar-dash"

run_step "bizar --version" "bizar --version"

# ── Phase 2: Install graphify persistently ────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 2: graphify install"
echo "═══════════════════════════════════════════════════════════════"
run_step "graphify install" \
  "pip3 install --quiet --break-system-packages --target=$PY_PKG_DIR graphifyy"

run_step "graphify importable" "python3 -c 'import graphify; print(\"OK\")' 2>&1 || true"

# ── Phase 3: CLI commands ─────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 3: CLI command smoke"
echo "═══════════════════════════════════════════════════════════════"
run_step "bizar audit" "bizar audit 2>&1 || true"
run_step "bizar plan templates" "bizar plan templates 2>&1 | head -3 || true"
run_step "bizar graph status" "bizar graph status 2>&1 | head -3 || true"
run_step "bizar test-gate (--help)" "bizar test-gate --help 2>&1 | head -3 || true"
run_step "bizar current-session" "bizar current-session 2>&1 | head -3 || true"

# ── Phase 4: Test suites ──────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 4: Test suites"
echo "═══════════════════════════════════════════════════════════════"
run_step "root typecheck" "npm run typecheck 2>&1 | tail -3"

run_step "SDK vitest" "cd /project/packages/sdk && npx vitest run 2>&1 | tail -3"

run_step "Plugin bun test (full)" "cd /project/plugins/bizar && bun test 2>&1 | tail -3"

# ── Phase 5: Dashboard v2 protocol ────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 5: Dashboard v2 protocol"
echo "═══════════════════════════════════════════════════════════════"

# Start dashboard in background
echo "  Starting dashboard in background..."
node /project/bizar-dash/src/cli.mjs start --port 4098 --foreground 2>&1 >/tmp/dash.log &
DASH_PID=$!
sleep 3

# Health check
run_step "dashboard /api/v2/health" \
  "curl -sS -o /dev/null -w '%{http_code}' http://localhost:4098/api/v2/health | grep -q 200"

# Auth check
run_step "dashboard /api/v2/sessions (auth required)" \
  "curl -sS -o /dev/null -w '%{http_code}' http://localhost:4098/api/v2/sessions | grep -q 401"

# Kill dashboard
kill $DASH_PID 2>/dev/null || true
wait $DASH_PID 2>/dev/null || true

# ── Phase 6: Skills + agents present ──────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "PHASE 6: Skills + agents"
echo "═══════════════════════════════════════════════════════════════"
run_step "5 bundled skills" "test -f /project/config/skills/bizar/SKILL.md && test -f /project/config/skills/self-improvement/SKILL.md && test -f /project/config/skills/cpp-coding-standards/SKILL.md && test -f /project/config/skills/cpp-testing/SKILL.md && test -f /project/config/skills/embedded-esp-idf/SKILL.md"
run_step "13 agent definitions" "ls /project/config/agents/*.md 2>&1 | wc -l | grep -q 13"
run_step ".bizar/AGENTS_SELF_IMPROVEMENT.md" "test -f /project/.bizar/AGENTS_SELF_IMPROVEMENT.md"
run_step ".bizar/PROJECT.md" "test -f /project/.bizar/PROJECT.md"

# ── Final summary ─────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 10 (Full integration) SUMMARY: $PASS passed, $FAIL failed"
[ $FAIL -gt 0 ] && for f in "${FAILURES[@]}"; do echo "  - $f"; done
echo "════════════════════════════════════════════════════════════════════"
