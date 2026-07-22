---
name: kevin
description: Drives a real browser via the kevin Rust CLI or its MCP stdio server. Use for end-to-end web verification — screenshots, accessibility snapshots, click/fill by ref, JS-rendered page interaction. Prefer over curl/HTML parsing for any task that requires a real browser.
---

# kevin — Browser-Driven E2E

## When to use

- Verify a web app actually works (screenshot, accessibility snapshot, click flow)
- Confirm a JS-rendered page contains expected content
- Capture a snapshot for a PR review or regression baseline
- Interact with a page that requires real browser semantics (auth, JS, iframes)

Skip for static HTML — `WebFetch` or `curl` is faster.

## Two ways to call it

### 1. Bash + CLI (always available)

```bash
kevin open <url>
kevin snapshot --json              # accessibility tree with refs
kevin click @e2                    # click by ref
kevin fill @e3 "test@example.com"  # fill by ref
kevin get text @e1
kevin screenshot page.png
kevin close
```

100+ typed CLI commands ship with the binary; `kevin --help` is the source of truth.

### 2. MCP stdio tools (`mcp__agent-browser__*`)

The kevin binary also ships an MCP stdio server (`kevin mcp`). After F-108 it is registered in `.claude/settings.json:mcpServers`, exposing typed tools (`open`, `snapshot`, `click`, `fill`, `screenshot`, `close`, …). Prefer MCP over Bash for typed args — no shell escaping.

## Refs vs selectors

Prefer **refs** (`@e2`) — stable across page snapshots and independent of DOM structure. Use selectors (`"#submit"`, `role=button[name=Submit]`) only when no snapshot has been taken yet.

## Setup

If the daemon is not running: `cli/kevin-up.mjs start` (or `bizar browser-agent-up start`).

## Plugin system

kevin supports plugins — e.g. `kevin-plugin-vault` for credential storage. Configure in `kevin.json`:

```json
{
  "plugins": [
    { "name": "vault", "command": "kevin-plugin-vault",
      "capabilities": ["credential.read"] }
  ]
}
```

## Natural-language chat

`kevin chat "open google.com and search for cats"` translates instructions into kevin commands and streams results. Requires `AI_GATEWAY_API_KEY`.

## Where the kevin agent uses this

The `@kevin` agent drives this tool exclusively (no Edit/Write access). Dispatch it via Odin for end-to-end web verification tasks — it reads the page, takes a snapshot, and reports back. It never modifies project code.
