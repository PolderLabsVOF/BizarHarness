#!/usr/bin/env bash
#
# install.sh — One-shot BizarHarness installer.
#
# v3.20.11 — Comprehensive auto-installer with full dependency
# resolution. Replaces the older "print 4 manual next steps" flow
# with: (1) install every system dep we can reasonably fetch
# (uv, python3.12, chrome-headless-shell, jq, Chrome runtime libs);
# (2) install browser-harness + register its skill; (3) start Chrome
# for browser-driven E2E; (4) install + configure all BizarHarness
# files (agents, commands, opencode.json, plugin); (5) print a
# single status banner that tells the operator what is ready and
# what (if anything) they still need to do.
#
# Idempotent — every step checks for the existing install and
# skips re-work. Re-running after a failed install picks up
# where it left off. Same script can run from a fresh `git clone`
# or via `bizar install` (which spawns this script under bash).
#
# What this script does NOT do (intentional):
#   - Configure provider API keys (MINIMAX_API_KEY, etc.). The user
#     does that via `/connect` in opencode after install. We deliberately
#     do not collect secrets here — the install is idempotent and safe
#     to re-run, and asking for keys during install breaks CI / scripted
#     deployments.
#   - Reload opencode. The opencode session picks up the new config on
#     next start. We print a status line at the end; we do not kill or
#     restart the opencode process from here (it would interrupt
#     in-flight agent sessions).
#   - Hide `.obsidian/`. The Obsidian vault is a first-class part of
#     the project tree. We do not add it to any .gitignore / .npmignore
#     / IDE-exclusion list.
#
# Idempotent: every step checks for the existing install and skips
# re-work. Re-running after a failed install picks up where it left off.
#
# Cross-platform: bash + curl work on Linux + macOS. On Windows run
# `npm install -g @polderlabs/bizar` which triggers the npm postinstall
# hook (cli/install.mjs → install.sh via git bash).
set -euo pipefail

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
SKILLS_DIR="$HOME/.opencode/skills"
BIZAR_STATE_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/bizar"
BIZAR_STATE_FILE="$BIZAR_STATE_DIR/install-state.json"
PYTHON_BIN="${PYTHON_BIN:-python3.12}"
CHROME_PORT="${CHROME_PORT:-9222}"

# Counters for the final summary.
INSTALLED=()
SKIPPED=()
FAILED=()

note() {
  echo -e "  ${GREEN}✓${NC} $1"
  INSTALLED+=("$1")
}
warn() {
  echo -e "  ${YELLOW}⚠${NC} $1"
  SKIPPED+=("$1")
}
err() {
  echo -e "  ${RED}✗${NC} $1"
  FAILED+=("$1")
}
section() {
  echo ""
  echo -e "${BOLD}${CYAN}── $1 ──${NC}"
}

# ── verify_dependencies: final check that all required tools are on PATH ─
verify_dependencies() {
  local missing=()
  for cmd in node uv uvx bun jq sqlite3 gh opencode python3 make g++; do
    if ! command -v "$cmd" &>/dev/null; then
      missing+=("$cmd")
    fi
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo -e "  ${RED}✗${NC} missing required commands: ${missing[*]}"
    return 1
  fi
  return 0
}

# ── Pre-flight: which tools are missing? ───────────────────────────────
section "Pre-flight: checking system tools"

have_cmd() { command -v "$1" >/dev/null 2>&1; }
have_file() { [ -e "$1" ]; }

MISSING=()
have_cmd node || MISSING+=("node")
have_cmd uv || MISSING+=("uv")
have_cmd uvx || MISSING+=("uvx")
have_cmd "$PYTHON_BIN" || MISSING+=("$PYTHON_BIN")
have_cmd jq || MISSING+=("jq")
have_cmd npx || MISSING+=("npx")
have_cmd git || MISSING+=("git")
have_cmd bun || MISSING+=("bun")
have_cmd gh || MISSING+=("gh")
have_cmd opencode || MISSING+=("opencode")
have_cmd sqlite3 || MISSING+=("sqlite3")
have_cmd make || MISSING+=("make")
have_cmd g++ || MISSING+=("g++")

# Chrome detection: prefer chrome-headless-shell from puppeteer cache, then
# system chromium / chrome / google-chrome. We don't require Chrome — the
# installer works without it — but we report it so the operator knows.
CHROME_BIN=""
for cand in \
  "$HOME/.cache/puppeteer/chrome-headless-shell"*/chrome-headless-shell/chrome-headless-shell \
  /usr/bin/chromium \
  /usr/bin/chrome \
  /usr/bin/google-chrome \
  "$(command -v chromium 2>/dev/null || true)" \
  "$(command -v chrome 2>/dev/null || true)" \
  "$(command -v google-chrome 2>/dev/null || true)"; do
  [ -n "$cand" ] && [ -x "$cand" ] && CHROME_BIN="$cand" && break
