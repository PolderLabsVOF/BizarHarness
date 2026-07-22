---
name: agent-browser
description: Drives a real browser via the agent-browser Rust CLI or its MCP stdio server. Use for end-to-end web verification — screenshots, accessibility snapshots, click/fill by ref, JS-rendered page interaction. Prefer over curl/HTML parsing for any task that requires a real browser.
---

# agent-browser — Browser-Driven E2E

## When to use

- Verify a web app actually works (screenshot, accessibility snapshot, click flow)
- Confirm a JS-rendered page contains expected content
- Capture a snapshot for a PR review or regression baseline
- Interact with a page that requires real browser semantics (auth, JS, iframes)

Skip for static HTML — `WebFetch` or `curl` is faster.

## Two ways to call it

### 1. Bash + CLI (always available)

```bash
agent-browser open <url>
agent-browser snapshot --json              # accessibility tree with refs
agent-browser click @e2                    # click by ref
agent-browser fill @e3 "test@example.com"  # fill by ref
agent-browser get text @e1
agent-browser screenshot page.png
agent-browser close
```

100+ typed CLI commands ship with the binary; `agent-browser --help` is the source of truth.

### 2. MCP stdio tools (`mcp__agent-browser__*`)

The agent-browser binary also ships an MCP stdio server (`agent-browser mcp`). After F-108 it is registered in `.claude/settings.json:mcpServers`, exposing typed tools (`open`, `snapshot`, `click`, `fill`, `screenshot`, `close`, …). Prefer MCP over Bash for typed args — no shell escaping.

## Refs vs selectors

Prefer **refs** (`@e2`) — stable across page snapshots and independent of DOM structure. Use selectors (`"#submit"`, `role=button[name=Submit]`) only when no snapshot has been taken yet.

## Setup

If the daemon is not running: `cli/agent-browser-up.mjs start` (or `bizar browser-agent-up start`).

## Plugin system

agent-browser supports plugins — e.g. `agent-browser-plugin-vault` for credential storage. Configure in `agent-browser.json`:

```json
{
  "plugins": [
    { "name": "vault", "command": "agent-browser-plugin-vault",
      "capabilities": ["credential.read"] }
  ]
}
```

## Natural-language chat

`agent-browser chat "open google.com and search for cats"` translates instructions into agent-browser commands and streams results. Requires `AI_GATEWAY_API_KEY`.

## Where the agent-browser agent uses this

The `@agent-browser` agent drives this tool exclusively (no Edit/Write access). Dispatch it via Odin for end-to-end web verification tasks — it reads the page, takes a snapshot, and reports back. It never modifies project code.
