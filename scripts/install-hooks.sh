#!/usr/bin/env bash
# Install BizarHarness git hooks
# Run this once per clone: ./scripts/install-hooks.sh

set -e

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/scripts/git-hooks"
GIT_HOOKS_DIR="$(git rev-parse --git-dir)/hooks"

if [ ! -d "$GIT_HOOKS_DIR" ]; then
  echo "Error: not in a git repo"
  exit 1
fi

cp "$HOOKS_DIR/pre-commit" "$GIT_HOOKS_DIR/pre-commit"
chmod +x "$GIT_HOOKS_DIR/pre-commit"

cp "$HOOKS_DIR/pre-push" "$GIT_HOOKS_DIR/pre-push"
chmod +x "$GIT_HOOKS_DIR/pre-push"

echo "✓ Installed pre-commit hook"
echo "  The hook scans staged changes for likely secrets (Bearer tokens, API keys, etc.)"
echo "  It also blocks commits touching .bizar/ or config/cline.json (per-machine state)"
echo "  To bypass in an emergency: git commit --no-verify"
echo ""
echo "✓ Installed pre-push hook"
echo "  Blocks pushes whose commit range includes .bizar/ or config/cline.json changes"
echo "  Defense-in-depth: catches bypasses of pre-commit via --no-verify"
echo "  To bypass in an emergency: git push --no-verify"
