#!/usr/bin/env bash
# Pass 8: Self-improvement workflow end-to-end

set -uo pipefail

PREFIX="$HOME/.cache/bizar-global"
export PATH="$PREFIX/node_modules/.bin:$PATH"

cd /project

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

# ─── Pass 8a: .bizar/ exists and has expected files ─────────────────
echo "═══ Pass 8a. .bizar/ directory structure ═══"
if [ -d /project/.bizar ]; then
  echo "  ✅ .bizar/ exists"
  PASS=$((PASS + 1))
else
  echo "  ❌ .bizar/ missing — init not run?"
  FAIL=$((FAIL + 1))
  FAILURES+=(".bizar-missing")
fi

# ─── Pass 8b: AGENTS_SELF_IMPROVEMENT.md present ────────────────────
echo ""
echo "═══ Pass 8b. Self-improvement file ═══"
if [ -f /project/.bizar/AGENTS_SELF_IMPROVEMENT.md ]; then
  lines=$(wc -l < /project/.bizar/AGENTS_SELF_IMPROVEMENT.md)
  echo "  ✅ .bizar/AGENTS_SELF_IMPROVEMENT.md ($lines lines)"
  PASS=$((PASS + 1))

  # Check for required sections
  if grep -q "## Active Rules" /project/.bizar/AGENTS_SELF_IMPROVEMENT.md; then
    rule_count=$(grep -c "^[0-9]\+\." /project/.bizar/AGENTS_SELF_IMPROVEMENT.md || echo 0)
    echo "  ✅ Active Rules section has $rule_count numbered rules"
    PASS=$((PASS + 1))
  else
    echo "  ⚠ Missing Active Rules section"
    FAIL=$((FAIL + 1))
    FAILURES+=("active-rules-section")
  fi
else
  echo "  ❌ .bizar/AGENTS_SELF_IMPROVEMENT.md missing"
  FAIL=$((FAIL + 1))
  FAILURES+=("self-improvement-md")
fi

# ─── Pass 8c: PROJECT.md present ────────────────────────────────────
echo ""
echo "═══ Pass 8c. PROJECT.md ═══"
if [ -f /project/.bizar/PROJECT.md ]; then
  lines=$(wc -l < /project/.bizar/PROJECT.md)
  echo "  ✅ .bizar/PROJECT.md ($lines lines)"
  PASS=$((PASS + 1))
else
  echo "  ❌ .bizar/PROJECT.md missing"
  FAIL=$((FAIL + 1))
  FAILURES+=("project-md")
fi

# ─── Pass 8d: Simulate a self-improvement append ───────────────────
echo ""
echo "═══ Pass 8d. Append a self-improvement entry ═══"
test_entry_marker="<!-- test-pass8-marker: $(date +%s) -->"
test_entry="$(cat <<EOF

### $(date -u +"%Y-%m-%dT%H:%M:%SZ") (Pass 8 simulation)
$test_entry_marker

**Context:** Test pass running in BizarHarness-dev container, verifying the
self-improvement append workflow end-to-end.

**Lesson:** The append workflow appends an H3-dated entry below any existing
content. No need to parse or modify existing rules — just append.

**Pattern:** Use a unique marker (timestamp + comment) so tests can verify
the entry was actually written.

**Files changed:** .bizar/AGENTS_SELF_IMPROVEMENT.md (appended test entry)
**Agent used:** @heimdall (simulated via bash here-doc)
EOF
)"

# Backup, append, verify
backup="/tmp/pass8-backup-$$.md"
cp /project/.bizar/AGENTS_SELF_IMPROVEMENT.md "$backup"
echo "$test_entry" >> /project/.bizar/AGENTS_SELF_IMPROVEMENT.md
if grep -q "$test_entry_marker" /project/.bizar/AGENTS_SELF_IMPROVEMENT.md; then
  echo "  ✅ Append succeeded — marker present in file"
  PASS=$((PASS + 1))
else
  echo "  ❌ Append failed"
  FAIL=$((FAIL + 1))
  FAILURES+=("append-entry")
fi

# Verify line count increased
before=$(wc -l < "$backup")
after=$(wc -l < /project/.bizar/AGENTS_SELF_IMPROVEMENT.md)
delta=$((after - before))
if [ "$delta" -gt 5 ]; then
  echo "  ✅ Line count grew by $delta lines"
  PASS=$((PASS + 1))
else
  echo "  ❌ Line count grew by only $delta lines"
  FAIL=$((FAIL + 1))
  FAILURES+=("line-count-delta")
fi

# ─── Pass 8e: Restore backup ────────────────────────────────────────
echo ""
echo "═══ Pass 8e. Restore backup ═══"
cp "$backup" /project/.bizar/AGENTS_SELF_IMPROVEMENT.md
rm -f "$backup"
if ! grep -q "$test_entry_marker" /project/.bizar/AGENTS_SELF_IMPROVEMENT.md; then
  echo "  ✅ Backup restored — marker removed"
  PASS=$((PASS + 1))
else
  echo "  ❌ Marker still present after restore"
  FAIL=$((FAIL + 1))
  FAILURES+=("restore-backup")
fi

# ─── Pass 8f: Check rules file referenced in self-improvement skill ─
echo ""
echo "═══ Pass 8f. Cross-reference between skill and file ═══"
skill_file=/project/config/skills/self-improvement/SKILL.md
if [ -f "$skill_file" ]; then
  if grep -q "AGENTS_SELF_IMPROVEMENT" "$skill_file"; then
    echo "  ✅ self-improvement skill references AGENTS_SELF_IMPROVEMENT.md"
    PASS=$((PASS + 1))
  else
    echo "  ⚠ skill does not reference the file by name"
    FAIL=$((FAIL + 1))
    FAILURES+=("skill-cross-ref")
  fi
fi

# ─── Pass 8g: Hindsight bank state ──────────────────────────────────
echo ""
echo "═══ Pass 8g. Hindsight presence ═══"
# Hindsight is disabled in dev sandbox (sandbox-disable), but the file structure should still exist
hindsight_dir="$HOME/.cache/hindsight"
if [ -d "$hindsight_dir" ]; then
  banks=$(ls "$hindsight_dir" 2>/dev/null | wc -l)
  echo "  ✅ Hindsight dir exists ($banks entries)"
  PASS=$((PASS + 1))
else
  echo "  ⚠ Hindsight dir not yet created (sandbox-disabled in dev container)"
fi

# ─── Summary ────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 8 SUMMARY: $PASS passed, $FAIL failed"
[ $FAIL -gt 0 ] && for f in "${FAILURES[@]}"; do echo "  - $f"; done
echo "════════════════════════════════════════════════════════════════════"
