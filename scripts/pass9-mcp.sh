#!/usr/bin/env bash
# Pass 9: Hindsight + Semble MCP integration end-to-end

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

# ─── Pass 9a: Semble binary present ─────────────────────────────────
echo "═══ Pass 9a. Semble CLI presence ═══"
if command -v semble >/dev/null 2>&1; then
  version=$(semble --version 2>&1 | head -1)
  echo "  ✅ semble on PATH: $version"
  PASS=$((PASS + 1))
else
  echo "  ⚠ semble not on PATH"
fi

# ─── Pass 9b: Semble can search the repo ────────────────────────────
echo ""
echo "═══ Pass 9b. Semble search smoke test ═══"
if command -v semble >/dev/null 2>&1; then
  # Build a quick search query
  result=$(semble search "plan canvas" /project --top-k 1 2>&1 | head -20)
  if echo "$result" | grep -qE '\.mjs|\.ts|file:'; then
    echo "  ✅ Semble returns matches with file paths"
    PASS=$((PASS + 1))
    echo "$result" | head -5
  else
    echo "  ⚠ Semble returned no matches or wrong format"
    echo "  Output: $result"
    FAIL=$((FAIL + 1))
    FAILURES+=("semble-search")
  fi
fi

# ─── Pass 9c: opencode.json MCP entries ─────────────────────────────
echo ""
echo "═══ Pass 9c. opencode.json MCP wiring ═══"
oc_config="/home/dev/.config/opencode/opencode.json"
if [ -f "$oc_config" ]; then
  if grep -q '"semble"' "$oc_config" 2>/dev/null; then
    echo "  ✅ semble MCP entry present in opencode.json"
    PASS=$((PASS + 1))
  else
    echo "  ❌ semble MCP entry missing from opencode.json"
    FAIL=$((FAIL + 1))
    FAILURES+=("semble-mcp-missing")
  fi
  if grep -q '"hindsight"' "$oc_config" 2>/dev/null; then
    echo "  ✅ hindsight MCP entry present in opencode.json"
    PASS=$((PASS + 1))
  else
    echo "  ⚠ hindsight MCP entry missing (sandbox-disabled)"
  fi
else
  echo "  ⚠ opencode.json not at $oc_config (sandbox hasn't run yet?)"
  FAIL=$((FAIL + 1))
  FAILURES+=("no-opencode-config")
fi

# ─── Pass 9d: Semble JSONL index exists ─────────────────────────────
echo ""
echo "═══ Pass 9d. Semble index state ═══"
# Semble typically builds a .semble/ or .semble-cache/ index
if [ -d /project/.semble ] || [ -d /tmp/.semble ]; then
  echo "  ✅ Semble index directory exists"
  PASS=$((PASS + 1))
else
  echo "  ⚠ Semble index not built yet (build on first search)"
fi

# ─── Pass 9e: Hindsight bank (if available) ──────────────────────────
echo ""
echo "═══ Pass 9e. Hindsight bank presence ═══"
hindsight_dir="$HOME/.cache/hindsight"
if [ -d "$hindsight_dir" ]; then
  banks=$(ls "$hindsight_dir" 2>/dev/null)
  if [ -n "$banks" ]; then
    echo "  ✅ Hindsight banks: $(echo "$banks" | wc -l) entries"
    echo "$banks" | head -5 | sed 's/^/    /'
    PASS=$((PASS + 1))
  else
    echo "  ⚠ Hindsight dir empty (sandbox-disabled)"
  fi
else
  echo "  ⚠ Hindsight disabled in dev sandbox (sandbox-disable-extras)"
  echo "  → Real users would create banks with hindsight_create_bank"
fi

# ─── Pass 9f: Plugin dashboard-client uses Semble (indirect) ───────
echo ""
echo "═══ Pass 9f. Plugin integration check ═══"
if grep -q "@polderlabs/bizar-sdk" /project/plugins/bizar/package.json; then
  echo "  ✅ Plugin uses @polderlabs/bizar-sdk"
  PASS=$((PASS + 1))
else
  echo "  ❌ Plugin doesn't reference SDK"
  FAIL=$((FAIL + 1))
  FAILURES+=("plugin-sdk-ref")
fi

# ─── Pass 9g: SDK events module ─────────────────────────────────────
echo ""
echo "═══ Pass 9g. SDK modules load ═══"
cd /project
node -e "
import('./packages/sdk/dist/index.js').then(m => {
  const names = Object.keys(m);
  console.log('  ✅ SDK exports:', names.slice(0, 8).join(', ') + (names.length > 8 ? ', ...' : ''));
}).catch(e => {
  console.log('  ❌ SDK load failed:', e.message);
  process.exit(1);
});
" 2>&1 | head -3
if [ $? -eq 0 ]; then
  PASS=$((PASS + 1))
else
  FAIL=$((FAIL + 1))
  FAILURES+=("sdk-load")
fi

# ─── Summary ────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════════════════════"
echo "PASS 9 SUMMARY: $PASS passed, $FAIL failed"
[ $FAIL -gt 0 ] && for f in "${FAILURES[@]}"; do echo "  - $f"; done
echo "════════════════════════════════════════════════════════════════════"
