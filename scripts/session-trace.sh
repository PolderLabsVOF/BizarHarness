#!/usr/bin/env bash
# session-trace.sh — Record structured session events to JSONL.
#
# Usage:
#   ./scripts/session-trace.sh start    # record session start
#   ./scripts/session-trace.sh end      # record session end
#   ./scripts/session-trace.sh event <type> <data>   # record arbitrary event
#
# Output: .harness/traces/sessions.jsonl (gitignored)
#
# Per session, records:
#   - start time, branch, commit
#   - features touched (read from feature_list.json state transitions)
#   - end time, files changed, tests run

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TRACE_DIR="$ROOT/.harness/traces"
TRACE_FILE="$TRACE_DIR/sessions.jsonl"

mkdir -p "$TRACE_DIR"

ACTION="${1:-}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BRANCH=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "no-branch")
COMMIT=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo "no-commit")

write_event() {
  echo "$1" >> "$TRACE_FILE"
}

case "$ACTION" in
  start)
    write_event "{\"event\":\"session.start\",\"timestamp\":\"$NOW\",\"branch\":\"$BRANCH\",\"commit\":\"$COMMIT\"}"
    echo "✓ Session started — recorded to $TRACE_FILE"
    ;;
  end)
    write_event "{\"event\":\"session.end\",\"timestamp\":\"$NOW\",\"branch\":\"$BRANCH\",\"commit\":\"$COMMIT\"}"
    echo "✓ Session ended — recorded to $TRACE_FILE"
    ;;
  event)
    TYPE="${2:-unknown}"
    DATA="${3:-}"
    write_event "{\"event\":\"$TYPE\",\"timestamp\":\"$NOW\",\"branch\":\"$BRANCH\",\"commit\":\"$COMMIT\",\"data\":\"$DATA\"}"
    echo "✓ Event '$TYPE' recorded"
    ;;
  *)
    echo "Usage: $0 {start|end|event <type> <data>}"
    exit 1
    ;;
esac
