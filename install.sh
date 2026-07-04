#!/usr/bin/env bash
#
# install.sh — Cross-platform BizarHarness installer.
#
# v3.22.0 — Rewritten for cross-platform dispatch. Linux (apt/dnf/pacman/zypper),
# macOS (brew), and a pointer to install.ps1 for Windows.
#
# Features:
#   - Dependency detection via node scripts/check-deps.mjs
#   - Auto-install missing deps for the current platform/distro
#   - Idempotent — every step checks before acting
#   - --update: git pull --ff-only, re-install config, re-install service
#   - --dry-run: print what would happen, do nothing
#   - --non-interactive: skip all prompts (CI safe)
#   - --force: overwrite files even when they match
#   - Plugin registration verification in ~/.config/opencode/opencode.json
#   - Service registration via node scripts/install-service.mjs
#
# What this script does NOT do (intentional):
#   - Configure provider API keys. The user does that via /connect.
#   - Reload opencode. The next opencode session picks up new config.
#   - Windows installation (see install.ps1 for that).

set -euo pipefail

# ── Constants ──────────────────────────────────────────────────────────────────

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
NC='\033[0m'

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
PLUGIN_DIR="$CONFIG_DIR/plugins/bizar"

# Flags parsed from CLI args
DRY_RUN=false
NON_INTERACTIVE=false
FORCE=false
UPDATE_MODE=false

# ── UI helpers ─────────────────────────────────────────────────────────────────

note()  { echo -e "  ${GREEN}✓${NC} $1"; }
warn()  { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()   { echo -e "  ${RED}✗${NC} $1"; }
action(){ echo -e "  ${CYAN}→${NC} $1"; }
dim()   { echo -e "  ${DIM}$1${NC}"; }
section(){
  echo ""
  echo -e "${BOLD}${CYAN}── $1 ──${NC}"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# ── Usage ──────────────────────────────────────────────────────────────────────

show_usage() {
  cat <<'EOF'

  install.sh — BizarHarness cross-platform installer

  Usage:
    ./install.sh                     Interactive install (Linux/macOS)
    ./install.sh --help              Show this help
    ./install.sh --dry-run           Dry run — print actions, no changes
    ./install.sh --non-interactive   Non-interactive (CI safe)
    ./install.sh --force             Overwrite existing files
    ./install.sh --update            Pull latest + re-install config + service

  On Windows, run install.ps1 instead.

EOF
}

# ── Parse CLI flags ────────────────────────────────────────────────────────────

parse_flags() {
  for arg in "$@"; do
    case "$arg" in
      --help|-h)         show_usage; exit 0 ;;
      --dry-run)         DRY_RUN=true ;;
      --non-interactive) NON_INTERACTIVE=true ;;
      --force)           FORCE=true ;;
      --update)          UPDATE_MODE=true ;;
      *)                 warn "Unknown flag: $arg"; show_usage; exit 1 ;;
    esac
  done
}

# ── Dry-run guard ──────────────────────────────────────────────────────────────

dry() {
  if $DRY_RUN; then
    dim "  [DRY-RUN] $*"
    return 0
  fi
  "$@"
}

sudo_if_needed() {
  if [ "$EUID" -eq 0 ]; then
    dry "$@"
  else
    dry sudo "$@"
  fi
}

# ── Shared arrays (populated by check_deps, consumed by install_missing_deps) ──
MISSING_DEPS=()
MISSING_CMDS=()

# ── check_deps: run node scripts/check-deps.mjs and parse result ───────────────

