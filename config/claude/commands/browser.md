---
description: Install, update, or check the agent-browser binary used by the support-tech agent.
allowed-tools: Read, Bash
---

# /browser — manage agent-browser

Runs `bizar browser <subcommand>`:

- `bizar browser install` — installs the Playwright-driven `agent-browser`
  binary the `support-tech` agent uses for verification.
- `bizar browser update` — pulls the latest pinned release.
- `bizar browser status` — prints version, Chromium revision, and the
  path the MCP server is registered at in `~/.claude/settings.json`.
- `bizar browser uninstall` — removes the binary and clears the MCP entry.

The agent-browser binary is registered as the `agent-browser` MCP server in
`~/.claude/settings.json` during `bizar install`. Re-run `bizar repair` if
the MCP entry is missing after a Claude Code upgrade.