done

for t in "${MISSING[@]}"; do warn "missing system tool: $t"; done
if [ -z "$CHROME_BIN" ]; then warn "no chrome / chromium found — browser-harness won't work until installed"; fi
[ ${#MISSING[@]} -eq 0 ] && [ -n "$CHROME_BIN" ] && note "all system tools present"

# ── Install missing system tools (best effort, never abort) ─────────────
section "Install missing system tools"

# uv (Python package manager — needed for browser-harness + Semble)
if ! have_cmd uv; then
  echo -e "  ${CYAN}→${NC} Installing uv (Python package manager)..."
  if have_cmd curl; then
    if curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1; then
      # uv's installer drops the binary at ~/.local/bin/uv
      export PATH="$HOME/.local/bin:$PATH"
      if have_cmd uv; then
        note "uv installed at $(command -v uv)"
      else
        warn "uv install ran but uv not on PATH — try 'export PATH=\$HOME/.local/bin:\$PATH'"
      fi
    else
      warn "uv installer script failed — install manually: https://docs.astral.sh/uv/"
    fi
  else
    warn "curl not found — install uv manually: https://docs.astral.sh/uv/"
  fi
else
  note "uv $(uv --version 2>/dev/null | head -1)"
fi

# python3.12 (uv will manage its own python via --python 3.12, but
# we also accept system python3.12 if present). Only install if uv
# is available — uv can fetch its own python.
if ! have_cmd "$PYTHON_BIN"; then
  if have_cmd uv; then
    echo -e "  ${CYAN}→${NC} python3.12 not on PATH — uv will fetch on first use"
    note "python3.12 will be auto-fetched by uv (browser-harness will trigger first fetch)"
  else
    warn "no $PYTHON_BIN and no uv — install manually: sudo apt install python3.12 / brew install python@3.12"
  fi
else
  note "$PYTHON_BIN $($PYTHON_BIN --version 2>&1 | head -1)"
fi

# jq (for safe opencode.json merging)
if ! have_cmd jq; then
  echo -e "  ${CYAN}→${NC} Trying to install jq..."
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Linux)
      if have_cmd apt-get; then sudo apt-get install -y jq 2>/dev/null && note "jq installed (apt)" || warn "apt install jq failed — install manually"
      elif have_cmd dnf; then sudo dnf install -y jq 2>/dev/null && note "jq installed (dnf)" || warn "dnf install jq failed — install manually"
      elif have_cmd pacman; then sudo pacman -S --noconfirm jq 2>/dev/null && note "jq installed (pacman)" || warn "pacman install jq failed — install manually"
      elif have_cmd apk; then sudo apk add jq 2>/dev/null && note "jq installed (apk)" || warn "apk install jq failed — install manually"
      else warn "no known package manager — install jq manually"
      fi
      ;;
    Darwin)
      if have_cmd brew; then brew install jq 2>/dev/null && note "jq installed (brew)" || warn "brew install jq failed — install manually"
      else warn "no brew — install jq manually"
      fi
      ;;
    *) warn "unknown OS — install jq manually";;
  esac
else
  note "jq $(jq --version)"
fi

# Chrome (best effort — install chrome-headless-shell from chrome-for-testing
# or the puppeteer cache). The dashboard/browser-harness will work without
# it (the user can install later), but we try.
if [ -z "$CHROME_BIN" ]; then
  echo -e "  ${CYAN}→${NC} Trying to install chrome-headless-shell..."
  PUPPETEER_CACHE_DIR="$HOME/.cache/puppeteer"
  mkdir -p "$PUPPETEER_CACHE_DIR"
  # chrome-for-testing JSON API — find the latest stable chrome-headless-shell
  # URL for linux64. Fall back to nothing if the request fails.
  CHROME_CT_URL=$(curl -fsSL "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json" 2>/dev/null \
    | grep -o '"url": *"[^"]*chrome-headless-shell-linux64[^"]*"' \
    | head -1 \
    | sed 's/.*"url": *"\([^"]*\)".*/\1/')
  if [ -n "$CHROME_CT_URL" ]; then
    TMP_DIR=$(mktemp -d)
    if curl -fsSL "$CHROME_CT_URL" -o "$TMP_DIR/chrome-headless-shell.zip" 2>/dev/null; then
      TARGET_DIR="$PUPPETEER_CACHE_DIR/chrome-headless-shell"
      mkdir -p "$TARGET_DIR"
      unzip -q -o "$TMP_DIR/chrome-headless-shell.zip" -d "$TARGET_DIR"
      CHROME_BIN=$(find "$TARGET_DIR" -name chrome-headless-shell -type f 2>/dev/null | head -1)
      [ -n "$CHROME_BIN" ] && [ -x "$CHROME_BIN" ] && note "chrome-headless-shell installed at $CHROME_BIN" || warn "chrome-headless-shell install failed"
      rm -rf "$TMP_DIR"
    else
      warn "download from chrome-for-testing failed — install Chrome manually"
    fi
  else
    warn "could not resolve latest chrome-for-testing URL — install Chrome manually"
  fi
