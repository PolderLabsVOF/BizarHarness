#!/usr/bin/env bash
# install.sh — BizarHarness OS dependencies installer
# Usage: ./install.sh [--non-interactive|--dry-run]
set -euo pipefail

G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; N='\033[0m'
note() { echo -e "  ${G}✓${N} $1"; }
warn() { echo -e "  ${Y}⚠${N} $1"; }
err()  { echo -e "  ${R}✗${N} $1"; }
cmd()  { command -v "$1" >/dev/null 2>&1; }
dry()  { [ "${DRY:-0}" -eq 0 ] && "$@" || echo "  would $*" >&2; }
sudo_if_needed() { [ "$(id -u)" -ne 0 ] && cmd sudo && SUDO="sudo" || SUDO=""; }

main() {
  local ni=0
  while [ $# -gt 0 ]; do
    case "$1" in
      --help|-h) cat <<'EOF'
install.sh — BizarHarness OS-dependencies installer
  ./install.sh --non-interactive   CI safe
  ./install.sh --dry-run           print actions, no changes
EOF
        exit 0;;
      --dry-run) export DRY=1;;
      --non-interactive|-y) ni=1;;
      *) warn "ignoring: $1";;
    esac; shift
  done
  echo "Installing OS dependencies..."
  case "$(uname -s)" in
    Linux)  linux;;
    Darwin) macos;;
    *) err "Unsupported OS — use install.ps1 on Windows"; exit 1;;
  esac
  local a=(--mode=install)
  [ "$ni" -eq 1 ] && a+=(--yes)
  [ "${DRY:-0}" -eq 1 ] && a+=(--dry-run)
  exec node "$(dirname "$0")/cli/provision.mjs" "${a[@]}"
}

linux() {
  [ ! -f /etc/os-release ] && { err "no /etc/os-release"; exit 1; }
  . /etc/os-release
  note "Detected Linux ($ID)"
  sudo_if_needed
  case "$ID" in
    ubuntu|debian|pop|linuxmint|elementary)
      dry $SUDO apt-get update
      dry $SUDO apt-get install -y ca-certificates curl gnupg
      cmd node || dry curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
      dry $SUDO apt-get install -y nodejs
      dry $SUDO apt-get install -y --no-install-recommends python3 jq git curl
      ;;
    fedora|rhel|rocky|almalinux|centos)
      cmd node || dry $SUDO dnf install -y https://rpm.nodesource.com/pub_20.x/nodesource-release-nodesource-1.noarch.rpm
      cmd node || dry $SUDO dnf install -y nodejs
      dry $SUDO dnf install -y python3 jq git curl gh
      ;;
    arch|manjaro|endeavouros)
      dry $SUDO pacman -Sy --noconfirm --needed nodejs npm python jq git curl
      ;;
    opensuse*|sles)
      dry $SUDO zypper install -y nodejs20 npm20 python3 jq git curl gh
      ;;
    alpine)  dry $SUDO apk add --no-cache nodejs npm python3 jq git curl ;;
    void)    dry $SUDO xbps-install -S nodejs python3 jq git curl ;;
    nixos)
      note "NixOS — manual setup required"
      warn "nix-shell -p nodejs python3 jq gh git"
      warn "node cli/provision.mjs --mode=install"
      exit 0
      ;;
    *) err "Unsupported distro: $ID"; exit 1;;
  esac
  cmd uv || { note "Installing uv..."; dry curl -LsSf https://astral.sh/uv/install.sh | sh; }
  note "OS dependencies ready"
}

macos() {
  note "Detected macOS"
  cmd brew || { err "Homebrew not found — install from https://brew.sh"; exit 1; }
  dry brew install uv jq gh
  note "OS dependencies ready"
}

main "$@"
