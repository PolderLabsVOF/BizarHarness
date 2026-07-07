#!/usr/bin/env bash
#
# install.sh — Cross-platform BizarHarness installer (v5.x — thin shell wrapper).
#
# v5.x — Updated for issue #7. The install/update flow now:
#   1. On first install: registers the system service that auto-starts
#      the dashboard (`bizar service install`).
#   2. On update: stops the running service before files are replaced
#      (`bizar service stop` → npm upgrade → `bizar service restart`).
#
# Almost all logic still lives in `cli/provision.mjs:runProvision`, which
# is shared between `bizar install` and `bizar update`. This bash script
# exists only for the platform-specific steps that need sudo + a system
# package manager:
#
#   - Linux:  ensure node is installed (apt/dnf/pacman/zypper), install uv,
#             python3.12, jq, gh, agent-browser, Chrome runtime libs.
#   - macOS:  ensure homebrew is installed; everything else is via brew.
#   - Windows: a stub that prints "use install.ps1".
#
# Agent files / plugin copy / cline.json patching / service registration /
# skills install / doctor check are ALL handled by the unified provisioner
# after this script returns.
#
# Flags:
#   --non-interactive   skip prompts (CI safe)
#   --dry-run           print actions, make no changes
#   --force             overwrite existing files
#   --update            this is a re-install
#   --mode=install|update|install-only-system
#                       install = full flow (the default)
#                       update  = alias for install (provisioner auto-detects)
#                       install-only-system = only run this bash script, skip
#                                              the Node provisioner (used for
#                                              bootstrapping on a fresh box
#                                              before the npm package is set up)
#
# The script exits with the provisioner's exit code.

set -euo pipefail

# ── Color helpers ────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

note()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn()   { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1"; }
action() { echo -e "  ${CYAN}→${NC} $1"; }
dim()    { echo -e "  ${DIM}$1${NC}"; }
section(){
  echo ""
  echo -e "${BOLD}${CYAN}── $1 ──${NC}"
}

have_cmd() { command -v "$1" >/dev/null 2>&1; }

# ── Paths ───────────────────────────────────────────────────────────────────
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

# ── Flags ────────────────────────────────────────────────────────────────────
NON_INTERACTIVE=0
DRY_RUN=0
FORCE=0
UPDATE_MODE=0
MODE="install"

show_usage() {
  cat <<'EOF'
install.sh — BizarHarness cross-platform installer

Usage:
  ./install.sh                     Interactive install (Linux/macOS)
  ./install.sh --help              Show this help
  ./install.sh --dry-run           Dry run — print actions, no changes
  ./install.sh --non-interactive   Non-interactive (CI safe)
  ./install.sh --force             Overwrite existing files
  ./install.sh --update            Alias for --mode=update
  ./install.sh --mode=<mode>       install | update | install-only-system

This script handles platform-specific system dependencies (apt/dnf/pacman/
zypper on Linux, brew on macOS) and then shells to `node cli/provision.mjs`,
which performs agent-file sync, plugin copy, cline.json patching,
service registration, skills install, and the post-install doctor check.
EOF
}

parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) show_usage; exit 0;;
      --non-interactive|-y) NON_INTERACTIVE=1;;
      --dry-run) DRY_RUN=1;;
      --force) FORCE=1;;
      --update) UPDATE_MODE=1; MODE="update";;
      --mode=*) MODE="${1#--mode=}";;
      --mode) shift; MODE="${1:-install}";;
      *) err "unknown flag: $1"; show_usage; exit 2;;
    esac
    shift
  done
}

dry() {
  if [ "$DRY_RUN" -eq 0 ]; then "$@"; fi
}

# ── sudo helper ─────────────────────────────────────────────────────────────
SUDO=""
sudo_if_needed() {
  if [ "$(id -u)" -ne 0 ] && have_cmd sudo; then SUDO="sudo"; fi
}

