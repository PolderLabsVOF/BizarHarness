#!/usr/bin/env bash
set -euo pipefail

# NOTE: This installer is for Linux/macOS only. On Windows, run:
#   npm install -g @polderlabs/bizar
# ...which triggers the cross-platform Node.js installer.
# This script will fail on Windows cmd/PowerShell.

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

# ── Copy commands (slash commands) ──────────────────────────────────
if [ -d "$REPO_DIR/config/commands/" ]; then
  echo -e "  ${GREEN}→${NC} Installing slash commands..."
  mkdir -p "$CONFIG_DIR/commands"
  for f in "$REPO_DIR/config/commands/"*.md; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    cp "$f" "$CONFIG_DIR/commands/$name"
    echo -e "    ${GREEN}✓${NC} commands/$name"
  done
fi

# ── Copy hooks ─────────────────────────────────────────────────────
if [ -d "$REPO_DIR/config/hooks/" ]; then
  echo -e "  ${GREEN}→${NC} Installing hooks..."
  mkdir -p "$CONFIG_DIR/hooks"
  for f in "$REPO_DIR/config/hooks/"*; do
    [ -e "$f" ] || continue
    name="$(basename "$f")"
    cp -R "$f" "$CONFIG_DIR/hooks/$name"
    echo -e "    ${GREEN}✓${NC} hooks/$name"
  done
fi

# ── Copy AGENTS.md ─────────────────────────────────────────────────
echo -e "  ${GREEN}→${NC} Installing AGENTS.md..."
cp "$REPO_DIR/config/AGENTS.md" "$CONFIG_DIR/AGENTS.md"
echo -e "    ${GREEN}✓${NC} AGENTS.md"

# ── Copy bundled skills ────────────────────────────────────────────
SKILLS_DIR="$HOME/.opencode/skills"
echo -e "  ${GREEN}→${NC} Installing bundled skills..."
for skill in bizar self-improvement cpp-coding-standards cpp-testing embedded-esp-idf; do
  if [ -d "$REPO_DIR/config/skills/$skill" ]; then
    mkdir -p "$SKILLS_DIR/$skill"
    cp -R "$REPO_DIR/config/skills/$skill/." "$SKILLS_DIR/$skill/"
    echo -e "    ${GREEN}✓${NC} skills/$skill"
  else
    echo -e "    ${YELLOW}⚠${NC} skills/$skill — source not found, skipping"
  fi
