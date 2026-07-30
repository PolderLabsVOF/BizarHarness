#!/usr/bin/env bash
# scripts/worktree-setup.sh
#
# Worktree dependency bootstrap.
# When a git worktree is added, symlink the dependency install from the main
# checkout. Build output and Bizar runtime state remain worktree-local so
# parallel agents cannot overwrite one another's artifacts or leases.
#
# Usage:
#   ./scripts/worktree-setup.sh <worktree-path>
#
# The worktree path is passed by the SubagentStart hook or Makefile.

set -euo pipefail

WORKTREE_ROOT="${1:-}"
if [[ -z "$WORKTREE_ROOT" ]]; then
  echo "Usage: $0 <worktree-path>" >&2
  exit 1
fi

# Find the main checkout. Linked worktrees store `.git` as a file.
if [[ ! -e "$WORKTREE_ROOT/.git" ]]; then
  echo "error: $WORKTREE_ROOT is not a git worktree" >&2
  exit 1
fi

MAIN_ROOT="$(
  git -C "$WORKTREE_ROOT" worktree list --porcelain 2>/dev/null |
    awk '/^worktree / { sub(/^worktree /, ""); print; exit }'
)"
if [[ -z "$MAIN_ROOT" || ! -d "$MAIN_ROOT" ]]; then
  echo "error: could not determine main worktree for $WORKTREE_ROOT" >&2
  exit 1
fi

# Dependency directories safe to share between worktrees.
LINK_PAIRS=(
  "node_modules:node_modules"
)

ln_errors=0
for pair in "${LINK_PAIRS[@]}"; do
  src="${pair%%:*}"
  dst="${pair##*:}"
  src_path="$MAIN_ROOT/$src"
  dst_path="$WORKTREE_ROOT/$dst"

  if [[ ! -e "$src_path" ]]; then
    echo "skip: shared dependency path does not exist: $src_path"
    continue
  fi

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
