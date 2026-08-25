---
description: Update Bizar, the SDK, and the agent-browser binary to the latest pinned versions.
allowed-tools: Read, Bash
---

# /update — refresh Bizar + SDK + agent-browser

Runs `bizar update`, which:

1. Installs the latest matching `@polderlabs/bizar` and `@polderlabs/bizar-sdk` from npm.
2. Refreshes `agent-browser` (the Playwright-driven browser harness used by the `support-tech` agent and `verify-deliverables` hook).
3. Re-runs `bizar install` so the new SDK and binary paths land in `~/.claude/settings.json`.

If a Claude Code release breaks the bundled MCP registration, run
`bizar repair` afterwards.