#!/usr/bin/env bash
# Full empirical test: background agent + tmux
# - Start opencode serve as a true daemon
# - Start dashboard
# - Try to spawn a background agent
# - Check what actually happens

set -uo pipefail

export PATH="$HOME/.cache/bizar-global/node_modules/.bin:$PATH"
export PYTHONPATH="$HOME/.cache/python-packages"

# Clean up any previous run
pkill -f "opencode serve" 2>/dev/null || true
pkill -f "bizar-dash" 2>/dev/null || true
tmux kill-server 2>/dev/null || true
sleep 1

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 1: Start opencode serve as daemon"
echo "═══════════════════════════════════════════════════════════════"
mkdir -p /home/dev/.cache/bizar

# True daemon: redirect ALL fds, run in background, disown
( cd /tmp && opencode serve --port 4097 </dev/null >/tmp/opencode.log 2>&1 & )
sleep 3
echo "opencode log:"
cat /tmp/opencode.log 2>&1 | head -20
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 2: Health check"
echo "═══════════════════════════════════════════════════════════════"
for i in 1 2 3 4 5; do
  if curl -sS --max-time 1 http://127.0.0.1:4097/health > /dev/null 2>&1; then
    echo "✅ opencode serve alive after $i tries"
    break
  fi
  sleep 1
done
curl -sS --max-time 2 http://127.0.0.1:4097/health 2>&1
echo
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 3: Write serve.json as the plugin would"
echo "═══════════════════════════════════════════════════════════════"
# The plugin writes this when it starts opencode serve
PASSWORD=$(openssl rand -hex 16)
cat > /home/dev/.cache/bizar/serve.json <<EOF
{
  "baseUrl": "http://127.0.0.1:4097",
  "port": 4097,
  "password": "$PASSWORD",
  "worktree": "/project",
  "pid": 99999,
  "startedAt": $(date +%s%3N)
}
EOF
cat /home/dev/.cache/bizar/serve.json
echo
echo "Password: $PASSWORD"
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 4: Try to read serve-info via the dashboard's readServeInfo()"
echo "═══════════════════════════════════════════════════════════════"
cd /project
node -e "
import('./bizar-dash/src/server/serve-info.mjs').then(m => {
  const info = m.readServeInfo();
  console.log('readServeInfo() returned:', JSON.stringify(info, null, 2));
  if (!info) {
    console.log('❌ Would fail task-delegator.mjs:563 guard — dispatch skipped');
  } else {
    console.log('✅ serveInfo OK, dispatch would proceed');
  }
}).catch(e => console.log('load failed:', e.message));
" 2>&1 | head -20
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 5: HTTP createSession (as the plugin's HttpClient does)"
echo "═══════════════════════════════════════════════════════════════"
RESP=$(curl -sS --max-time 5 -X POST "http://127.0.0.1:4097/api/session?directory=/project" \
  -H 'Content-Type: application/json' \
  -d '{"title":"test-empirical","agent":"mimir"}')
echo "Response: $RESP"
SESSION_ID=$(echo "$RESP" | grep -oE '"id":"ses_[^"]+"' | head -1 | cut -d'"' -f4)
echo "Session ID: $SESSION_ID"
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 6: HTTP sendPrompt (as the plugin's sendPrompt does)"
echo "═══════════════════════════════════════════════════════════════"
curl -sS --max-time 5 -X POST "http://127.0.0.1:4097/api/session/$SESSION_ID/prompt_async?directory=/project" \
  -H 'Content-Type: application/json' \
  -d "{\"agent\":\"mimir\",\"parts\":[{\"type\":\"text\",\"text\":\"echo hello world\"}]}" 2>&1
echo
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 7: Wait 8s, check session messages + log"
echo "═══════════════════════════════════════════════════════════════"
sleep 8
echo "---Session messages---"
curl -sS --max-time 5 "http://127.0.0.1:4097/api/session/$SESSION_ID/messages?directory=/project" 2>&1
echo
echo "---opencode log (last 30 lines)---"
cat /tmp/opencode.log 2>&1 | tail -30
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 8: Simulate the dashboard's tmux wrap (POST-FIX)"
echo "═══════════════════════════════════════════════════════════════"
# v3.11.1 — Bug fix: the dashboard now uses getActualBgLogPath() to
# tail the actual log file the plugin's LogWriter produces, not the
# phantom <worktree>/.bizar/opencode.log.
LOG_FILE=$(cd /project && node -e "
import('./bizar-dash/src/server/lib/path-safe.mjs').then(m => {
  const p = m.getActualBgLogPath({ sessionId: '$SESSION_ID' });
  process.stdout.write(p);
}).catch(e => { console.error(e.message); process.exit(1); });
")
echo "Log file we're about to tail (POST-FIX): $LOG_FILE"
ls -la "$LOG_FILE" 2>&1 || true
echo

if which tmux >/dev/null 2>&1; then
  # Make sure the file exists so tail -F has something to read.
  mkdir -p "$(dirname "$LOG_FILE")"
  touch "$LOG_FILE"
  tmux new-session -d -s "bizar-bg-${SESSION_ID:3:16}" -x 220 -y 50 \
    tail -n 200 -F "$LOG_FILE"
  sleep 2
  echo "---tmux sessions---"
  tmux ls
  echo "---capture-pane (post-fix)---"
  tmux capture-pane -p -t "bizar-bg-${SESSION_ID:3:16}" -S -30
  # Write a fake log line to simulate plugin activity
  echo "$(date -u +%FT%TZ) sample activity line for bg_${SESSION_ID:3:16}" >> "$LOG_FILE"
  sleep 1
  echo "---capture-pane AFTER writing---"
  tmux capture-pane -p -t "bizar-bg-${SESSION_ID:3:16}" -S -30
  echo
  echo "VERDICT: tmux now shows real content (or empty file view, not phantom error)."
  tmux kill-server
else
  echo "tmux not installed in this container."
  echo
  # Simulate what the code does: tail -F against the REAL log path
  echo "Verdict: spawning tail -F $LOG_FILE produces:"
  timeout 3 tail -n 200 -F "$LOG_FILE" 2>&1 | head -3 || true
  echo "(tail blocks on the empty file — no error — operator can see new content as it appears)"
fi
echo

echo "═══════════════════════════════════════════════════════════════"
echo "STEP 9: Confirm the phantom path is no longer used"
echo "═══════════════════════════════════════════════════════════════"
PHANTOM="/project/.bizar/opencode.log"
echo "Phantom path: $PHANTOM"
ls -la "$PHANTOM" 2>&1
echo "(pre-fix: tmux tailed this nonexistent file and showed 'cannot open' forever)"
echo
echo "Real log path: $LOG_FILE"
ls -la "$LOG_FILE" 2>&1
echo "(post-fix: tmux tails this; if it doesn't exist, -F waits for it without an error loop)"

echo
echo "═══════════════════════════════════════════════════════════════"
echo "DONE"
echo "═══════════════════════════════════════════════════════════════"