fi

# Chrome runtime libs (v3.20.11). chrome-headless-shell needs ~10 shared
# libraries that Debian/Ubuntu don't ship by default. Without these,
# chrome starts but immediately errors with `libnspr4.so: cannot open
# shared object file`. We install them on apt-based systems; on others
# we warn but continue (Chrome won't work, but the rest of the install
# will).
if [ -n "$CHROME_BIN" ] || [ -z "$CHROME_BIN" ]; then
  # Check if chrome-headless-shell actually runs (libs satisfied)
  if [ -n "$CHROME_BIN" ] && ! "$CHROME_BIN" --version >/dev/null 2>&1; then
    case "$(uname -s 2>/dev/null || echo unknown)" in
      Linux)
        if have_cmd apt-get; then
          echo -e "  ${CYAN}→${NC} chrome-headless-shell needs runtime libs — installing via apt..."
          if sudo -n apt-get install -y --no-install-recommends \
              libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
              libxdamage1 libxkbcommon0 libasound2t64 libatspi2.0-0 \
              2>/dev/null; then
            note "chrome runtime libs installed (libnss3, libnspr4, libatk*, libxkbcommon, libasound, libatspi)"
          else
            warn "apt install of chrome runtime libs failed (needs sudo). run manually:"
            warn "  sudo apt-get install -y libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \\"
            warn "    libxdamage1 libxkbcommon0 libasound2t64 libatspi2.0-0"
          fi
        else
          warn "chrome-headless-shell runtime libs missing — install libnss3, libnspr4, libatk* for your distro"
        fi
        ;;
      Darwin)
        warn "chrome-headless-shell runtime libs missing — on macOS: brew install --cask chromium"
        ;;
      *) warn "chrome-headless-shell runtime libs missing — install via your package manager";;
    esac
  fi
fi

# ── Native build deps (better-sqlite3 compiles, etc.) ─────────────────
section "Install native build dependencies"

if [ "${NO_SUDO:-}" != "1" ] && have_cmd apt-get; then
  echo -e "  ${CYAN}→${NC} Installing build-essential, python3, sqlite3-dev..."
  if sudo -n apt-get install -y --no-install-recommends \
    build-essential python3 sqlite3 libsqlite3-dev \
    2>/dev/null; then
    note "native build deps installed (build-essential, python3, sqlite3-dev)"
  else
    warn "apt install of native build deps failed (needs sudo). Install manually:"
    warn "  sudo apt-get install -y build-essential python3 sqlite3 libsqlite3-dev"
  fi
else
  note "native build deps check skipped (NO_SUDO=1 or non-apt system)"
fi

# ── Skills CLI (for skills.sh domain skills) ──────────────────────────
section "Install skills CLI"

if ! have_cmd skills; then
  if have_cmd npm; then
    echo -e "  ${CYAN}→${NC} Installing skills CLI via npm..."
    if npm install -g skills >/dev/null 2>&1; then
      note "skills CLI installed at $(command -v skills 2>/dev/null || echo 'npm global')"
    else
      warn "skills CLI install failed (run manually: npm install -g skills)"
    fi
  else
    warn "npm not found — cannot install skills CLI"
  fi
else
  note "skills CLI already installed"
fi

# ── Bun (JavaScript runtime, for plugin tests) ────────────────────────
section "Install Bun"

if ! have_cmd bun; then
  echo -e "  ${CYAN}→${NC} Installing Bun..."
  if have_cmd curl; then
    if curl -fsSL https://bun.sh/install | bash >/dev/null 2>&1; then
      export PATH="$HOME/.bun/bin:$PATH"
      if have_cmd bun; then
        note "Bun installed at $(command -v bun)"
      else
        warn "Bun installer ran but bun not on PATH — try 'export PATH=\$HOME/.bun/bin:\$PATH'"
      fi
    else
      warn "Bun installer failed — install manually: https://bun.sh"
    fi
  else
    warn "curl not found — install Bun manually: https://bun.sh"
  fi
else
  note "Bun $(bun --version 2>/dev/null | head -1)"
fi

