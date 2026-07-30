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

cp "$HOOKS_DIR/commit-msg" "$GIT_HOOKS_DIR/commit-msg"
chmod +x "$GIT_HOOKS_DIR/commit-msg"

echo "✓ Installed pre-commit hook"
echo "  The hook scans staged changes for likely secrets (Bearer tokens, API keys, etc.)"
echo "  It also blocks commits touching per-session .bizar state or .config/bizar logs"
echo "  To bypass in an emergency: git commit --no-verify"
echo ""
echo "✓ Installed pre-push hook"
echo "  Blocks pushes whose commit range includes per-session Bizar state"
echo "  Defense-in-depth: catches bypasses of pre-commit via --no-verify"
echo "  To bypass in an emergency: git push --no-verify"
echo ""
echo "✓ Installed commit-msg hook"
echo "  Strips Co-Authored-By: Claude <noreply@anthropic.com> (and agent-themed"
echo "  noreply@polderlabs.dev trailers) from commit messages — this repo's"
echo "  commits should only carry the human author identity."
echo "  To bypass in an emergency: git commit --no-verify"
