---
description: Validate the installed Bizar harness and fix what's safe to fix.
allowed-tools: Read, Bash
---

# /doctor — health check for the Bizar install

Runs `bizar doctor`, which verifies:

1. `~/.claude/settings.json` parses and includes the Bizar MCP server.
2. The 16 shipped agent files are present in `~/.claude/agents/`.
3. Canonical skills and rules mirror into `~/.claude/skills/` and `~/.claude/rules/`.
4. Slash commands are copied to `~/.claude/commands/`.
5. Hook scripts under `~/.claude/hooks/` are executable.

If something is broken, `bizar doctor` reports a fix command.
If you want it to apply the fix itself, run `bizar repair` after the report.
