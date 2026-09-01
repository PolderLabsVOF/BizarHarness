---
description: Detect and repair stale Bizar executable symlinks.
allowed-tools: Read, Bash
---

# /repair

Run `bizar repair`. This repairs stale Bizar binary links and reports what it
changed. For a full idempotent re-provision of agents, commands, hooks, skills,
MCP registration, and settings, run `bizar install --force --yes`, then
`bizar validate`.
