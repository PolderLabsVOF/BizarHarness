---
description: Repair a broken Bizar install — re-run provision and re-mark hooks executable.
allowed-tools: Read, Bash
---

# /repair — fix common install issues

Runs `bizar repair` to:

1. Re-run `bizar install` (idempotent: merges into the existing `~/.claude/settings.json` instead of replacing it).
2. Re-mark every script under `~/.claude/hooks/` as executable.
3. Refresh the skills and rules mirrors from `config/skills/` and `config/rules/`.
4. Rewrite the Bizar MCP server registration if the SDK path has moved.

Use after `bizar doctor` reports a problem, after `npm install -g @anthropic-ai/claude-code`,
or after a Claude Code upgrade that drops hooks or MCP entries.
