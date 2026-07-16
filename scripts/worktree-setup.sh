#!/usr/bin/env bash
# scripts/worktree-setup.sh
#
# Pillar A — Worktree symlink bootstrap.
# When a git worktree is added, symlink shared node_modules, dist, .next,
# and .harness/node_modules from the main worktree so agents don't re-install.
#
# Usage:
#   ./scripts/worktree-setup.sh <worktree-path>
#
# The worktree path is passed by the EnterWorktree PostToolUse hook.

set -euo pipefail

WORKTREE_ROOT="${1:-}"
if [[ -z "$WORKTREE_ROOT" ]]; then
  echo "Usage: $0 <worktree-path>" >&2
  exit 1
fi

# Resolve relative paths and find the main worktree (the git repo root).
if [[ ! -d "$WORKTREE_ROOT/.git" ]]; then
  echo "error: $WORKTREE_ROOT is not a git worktree" >&2
  exit 1
fi

GIT_ROOT="$(git -C "$WORKTREE_ROOT" rev-parse --show-toplevel 2>/dev/null || echo "")"
if [[ -z "$GIT_ROOT" ]]; then
  echo "error: could not determine git root for $WORKTREE_ROOT" >&2
  exit 1
fi

# Directories to symlink from main worktree
LINK_PAIRS=(
  "node_modules:node_modules"
  ".harness/node_modules:.harness/node_modules"
)

# Optional build outputs — only symlink if they exist in the main worktree
for item in dist .next; do
  if [[ -e "$GIT_ROOT/$item" ]]; then
    LINK_PAIRS+=("$item:$item")
  fi
done

ln_errors=0
for pair in "${LINK_PAIRS[@]}"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  src_path="$GIT_ROOT/$src"
  dst_path="$WORKTREE_ROOT/$dst"

  # If dst already exists (file or directory), skip.
  if [[ -e "$dst_path" ]]; then
    echo "skip: $dst_path already exists"
    continue
  fi

  # Create parent dir if needed
  dst_parent="$(dirname "$dst_path")"
  mkdir -p "$dst_parent"

  # Symlink relatively from worktree to main worktree.
  # Use a relative path so it works across machines.
  rel="$(realpath --relative-to="$dst_parent" "$src_path")"
  if ln -s "$rel" "$dst_path"; then
    echo "linked: $dst_path -> $rel"
  else
    echo "error: failed to symlink $dst_path" >&2
    ln_errors=$((ln_errors + 1))
  fi
done

if [[ $ln_errors -gt 0 ]]; then
  echo "warning: $ln_errors symlink(s) failed" >&2
  exit 1
fi

echo "worktree-setup complete"
