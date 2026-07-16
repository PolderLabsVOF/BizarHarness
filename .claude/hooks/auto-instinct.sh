#!/usr/bin/env bash
# auto-instinct.sh — PostToolUse:Bash hook for high-frequency commands.
#
# v10.1.1 — Pillar D: auto-instinct for repeated commands.
#
# Claude Code PostToolUse input:
#   { tool: "Bash", path: string, command: string, exit_code: number, duration_ms: number }
# Claude Code PostToolUse output:
#   { continue?: boolean, stopReason?: string }
#
# Commands that trigger a low-confidence instinct:
#   npm install, git push, git commit, make test, make check, make e2e

set -euo pipefail

RAW=""
while IFS= read -r line; do
  RAW="$RAW$line"
done

INPUT_JSON="${RAW:-"{}"}"

COMMAND=$(echo "$INPUT_JSON" | node -e "
  const stdin = require('fs').readFileSync('/dev/stdin', 'utf8');
  let v;
  try { v = JSON.parse(stdin); } catch { v = {}; }
  console.log(String(v.command || ''));
" 2>/dev/null || echo "")

TRIGGER=""
case "$COMMAND" in
  *npm\ install*|*npm\ i*)  TRIGGER="npm install" ;;
  *git\ push*)              TRIGGER="git push" ;;
  *git\ commit*)            TRIGGER="git commit" ;;
  *make\ test*)             TRIGGER="make test" ;;
  *make\ check*)            TRIGGER="make check" ;;
  *make\ e2e*)              TRIGGER="make e2e" ;;
  *)                        TRIGGER="" ;;
esac

if [ -z "$TRIGGER" ]; then
  echo '{}'
  exit 0
fi

# Use the SDK if available, otherwise use a raw node script.
SDK_PATH="$(pwd)/node_modules/@polderlabs/bizar-sdk/learning"
if [ -d "$SDK_PATH" ]; then
  node -e "
    const { recordInstinct } = require('$SDK_PATH/instincts.js');
    recordInstinct({
      trigger: '$TRIGGER',
      action: 'auto_recorded',
      confidence: 0.3,
      evidence: ['auto-instinct hook: $COMMAND'],
      scope: 'global',
    });
    console.log('ok');
  " 2>/dev/null || true
else
  # Fallback: append raw JSONL directly.
  LEARNING_DIR='.bizar/learning'
  mkdir -p "$LEARNING_DIR"
  INSTINCT_FILE="$LEARNING_DIR/instincts.jsonl"
  TS=$(date +%s%3N)
  ID=$(echo -n "${TS}::${TRIGGER}::auto_recorded" | sha256sum | cut -c1-16)
  ENTRY=$(node -e "console.log(JSON.stringify({
    id: '$ID',
    trigger: '$TRIGGER',
    action: 'auto_recorded',
    confidence: 0.3,
    evidence: ['auto-instinct hook: $COMMAND'],
    scope: 'global',
    project: '',
    created_at: new Date($TS).toISOString(),
    updated_at: new Date($TS).toISOString(),
  }))")
  echo "$ENTRY" >> "$INSTINCT_FILE" 2>/dev/null || true
fi

echo '{}'
