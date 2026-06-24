#!/usr/bin/env bash
# Pass 2+3: Plugin lifecycle + agent definitions

set -uo pipefail
export PATH="$HOME/.local/bin:$PATH"

cd /project

# ─── Pass 2a: Plugin loads without error ─────────────────────────────
echo "═══ Pass 2a. Plugin loads without error ═══"
mkdir -p /tmp/bizar-agent-test
cd /tmp/bizar-agent-test
rm -f opencode.log
echo "" | timeout 60 opencode run --model "opencode/deepseek-v4-flash-free" "echo ready" 2>&1 | tail -10 > /tmp/opencode-out.txt
echo "opencode run output:"
cat /tmp/opencode-out.txt
echo ""
echo "Did it load without error?"
if grep -q "Error" /tmp/opencode-out.txt; then
  echo "❌ Plugin load: errors detected"
else
  echo "✅ Plugin load: no errors"
fi

# ─── Pass 2b: Plugin tools schema check ───────────────────────────────
echo ""
echo "═══ Pass 2b. Plugin tool schemas ═══"
# Tools are defined in src/tools/. Let's check each one is registered and has Zod schema.
TOOLS_DIR="/project/plugins/bizar/src/tools"
for tool in bg-spawn bg-status bg-collect bg-kill bg-get-comments plan-action wait-for-feedback; do
  if [ -f "$TOOLS_DIR/$tool.ts" ]; then
    echo "✅ $tool.ts exists"
    # Check it exports a tool with schema + execute
    if grep -q "export const $tool\|export const .*Tool\|export const.* = tool(" "$TOOLS_DIR/$tool.ts"; then
      echo "   ✓ exports tool definition"
    else
      echo "   ⚠ no obvious tool export found (may still be valid)"
    fi
  else
    echo "❌ $tool.ts MISSING"
  fi
done

# ─── Pass 3: Agent definitions ──────────────────────────────────────
echo ""
echo "═══ Pass 3. Agent definitions (13 agents) ═══"
AGENTS_DIR="/project/config/agents"
EXPECTED_AGENTS=(
  "baldr"
  "forseti"
  "frigg"
  "heimdall"
  "hermod"
  "mimir"
  "odin"
  "quick"
  "semble-search"
  "thor"
  "tyr"
  "vidarr"
  "vor"
)

VALID=0
INVALID=0
for agent in "${EXPECTED_AGENTS[@]}"; do
  FILE="$AGENTS_DIR/$agent.md"
  if [ ! -f "$FILE" ]; then
    echo "❌ $agent: file MISSING"
    INVALID=$((INVALID + 1))
    continue
  fi
  # Check frontmatter (between --- markers at top of file)
  FRONTMATTER=$(sed -n '/^---$/,/^---$/p' "$FILE" | head -30)
  if [ -z "$FRONTMATTER" ]; then
    echo "❌ $agent: missing frontmatter"
    INVALID=$((INVALID + 1))
    continue
  fi
  # Check for description
  if echo "$FRONTMATTER" | grep -q "^description:"; then
    echo "✅ $agent: frontmatter OK"
    VALID=$((VALID + 1))
  else
    echo "❌ $agent: missing description in frontmatter"
    INVALID=$((INVALID + 1))
  fi
done

echo ""
echo "Agents: $VALID valid, $INVALID invalid"

# ─── Pass 3b: Agent frontmatter details ──────────────────────────────
echo ""
echo "═══ Pass 3b. Agent frontmatter details (model + tools + hooks) ═══"
for agent in "${EXPECTED_AGENTS[@]}"; do
  FILE="$AGENTS_DIR/$agent.md"
  if [ -f "$FILE" ]; then
    MODEL=$(grep -E "^model:" "$FILE" | head -1 | sed 's/model:\s*//' | tr -d '"' | tr -d "'" | head -c 60)
    echo "  $agent: model=$MODEL"
  fi
done

# ─── Pass 3c: opencode.json consistency ─────────────────────────────
echo ""
echo "═══ Pass 3c. opencode.json plugin references ═══"
OPENCODE_JSON="/home/dev/.config/opencode/opencode.json"
echo "Plugin entry:"
grep -A 8 '"plugin"' "$OPENCODE_JSON" 2>&1 | head -10
echo ""
echo "Agent entries (if any):"
grep -A 2 '"agent"' "$OPENCODE_JSON" 2>&1 | head -10