# ── Node install (Linux) ────────────────────────────────────────────────────
ensure_node() {
  if have_cmd node; then
    note "Node.js $(node --version) present"
    return
  fi
  section "Installing Node.js"
  if [ ! -f /etc/os-release ]; then
    err "no /etc/os-release — cannot detect distro"
    err "Install Node.js 18+ manually: https://nodejs.org/"
    exit 1
  fi
  . /etc/os-release
  sudo_if_needed
  case "$ID" in
    ubuntu|debian|pop|linuxmint|elementary)
      action "Installing Node.js 20.x via NodeSource (apt)..."
      dry $SUDO apt-get update
      dry $SUDO apt-get install -y ca-certificates curl gnupg
      dry curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
      dry $SUDO apt-get install -y nodejs
      ;;
    fedora|rhel|rocky|almalinux|centos)
      action "Installing Node.js 20.x via NodeSource (dnf)..."
      dry $SUDO dnf install -y https://rpm.nodesource.com/pub_20.x/nodesource-release-nodesource-1.noarch.rpm
      dry $SUDO dnf install -y nodejs
      ;;
    arch|manjaro|endeavouros)
      action "Installing Node.js via pacman..."
      dry $SUDO pacman -Sy --noconfirm nodejs npm
      ;;
    opensuse*|sles)
      action "Installing Node.js via zypper..."
      dry $SUDO zypper install -y nodejs20 npm20
      ;;
    alpine)
      action "Installing Node.js via apk..."
      dry $SUDO apk add --no-cache nodejs npm
      ;;
    nixos)
      action "Detected NixOS — Node.js must be installed via nix-shell"
      warn "Run the following, then re-run this installer:"
      warn "  nix-shell -p nodejs python3 jq gh git"
      warn "  node cli/provision.mjs"
      exit 0
      ;;
    void)
      action "Installing Node.js via xbps..."
      dry $SUDO xbps-install -S nodejs
      ;;
    *)
      err "Unsupported distro: $ID"
      err "Install Node.js 18+ manually: https://nodejs.org/"
      exit 1
      ;;
  esac
  note "Node.js installed: $(node --version)"
}

# ── Dependency detection + install (cross-platform) ────────────────────────
check_deps() {
  section "Checking dependencies"
  if ! [ -f "$REPO_DIR/scripts/check-deps.mjs" ]; then
    warn "scripts/check-deps.mjs not found — skipping detailed check"
    return
  fi
  if ! node "$REPO_DIR/scripts/check-deps.mjs" --strict 2>/dev/null; then
    warn "dependency detector reported missing deps — proceeding with best-effort checks"
  else
    note "all required dependencies satisfied"
  fi
}

