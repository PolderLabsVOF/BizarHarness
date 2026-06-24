#!/usr/bin/env bash
# Full real-life simulation of the v0.7.0-alpha.1 plugin↔dashboard refactor.
# Runs inside the bizarharness-dev Docker container.
# All logs persist at /project/.bizar/sim-logs/ (mounted to host).

set -uo pipefail
# set -x  # uncomment for debug

LOG_DIR="/project/.bizar/sim-logs"
mkdir -p "$LOG_DIR"

# ── 1. Verify environment ─────────────────────────────────────────────
echo "═══ 1. Verify environment ═══"
echo "opencode: $(opencode --version 2>&1 | head -1)"
echo "bun: $(bun --version 2>&1 | head -1)"
echo "node: $(node --version 2>&1 | head -1)"
echo "npm: $(npm --version 2>&1 | head -1)"

# ── 1a. Install bizar CLI + dashboard to user-owned prefix ───────────
# (npm install -g hits EACCES on /usr/local/lib/node_modules in this
#  container because the Dockerfile installed npm packages as root
#  but the runtime user is `dev`. Use --prefix=~/.local instead.)
echo ""
echo "═══ 1a. Install @polderlabs/bizar + @polderlabs/bizar-dash to ~/.local ═══"
mkdir -p ~/.local
npm install -g --prefix="$HOME/.local" @polderlabs/bizar @polderlabs/bizar-dash --no-fund --no-audit 2>&1 | tail -5 | tee "$LOG_DIR/01a-install.log"
export PATH="$HOME/.local/bin:$PATH"
echo ""
echo "bizar (post-install): $(bizar --version 2>&1 | head -1)"

# ── 2. Install plugin source ──────────────────────────────────────────
echo ""
echo "═══ 2. Install plugin source into ~/.config/opencode/plugins/bizar/ ═══"
cd /project
timeout 60 bash install.sh 2>&1 | tail -3 | tee "$LOG_DIR/02-install.log"

# ── 3. Install plugin dependencies ─────────────────────────────────────
echo ""
echo "═══ 3. Install plugin dependencies ═══"
cd ~/.config/opencode/plugins/bizar/
echo "Plugin package.json deps:"
node -e "const p=require('./package.json'); console.log(JSON.stringify(p.dependencies||{},null,2))"
echo ""
echo "Running npm install..."
timeout 120 npm install --no-fund --no-audit 2>&1 | tail -5 | tee "$LOG_DIR/03-npm-install.log"
echo ""
echo "SDK version:"
node -p "require('./node_modules/@polderlabs/bizar-sdk/package.json').version" 2>&1

# ── 4. Skip bizar update (would re-install npm packages globally) ─────
echo ""
echo "═══ 4. Skip bizar update (already installed to user prefix in 1a) ═══"

# ── 5. Start dashboard in background ──────────────────────────────────
# IMPORTANT: run from LOCAL source (/project/bizar-dash/) not the npm
# package — the npm @polderlabs/bizar-dash@3.11.0 doesn't have my v2
# routes. Local source has the new SDK + v2 routes + SSE handler.
echo ""
echo "═══ 5. Start dashboard in background on port 4098 (LOCAL source) ═══"
# Install local dashboard deps (croner, blessed, ws, etc.)
cd /project/bizar-dash
echo "Installing local dashboard deps (croner, blessed, ws, etc.)..."
timeout 120 npm install --no-fund --no-audit 2>&1 | tail -3 | tee "$LOG_DIR/05a-dash-deps.log"

# Kill any leftover
pkill -f 'bizar-dash' 2>/dev/null || true
pkill -f 'src/server/server.mjs' 2>/dev/null || true
sleep 1

# Start dashboard from LOCAL source via the cli.mjs in the dashboard source dir
echo ""
echo "Using LOCAL dashboard source at: /project/bizar-dash/src/cli.mjs"
nohup node /project/bizar-dash/src/cli.mjs start --port 4098 > "$LOG_DIR/05-dash-start.log" 2>&1 &
DASH_BG_PID=$!
echo "Dashboard bg pid (parent shell): $DASH_BG_PID"
sleep 5

# Wait for dashboard
echo "Waiting for dashboard to be ready..."
for i in $(seq 1 30); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4098/api/v2/health 2>/dev/null || echo 000)
  if [ "$CODE" = "200" ]; then
    echo "Dashboard ready after ${i}s (HTTP $CODE)"
    break
  fi
  sleep 1
done

echo ""
echo "=== Last 15 lines of dashboard log: ==="
tail -15 "$LOG_DIR/05-dash-start.log" 2>&1 || echo "(no log)"

# Capture port + auth file
echo ""
echo "Port file: $(cat ~/.config/bizar/dashboard.port 2>&1 || echo 'NOT FOUND')"
echo "V2 auth file:"
ls -la ~/.cache/bizarharness/dash-auth.json 2>&1 | head -1

# ── 6. Verify v2 routes ───────────────────────────────────────────────
echo ""
echo "═══ 6. Verify v2 routes ═══"
if [ ! -f ~/.cache/bizarharness/dash-auth.json ]; then
  echo "  ⚠ SKIP: dash-auth.json not found — dashboard didn't start"
