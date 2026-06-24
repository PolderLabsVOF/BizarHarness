#!/usr/bin/env bash
# Pass 5: Plan system end-to-end

set -uo pipefail

# Use a persistent prefix inside the cache volume so installs survive restarts.
PREFIX="$HOME/.cache/bizar-global"
export PATH="$PREFIX/node_modules/.bin:$PATH"

cd /project

# Install global @polderlabs/bizar into the persistent cache prefix
if [ ! -x "$PREFIX/node_modules/.bin/bizar" ]; then
  echo "── Installing @polderlabs/bizar to $PREFIX (persistent) ──"
  npm install --silent --no-fund --no-audit --prefix="$PREFIX" @polderlabs/bizar 2>&1 | tail -3
fi

PASS=0
FAIL=0
declare -a FAILURES

run_test() {
  local name="$1"
  shift
  echo ""
  echo "─────────────────────────────────────────────────────────────"
  echo "TEST: $name"
  echo "CMD:  $*"
  echo "─────────────────────────────────────────────────────────────"
  local out
  out=$(timeout 60 bash -c "$*" 2>&1)
  local exit=$?
  echo "$out" | tail -10
  if [ "$exit" -eq 0 ]; then
    echo "✅ $name PASS"
    PASS=$((PASS + 1))
  else
    echo "❌ $name FAIL (exit=$exit)"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
  fi
}

# ─── Pass 5a: List templates ────────────────────────────────────────
echo "═══ Pass 5a. Plan templates ═══"
run_test "plan templates" "bizar plan templates 2>&1"

# ─── Pass 5b: Create plan ───────────────────────────────────────────
echo ""
echo "═══ Pass 5b. Plan creation ═══"
cd /tmp
rm -rf /tmp/bizar-plan-test
mkdir -p /tmp/bizar-plan-test/plans
cd /tmp/bizar-plan-test
# Some versions need to be in a project. Try anyway.
run_test "plan new my-feature (auto)" "bizar plan new my-feature --auto 2>&1 || bizar plan new my-feature 2>&1"

# ─── Pass 5c: Plan list ────────────────────────────────────────────
echo ""
echo "═══ Pass 5c. Plan list ═══"
run_test "plan list" "bizar plan list 2>&1"

# ─── Pass 5d: Plan system direct test (without bizar) ──────────────
echo ""
echo "═══ Pass 5d. Plan system modules load ═══"
cd /project
node -e "
import('./cli/plan.mjs').then(m => {
  console.log('  ✅ plan.mjs loads');
  console.log('  Exports:', Object.keys(m).join(', '));
}).catch(e => console.log('  ❌ plan.mjs failed:', e.message));
" 2>&1 | head -3

# ─── Pass 5e: Plan action tests (unit) ─────────────────────────────
echo ""
echo "═══ Pass 5e. Plan action unit tests (bun) ═══"
run_test "plan-action bun tests" "cd plugins/bizar && bun test tests/tools/plan-action.test.ts 2>&1 | tail -3"

# ─── Summary ────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 5 SUMMARY: $PASS passed, $FAIL failed"
[ $FAIL -gt 0 ] && for f in "${FAILURES[@]}"; do echo "  - $f"; done
echo "════════════════════════════════════════════════════════════════════"