# ── GitHub CLI (gh, for PR/issue operations) ──────────────────────────
section "Install GitHub CLI"

if ! have_cmd gh; then
  case "$(uname -s 2>/dev/null || echo unknown)" in
    Linux)
      if have_cmd apt-get; then
        echo -e "  ${CYAN}→${NC} Installing gh via apt..."
        if sudo -n apt-get install -y gh >/dev/null 2>&1; then
          note "gh installed (apt)"
        else
          warn "apt install gh failed. Install manually: https://cli.github.com/"
        fi
      elif have_cmd dnf; then
        sudo -n dnf install -y gh >/dev/null 2>&1 && note "gh installed (dnf)" || warn "dnf install gh failed"
      elif have_cmd pacman; then
        sudo -n pacman -S --noconfirm gh >/dev/null 2>&1 && note "gh installed (pacman)" || warn "pacman install gh failed"
      else
        warn "no known package manager — install gh manually: https://cli.github.com/"
      fi
      ;;
    Darwin)
      if have_cmd brew; then
        brew install gh >/dev/null 2>&1 && note "gh installed (brew)" || warn "brew install gh failed"
      else
        warn "no brew — install gh manually: https://cli.github.com/"
      fi
      ;;
    *)
      warn "unknown OS — install gh manually: https://cli.github.com/"
      ;;
  esac
else
  note "gh $(gh --version 2>/dev/null | head -1)"
fi

# ── opencode CLI (via curl installer) ────────────────────────────────
section "Install opencode CLI"

if ! have_cmd opencode; then
  echo -e "  ${CYAN}→${NC} Installing opencode CLI..."
  if have_cmd curl; then
    if curl -fsSL https://opencode.ai/install.sh | sh >/dev/null 2>&1; then
      if have_cmd opencode; then
        note "opencode CLI installed at $(command -v opencode)"
      else
        warn "opencode installer ran but binary not on PATH"
      fi
    else
      warn "opencode installer failed — install manually: https://opencode.ai"
    fi
  else
    warn "curl not found — install opencode manually: https://opencode.ai"
  fi
else
  note "opencode CLI already installed"
fi

# ── npm packages (BizarHarness, optional @polderlabs/bizar-dash peer) ───
section "Install BizarHarness npm packages"

if have_cmd npm; then
  for pkg in @polderlabs/bizar @polderlabs/bizar-dash; do
    if npm ls -g "$pkg" --depth=0 >/dev/null 2>&1; then
      cur=$(npm ls -g "$pkg" --depth=0 --json 2>/dev/null | grep -oE '"version":\s*"[^"]+"' | head -1 | sed 's/.*"\([^"]*\)".*/\1/')
      note "$pkg already installed (v$cur)"
    else
      echo -e "  ${CYAN}→${NC} Installing $pkg..."
      if npm install -g "$pkg" >/dev/null 2>&1; then
        note "$pkg installed"
      else
        err "$pkg install failed (run manually: npm install -g $pkg)"
      fi
    fi
  done
else
  err "npm not found — install Node.js 20+ first: https://nodejs.org/"
fi

# ── browser-harness (Python tool via uv, requires Python 3.12) ─────────
section "Install browser-harness (Python via uv)"

if have_cmd browser-harness; then
  note "browser-harness $(browser-harness --version 2>&1 | head -1) already installed"
else
  if have_cmd uv; then
    echo -e "  ${CYAN}→${NC} uv tool install --python 3.12 --upgrade --force browser-harness"
    if uv tool install --python 3.12 --upgrade --force browser-harness >/dev/null 2>&1; then
      note "browser-harness installed"
    else
      err "browser-harness install failed (run manually: uv tool install --python 3.12 --upgrade --force browser-harness)"
    fi
  else
    warn "uv not installed — skipping browser-harness (install uv first, then re-run this script)"
  fi
fi

# Register the browser-harness skill so any agent that needs it picks it up.
if have_cmd browser-harness; then
  BH_SKILL_DIR="$SKILLS_DIR/browser-harness"
  mkdir -p "$BH_SKILL_DIR"
  if browser-harness skill > "$BH_SKILL_DIR/SKILL.md" 2>/dev/null; then
    note "browser-harness skill registered at $BH_SKILL_DIR/SKILL.md"
  else
    warn "browser-harness skill registration failed (re-run: browser-harness skill > $BH_SKILL_DIR/SKILL.md)"
  fi
fi

# ── Chrome lifecycle (start browser-harness-up.sh) ────────────────────
section "Start Chrome for browser-harness"