check_deps() {
  section "Checking dependencies"
  action "Running dependency detector..."
  local json
  if ! json=$(node "$REPO_DIR/scripts/check-deps.mjs" --strict 2>/dev/null); then
    warn "dependency detector failed — proceeding with best-effort checks"
    return
  fi

  local ok
  ok=$(echo "$json" | node -e "console.log(JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).ok)")
  if [ "$ok" = "true" ]; then
    note "all required dependencies satisfied"
    return
  fi

  # Print missing deps
  while IFS='|' read -r name cmd; do
    [ -z "$name" ] && continue
    warn "missing dependency: $name"
    if [ -n "$cmd" ]; then
      MISSING_CMDS+=("$cmd")
    fi
  done < <(echo "$json" | node -e "
    const d = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    for (const m of d.missing) {
      if (m.name === 'tmux') continue;
      console.log(m.name + '|' + (m.installCmd || ''));
    }
  ")
}

# ── install_missing_deps: run install commands for missing deps ─────────────────

install_missing_deps() {
  if [ ${#MISSING_CMDS[@]} -eq 0 ]; then
    return
  fi

  section "Installing missing dependencies"

  local i
  for i in "${!MISSING_CMDS[@]}"; do
    local cmd="${MISSING_CMDS[$i]}"
    action "Running: $cmd"
    if $DRY_RUN; then
      dim "  would execute: $cmd"
      continue
    fi
    if eval "$cmd" >/dev/null 2>&1; then
      note "dependency installed"
    else
      warn "install command failed — you may need to install this manually"
    fi
  done
}

# ── ensure_node: node MUST be available for the rest of the install ────────────

ensure_node() {
  if have_cmd node; then return; fi
  section "Node.js is required"
  action "Install Node.js 18+ first, then re-run this script."
  if $DRY_RUN; then
    dim "  would install nodejs via platform package manager"
    return
  fi
  case "$(uname -s)" in
    Linux)
      if have_cmd apt-get; then
        action "Detected apt — installing via NodeSource..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
        sudo apt-get install -y nodejs
      elif have_cmd dnf; then
        action "Detected dnf — installing nodejs..."
        sudo dnf install -y nodejs
      elif have_cmd pacman; then
        action "Detected pacman — installing nodejs..."
        sudo pacman -S --noconfirm nodejs npm
      elif have_cmd zypper; then
        action "Detected zypper — installing nodejs..."
        sudo zypper install -y nodejs20
      else
        err "No known package manager. Install Node.js manually: https://nodejs.org/"
        exit 1
      fi
      ;;
    Darwin)
      action "Installing node via Homebrew..."
      brew install node@18
      ;;
    *)
      err "Unsupported OS. Install Node.js manually: https://nodejs.org/"
      exit 1
      ;;
  esac
  note "Node.js installed: $(node --version)"
}

# ── Standalone installer (no git clone) ─────────────────────────────────────────
# v4.4.5 — The plugin, agents, commands, hooks, and dashboard ALL ship inside
# this package. No separate npm install, no git clone, no separate package
# lookup. install.sh runs entirely against its own `$REPO_DIR` (which is the
# installed package directory — `<npm root -g>/@polderlabs/bizar/`).

ensure_repo() {
  # v4.4.5 — No-op. Everything ships with the package. We still log a note
  # so users upgrading from older versions see that the git-clone step is
  # intentionally gone.
  if [ -d "$REPO_DIR/plugins/bizar" ] && [ -d "$REPO_DIR/bizar-dash" ]; then
    note "using bundled plugin + dashboard from $REPO_DIR"
  else
    err "package missing required files (plugins/bizar or bizar-dash)"
    err "this looks like a corrupted install — try: npm install -g @polderlabs/bizar --force"
    exit 1
  fi

  # Clean up any stale separate-repo clone left over from v3.x installs.
  local stale_clone="$(dirname "$REPO_DIR")/BizarHarness"
  if [ -d "$stale_clone" ] && [ "$stale_clone" != "$REPO_DIR" ]; then
    if $DRY_RUN; then
      dim "  would remove stale v3.x clone at $stale_clone"
    else
      action "Removing stale v3.x repo clone at $stale_clone..."
      rm -rf "$stale_clone" 2>/dev/null && note "removed" || dim "  (could not remove; harmless)"
    fi
  fi
}

# ── Copy agent / config / dashboard files ──────────────────────────────────────

