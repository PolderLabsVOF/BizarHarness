#!/usr/bin/env bash
#
# cli/browser-harness-up.sh — start Chromium with remote debugging enabled
# and register the browser-harness skill. Survives parent shell exit
# via setsid + nohup. Idempotent: re-running is a no-op if already up.
#
# v3.20.7 — Required by the browser-harness Bizar agent for any
# browser-driven E2E verification. The agent runs `browser-harness
# skill` calls; this script makes sure Chrome is alive on CDP 9222
# with the DevToolsActivePort file browser-harness auto-detects.
#
# Usage:
#   cli/browser-harness-up.sh           # start if not running
#   cli/browser-harness-up.sh status    # print status
#   cli/browser-harness-up.sh stop      # kill chrome
#   cli/browser-harness-up.sh restart   # stop + start
#
# Environment overrides:
#   BH_CHROME_BIN  — path to a chrome-headless-shell / chrome binary
#                     (default: chrome-headless-shell from puppeteer cache)
#   BH_PORT        — CDP port (default: 9222)
#   BH_PROFILE     — chrome user-data-dir (default: ~/.config/chromium)
#
# Exit codes:
#   0   started / already running / status clean
#   1   failed to start (missing binary, port busy, etc.)
#
set -euo pipefail

BH_PORT="${BH_PORT:-9222}"
BH_PROFILE="${BH_PROFILE:-$HOME/.config/chromium}"
BH_DEVTOOLS_FILE="$BH_PROFILE/DevToolsActivePort"

# Find the chrome binary. Prefer chrome-headless-shell from the puppeteer
# cache (it's smaller, has no crashpad, and starts cleanly under daemon).
# Fall back to the system chromium / chrome / google-chrome.
find_chrome_bin() {
  if [ -n "${BH_CHROME_BIN:-}" ] && [ -x "$BH_CHROME_BIN" ]; then
    echo "$BH_CHROME_BIN"
    return 0
  fi
  local puppeteer_bin
  puppeteer_bin="$(find "$HOME/.cache/puppeteer" -name chrome-headless-shell -type f 2>/dev/null | head -1)"
  if [ -n "$puppeteer_bin" ] && [ -x "$puppeteer_bin" ]; then
    echo "$puppeteer_bin"
    return 0
  fi
  for cand in chromium google-chrome chrome; do
    local p
    p="$(command -v "$cand" 2>/dev/null || true)"
    if [ -n "$p" ] && [ -x "$p" ]; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

is_chrome_running() {
  # The DevToolsActivePort file's format varies across Chrome versions:
  #   - older:  PID\nPORT\nWS_PATH
  #   - newer:  PORT\nWS_PATH
  # We can't reliably extract a PID, so we check the TCP port directly.
  # That's the only invariant that matters for browser-harness: it
  # connects via CDP on this port.
  if (echo >"/dev/tcp/127.0.0.1/$BH_PORT") 2>/dev/null; then
    if [ -f "$BH_DEVTOOLS_FILE" ]; then
      echo "port:$BH_PORT"
      return 0
    fi
  fi
  return 1
}

# Find the chrome PID by scanning /proc (used by `do_stop`). Linux only.
find_chrome_pid() {
  local pid
  for pid in $(pgrep -f 'chrome.*--remote-debugging-port=' 2>/dev/null); do
    # Confirm it's our chrome (matches our port)
    local cmdline
    cmdline="$(tr '\0' ' ' </proc/"$pid"/cmdline 2>/dev/null)"
    if echo "$cmdline" | grep -q -- "--remote-debugging-port=$BH_PORT"; then
      echo "$pid"
      return 0
    fi
  done
  return 1
}

do_status() {
  if is_chrome_running >/dev/null; then
    local pid
    pid="$(find_chrome_pid 2>/dev/null || echo '?')"
    echo "  ✓ Chromium is running (pid $pid, port $BH_PORT, profile $BH_PROFILE)"
    if [ -f "$BH_DEVTOOLS_FILE" ]; then
      echo "  ✓ DevToolsActivePort: $(head -1 "$BH_DEVTOOLS_FILE" 2>/dev/null)"
    fi
    if command -v browser-harness >/dev/null 2>&1; then
      echo "  ✓ browser-harness: $(browser-harness --version 2>&1 | head -1)"
      if [ -f "$HOME/.opencode/skills/browser-harness/SKILL.md" ]; then
        echo "  ✓ Skill registered at ~/.opencode/skills/browser-harness/SKILL.md"
      else
        echo "  ! Skill not yet registered — run: browser-harness skill > ~/.opencode/skills/browser-harness/SKILL.md"
      fi
    else
      echo "  ! browser-harness not installed — run: uv tool install --python 3.12 --upgrade --force browser-harness"
    fi
    return 0
  else
    echo "  ✗ Chromium is NOT running on port $BH_PORT (profile $BH_PROFILE)"
    return 1
  fi
}

do_start() {
  if is_chrome_running >/dev/null; then
    local pid
    pid="$(find_chrome_pid 2>/dev/null || echo '?')"
    echo "  ✓ Chromium already running (pid $pid, port $BH_PORT)"
    return 0
  fi

  local bin
  bin="$(find_chrome_bin)" || {
    echo "  ✗ No chromium / chrome binary found." >&2
    echo "    Set BH_CHROME_BIN or install one of: chromium, google-chrome, chrome," >&2
    echo "    or place chrome-headless-shell in ~/.cache/puppeteer/." >&2
    return 1
  }

  mkdir -p "$BH_PROFILE"
  echo "  Starting $bin on port $BH_PORT (profile $BH_PROFILE)"

  # setsid + nohup + redirect stdio so the daemon survives the parent
  # shell exit (the Bizar background-process footgun — see AGENTS.md
  # rule #25). The parent shell can exit cleanly while chrome keeps
  # running on its own session.
  setsid bash -c "nohup '$bin' \
    --headless \
    --disable-gpu \
    --no-sandbox \
    --disable-crashpad \
    --remote-debugging-port=$BH_PORT \
    --remote-debugging-address=127.0.0.1 \
    --user-data-dir=$BH_PROFILE \
    </dev/null >/tmp/chromium-bh.log 2>&1 & disown"

  # Wait for the port to come up (up to 8s)
  for _ in $(seq 1 40); do
    if (echo >"/dev/tcp/127.0.0.1/$BH_PORT") 2>/dev/null; then
      sleep 0.3  # give chrome time to write DevToolsActivePort
      if is_chrome_running >/dev/null; then
        local pid
        pid="$(find_chrome_pid 2>/dev/null || echo '?')"
        echo "  ✓ Chromium started (pid $pid, port $BH_PORT)"
        return 0
      fi
    fi
    sleep 0.2
  done
  echo "  ✗ Failed to start Chrome on port $BH_PORT (see /tmp/chromium-bh.log)" >&2
  return 1
}

do_stop() {
  local pid
  if pid="$(find_chrome_pid 2>/dev/null)"; then
    echo "  Stopping Chromium (pid $pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$BH_DEVTOOLS_FILE"
    echo "  ✓ Stopped"
  else
    echo "  (Chromium was not running)"
  fi
}

do_restart() {
  do_stop
  do_start
}

# Entry point
case "${1:-start}" in
  status)  do_status ;;
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_restart ;;
  *)       echo "Usage: $0 {start|stop|restart|status}" >&2; exit 1 ;;
esac
