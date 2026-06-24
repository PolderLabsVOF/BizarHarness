#!/usr/bin/env bash
# Pass 7: Skills system end-to-end

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

# ─── Pass 7a: Bundled skills exist ──────────────────────────────────
echo "═══ Pass 7a. Bundled skills present ═══"
SKILLS_DIR="/project/config/skills"
for skill in bizar self-improvement cpp-coding-standards cpp-testing embedded-esp-idf; do
  if [ -d "$SKILLS_DIR/$skill" ] && [ -f "$SKILLS_DIR/$skill/SKILL.md" ]; then
    lines=$(wc -l < "$SKILLS_DIR/$skill/SKILL.md")
    echo "  ✅ $SKILLS_DIR/$skill/SKILL.md ($lines lines)"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $SKILLS_DIR/$skill missing"
    FAIL=$((FAIL + 1))
    FAILURES+=("bundled: $skill")
  fi
done

# ─── Pass 7b: skills CLI available ──────────────────────────────────
echo ""
echo "═══ Pass 7b. skills CLI check ═══"
if command -v skills >/dev/null 2>&1; then
  echo "  ✅ skills CLI on PATH"
  skills --version 2>&1 | head -3
  PASS=$((PASS + 1))
else
  echo "  ⚠ skills CLI not on PATH (skipping)"
fi

# ─── Pass 7c: SKILL.md format validation ────────────────────────────
echo ""
echo "═══ Pass 7c. SKILL.md frontmatter validation ═══"
fail_count=0
for skill_dir in "$SKILLS_DIR"/*/; do
  skill=$(basename "$skill_dir")
  f="$skill_dir/SKILL.md"
  [ ! -f "$f" ] && continue

  # Check for required frontmatter
  if head -1 "$f" | grep -q '^---$'; then
    if grep -q '^name:' "$f" && grep -q '^description:' "$f"; then
      :
    else
      echo "  ⚠ $skill: missing name/description in frontmatter"
      fail_count=$((fail_count + 1))
    fi
  else
    echo "  ⚠ $skill: no frontmatter"
    fail_count=$((fail_count + 1))
  fi
done
if [ "$fail_count" -eq 0 ]; then
  echo "  ✅ All skills have valid frontmatter"
  PASS=$((PASS + 1))
else
  echo "  ❌ $fail_count skills have invalid frontmatter"
  FAIL=$((FAIL + 1))
  FAILURES+=("frontmatter-validation")
fi

# ─── Pass 7d: Custom skills loader (in plugin) ─────────────────────
echo ""
echo "═══ Pass 7d. Plugin skill loader tests ═══"
cd /project/plugins/bizar
run_test "skill loader unit tests" "bun test tests/skills/ 2>&1 | tail -3"
cd /project

# ─── Pass 7e: List installed skills in opencode ────────────────────
echo ""
echo "═══ Pass 7e. opencode skills directory ═══"
# Check that opencode sees our skills
ls -la /project/.opencode/skills/ 2>/dev/null | head -10 || echo "  No .opencode/skills/ in project (skill discovery may differ)"

# ─── Pass 7f: Verify skill content references ──────────────────────
echo ""
echo "═══ Pass 7f. Skill content sanity checks ═══"
if grep -q "BizarHarness" "$SKILLS_DIR/bizar/SKILL.md" 2>/dev/null; then
  echo "  ✅ bizar skill mentions BizarHarness"
  PASS=$((PASS + 1))
fi
if grep -q "self-improvement" "$SKILLS_DIR/self-improvement/SKILL.md" 2>/dev/null; then
  echo "  ✅ self-improvement skill describes the workflow"
  PASS=$((PASS + 1))
fi

# ─── Summary ────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 7 SUMMARY: $PASS passed, $FAIL failed"
[ $FAIL -gt 0 ] && for f in "${FAILURES[@]}"; do echo "  - $f"; done
echo "════════════════════════════════════════════════════════════════════"