if [ -x "$REPO_DIR/cli/browser-harness-up.sh" ]; then
  # The script knows how to find chrome-headless-shell from the
  # puppeteer cache (or any system chrome).
  if BH_OUTPUT=$("$REPO_DIR/cli/browser-harness-up.sh" start 2>&1); then
    # Trim verbose output; just keep the success lines.
    while IFS= read -r line; do
      case "$line" in
        *"✓"*|*"already"*|*"stopped"*|*"restarted"*) note "$line" ;;
        *) ;;
      esac
    done <<< "$BH_OUTPUT"
  else
    warn "browser-harness-up.sh start failed (run manually: $REPO_DIR/cli/browser-harness-up.sh start)"
  fi
elif have_cmd "$REPO_DIR/../bin/bizar"; then
  if "$REPO_DIR/../bin/bizar" browser-harness-up start 2>&1 | grep -E '✓|✗' | head -3; then
    note "Chrome started via bizar browser-harness-up"
  fi
else
  warn "cli/browser-harness-up.sh not found at $REPO_DIR — skipping Chrome auto-start"
fi

# ── BizarHarness config files ─────────────────────────────────────────
section "Install BizarHarness config files"

mkdir -p "$CONFIG_DIR/agents"

# Agents — copy every .md except those already in place.
for f in "$REPO_DIR/config/agents/"*.md; do
  [ -f "$f" ] || continue
  name="$(basename "$f")"
  if [ -f "$CONFIG_DIR/agents/$name" ] && cmp -s "$f" "$CONFIG_DIR/agents/$name"; then
    : # identical, skip silently
  else
    cp "$f" "$CONFIG_DIR/agents/$name"
    INSTALLED+=("agents/$name")
  fi
done
note "agents synced ($(ls "$CONFIG_DIR/agents/"*.md 2>/dev/null | wc -l) files)"

# Shared baseline (used as a skill AND as the on-disk reference)
if [ -d "$REPO_DIR/config/agents/_shared" ]; then
  mkdir -p "$CONFIG_DIR/agents/_shared"
  cp -R "$REPO_DIR/config/agents/_shared/." "$CONFIG_DIR/agents/_shared/"
  note "agents/_shared/ synced"
fi

# Slash commands
if [ -d "$REPO_DIR/config/commands/" ]; then
  mkdir -p "$CONFIG_DIR/commands"
  for f in "$REPO_DIR/config/commands/"*.md; do
    [ -f "$f" ] || continue
    name="$(basename "$f")"
    cp "$f" "$CONFIG_DIR/commands/$name"
  done
  note "slash commands synced"
fi

# Hooks
if [ -d "$REPO_DIR/config/hooks/" ]; then
  mkdir -p "$CONFIG_DIR/hooks"
  for entry in "$REPO_DIR/config/hooks/"*; do
    [ -e "$entry" ] || continue
    name="$(basename "$entry")"
    cp -R "$entry" "$CONFIG_DIR/hooks/$name"
  done
  note "hooks synced"
fi

# AGENTS.md
if [ -f "$REPO_DIR/config/AGENTS.md" ]; then
  cp "$REPO_DIR/config/AGENTS.md" "$CONFIG_DIR/AGENTS.md"
  note "AGENTS.md synced"
fi

# ── Bundled skills (bizar, self-improvement, agent-baseline, …) ───────
section "Install bundled skills"

mkdir -p "$SKILLS_DIR"
# Core skills — bundled from config/skills/ in the repo.
for skill in bizar self-improvement cpp-coding-standards cpp-testing embedded-esp-idf \
             obsidian glyph read-the-damn-docs; do
  if [ -d "$REPO_DIR/config/skills/$skill" ]; then
    mkdir -p "$SKILLS_DIR/$skill"
    cp -R "$REPO_DIR/config/skills/$skill/." "$SKILLS_DIR/$skill/"
    note "skill: $skill"
  else
    # Fallback: write inline SKILL.md so install.sh remains self-contained.
    mkdir -p "$SKILLS_DIR/$skill"
    case "$skill" in
      obsidian)
        cat > "$SKILLS_DIR/$skill/SKILL.md" << 'OBSIDIAN_SKILL'
---
name: obsidian
description: Interact with the Obsidian vault for persistent per-project memory. Use when searching notes, creating notes, writing wikilinks, using callouts, setting properties, or managing the project's obsidian knowledge bank.
---

# Obsidian Vault

Per-project persistent memory for Bizar agents. Every project gets its own vault bank, keyed by project name.

## Operations

- **Search vault**: `obsidian_search` with `bank_id: "<project-name>"` — use before writing code that might have prior context
- **Create/update notes**: `obsidian_write` with bank_id — store decisions, ADRs, architecture notes
- **Append to notes**: `obsidian_append` — add to existing notes
- **List notes**: `obsidian_list_notes` with optional directory prefix

## Conventions