install_lightrag() {
  # LightRAG is optional but recommended. Install via uv tool.
  # uv tools install to ~/.local/bin/ — ensure that's on PATH.
  if [ -d "$HOME/.local/bin" ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    export PATH="$HOME/.local/bin:$PATH"
  fi
  if have_cmd lightrag-server; then
    note "LightRAG $(lightrag-server --version 2>/dev/null || echo 'server') present"
    return 0
  fi
  action "Installing LightRAG via uv tool..."
  if dry uv tool install "lightrag-hku[api]" 2>&1; then
    note "LightRAG installed"
    # Verify reachable
    if [ -f "$HOME/.local/bin/lightrag-server" ]; then
      note "LightRAG binary found at ~/.local/bin/"
    fi
  else
    warn "LightRAG install failed — the memory graph will not be available"
    warn "    Install later: uv tool install \"lightrag-hku[api]\""
  fi
}

install_missing_deps_linux() {
  . /etc/os-release 2>/dev/null || return 0
  sudo_if_needed
  case "$ID" in
    ubuntu|debian|pop|linuxmint|elementary)
      action "Installing uv, python3.12, jq, gh via apt..."
      dry $SUDO apt-get update
      dry $SUDO apt-get install -y --no-install-recommends python3 python3-pip jq git curl ca-certificates gnupg
      # uv via official installer (no apt package)
      if ! have_cmd uv; then
        dry curl -LsSf https://astral.sh/uv/install.sh | sh
        note "uv installed via astral.sh"
      fi
      ;;
    fedora|rhel|rocky|almalinux|centos)
      action "Installing uv, python3.12, jq, gh via dnf..."
      dry $SUDO dnf install -y python3 python3-pip jq git curl gh
      if ! have_cmd uv; then
        dry curl -LsSf https://astral.sh/uv/install.sh | sh
        note "uv installed via astral.sh"
      fi
      ;;
    arch|manjaro|endeavouros)
      action "Installing uv, python3.12, jq, gh via pacman..."
      dry $SUDO pacman -Sy --noconfirm --needed python python-pip jq git curl github-cli
      if ! have_cmd uv; then
        dry curl -LsSf https://astral.sh/uv/install.sh | sh
        note "uv installed via astral.sh"
      fi
      ;;
    opensuse*|sles)
      action "Installing uv, python3.12, jq, gh via zypper..."
      dry $SUDO zypper install -y python3 python3-pip jq git curl gh
      if ! have_cmd uv; then
        dry curl -LsSf https://astral.sh/uv/install.sh | sh
        note "uv installed via astral.sh"
      fi
      ;;
    alpine)
      action "Installing uv, python3, jq, gh via apk..."
      dry $SUDO apk add --no-cache python3 py3-pip jq git curl
      if ! have_cmd uv; then
        dry curl -LsSf https://astral.sh/uv/install.sh | sh
        note "uv installed via astral.sh"
      fi
      ;;
    void)
      action "Installing uv, python3, jq, gh via xbps..."
      dry $SUDO xbps-install -S python3 python3-pip jq git curl
      if ! have_cmd uv; then
        dry curl -LsSf https://astral.sh/uv/install.sh | sh
        note "uv installed via astral.sh"
      fi
      ;;
    nixos)
      warn "NixOS detected — LightRAG and other uv tools require manual setup"
      warn "  After nix-shell: nix-shell -p nodejs python3 jq gh git"
      warn "  Then run: uv tool install \"lightrag-hku[api]\""
      warn "  And re-run this installer: node cli/provision.mjs"
      return 0
      ;;
  esac
  # LightRAG via uv tool (requires uv to be on PATH)
  install_lightrag
}

install_missing_deps_macos() {
  if ! have_cmd brew; then
    section "Homebrew"
    action "Installing Homebrew..."
    if [ "$DRY_RUN" -eq 0 ]; then
      /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
      note "Homebrew installed"
    fi
  else
    note "Homebrew already installed"
  fi
  action "Installing uv, python3.12, jq, gh via brew..."
  dry brew install uv jq gh 2>/dev/null || true
  # LightRAG via uv tool (requires uv to be on PATH)
  install_lightrag
}

# ── Service registration (delegated to Node) ────────────────────────────────
install_service() {
  section "Installing background service"
  # The unified provisioner does this via `cli/service-controller.mjs`.
  # We still call it from here because the bash script may run standalone
  # (e.g. for first-boot provisioning before the npm package is set up).
  #
  # v5.x — issue #7: On first install, register the service so the
  # dashboard auto-starts at login. On update, the running service is
  # stopped by the provisioner before files are replaced, then restarted
  # by the provisioner after — see cli/provision.mjs. This function
  # covers the FIRST install path only.
  local bin="$REPO_DIR/cli/bin.mjs"
  if [ ! -f "$bin" ]; then
    warn "cli/bin.mjs not found — service registration deferred"
    warn "    (will complete when `bizar service install` is run later)"
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    dim "  would run: node $bin service install"
    return 0
  fi
  if [ "$UPDATE_MODE" -eq 1 ]; then
    dim "  update mode: service restart is handled by the Node provisioner"
    return 0
  fi
  if ! node "$bin" service install 2>&1; then
    warn "service registration had issues — see output above"
    dim "    manual command: node $bin service install"
  fi
}