install_config() {
  section "Installing BizarHarness config files"

  if $DRY_RUN; then
    dim "  would copy agents/, commands/, hooks/, skills/ to ~/.config/opencode/"
    return
  fi

  local dst="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
  mkdir -p "$dst/agents" "$dst/agents/_shared" "$dst/command" "$dst/commands" "$dst/skill" "$dst/skills" 2>/dev/null

  # Agents
  if [ -d "$REPO_DIR/config/agents" ]; then
    action "Copying agent files..."
    cp -R "$REPO_DIR/config/agents/." "$dst/agents/" 2>/dev/null && note "agents synced" || warn "agent copy incomplete"
  fi

  # Slash commands
  if [ -d "$REPO_DIR/config/command" ]; then
    cp -R "$REPO_DIR/config/command/." "$dst/command/" 2>/dev/null
  fi
  if [ -d "$REPO_DIR/config/commands" ]; then
    cp -R "$REPO_DIR/config/commands/." "$dst/commands/" 2>/dev/null
  fi

  # Skills (bundled)
  for skill in obsidian glyph read-the-damn-docs; do
    if [ -d "$REPO_DIR/config/skills/$skill" ]; then
      cp -R "$REPO_DIR/config/skills/$skill" "$dst/skill/" 2>/dev/null
      cp -R "$REPO_DIR/config/skills/$skill" "$dst/skills/" 2>/dev/null
    fi
  done
  note "skills installed"

  # AGENTS.md
  if [ -f "$REPO_DIR/AGENTS.md" ]; then
    cp "$REPO_DIR/AGENTS.md" "$dst/AGENTS.md" 2>/dev/null && note "AGENTS.md synced" || true
  fi

  # Plugin (copy from <pkg>/plugins/bizar/ to ~/.config/opencode/plugins/bizar/)
  local dst_plugin="$dst/plugins/bizar"
  if [ -d "$REPO_DIR/plugins/bizar" ]; then
    mkdir -p "$dst_plugin"
    # Skip node_modules + dist to keep the deploy dir small; the plugin's
    # package.json declares its deps and Bun resolves them from the user's
    # global node_modules at load time.
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --exclude='node_modules' --exclude='dist' --exclude='.DS_Store' \
        "$REPO_DIR/plugins/bizar/" "$dst_plugin/" 2>/dev/null && note "plugin copied to $dst_plugin" \
        || warn "plugin copy incomplete"
    else
      # Fallback: shell glob + cp — mirrors rsync's exclude behaviour by
      # pruning after copy.
      cp -R "$REPO_DIR/plugins/bizar/." "$dst_plugin/" 2>/dev/null
      rm -rf "$dst_plugin/node_modules" "$dst_plugin/dist" 2>/dev/null
      note "plugin copied to $dst_plugin (cp fallback)"
    fi
  else
    warn "plugin source not found at $REPO_DIR/plugins/bizar/"
  fi
}

# ── Verify opencode.json has the Bizar plugin registered ───────────────────────

verify_plugin() {
  section "Verifying Bizar plugin registration"

  local opencode_config="$CONFIG_DIR/opencode.json"

  if [ ! -f "$opencode_config" ]; then
    warn "opencode.json not found at $opencode_config — plugin not registered"
    return
  fi

  # Check if plugin entry exists using node's JSON parser (avoid jq dependency)
  local has_plugin
  has_plugin=$(node -e "
    const cfg = JSON.parse(require('fs').readFileSync('$opencode_config', 'utf8'));
    const plugins = cfg.plugin || [];
    const found = plugins.some(function(p) {
      return Array.isArray(p) && p[0] && p[0].includes('plugins/bizar');
    });
    console.log(found ? 'yes' : 'no');
  " 2>/dev/null || echo "no")

  if [ "$has_plugin" = "yes" ]; then
    note "Bizar plugin registered in opencode.json"
    return
  fi

  action "Adding Bizar plugin entry to opencode.json..."

  if $DRY_RUN; then
    dim "  would patch opencode.json to add plugin entry"
    return
  fi

  # Patch via node script (no jq dependency needed)
  node -e "
    const fs = require('fs');
    const path = '$opencode_config';
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(path, 'utf8'));
    } catch(e) {
      console.error('Failed to read opencode.json:', e.message);
      process.exit(1);
    }
    if (!cfg.plugin) cfg.plugin = [];
    const has = cfg.plugin.some(function(p) {
      return Array.isArray(p) && p[0] && p[0].includes('plugins/bizar');
    });
    if (!has) {
      cfg.plugin.push(['./plugins/bizar/index.ts', {
        loopThresholdWarn: 5,
        loopThresholdEscalate: 8,
        loopThresholdBlock: 12,
        loopWindowSize: 10
      }]);
    }
    fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    console.log(has ? 'already registered' : 'plugin entry added');
  "

  note "opencode.json updated with Bizar plugin"
}

# ── Install background service ─────────────────────────────────────────────────

