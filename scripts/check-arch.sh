#!/usr/bin/env bash
# check-arch.sh — Architectural constraint runner.
#
# Reads .harness/arch-rules.json and runs each rule's `check` command.
# Outputs WHAT/WHY/FIX on violations. Exits 0 if all pass.
#
# Each rule has the shape:
#   {
#     "id": "ARCH-NNN",
#     "description": "...",
#     "check": "<shell command>",      # exit 0 = pass
#     "expect": "pass" | "fail",
#     "what": "...",   # human description of the violation
#     "why": "...",    # rationale
#     "fix":  "..."    # how to fix
#   }

set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RULES="$ROOT/.harness/arch-rules.json"

if [[ ! -f "$RULES" ]]; then
  echo "FAIL: .harness/arch-rules.json not found"
  exit 1
fi

echo "▶ Running architectural constraints..."

PASS=0
FAIL=0
VIOLATIONS=()

# Parse and run each rule
RULE_IDS=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); for (const x of r.rules) console.log(x.id);" 2>/dev/null || echo "")

for ID in $RULE_IDS; do
  # Extract fields
  DESC=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); const x = r.rules.find(y => y.id === '$ID'); console.log(x.description);" 2>/dev/null)
  CHECK=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); const x = r.rules.find(y => y.id === '$ID'); console.log(x.check);" 2>/dev/null)
  EXPECT=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); const x = r.rules.find(y => y.id === '$ID'); console.log(x.expect);" 2>/dev/null)
  WHAT=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); const x = r.rules.find(y => y.id === '$ID'); console.log(x.what);" 2>/dev/null)
  WHY=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); const x = r.rules.find(y => y.id === '$ID'); console.log(x.why);" 2>/dev/null)
  FIX=$(bun -e "const r = JSON.parse(await Bun.file('$RULES').text()); const x = r.rules.find(y => y.id === '$ID'); console.log(x.fix);" 2>/dev/null)

  # Run the check
  set +e
  RESULT=$(cd "$ROOT" && eval "$CHECK" 2>&1)
  RC=$?
  set -e

  if [[ "$EXPECT" == "pass" && $RC -eq 0 ]] || [[ "$EXPECT" == "fail" && $RC -ne 0 ]]; then
    PASS=$((PASS + 1))
    echo "  PASS  $ID — $DESC"
  else
    FAIL=$((FAIL + 1))
    echo "  FAIL  $ID — $DESC"
    VIOLATIONS+=("ID: $ID
  WHAT: $WHAT
  WHY:  $WHY
  FIX:  $FIX
  OUTPUT: $RESULT
")
  fi
done

echo ""
echo "──────────────────────────────────────"
echo "Summary: $PASS passed, $FAIL failed"

if [[ $FAIL -gt 0 ]]; then
  echo ""
  echo "Violations:"
  for v in "${VIOLATIONS[@]}"; do
    echo "$v"
    echo ""
  done
  exit 1
fi
exit 0
