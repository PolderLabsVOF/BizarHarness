---
name: agent-browser
description: Self-healing browser automation CLI for AI agents — drives Chrome for Testing via 100+ typed CLI commands, native MCP stdio server, snapshot-based element refs (`@e2`), and a plugin system.
version: "1.0.0"
status: active
created_by: sprint MS-2026-05
use_count: 0
failure_count: 0
last_used: null
---

# agent-browser

`agent-browser` is a **native Rust CLI** from [vercel-labs](https://github.com/vercel-labs/agent-browser)
(~38K★) that exposes a complete browser-automation surface to AI agents.

## Why this skill

- Bizar dispatches a browser-primary agent (`agent-browser`) for any task
  that requires real-browser verification of a web app: clicking buttons,
  filling forms, taking screenshots, reading accessibility trees.
- agent-browser replaces the v5.x `browser-harness` (Python + uv) which
  was slow, fragile, and lacked MCP integration. See `docs/migration-guide.md`
  for the migration rationale.

## When to use

Use this skill when the task requires:

- "Take a screenshot of `<url>`"
- "Click button X, verify the result"
- "Fill in the login form, click submit"
- "Find a bug that's only visible in the rendered page"
- "Verify the dashboard's tab navigation works end-to-end"

Do not use this skill for:

- Editing code (the browser-primary agent has edit/write **denied**)
- Long-running background automation (use Cline agent teams instead)
- Non-Chromium browsers (Chrome for Testing only)

## Quick start

```bash
# Install (one-time)
npm install -g agent-browser
agent-browser install        # downloads Chrome for Testing

# Ensure the daemon is up
bizar browser-agent-up start # wrapper around cli/agent-browser-up.sh

# Drive the browser
agent-browser open example.com
agent-browser snapshot --json
agent-browser click @e2
agent-browser fill @e3 "hello"
agent-browser screenshot page.png
agent-browser close
```

## Command reference

The full command set has 100+ commands. The most common:

| Command | Purpose |
| --- | --- |
| `agent-browser open <url>` | Launch + navigate (aliases: `goto`, `navigate`) |
| `agent-browser read [url]` | Fetch agent-readable text from URL or active tab |
| `agent-browser snapshot [--json]` | Accessibility tree with refs (`@e1`, `@e2`, ...) |
| `agent-browser click <sel>` | Click — accepts ref (`@e2`) or selector (`#submit`) |
| `agent-browser fill <sel> <text>` | Clear + fill |
| `agent-browser type <sel> <text>` | Type without clear |
| `agent-browser press <key>` | Press key (Enter, Tab, Control+a) |
| `agent-browser get <what> <sel>` | Get text / html / attr |
| `agent-browser screenshot <path>` | Screenshot to file (PNG) |
| `agent-browser find role/label/text` | Semantic find (returns ref) |
| `agent-browser wait <what>` | Wait for selector / load / network idle |
| `agent-browser eval <js>` | Evaluate JavaScript |
| `agent-browser tab list/open/close/switch` | Tab management |
| `agent-browser close` | Close the browser |
| `agent-browser doctor` | Self-diagnostics |
| `agent-browser mcp` | Start MCP stdio server |
| `agent-browser chat "..."` | Natural-language browser tasks |
| `agent-browser skills list/get` | Bundled skills (this skill is in the catalog) |

## MCP integration

Cline registers `agent-browser` as an MCP tool server at session start via
`.cline/mcp.json`:

```json
{
  "mcpServers": {
    "agent-browser": {
      "command": "agent-browser",
      "args": ["mcp", "--tools", "core"]
    }
  }
}
```

Tool profiles:

- `core` — Default. Navigation, snapshots, interaction, waits, reads, screenshots,
  JavaScript eval, close, tab basics, profile discovery. Small MCP context.
- `network` — Routes, request inspection, HAR, headers, credentials, offline.
- `state` — Cookies, storage, auth, sessions, profiles, skills.
- `debug` — Console/errors, tracing, profiling, recording, clipboard, plugins,
  doctor, dashboard, install, upgrade, chat, batch.
- `tabs` — Back/forward/reload, tabs, windows, frames, dialogs.
- `react` — React tree/inspect, vitals, pushstate.
- `mobile` — Viewport/device/geolocation, touch, swipe, mouse, keyboard.
- `all` — Every MCP tool.

## Plugin system

```json
{
  "plugins": [
    {
      "name": "vault",
      "command": "agent-browser-plugin-vault",
      "capabilities": ["credential.read"]
    }
  ]
}
```

## Patterns

### Stable selectors

Prefer **refs** (`@e2`) over CSS selectors — refs survive snapshot churn.

```bash
agent-browser snapshot --json > snap.json
agent-browser click @e2
```

### Headless vs headed

Default is headless. Use `--headed` for visual debugging.

### Persistent profile

Set `--profile <dir>` to keep cookies / storage across runs. Default
is `~/.agent-browser/profile`.

### Natural-language chat

```bash
AI_GATEWAY_API_KEY=... agent-browser chat "summarize the page at /pricing"
```

This streams a structured response from the configured LLM provider.

## Configuration

Layered config (lowest → highest priority):

1. `~/.agent-browser/config.json` — user-level
2. `./agent-browser.json` — project-level
3. `AGENT_BROWSER_*` env vars
4. CLI flags

## Lessons / known limitations

- Chrome for Testing only (no Firefox / Safari / WebKit).
- `agent-browser install` requires network access to download Chrome
  the first time (~150MB).
- The chat endpoint requires `AI_GATEWAY_API_KEY` from Vercel.
- The daemon binds to `127.0.0.1` by default; use `--host` to expose
  publicly (only on trusted networks).

## See also

- [config/agents/agent-browser.md](../../config/agents/agent-browser.md) — the Cline primary agent
- [cli/agent-browser-up.sh](../../cli/agent-browser-up.sh) — idempotent starter
- https://github.com/vercel-labs/agent-browser — upstream README
- [docs/migration-guide.md](../../docs/migration-guide.md) — browser-harness → agent-browser rationale
- [research/agent-harness-survey/round-9-memory/bizar-memory-redesign.md](../../research/agent-harness-survey/round-9-memory/bizar-memory-redesign.md)