else
  PW=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$HOME/.cache/bizarharness/dash-auth.json','utf8')).password)")
  AUTH="Authorization: Basic $(node -e "console.log(Buffer.from('opencode:'+process.argv[1]).toString('base64'))" "$PW")"

  echo "6a. GET /api/v2/health (public, expect 200):"
  curl -s -w "  → HTTP %{http_code}\n" http://127.0.0.1:4098/api/v2/health

  echo ""
  echo "6b. GET /api/v2/sessions without auth (expect 401):"
  curl -s -w "  → HTTP %{http_code}\n" http://127.0.0.1:4098/api/v2/sessions

  echo ""
  echo "6c. GET /api/v2/sessions with auth (expect 200):"
  curl -s -H "$AUTH" -w "  → HTTP %{http_code}\n" http://127.0.0.1:4098/api/v2/sessions

  echo ""
  echo "6d. GET /api/v2/doc (public, OpenAPI YAML):"
  curl -s -w "  → HTTP %{http_code}  size: %{size_download}B\n" http://127.0.0.1:4098/api/v2/doc -o /dev/null

  echo ""
  echo "6e. POST /api/v2/sessions (create test session):"
  curl -s -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"agent":"mimir","prompt":"test"}' \
    -w "  → HTTP %{http_code}\n" \
    http://127.0.0.1:4098/api/v2/sessions | head -3
fi

# ── 7. Subscribe to SSE in background ─────────────────────────────────
echo ""
echo "═══ 7. Subscribe to SSE in background ═══"
> "$LOG_DIR/07-sse-events.log"
if [ -f ~/.cache/bizarharness/dash-auth.json ]; then
  PW=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$HOME/.cache/bizarharness/dash-auth.json','utf8')).password)")
  AUTH="Authorization: Basic $(node -e "console.log(Buffer.from('opencode:'+process.argv[1]).toString('base64'))" "$PW")"
  # Set a max-time so curl doesn't hang forever
  nohup timeout 120 curl -s -N -H "$AUTH" -H "Accept: text/event-stream" \
    --max-time 120 \
    http://127.0.0.1:4098/api/v2/event \
    > "$LOG_DIR/07-sse-events.log" 2>&1 &
  SSE_PID=$!
  echo "SSE subscriber pid: $SSE_PID"
  sleep 2
else
  echo "  ⚠ SKIP: no auth file"
  SSE_PID=""
fi

# ── 8. Run opencode with prompt ───────────────────────────────────────
echo ""
echo "═══ 8. Run opencode with prompt (verify plugin loads + SDK calls fire) ═══"
cd /project
# Use --model with a model that works in the container. The opencode.json
# on the host has wrong model names; this overrides. Tested in step 1.
timeout 90 opencode run --model "opencode/deepseek-v4-flash-free" "say hello world in 5 words" 2>&1 | tail -30 | tee "$LOG_DIR/08-opencode.log" || echo "(opencode returned non-zero — likely model auth issue, but plugin should still load)"

# Give SDK a moment to flush any queued publishes
sleep 3

# ── 9. Check SSE for events from opencode ──────────────────────────────
echo ""
echo "═══ 9. Check SSE events captured from opencode run ═══"
echo "SSE event log: $(wc -l < "$LOG_DIR/07-sse-events.log") lines, $(wc -c < "$LOG_DIR/07-sse-events.log") bytes"
echo ""
echo "First 30 lines:"
head -30 "$LOG_DIR/07-sse-events.log"

# Stop the SSE subscriber
if [ -n "$SSE_PID" ]; then
  kill $SSE_PID 2>/dev/null || true
fi

# ── 10. Run all test suites ────────────────────────────────────────────
echo ""
echo "═══ 10. Run test suites ═══"

echo ""
echo "10a. SDK vitest:"
cd /project/packages/sdk
timeout 60 npm test 2>&1 | tail -7 | tee "$LOG_DIR/10a-sdk-test.log"

echo ""
echo "10b. Plugin dashboard-client tests:"
cd ~/.config/opencode/plugins/bizar/
timeout 60 bun test tests/dashboard-client.test.ts 2>&1 | tail -8 | tee "$LOG_DIR/10b-plugin-test.log"

echo ""
echo "10c. Dashboard v2 smoke test:"
cd /project/bizar-dash
timeout 60 node tests/smoke-v2.mjs 2>&1 | tail -12 | tee "$LOG_DIR/10c-dash-smoke.log"

echo ""
echo "10d. Plugin check:imports (forbidden node: imports):"
cd ~/.config/opencode/plugins/bizar/
timeout 30 npm run check:imports 2>&1 | tail -5 | tee "$LOG_DIR/10d-imports.log"

# ── 11. Cleanup ────────────────────────────────────────────────────────
echo ""
echo "═══ 11. Cleanup ═══"
pkill -f 'bizar-dash' 2>/dev/null || true
pkill -f 'src/server/server.mjs' 2>/dev/null || true
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "DONE. Logs in $LOG_DIR (persists on host at ~/.bizar/sim-logs/)"
echo "════════════════════════════════════════════════════════════════════"
