---
description: Configure Claude Code provider environment without replacing hooks, permissions, or MCP settings.
allowed-tools: Read, Write, Bash
---

# /setup-provider

Run the repository CLI:

```bash
bizar setup-provider --list
bizar setup-provider --gateway <url> [--key <secret>] [--model <id>]
bizar setup-provider --remove-key
```

The command edits only `env.ANTHROPIC_BASE_URL`,
`env.BIZAR_MODEL_ROUTER_URL`, `env.ANTHROPIC_AUTH_TOKEN`, and
`env.ANTHROPIC_MODEL` in
`~/.claude/settings.json` (or `$CLAUDE_CONFIG_DIR/settings.json`).
All unrelated settings are preserved. It rejects invalid existing JSON
and never prints a full API key.

With no arguments it shows help; it does not guess credentials or query
an untrusted model catalog. A normal `bizar install` provides the safer
interactive path with hidden key entry; this command remains useful for
automation and explicit changes.