- Use `bank_id: "<project-name>"` determined from the project root (the directory name)
- Use wikilinks `[[Note Name]]` for cross-references within the vault
- Use frontmatter for structured properties (tags, status, date)
- Store ADRs under `adr/` prefix
- Store implementation notes under `notes/` prefix
OBSIDIAN_SKILL
        note "skill: $skill (inline)"
        ;;
      glyph)
        cat > "$SKILLS_DIR/$skill/SKILL.md" << 'GLYPH_SKILL'
---
name: glyph
description: Work with the project knowledge graph (graphify). Query the graph before searching source files for structural and relationship questions. Use for architecture discovery, dependency mapping, and cross-module understanding.
---

# Glyph — Knowledge Graph

Graph-based codebase navigation using graphify (`.bizar/graph/`). Maps source files, functions, types, and their relationships into a queryable graph with community detection.

## Commands

```bash
bizar graph status          # node/edge/community counts
bizar graph query <term>    # BFS traversal from a concept
bizar graph path <A> <B>    # shortest path between two concepts
bizar graph explain <X>     # all nodes related to X
bizar graph update          # incremental rebuild
bizar graph build           # full rebuild
```

## When to Use

- Before reading a large file: `bizar graph explain "<module>"`
- Mapping unfamiliar code: `bizar graph query "<feature>"`
- Debugging cross-module: `bizar graph path "<symptom>" "<root-cause>"`
- Before grep: check the graph first — may point directly to the file
GLYPH_SKILL
        note "skill: $skill (inline)"
        ;;
      read-the-damn-docs)
        cat > "$SKILLS_DIR/$skill/SKILL.md" << 'RTDD_SKILL'
---
name: read-the-damn-docs
description: Before writing code, read the official documentation. Use websearch/webfetch to find docs for any API, library, framework, or tool. Never guess API signatures, parameter names, or return types.
---

# Read the Damn Docs

Discipline: always check official documentation before writing code against an unfamiliar API.

## Rules

1. **Search docs first**: Before using any function/API/component you haven't used recently, `websearch` or `webfetch` the official docs
2. **No guessing**: Never invent parameter names, return types, or method signatures from training data alone
3. **Read error messages**: When something fails, read the full error and search docs for the exact error text
4. **Version matters**: Note the library/tool version and use docs matching that version
5. **Check examples**: Most good docs have worked examples — find and follow them

## When to Apply

- Adding a new dependency — read its install/setup docs
- Using an unfamiliar API method — check signature and return type
- Debugging an error you don't understand — search docs + error message
- Configuring a tool — read the official config reference
RTDD_SKILL
        note "skill: $skill (inline)"
        ;;
      *)
        warn "skill source missing: $skill (no inline fallback)"
        ;;
    esac
  fi
done

# Shared agent baseline skill — referenced by every agent file.
if [ -f "$REPO_DIR/config/agents/_shared/AGENT_BASELINE.md" ]; then
  mkdir -p "$SKILLS_DIR/agent-baseline"
  cp "$REPO_DIR/config/agents/_shared/AGENT_BASELINE.md" "$SKILLS_DIR/agent-baseline/SKILL.md"
  note "skill: agent-baseline (shared by all 14 agents)"
fi

