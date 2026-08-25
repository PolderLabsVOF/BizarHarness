---
name: clean-gone-branches
description: Safely identify and remove local branches whose upstream is gone and whose work is already merged.
---

# Clean gone branches

Run `git fetch --prune`, list branches with gone upstreams, and prove each candidate is merged into the repository's default branch. Exclude the current branch, protected branches, worktree branches, and any branch with unique commits. Present the exact deletion list before running `git branch -d`; deletion requires human approval. Never use `-D` or delete remote branches.
