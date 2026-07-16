#!/usr/bin/env bash
# post-merge-audit.sh — Post-merge audit hook
#
# Runs after git push (triggered by PostToolUse hook on Bash when command matches git push).
# Executes `make audit` and appends score to PROGRESS.md under ## Audit History.
# Idempotent — safe to run multiple times.
#
# Usage:
#   bash .claude/hooks/post-merge-audit.sh
#
# Registered in: .claude/settings.json → hooks.PostToolUse

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
AUDIT_MARKER="## Audit History"
AUDIT_ENTRY_MARKER="post-merge-audit"

# ── find the audit script ───────────────────────────────────────────────────────

# Try tools/audit-harness.sh first (the one referenced in the harness)
if [[ -f "$ROOT/tools/audit-harness.sh" ]]; then
  AUDIT_SCRIPT="bash $ROOT/tools/audit-harness.sh"
elif [[ -f "$ROOT/scripts/audit-harness.sh" ]]; then
  AUDIT_SCRIPT="bash $ROOT/scripts/audit-harness.sh"
else
  # No audit script found — exit 0 (idempotent, no blocking)
  echo "[post-merge-audit] No audit script found at tools/audit-harness.sh or scripts/audit-harness.sh — skipping."
  exit 0
fi

# ── run the audit ───────────────────────────────────────────────────────────────

set +e
AUDIT_OUTPUT=$($AUDIT_SCRIPT . 2>&1 || true)
AUDIT_RC=$?
set -e

# Extract score: look for "Score: XX" or "AUDIT SCORE: XX" or "score: XX"
SCORE=$(
  echo "$AUDIT_OUTPUT" |
    grep -iE "score[:\s]+([0-9]+)" |
    head -1 |
    grep -oE "[0-9]+"
)

if [[ -z "$SCORE" ]]; then
  SCORE="?"
fi

TIMESTAMP=$(date +"%Y-%m-%d %H:%M")
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

ENTRY="| $TIMESTAMP | $BRANCH | $COMMIT | $SCORE | post-merge-audit |"

# ── append to PROGRESS.md Audit History section ─────────────────────────────────

PROGRESS="$ROOT/PROGRESS.md"

if [[ ! -f "$PROGRESS" ]]; then
  echo "[post-merge-audit] PROGRESS.md not found at $PROGRESS — skipping."
  exit 0
fi

if ! grep -q "$AUDIT_MARKER" "$PROGRESS"; then
  # Section doesn't exist — create it
  {
    echo ""
    echo "$AUDIT_MARKER"
    echo ""
    echo "| Timestamp | Branch | Commit | Score | Trigger |"
    echo "|---|---|---|---|---|"
    echo "$ENTRY"
  } >> "$PROGRESS"
else
  # Section exists — check if this hook already ran for the same commit (idempotent)
  if grep -q "$AUDIT_ENTRY_MARKER.*$COMMIT" "$PROGRESS"; then
    echo "[post-merge-audit] Already audited commit $COMMIT — skipping (idempotent)."
    exit 0
  fi

  # Append entry after the table header separator line
  # Find the line after the table header separator (|---|---|---|) in the Audit History section
  awk -v entry="$ENTRY" '
    /^\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|[-|]+\|/ { found_sep=1; print; next }
    found_sep && !printed { print entry; printed=1 }
    { print }
  ' "$PROGRESS" > "$PROGRESS.tmp" && mv "$PROGRESS.tmp" "$PROGRESS"
fi

echo "[post-merge-audit] Audit complete. Score: $SCORE. Entry appended to PROGRESS.md."
exit 0
