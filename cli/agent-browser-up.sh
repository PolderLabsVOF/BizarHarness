#!/usr/bin/env bash
#
# cli/agent-browser-up.sh — install/launch agent-browser for Cline.
# v6.0.0 — Replaces browser-harness (Python, v3.20.7-v5.6.0) with
# agent-browser (native Rust CLI from vercel-labs, ~38K★).
#
# agent-browser is a thin CLI wrapper around Chrome for Testing that
# gives agents access to:
#   - 100+ typed CLI commands (open, snapshot, click, fill, screenshot, …)
#   - Native MCP stdio server (`agent-browser mcp`)
#   - Self-healing snapshot-based element detection
#   - Plugins (vault, recorder, …)
#   - Vercel AI SDK + AI Gateway integration (natural-language `chat`)
#
# Install:  npm install -g agent-browser
#           agent-browser install        # downloads Chrome for Testing
#
# This script ensures the daemon is up before Bizar agents try to
# drive the browser. Idempotent: re-running is a no-op if already up.
#
# Usage:
#   cli/agent-browser-up.sh                 # start if not running
#   cli/agent-browser-up.sh status          # print status
#   cli/agent-browser-up.sh stop            # kill daemon
#   cli/agent-browser-up.sh restart         # stop + start
#   cli/agent-browser-up.sh install         # install + bootstrap
#   cli/agent-browser-up.sh doctor          # run agent-browser doctor
#
# Environment overrides:
#   AB_PROFILE      — user-data-dir (default: ~/.agent-browser/profile)
#   AGENT_BROWSER_API_KEY — for natural-language chat
#
# Exit codes:
#   0   started / already running / status clean
#   1   failed to start (missing binary, port busy, etc.)
#
set -euo pipefail

AB_BIN="${AB_BIN:-$(command -v agent-browser || true)}"
AB_DAEMON_HOST="127.0.0.1"
AB_DAEMON_PORT="${AB_DAEMON_PORT:-9223}"
AB_PROFILE="${AB_PROFILE:-$HOME/.agent-browser/profile}"

log()  { echo "[agent-browser-up] $*" >&2; }
fail() { log "FAIL: $*"; exit 1; }

ensure_binary() {
  if [ -z "$AB_BIN" ] || ! [ -x "$AB_BIN" ]; then
    log "agent-browser not on PATH. Installing via npm..."
    command -v npm >/dev/null || fail "npm not found — install Node.js 24+ first"
    npm install -g agent-browser
    AB_BIN="$(command -v agent-browser)"
    [ -x "$AB_BIN" ] || fail "agent-browser install failed"
  fi
  log "agent-browser binary: $AB_BIN"
  log "version: $($AB_BIN --version 2>/dev/null || echo 'unknown')"
}

ensure_chrome() {
  if [ -d "$AB_PROFILE" ] && [ -f "$AB_PROFILE/SingletonLock" ]; then
    log "Chrome profile already exists: $AB_PROFILE"
    return 0
  fi
  log "Bootstrapping Chrome for Testing via agent-browser install"
  $AB_BIN install --silent || true
}

is_daemon_running() {
  $AB_BIN status --quiet 2>/dev/null && return 0
  # Fallback: check the daemon HTTP endpoint
  curl -fsS --max-time 2 "http://${AB_DAEMON_HOST}:${AB_DAEMON_PORT}/json/version" >/dev/null 2>&1
}

start_daemon() {
  log "Starting agent-browser daemon (profile: $AB_PROFILE, port: $AB_DAEMON_PORT)..."
  mkdir -p "$AB_PROFILE"

  # Spawn the daemon detached so it survives parent shell exit
  setsid nohup "$AB_BIN" serve \
      --port "$AB_DAEMON_PORT" \
      --profile "$AB_PROFILE" \
      --headless \
      >"$AB_PROFILE/daemon.log" 2>&1 < /dev/null &
  local pid=$!
  echo $pid > "$AB_PROFILE/daemon.pid"
  disown $pid 2>/dev/null || true

  # Wait for the daemon to bind
  local retries=30
  while [ $retries -gt 0 ]; do
    if curl -fsS --max-time 2 "http://${AB_DAEMON_HOST}:${AB_DAEMON_PORT}/json/version" >/dev/null 2>&1; then
      log "agent-browser daemon is up (pid $pid)"
      return 0
    fi
    sleep 1
    retries=$((retries - 1))
  done
  fail "agent-browser daemon did not bind to ${AB_DAEMON_HOST}:${AB_DAEMON_PORT}"
}

stop_daemon() {
  local pidfile="$AB_PROFILE/daemon.pid"
  if [ -f "$pidfile" ]; then
    local pid
    pid="$(cat "$pidfile" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      log "Stopping agent-browser daemon (pid $pid)"
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidfile"
  fi
  # Belt-and-braces: kill any orphan agent-browser processes
  pkill -f 'agent-browser serve' 2>/dev/null || true
}

print_status() {
  if is_daemon_running; then
    echo "agent-browser: RUNNING  (http://${AB_DAEMON_HOST}:${AB_DAEMON_PORT})"
    $AB_BIN doctor 2>&1 | tail -20 || true
  else
    echo "agent-browser: STOPPED"
    echo "Start with: cli/agent-browser-up.sh start"
  fi
}

case "${1:-start}" in
  start)   ensure_binary; ensure_chrome; is_daemon_running && { log "already running"; exit 0; }; start_daemon ;;
  stop)    stop_daemon ;;
  restart) stop_daemon; sleep 1; ensure_binary; ensure_chrome; start_daemon ;;
  status)  ensure_binary; print_status ;;
  doctor)  ensure_binary; $AB_BIN doctor ;;
  install) ensure_binary; ensure_chrome; $AB_BIN install ;;
  help|--help|-h)
    cat <<'AGENT_BROWSER_UP_HELP'
agent-browser-up -- start/stop the agent-browser daemon

Usage: cli/agent-browser-up.sh <command>

Commands:
  start    Start the daemon (idempotent)
  stop     Stop the daemon
  restart  Stop + start
  status   Print daemon status
  doctor   Run agent-browser doctor
  install  Install agent-browser + download Chrome
AGENT_BROWSER_UP_HELP
    exit 0
    ;;
  *)       fail "unknown command: $1 (use start|stop|restart|status|doctor|install)" ;;
esac
