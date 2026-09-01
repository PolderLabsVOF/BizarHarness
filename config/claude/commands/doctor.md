---
description: Validate the installed Bizar harness and fix what's safe to fix.
allowed-tools: Read, Bash
---

# /doctor — health check for the Bizar install

Runs `bizar doctor`, which verifies:

1. `~/.claude/settings.json` parses and includes the Bizar MCP server.
2. The 16 shipped agent files are present in `~/.claude/agents/`.
3. Skills include the default `i-have-adhd` output skill, and all seven rules are present.
4. Slash commands are copied to `~/.claude/commands/`.
5. All shipped hook entrypoints are executable and every lifecycle event is wired.
6. The global model router has an explicit enabled fallback when no gateway URL is configured.

If something is broken, `bizar doctor` reports a fix command.
If you want it to apply the fix itself, run `bizar repair` after the report.
