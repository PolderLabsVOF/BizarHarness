---
description: Migrate a legacy ~/.config/cline/ install to the user-level Claude Code directory.
allowed-tools: Read, Bash
---

# /migrate — Cline-era ~/.config/cline/ → ~/.claude/

Runs `bizar migrate` once. It is safe to re-run.

1. Detects `~/.config/cline/{settings.json,CLAUDE.md,agents,commands}` and any
   other Cline-era surfaces that still live under `~/.config/`.
2. Moves them under `~/.claude/` (or `$CLAUDE_CONFIG_DIR`) and reconciles
   names with the current Claude Code conventions.
3. Writes a stamp file `~/.claude/.bizar-cline-migration-stamp` recording the
   source and Bizar version that performed the migration.

No file is deleted. The original `~/.config/cline/` is left in place until you
verify the move succeeded.
