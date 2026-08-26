#!/bin/sh
# bizar-hook-wrapper.sh — path-resolving shim for hook commands.
#
# Claude Code invokes hooks via /bin/sh with a stripped PATH that may not
# include the npm-global bin directory where the global `bizar` symlink lives.
# This wrapper probes known install locations and falls back to `npx` if the
# CLI is not on PATH at all.
#
# Receives the hook subcommand name as $1, forwards stdin, exits with the
# same code as the underlying `bizar hook <sub>` invocation.
set -e
BIZAR=""
for d in "$HOME/.npm-global/bin" "$HOME/.local/bin" "/usr/local/bin" "/usr/bin"; do
  if [ -x "$d/bizar" ]; then
    BIZAR="$d/bizar"
    break
  fi
done
if [ -z "$BIZAR" ] && command -v bizar >/dev/null 2>&1; then
  BIZAR="$(command -v bizar)"
fi
if [ -z "$BIZAR" ]; then
  BIZAR="npx -y @polderlabs/bizar-sdk"
fi
exec $BIZAR hook "$@"