# ── Final success banner ───────────────────────────────────────────────────────

print_banner() {
  local dashboard_url="${BIZAR_DASHBOARD_URL:-http://localhost:4321}"
  section "Install complete"
  echo ""
  echo -e "${BOLD}${CYAN}┌────────────────────────────────────────────────────────────┐${NC}"
  echo -e "${BOLD}${CYAN}│${NC}  ${BOLD}BizarHarness ready.${NC}                                             │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  ${GREEN}✓${NC} Cross-platform installer v4.4.7                             │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  Dashboard: ${CYAN}$dashboard_url${NC}                                    │"
  echo -e "${BOLD}${CYAN}│${NC}                                                          │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}Next:${NC}                                                            │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  1. Restart cline to pick up new config${NC}                     │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  2. Run /connect in cline to add API keys${NC}                   │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  3. Run 'bizar dash start' to launch the dashboard${NC}             │"
  echo -e "${BOLD}${CYAN}│${NC}  ${DIM}  4. Visit $dashboard_url in your browser${NC}                │"
  echo -e "${BOLD}${CYAN}└────────────────────────────────────────────────────────────┘${NC}"
  echo ""
  if [ "$DRY_RUN" -eq 1 ]; then
    warn "DRY RUN — no changes were made"
  fi
}

# ── OS dispatch ───────────────────────────────────────────────────────────────

install_linux() {
  note "Detected Linux ($(uname -m))"
  ensure_node
  check_deps
  install_missing_deps_linux
  install_service
}

install_macos() {
  note "Detected macOS ($(uname -m))"
  check_deps
  install_missing_deps_macos
  install_service
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  parse_flags "$@"

  if [ "$DRY_RUN" -eq 1 ]; then
    dim "DRY RUN MODE — no changes will be made"
    echo ""
  fi

  echo ""
  echo -e "${BOLD}${CYAN}  ⚡ BizarHarness Installer v4.4.7${NC}"
  if [ "$UPDATE_MODE" -eq 1 ]; then
    echo -e "  ${DIM}Update mode${NC}"
  fi
  echo ""

  # OS detection
  local os
  os="$(uname -s)"
  case "$os" in
    Linux) install_linux ;;
    Darwin) install_macos ;;
    *)
      err "Unsupported OS: $os"
      echo ""
      warn "On Windows, run install.ps1 instead."
      warn "On other Unix systems, ensure Node.js 18+ is available and run:"
      warn "  node scripts/check-deps.mjs"
      echo ""
      exit 1
      ;;
  esac

  # ── Hand off to the unified provisioner (Node) ─────────────────────────
  # All cross-OS work (agent files, plugin copy, cline.json patching,
  # skills install, doctor check) lives in `cli/provision.mjs:runProvision`.
  # It's idempotent — skipping it (e.g. via --install-only-system) is fine
  # for first-boot scenarios where the npm package isn't yet set up.
  if [ "$MODE" = "install-only-system" ]; then
    note "skipped node provisioner (--mode=install-only-system)"
    exit 0
  fi

  if [ -f "$REPO_DIR/cli/provision.mjs" ]; then
    echo ""
    section "Running unified provisioner"
    local args=(--mode "$MODE")
    [ "$DRY_RUN" -eq 1 ] && args+=(--dry-run)
    [ "$FORCE" -eq 1 ] && args+=(--force)
    [ "$NON_INTERACTIVE" -eq 1 ] && args+=(--yes)
    # `set +e` so we capture the provisioner's exit code and surface it.
    set +e
    node "$REPO_DIR/cli/provision.mjs" "${args[@]}"
    local rc=$?
    set -e
    if [ "$rc" -ne 0 ]; then
      warn "provisioner exited with code $rc"
      exit "$rc"
    fi
    print_banner
  else
    warn "cli/provision.mjs not found — agent files / plugin / cline.json"
    warn "    were NOT synced. Run \`bizar install\` from a checkout to fix."
  fi
}

main "$@"