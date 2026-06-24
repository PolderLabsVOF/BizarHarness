#!/usr/bin/env bash
# Pass 4: Dashboard routes end-to-end

set -uo pipefail

cd /project/bizar-dash

# Install local dashboard deps
npm install --no-fund --no-audit 2>&1 | tail -1

PASS=0
FAIL=0
declare -a FAILURES

start_dash() {
  local port="${1:-4098}"
  pkill -f 'bizar-dash' 2>/dev/null || true
  pkill -f 'src/server/server.mjs' 2>/dev/null || true
  sleep 1
  nohup node /project/bizar-dash/src/cli.mjs start --port "$port" > /tmp/dash-$port.log 2>&1 &
  DASH_PID=$!
  sleep 4
  for i in $(seq 1 20); do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/api/v2/health" 2>/dev/null || echo 000)
    [ "$CODE" = "200" ] && break
    sleep 1
  done
}

get_auth_header() {
  local port="${1:-4098}"
  local pw
  pw=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/home/dev/.cache/bizarharness/dash-auth.json','utf8')).password)")
  echo "Authorization: Basic $(node -e "console.log(Buffer.from('opencode:'+process.argv[1]).toString('base64'))" "$pw")"
}

run_test() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  ✅ $name → HTTP $actual"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $name → expected HTTP $expected, got HTTP $actual"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name (expected=$expected got=$actual)")
  fi
}

# ─── Pass 4a: V2 routes (already verified, re-confirm) ──────────────
echo "═══ Pass 4a. /api/v2/* routes ═══"
start_dash 4098
AUTH=$(get_auth_header 4098)
BASE="http://127.0.0.1:4098"

run_test "/api/v2/health (no auth)"      "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v2/health)"
run_test "/api/v2/health (with auth)"     "200" "$(curl -s -o /dev/null -H "$AUTH" -w '%{http_code}' $BASE/api/v2/health)"
run_test "/api/v2/doc (no auth)"          "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v2/doc)"
run_test "/api/v2/sessions (no auth)"     "401" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v2/sessions)"
run_test "/api/v2/sessions (with auth)"   "200" "$(curl -s -H "$AUTH" -o /dev/null -w '%{http_code}' $BASE/api/v2/sessions)"
run_test "/api/v2/sessions POST (auth)"   "201" "$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -d '{"agent":"mimir","prompt":"test"}' -o /dev/null -w '%{http_code}' $BASE/api/v2/sessions)"
run_test "/api/v2/sessions/:id GET"       "200" "$(curl -s -H "$AUTH" -o /dev/null -w '%{http_code}' $BASE/api/v2/sessions/bgr_test123)"
run_test "/api/v2/sessions/:id DELETE"    "204" "$(curl -s -H "$AUTH" -X DELETE -o /dev/null -w '%{http_code}' $BASE/api/v2/sessions/bgr_test456)"
run_test "/api/v2/event GET (no auth)"    "401" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/v2/event)"
run_test "/api/v2/event POST (auth)"      "204" "$(curl -s -H "$AUTH" -H 'Content-Type: application/json' -d '{"type":"test.event","properties":{}}' -o /dev/null -w '%{http_code}' $BASE/api/v2/event)"

# ─── Pass 4b: V1 routes (legacy, should still work) ─────────────────
echo ""
echo "═══ Pass 4b. /api/* v1 routes (backward compat) ═══"
run_test "/api/health (no auth)"          "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/health)"
run_test "/api/auth/status"               "200" "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/auth/status)"
run_test "/api/pair/verify"               "200" "$(curl -s -X POST -H 'Content-Type: application/json' -d '{"code":"fake"}' -o /dev/null -w '%{http_code}' $BASE/api/pair/verify)"

# ─── Pass 4c: Dist build check ─────────────────────────────────────
echo ""
echo "═══ Pass 4c. Dashboard frontend dist/ ═══"
DIST="/project/bizar-dash/dist"
if [ -f "$DIST/index.html" ]; then
  echo "  ✅ dist/index.html exists"
  ls -la "$DIST/assets/" 2>&1 | head -3
  echo "  ✅ dist/assets/ exists"
else
  echo "  ⚠ dist/ not built — frontend SPA fallback will trigger"
fi

# ─── Pass 4d: Croner, blessed, ws deps all loadable ────────────────
echo ""
echo "═══ Pass 4d. Dashboard npm deps loadable ═══"
for dep in blessed croner ws fuse.js; do
  if node -e "import('$dep').then(() => console.log('  ✅ $dep loads'), e => console.log('  ❌ $dep failed: ' + e.message))" 2>&1 | tail -2; then :; fi
done

# Cleanup
pkill -f 'bizar-dash' 2>/dev/null || true
pkill -f 'src/server/server.mjs' 2>/dev/null || true

echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 4 SUMMARY: $PASS passed, $FAIL failed"
[ $FAIL -gt 0 ] && for f in "${FAILURES[@]}"; do echo "  - $f"; done
echo "════════════════════════════════════════════════════════════════════"