install_service() {
  section "Installing background service"

  if $DRY_RUN; then
    dim "  would run: node \"$REPO_DIR/scripts/install-service.mjs\""
    return
  fi

  if [ -f "$REPO_DIR/scripts/install-service.mjs" ]; then
    local result
    result=$(node "$REPO_DIR/scripts/install-service.mjs" 2>&1) || true
    # Parse the JSON result
    local ok
    ok=$(echo "$result" | node -e "
      try {
        const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        console.log(r.ok !== false ? 'yes' : 'no');
      } catch(e) { console.log('no'); }
    " 2>/dev/null <<< "$result" || echo "no")

    local skipped
    skipped=$(echo "$result" | node -e "
      try {
        const r = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
        console.log(r.skipped ? 'yes' : 'no');
      } catch(e) { console.log('no'); }
    " 2>/dev/null <<< "$result" || echo "no")

    if [ "$ok" = "yes" ]; then
      if [ "$skipped" = "yes" ]; then
        dim "  (service registration deferred — re-run \`bizar service install\` to retry)"
      fi
      note "service registration complete"
    else
      warn "service registration had issues — see output above"
      dim "  manual command: node cli/service-controller.mjs install"
    fi
  else
    warn "scripts/install-service.mjs not found"
  fi
}

# ── Verify .opencode/plugins/bizar exists ──────────────────────────────────────

verify_plugin_dir() {
  section "Verifying plugin directory"

  local dst_plugin="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/plugins/bizar"
  if [ -d "$dst_plugin" ]; then
    note "plugin directory exists at $dst_plugin"
  else
    action "Setting up plugin directory..."
    dry mkdir -p "$dst_plugin"
    # Copy from repo if available
    if [ -d "$REPO_DIR/plugins/bizar" ]; then
      if ! $DRY_RUN; then
        cp -R "$REPO_DIR/plugins/bizar/." "$dst_plugin/"
      fi
      note "plugin files copied from repo"
    else
      warn "no plugin source found in repo — run 'bizar install' or 'npm install -g @polderlabs/bizar-plugin'"
    fi
  fi
}

# ── Final success banner ───────────────────────────────────────────────────────

print_banner() {
  local dashboard_url="http://localhost:3333"
  section "Install complete"

  echo ""
  echo -e "${BOLD}${CYAN}┌────────────────────────────────────────────────────────────┐${NC}"
  echo -e "${BOLD}${CYAN}│${NC}  ${BOLD}BizarHarness ready.${NC}                                             │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  ${GREEN}✓${NC} Cross-platform installer v3.22.0                             │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  Dashboard: ${CYAN}$dashboard_url${NC}                                    │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}Next:${NC}                                                            │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  1. Restart opencode to pick up new config${NC}                     │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  2. Run /connect in opencode to add API keys${NC}                   │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  3. Run 'bizar dash start' to launch the dashboard${NC}             │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  4. Visit $dashboard_url in your browser${NC}                │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}└────────────────────────────────────────────────────────────┘${NC}"
  echo ""

  if $DRY_RUN; then
    warn "DRY RUN — no changes were made"
  fi
}

# ── install_linux: Debian/Ubuntu, Fedora/RHEL, Arch, openSUSE ──────────────────

install_linux() {
  note "Detected Linux ($(uname -m))"

  ensure_node

  # Pre-flight: populate PATH with common locations
  for p in "$HOME/.opencode/bin" "$HOME/.local/bin" "$HOME/.bun/bin"; do
    case ":$PATH:" in *":$p:"*) ;; *) [ -d "$p" ] && export PATH="$p:$PATH" ;; esac
  done

  check_deps
  install_missing_deps

  ensure_repo
  install_config
  verify_plugin_dir
  verify_plugin
  install_service
}

# ── install_macos: Homebrew-based ──────────────────────────────────────────────

install_macos() {
  note "Detected macOS ($(uname -m))"

  # Ensure Homebrew
  if ! have_cmd brew; then
    section "Homebrew"
    action "Installing Homebrew..."
    if $DRY_RUN; then
      dim "  would install Homebrew via /bin/bash -c '\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)'"
    else
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      note "Homebrew installed"
    fi
  else
    note "Homebrew already installed"
  fi

  ensure_node

  # Pre-flight: populate PATH
  for p in "$HOME/.opencode/bin" "$HOME/.local/bin" "$HOME/.bun/bin" "/opt/homebrew/bin"; do
    case ":$PATH:" in *":$p:"*) ;; *) [ -d "$p" ] && export PATH="$p:$PATH" ;; esac
  done

  check_deps
  install_missing_deps

  ensure_repo
  install_config
  verify_plugin_dir
  verify_plugin
  install_service
}

# ── Main entry ──────────────────────────────────────────────────────────────────

main() {
  parse_flags "$@"

  if $DRY_RUN; then
    dim "DRY RUN MODE — no changes will be made"
    echo ""
  fi

  # Header
  echo ""
  echo -e "${BOLD}${CYAN}  ⚡ BizarHarness Installer v3.22.0${NC}"
  if $UPDATE_MODE; then echo -e "  ${DIM}Update mode${NC}"; fi
  echo ""

  # OS detection
  local os
  os="$(uname -s)"
  case "$os" in
    Linux)
      install_linux
      ;;
    Darwin)
      install_macos
      ;;
    *)
      echo ""
      err "Unsupported OS: $os"
      echo ""
      warn "On Windows, run install.ps1 instead."
      warn "On other Unix systems, ensure Node.js 18+ is available and run:"
      warn "  node scripts/check-deps.mjs"
      echo ""
      exit 1
      ;;
  esac

  print_banner
  exit 0
}

main "$@"
