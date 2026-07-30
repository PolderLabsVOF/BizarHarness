---
name: agent-browser
description: Use the official agent-browser CLI or MCP server for real-browser verification, screenshots, accessibility snapshots, and interactive web flows.
---

# agent-browser

Use this skill when correctness depends on browser behavior rather than static
HTML: JavaScript rendering, accessibility snapshots, navigation, forms,
screenshots, authentication flows, or end-to-end regression evidence.

## Required discovery

Before driving a browser, load the current upstream workflow:

```bash
agent-browser skills get core
```

Follow that output as the source of truth for command syntax. The common flow is:

```bash
agent-browser open <url>
agent-browser snapshot --json
agent-browser click @e2
agent-browser fill @e3 "value"
agent-browser screenshot evidence.png
agent-browser close
```

Prefer snapshot refs such as `@e2` over fragile selectors. Re-snapshot after
navigation or major DOM changes.

## Setup and diagnostics

```bash
bizar browser status
bizar browser install
bizar browser update
bizar browser doctor
```

The official CLI manages its own browser daemon. Do not create a persistent
Bizar subprocess or maintain a second daemon wrapper.

Claude Code may use the registered `agent-browser mcp` server instead of Bash
when typed MCP tools are available.

## Approval boundary

Reading pages and collecting local evidence are autonomous. Ask before entering
credentials, submitting irreversible forms, publishing, purchasing, or changing
production state.