# Make bundled scripts executable.
chmod +x "$SKILLS_DIR"/embedded-esp-idf/scripts/*.sh 2>/dev/null || true

# ── Domain skills via skills.sh (impeccable, ponytail, obsidian-skills) ─
section "Install domain skills from skills.sh"

if have_cmd npx; then
  # Impeccable — UI anti-pattern detection (frontend quality)
  if npx --yes impeccable skills install -y --scope=user --providers=opencode >/dev/null 2>&1; then
    note "impeccable (UI anti-pattern detector)"
  else
    warn "impeccable install failed (run: npx impeccable skills install)"
  fi

  # Ponytail — minimal-code skill for AI agents
  if npx --yes @dietrichgebert/ponytail install --scope=user >/dev/null 2>&1; then
    note "ponytail (minimal-code skill)"
  else
    warn "ponytail install failed (run: npx @dietrichgebert/ponytail install)"
  fi

  # Obsidian skills — Obsidian Flavored Markdown, Bases, JSON Canvas, CLI
  if npx --yes skills add https://github.com/kepano/obsidian-skills --all -y >/dev/null 2>&1; then
    note "obsidian-skills (Obsidian Markdown/Bases/Canvas)"
  else
    warn "obsidian-skills install failed (run: npx skills add kepano/obsidian-skills)"
  fi
else
  warn "npx not found — skipping domain skill installation"
fi

# ── Bizar plugin (mirrored from npm package to ~/.config/opencode/plugins/) ─
section "Install Bizar opencode plugin"

PLUGIN_DST="$CONFIG_DIR/plugins/bizar"

# v3.20.12: two sources, in priority order:
#   1. Local repo's plugins/bizar/ (for `git clone` users)
#   2. Globally installed @polderlabs/bizar-plugin (for `npm i -g` users)
# The npm-installed plugin also needs its bundled node_modules/ copied
# alongside (it depends on @polderlabs/bizar-sdk, which isn't on npm).
# This previously lived in cli/install.mjs:installPluginFromGlobal();
# duplicating the logic here makes install.sh the single source of truth.
PLUGIN_SRC=""
if [ -d "$REPO_DIR/plugins/bizar" ]; then
  PLUGIN_SRC="$REPO_DIR/plugins/bizar"
  PLUGIN_SRC_KIND="local repo"
elif have_cmd npm; then
  # Resolve the npm global plugin path. `npm root -g` gives us
  # /usr/local/lib/node_modules; the plugin lives in @polderlabs/bizar-plugin/.
  NPM_GLOBAL_ROOT=$(npm root -g 2>/dev/null || echo "")
  if [ -n "$NPM_GLOBAL_ROOT" ] && [ -d "$NPM_GLOBAL_ROOT/@polderlabs/bizar-plugin" ]; then
    PLUGIN_SRC="$NPM_GLOBAL_ROOT/@polderlabs/bizar-plugin"
    PLUGIN_SRC_KIND="@polderlabs/bizar-plugin (global)"
  fi
fi

if [ -n "$PLUGIN_SRC" ]; then
  mkdir -p "$PLUGIN_DST"
  while IFS= read -r -d '' f; do
    rel="${f#$PLUGIN_SRC/}"
    case "$rel" in
      node_modules/*|dist/*|*.log|.DS_Store) continue ;;
    esac
    mkdir -p "$(dirname "$PLUGIN_DST/$rel")"
    cp "$f" "$PLUGIN_DST/$rel"
  done < <(find "$PLUGIN_SRC" -type f -print0)
  note "plugins/bizar/ copied from $PLUGIN_SRC_KIND"

  # Copy node_modules from the npm plugin package (the plugin imports
  # @polderlabs/bizar-sdk, which isn't on npm). Idempotent.
  if [ "$PLUGIN_SRC_KIND" != "local repo" ] && [ -d "$PLUGIN_SRC/node_modules" ]; then
    if cp -R "$PLUGIN_SRC/node_modules/." "$PLUGIN_DST/node_modules/" 2>/dev/null; then
      N_PKG=$(find "$PLUGIN_SRC/node_modules" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l)
      note "node_modules (~$N_PKG packages) bundled with deployed plugin"
    else
      warn "could not copy plugin node_modules (manual: cp -r $PLUGIN_SRC/node_modules $PLUGIN_DST/)"
    fi
  fi
else
  warn "Bizar plugin source not found (install @polderlabs/bizar-plugin: npm i -g @polderlabs/bizar-plugin)"
fi

# ── Merge opencode.json (template + user's existing config) ────────────
section "Configure opencode.json"

# Prefer the .template copy; fall back to the legacy tracked file.
if [ -f "$REPO_DIR/config/opencode.json.template" ]; then
  TEMPLATE="$REPO_DIR/config/opencode.json.template"
elif [ -f "$REPO_DIR/config/opencode.json" ]; then
  TEMPLATE="$REPO_DIR/config/opencode.json"
else
  warn "No opencode.json template found"
  TEMPLATE=""
fi

if [ -n "$TEMPLATE" ]; then
  if [ -f "$CONFIG_DIR/opencode.json" ]; then
    cp "$CONFIG_DIR/opencode.json" "$CONFIG_DIR/opencode.json.bak"
  fi

  if have_cmd jq; then
    MERGE_TMP="$CONFIG_DIR/opencode.json.merge.$$"
    if [ -f "$CONFIG_DIR/opencode.json" ]; then
      jq -s '.[0] * .[1]' "$TEMPLATE" "$CONFIG_DIR/opencode.json" > "$MERGE_TMP" 2>/dev/null \
        && mv "$MERGE_TMP" "$CONFIG_DIR/opencode.json" \
        || { rm -f "$MERGE_TMP"; cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"; }
    else
      cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"
    fi

    # Ensure the Bizar plugin entry is registered (idempotent).
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
    note "opencode.json (template merged with existing config; plugin entry ensured)"
  else
    cp "$TEMPLATE" "$CONFIG_DIR/opencode.json"
    warn "jq not available — copied template directly. Re-install jq for safe merging."
  fi
fi

# ── Write install-state.json (used by `bizar update` for migrations) ───
section "Write install-state"

mkdir -p "$BIZAR_STATE_DIR"
BH_VERSION=$(browser-harness --version 2>/dev/null | head -1 | sed 's/[^0-9.]//g' || echo "")
BIZAR_VERSION=$(npm ls -g @polderlabs/bizar --depth=0 --json 2>/dev/null | grep -oE '"@polderlabs/bizar":\s*\{[^}]*"version":\s*"[^"]+"' | grep -oE '"version":\s*"[^"]+"' | grep -oE '"[^"]+"' | tail -1 | tr -d '"' || echo "")
DASH_VERSION=$(npm ls -g @polderlabs/bizar-dash --depth=0 --json 2>/dev/null | grep -oE '"@polderlabs/bizar-dash":\s*\{[^}]*"version":\s*"[^"]+"' | grep -oE '"version":\s*"[^"]+"' | grep -oE '"[^"]+"' | tail -1 | tr -d '"' || echo "")
PY_VERSION=$("$PYTHON_BIN" --version 2>/dev/null | head -1 | sed 's/[^0-9.]//g' || echo "")
UV_VERSION=$(uv --version 2>/dev/null | head -1 | sed 's/[^0-9.]//g' || echo "")
JQ_VERSION=$(jq --version 2>/dev/null | sed 's/[^0-9.]//g' || echo "")

STATE_JSON=$(cat <<JSON
{
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%S.%NZ | sed 's/\.[0-9]*//')",
  "components": {
    "bizar": "${BIZAR_VERSION:-unknown}",
    "bizar-dash": "${DASH_VERSION:-unknown}",
    "browser-harness": "${BH_VERSION:-unknown}",
    "uv": "${UV_VERSION:-unknown}",
    "python3.12": "${PY_VERSION:-unknown}",
    "jq": "${JQ_VERSION:-unknown}"
  }
}
JSON
)
echo "$STATE_JSON" > "$BIZAR_STATE_FILE"
note "install-state written to $BIZAR_STATE_FILE"

