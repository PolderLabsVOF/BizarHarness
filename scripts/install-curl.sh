#!/usr/bin/env bash
# scripts/install-curl.sh — curl-pipe install entry point.
#
# Usage:
#   curl -fsSL https://bizar.dev/install.sh | bash
#
# This script downloads the canonical install.sh from the Bizar repo
# and execs it. Kept separate so the curl URL can be stable while
# install.sh can be edited freely.

set -euo pipefail
INSTALL_URL="${BIZAR_INSTALL_URL:-https://raw.githubusercontent.com/DrB0rk/BizarHarness/main/install.sh}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$INSTALL_URL" -o "$TMP/install.sh"
chmod +x "$TMP/install.sh"
exec "$TMP/install.sh" "$@"
