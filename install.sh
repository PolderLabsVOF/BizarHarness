#!/usr/bin/env bash
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "${BOLD}${CYAN}⚡ BizarHarness — Norse Pantheon Agent Installer${NC}"
echo ""

# ── Create config dir ──────────────────────────────────────────────
mkdir -p "$CONFIG_DIR/agents"

# ── Copy agents ────────────────────────────────────────────────────
echo -e "  ${GREEN}→${NC} Installing agent definitions..."
for f in "$REPO_DIR/config/agents/"*.md; do
  name="$(basename "$f")"
  cp "$f" "$CONFIG_DIR/agents/$name"
  echo -e "    ${GREEN}✓${NC} agents/$name"
done

# ── Copy AGENTS.md ─────────────────────────────────────────────────
echo -e "  ${GREEN}→${NC} Installing AGENTS.md..."
cp "$REPO_DIR/config/AGENTS.md" "$CONFIG_DIR/AGENTS.md"
echo -e "    ${GREEN}✓${NC} AGENTS.md"

# ── Merge opencode.json ────────────────────────────────────────────
echo -e "  ${GREEN}→${NC} Configuring opencode.json..."
TEMPLATE="$REPO_DIR/config/opencode.json"

if [ -f "$CONFIG_DIR/opencode.json" ]; then
  echo -e "    ${YELLOW}⚠${NC} Existing opencode.json found — backing up to opencode.json.bak"
  cp "$CONFIG_DIR/opencode.json" "$CONFIG_DIR/opencode.json.bak"
fi

if command -v jq &>/dev/null; then
  jq -s '.[0] * .[1]' "$TEMPLATE" "$CONFIG_DIR/opencode.json" 2>/dev/null ||
    cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"
else
  cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"
fi
echo -e "    ${GREEN}✓${NC} opencode.json"

# ── Post-install instructions ──────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}┌────────────────────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}${CYAN}│${NC}  ${BOLD}BizarHarness installed!${NC}                                         │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  ${YELLOW}Next steps:${NC}                                                   │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  1. Edit ${CONFIG_DIR}/opencode.json                         │"
echo -e "${BOLD}${CYAN}│${NC}     → Replace YOUR_HINDSIGHT_API_KEY with your key          │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  2. Restart opencode                                        │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  3. Run ${BOLD}/connect${NC} to add API keys:                                │"
echo -e "${BOLD}${CYAN}│${NC}     → OpenCode Zen (DeepSeek V4 Flash Free)                 │"
echo -e "${BOLD}${CYAN}│${NC}     → minimax.io (MiniMax M2.7 + M3)                        │"
echo -e "${BOLD}${CYAN}│${NC}     → OpenAI ChatGPT (GPT-5.5)                              │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  4. Verify with ${BOLD}/models${NC}                                          │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  ── Pantheon Agents ──                                        │"
echo -e "${BOLD}${CYAN}│${NC}  Odin     🛡️  DeepSeek V4 Flash Free  Free (router)           │"
echo -e "${BOLD}${CYAN}│${NC}  Heimdall 👁️  DeepSeek V4 Flash Free  Free (mechanical)        │"
echo -e "${BOLD}${CYAN}│${NC}  Hermod   ✉️  MiniMax M2.7            \$0.30/\$1.20 (git ops)         │"
echo -e "${BOLD}${CYAN}│${NC}  Thor     ⚡  MiniMax M2.7           \$0.30/\$1.20 (medium)      │"
echo -e "${BOLD}${CYAN}│${NC}  Tyr      ⚖️  MiniMax M3             Highest (complex work)     │"
echo -e "${BOLD}${CYAN}│${NC}  Vidarr   🔥  GPT-5.5                Highest (last resort)      │"
echo -e "${BOLD}${CYAN}│${NC}  Forseti  🔍  MiniMax M3 (audit)     Highest (plan review)      │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}└────────────────────────────────────────────────────────────┘${NC}"