# ── Final dependency verification ────────────────────────────────────
section "Verify all dependencies"

if verify_dependencies; then
  note "all required tools available on PATH"
else
  err "some required tools are missing — see list above"
fi

# ── Final status banner ──────────────────────────────────────────────
section "Install complete"

echo ""
echo -e "${BOLD}${CYAN}┌────────────────────────────────────────────────────────────┐${NC}"
echo -e "${BOLD}${CYAN}│${NC}  ${BOLD}BizarHarness ready.${NC}                                             │"
echo -e "${BOLD}${CYAN}│${NC}                                                          │"

if [ ${#INSTALLED[@]} -gt 0 ]; then
  echo -e "${BOLD}${CYAN}│${NC}  ${GREEN}✓ Installed:${NC}                                                │"
  for entry in "${INSTALLED[@]}"; do
    short=$(echo "$entry" | head -c 56)
    echo -e "${BOLD}${CYAN}│${NC}    • $short$(printf '%*s' $((56 - ${#short})) '') │"
  done
fi

if [ ${#SKIPPED[@]} -gt 0 ]; then
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  ${YELLOW}⚠ Skipped:${NC}                                                  │"
  for entry in "${SKIPPED[@]}"; do
    short=$(echo "$entry" | head -c 56)
    echo -e "${BOLD}${CYAN}│${NC}    • $short$(printf '%*s' $((56 - ${#short})) '') │"
  done
fi

if [ ${#FAILED[@]} -gt 0 ]; then
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  ${RED}✗ Failed:${NC}                                                  │"
  for entry in "${FAILED[@]}"; do
    short=$(echo "$entry" | head -c 56)
    echo -e "${BOLD}${CYAN}│${NC}    • $short$(printf '%*s' $((56 - ${#short})) '') │"
  done
fi

echo -e "${BOLD}${CYAN}│${NC}                                                          │"
echo -e "${BOLD}${CYAN}│${NC}  ${DIM}Next: open /connect in your next opencode session${NC}        │"
echo -e "${BOLD}${CYAN}│${NC}  ${DIM}       to add API keys (opencode-zen is free; MiniMax${NC}        │"
echo -e "${BOLD}${CYAN}│${NC}  ${DIM}       is paid). The installer never asks for keys —${NC}         │"
echo -e "${BOLD}${CYAN}│${NC}  ${DIM}       do that part yourself so secrets stay on your${NC}        │"
echo -e "${BOLD}${CYAN}│${NC}  ${DIM}       machine, not in any installer log.${NC}                       │"
echo -e "${BOLD}${CYAN}└────────────────────────────────────────────────────────────┘${NC}"
echo ""

[ ${#FAILED[@]} -gt 0 ] && exit 1
exit 0