done
# Make scripts executable for skills that bundle them
chmod +x "$SKILLS_DIR"/embedded-esp-idf/scripts/*.sh 2>/dev/null || true

# ── Install domain skills via skills.sh (always-on rule discoverability) ──
if command -v npx >/dev/null 2>&1; then
  echo -e "  ${GREEN}→${NC} Installing domain skills from skills.sh..."
  # Impeccable — UI anti-pattern detection (frontend quality)
  if npx --yes impeccable skills install -y --scope=user --providers=opencode >/dev/null 2>&1; then
    echo -e "    ${GREEN}✓${NC} impeccable (UI anti-pattern detector)"
  else
    echo -e "    ${YELLOW}⚠${NC} impeccable — install failed (run manually: npx impeccable skills install)"
  fi
  # Ponytail — minimal-code skill for AI agents
  if npx --yes @dietrichgebert/ponytail install --scope=user >/dev/null 2>&1; then
    echo -e "    ${GREEN}✓${NC} ponytail (minimal-code skill)"
  else
    echo -e "    ${YELLOW}⚠${NC} ponytail — install failed (run manually: npx @dietrichgebert/ponytail install)"
  fi
  # Obsidian skills — Obsidian Flavored Markdown, Bases, JSON Canvas, CLI
  if npx --yes skills add https://github.com/kepano/obsidian-skills --all -y >/dev/null 2>&1; then
    echo -e "    ${GREEN}✓${NC} obsidian-skills (Obsidian Markdown/Bases/Canvas)"
  else
    echo -e "    ${YELLOW}⚠${NC} obsidian-skills — install failed (run manually: npx skills add kepano/obsidian-skills)"
  fi
fi

# ── Copy Bizar plugin ──────────────────────────────────────────────
echo -e "  ${GREEN}→${NC} Installing Bizar plugin..."
PLUGIN_SRC="$REPO_DIR/plugins/bizar"
PLUGIN_DST="$CONFIG_DIR/plugins/bizar"
if [ -d "$PLUGIN_SRC" ]; then
  mkdir -p "$PLUGIN_DST"
  # Copy files, excluding node_modules, dist, *.log, .DS_Store (spec §9.2)
  while IFS= read -r -d '' f; do
    rel="${f#$PLUGIN_SRC/}"
    mkdir -p "$(dirname "$PLUGIN_DST/$rel")"
    cp "$f" "$PLUGIN_DST/$rel"
  done < <(find "$PLUGIN_SRC" \
    -not -path '*/node_modules/*' \
    -not -path '*/dist/*' \
    -not -name '*.log' \
    -not -name '.DS_Store' \
    -type f -print0)
  echo -e "    ${GREEN}✓${NC} plugins/bizar/"
else
  echo -e "    ${YELLOW}⚠${NC} Bizar plugin source not found at $PLUGIN_SRC — skipping"
fi

# ── Merge opencode.json ────────────────────────────────────────────
echo -e "  ${GREEN}→${NC} Configuring opencode.json..."
# Prefer the .template copy (non-tracked); fall back to the legacy tracked file
if [ -f "$REPO_DIR/config/opencode.json.template" ]; then
  TEMPLATE="$REPO_DIR/config/opencode.json.template"
elif [ -f "$REPO_DIR/config/opencode.json" ]; then
  TEMPLATE="$REPO_DIR/config/opencode.json"
else
  echo -e "    ${YELLOW}⚠${NC} No opencode template found — skipping config merge"
  TEMPLATE=""
fi

if [ -n "$TEMPLATE" ] && [ -f "$CONFIG_DIR/opencode.json" ]; then
  echo -e "    ${YELLOW}⚠${NC} Existing opencode.json found — backing up to opencode.json.bak"
  cp "$CONFIG_DIR/opencode.json" "$CONFIG_DIR/opencode.json.bak"
fi

if [ -n "$TEMPLATE" ]; then
  if command -v jq &>/dev/null; then
    MERGE_TMP="$CONFIG_DIR/opencode.json.merge.$$"
    if [ -f "$CONFIG_DIR/opencode.json" ] && jq -s '.[0] * .[1]' "$TEMPLATE" "$CONFIG_DIR/opencode.json" > "$MERGE_TMP" 2>/dev/null; then
      mv "$MERGE_TMP" "$CONFIG_DIR/opencode.json"
    else
      rm -f "$MERGE_TMP"
      cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"
    fi
    # Ensure the bizar plugin entry exists in the plugin array (idempotent)
    PLUGIN_TMP="$CONFIG_DIR/opencode.json.tmp.$$"
    jq '
      if (.plugin // []) | map(.[0] == "./plugins/bizar/index.ts") | any then .
      else .plugin = (.plugin // []) + [["./plugins/bizar/index.ts", {
        "loopThresholdWarn": 5,
        "loopThresholdEscalate": 8,
        "loopThresholdBlock": 12,
        "loopWindowSize": 10
      }]]
      end
    ' "$CONFIG_DIR/opencode.json" > "$PLUGIN_TMP" \
      && mv "$PLUGIN_TMP" "$CONFIG_DIR/opencode.json" \
      || rm -f "$PLUGIN_TMP"
    echo -e "    ${GREEN}✓${NC} opencode.json"
    echo -e "    ${GREEN}✓${NC} Bizar plugin (loop guard)"
  else
    cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"
    echo -e "    ${YELLOW}⚠${NC} jq not found — copied template directly. Install jq for safe config merge."
    echo -e "    ${YELLOW}⚠${NC}   Existing opencode.json is backed up at opencode.json.bak"
  fi
else
  echo -e "    ${YELLOW}⚠${NC} No opencode.json template found — skipping config"
fi

# ── Post-install instructions ──────────────────────────────────────
echo ""
echo -e "${BOLD}${CYAN}┌────────────────────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}${CYAN}│${NC}  ${BOLD}BizarHarness installed!${NC}                                         │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  Bundled skills: C++ coding standards, C++ testing,        │"
echo -e "${BOLD}${CYAN}│${NC}  Embedded ESP-IDF (plus BizarHarness, self-improvement)     │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  ${YELLOW}Next steps:${NC}                                                   │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  1. Edit ${CONFIG_DIR}/opencode.json                         │"
echo -e "${BOLD}${CYAN}│${NC}     → Configure Obsidian vault path with your key          │"
echo -e "${BOLD}${CYAN}│${NC}  ${YELLOW}⚠ If thinking is too verbose, remove or lower variant: \"high\"${NC}     │"
echo -e "${BOLD}${CYAN}│${NC}     ${YELLOW}on odin/tyr/forseti in ${CONFIG_DIR}/opencode.json${NC}                │"
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
echo -e "${BOLD}${CYAN}│${NC}  Odin     ᛟ  MiniMax-M3               Router                  │"
echo -e "${BOLD}${CYAN}│${NC}  Mimir    ᛗ  DeepSeek Flash Free  Free (research)              │"
echo -e "${BOLD}${CYAN}│${NC}  Heimdall ᚹ  DeepSeek Flash Free  Free (mechanical)             │"
echo -e "${BOLD}${CYAN}│${NC}  Hermod   ᚱ  MiniMax-M2.7           \$0.30/\$1.20 (git ops)      │"
echo -e "${BOLD}${CYAN}│${NC}  Thor     ᚦ  MiniMax-M2.7           \$0.30/\$1.20 (medium)       │"
echo -e "${BOLD}${CYAN}│${NC}  Tyr      ᛏ  MiniMax-M3             Highest (complex work)      │"
echo -e "${BOLD}${CYAN}│${NC}  Vidarr   ᛉ  GPT-5.5                Highest (last resort)       │"
echo -e "${BOLD}${CYAN}│${NC}  Forseti  ᚨ  MiniMax-M3 (audit)     Highest (plan review)       │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}└────────────────────────────────────────────────────────────┘${NC}"
