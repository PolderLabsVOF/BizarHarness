# Bizar Remote — Feature Spec

> **Status:** Draft for review. Companion to `visual-planner-v2-spec.md`. v0.1 (the MVP) is local-only; hosted control plane is a v0.3+ future.
> **Goal:** A single, optional control surface to see all projects, all running agents, and all plans on one machine — with a clean upgrade path to a hosted webui later.

---

## 1. Vision

`bizar-remote` is a separate npm package that ships a small local webui for monitoring and controlling the BizarHarness agent runtime. The "remote" in the name is a forward-looking statement of intent: v0.1 is **100% local** (the webui runs on `localhost`), with an optional tunnel for remote access. A truly hosted webui at `bizar.dev` is a v0.3+ paid offering that the local product is designed to evolve into.

### 1.1 What v0.1 does

The user installs the package, runs `bizar-remote serve`, and opens `http://localhost:8765` in their browser. They see:

- A list of all projects (auto-discovered from Hindsight banks + local configs).
- For each project: a list of plans (with status), a list of background agents (live status), and a "spawn new agent" button.
- A single conversation panel that can attach to any background agent and stream its messages in real time.
- The ability to kill an agent, send it a follow-up prompt, or mark a plan as approved.

That's it. No auth. No hosted component. No telemetry. The local machine is the source of truth.

### 1.2 What v0.1 explicitly does NOT do

- Multi-user. v0.1 is single-user, localhost-only.
- Multi-machine. v0.1 controls agents on ONE machine. A "remote" agent on another machine is not in scope.
- Hosted. v0.1 has no cloud component. All data stays on disk.
- Mobile-first. v0.1 is desktop-first. Mobile layout works but is unoptimized.
- Mobile app. v0.3+.

### 1.3 Why a separate package

| Reason | Detail |
|---|---|
| Different release cadence | BizarHarness is the agent runtime; it ships monthly. `bizar-remote` is the control surface; it can ship weekly without forcing a BizarHarness release. |
| Different dependencies | BizarHarness is installable in 5 seconds with no extra deps. `bizar-remote` needs Hono, Hono JSX, better-sqlite3, etc. — heavy deps that bloat the main package. |
| Optional install | Users who only want the CLI + plan command don't need the webui. Keeping it separate means a 2MB `bizarharness` install and a 25MB `bizar-remote` install. |
| Different users | BizarHarness is the dev tool. `bizar-remote` is also for non-dev users (e.g., a tech lead who wants to see what agents are running without using the CLI). |
| Future isolation | The hosted version (bizar.dev) lives in a different repo and is a different team. The local product can be OSS MIT; the hosted product can be a paid SaaS. |

### 1.4 Non-goals (v0.1)

- Authentication (no auth, localhost only).
- Multi-user collaboration.
- Cloud-hosted control plane.
- Real-time multi-machine sync.
- Mobile app.
- Slack/Discord integration.
- Webhook support.
- Per-project or per-user billing.

These are v0.2+ future work.

---

## 2. Architecture

### 2.1 Three components

```
┌────────────────────────────────────┐      ┌────────────────────────────────┐
│  Bizar Local (the user's machine)  │      │  Bizar Remote (control plane)  │
│                                    │      │                                │
│  ┌──────────────────────────────┐ │      │  ┌──────────────────────────┐  │
│  │ opencode + Bizar plugin      │ │      │  │  Local webui (browser)   │  │
│  │ (background agent runtime)   │ │      │  │  localhost:8765          │  │
│  │                              │ │      │  │  or via tunnel           │  │
│  │  - opencode serve :4096      │ │      │  └──────────┬───────────────┘  │
│  │  - SSE event stream          │ │      │             │                   │
│  │  - BackgroundState files     │ │      │             │                   │
│  └──────────────────────────────┘ │      │             │                   │
│             │                      │      │             ▼                   │
│             ▼                      │      │  ┌──────────────────────────┐  │
│  ┌──────────────────────────────┐ │      │  │  Bizar Remote server     │  │
│  │ Hindsight MCP                │ │◄─┐   │  │  Hono + SQLite           │  │
│  │ (per-project banks)          │ │  │   │  │  localhost:8765          │  │
│  │                              │ │  │   │  │                          │  │
│  │  bank_id="bizarharness"      │ │  │   │  │  Reads/writes:           │  │
│  │  bank_id="ams-studio"        │ │  │   │  │  - Bizar plugin API      │  │
│  │  bank_id="my-app"            │ │  │   │  │  - Hindsight MCP         │  │
│  └──────────────────────────────┘ │  │   │  │  - plan files (FS)       │  │
│             ▲                      │  │   │  └──────────────────────────┘  │
│             │                      │  │   │                                │
│  ┌──────────────────────────────┐ │  │   │  Optional Cloudflare Tunnel    │
│  │ Bizar Plugin HTTP API        │ │  └──►│  (or ngrok) for remote access  │
│  │ (opencode session API)       │ │      │                                │
│  └──────────────────────────────┘ │      │                                │
└────────────────────────────────────┘      └────────────────────────────────┘
```

**Bizar Local** is the user's existing setup: opencode with the Bizar plugin, Hindsight MCP for memory, plan files in `plans/`. Nothing changes here.

**Bizar Remote** is the new package: a small Hono server that runs on `127.0.0.1:8765`, reads from the local Bizar plugin's API and from the Hindsight MCP, and serves a webui in the browser.

**Bizar Cloud** (v0.3+, NOT in v0.1) is the hosted version of Bizar Remote. It would let users control agents on their machines from `bizar.dev` without running a local server. v0.1 does not include this.

### 2.2 Why Option C (local-only) for v0.1

The spec asks me to pick the right option and justify. I am picking **Option C (local-only webui) with optional tunnel support (Cloudflare Tunnel integration)** for v0.1, and **Option A (phone-home) for v0.3+**.

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| **A. Phone-home (WebSocket from local to remote)** | Works from any device, including mobile. No firewall config. | Adds a cloud dependency to a local-first product. The local machine "calls home" — philosophically at odds with BizarHarness's local-first ethos. Privacy concerns: a hosted server sees the user's agent prompts, conversation history, plan contents. **Hard problem**: how does the user trust that the hosted server isn't logging? A real B2B offering would need SOC2, GDPR, etc. — a significant operational burden. | **Defer to v0.3+.** Build the infrastructure (the local server + a clean API) so this is technically possible, but don't ship the hosted component until the privacy model and business model are clear. |
| **B. Tunnel only (user sets up Cloudflare Tunnel or ngrok)** | No cloud component. User controls the tunnel. Works from any device the user chooses. | Requires the user to set up a tunnel, which is non-trivial. No "magic link" UX. If the user already has a tunnel, it's a one-liner. | **Ship as the v0.1 tunnel mode**, but NOT the primary path. Most users will use v0.1 in pure-local mode. |
| **C. Pure local (no remote)** | Zero setup. Zero trust required. Works offline. Aligned with BizarHarness's local-first ethos. Same architecture as the plan server (port 8765, localhost only). | Not accessible from other devices unless the user sets up a tunnel. | **Ship as the v0.1 default mode.** This is what 95% of users will use. |

The local-first default + optional tunnel matches BizarHarness's existing pattern: the plan command runs a local server on 4321, the user opens it in a browser, the local server binds to 127.0.0.1. `bizar-remote` is the same pattern, just for the agent runtime instead of plans.

### 2.3 Local server architecture

```
                    ┌──────────────────────────────────────────────┐
                    │   Bizar Remote server (Hono, :8765)         │
                    │                                              │
                    │   ┌──────────────────────────────────────┐   │
                    │   │  Routes                              │   │
                    │   │  - /api/projects (list)              │   │
                    │   │  - /api/projects/:id/agents (list)   │   │
                    │   │  - /api/projects/:id/agents (POST)   │   │
                    │   │  - /api/agents/:id (DELETE)          │   │
                    │   │  - /api/agents/:id/messages          │   │
                    │   │  - /api/plans (list)                 │   │
                    │   │  - /api/plans/:slug (get)            │   │
                    │   │  - /api/stream (SSE)                 │   │
                    │   └──────────────────────────────────────┘   │
                    │                                              │
                    │   ┌──────────────────────────────────────┐   │
                    │   │  Adapters                            │   │
                    │   │  - BizarPluginAdapter (HTTP→plugin)  │   │
                    │   │  - HindsightAdapter (MCP→banks)      │   │
                    │   │  - PlansAdapter (FS→plans/*)         │   │
                    │   │  - TunnelAdapter (cloudflared)       │   │
                    │   └──────────────────────────────────────┘   │
                    │                                              │
                    │   ┌──────────────────────────────────────┐   │
                    │   │  Persistence                         │   │
                    │   │  - ~/.local/share/bizar-remote/       │   │
                    │   │  - db.sqlite (sessions, audit log)   │   │
                    │   │  - cache/ (project list cache)       │   │
                    │   └──────────────────────────────────────┘   │
                    │                                              │
                    │   ┌──────────────────────────────────────┐   │
                    │   │  Views                               │   │
                    │   │  - pages/index.html (project list)   │   │
                    │   │  - pages/agent.html (agent view)     │   │
                    │   │  - pages/plan.html (plan view)       │   │
                    │   └──────────────────────────────────────┘   │
                    └──────────────────────────────────────────────┘
```

The server is a single Hono process that:
- Discovers projects on startup (Hindsight banks + filesystem scan).
- Polls the Bizar plugin's HTTP API (or opencode serve) for agent status every 2s.
- Subscribes to the SSE event stream from the plugin.
- Serves the webui as server-rendered HTML with HTMX-style interactivity.
- Exposes a `/api/stream` SSE endpoint for the browser to subscribe to.

### 2.4 Adapter pattern

Each external dependency is wrapped in an adapter so the server can be tested without the dependency:

| Adapter | Wraps | Used for |
|---|---|---|
| `BizarPluginAdapter` | `opencode serve` HTTP API + Bizar plugin's HTTP API | Listing/spawning/killing background agents, getting messages |
| `HindsightAdapter` | Hindsight MCP via `stdio` | Listing banks (projects), reading project context |
| `PlansAdapter` | Filesystem (`plans/`) | Listing plans, reading plan content, updating meta |
| `TunnelAdapter` | `cloudflared` CLI binary | Starting a quick tunnel for remote access |

The adapters are swappable (e.g., for tests, in-memory implementations are used). The server depends on adapter interfaces, not concrete implementations.

### 2.5 Discovery

On startup, the server runs a discovery pass:

1. **Hindsight banks:** list all banks (skip `default`). Each bank maps to a project.
2. **Filesystem scan:** walk `~/<projects>/` for `package.json` with a `.bizar/` directory. Each match is a project.
3. **Merge:** the union of Hindsight banks and FS-scanned projects. If a project appears in both, merge (Hindsight wins for project name/description; FS wins for path/plan-list).
4. **Cache:** write the result to `~/.local/share/bizar-remote/cache/projects.json` with a TTL of 5 minutes.
5. **Re-discover:** every 5 minutes, the server re-runs the discovery. (In v0.1 this is a simple setInterval; in v0.2+ it'll be event-driven.)

The discovery is intentionally simple in v0.1. A real product would use an event bus (inotify on the FS, MCP events for banks). v0.1 polls.

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| **Runtime** | Node.js 20+ | Matches the BizarHarness CLI's engine requirement. Bun is faster but adds a non-trivial dep. |
| **Language** | TypeScript 5.x | Type safety for the API surface. The Bizar plugin is also TypeScript; we share types if possible. |
| **Server framework** | Hono 4.x | Lightweight (~15kb), runs on Node/Bun/Deno/Workers. Excellent TypeScript support. Built-in SSE support via `hono/streaming`. Server-rendered HTML is a first-class citizen (Hono JSX). |
| **HTML rendering** | Hono JSX | No build step. Server-side JSX compiles to template literals at build time. The result is a self-contained JS bundle. |
| **Client-side JS** | Vanilla JS (no framework) | ~5KB of progressive enhancement. The webui is 95% server-rendered HTML. |
| **CSS** | Hand-written CSS + CSS variables (no Tailwind, no PostCSS) | Matches the existing plan template's CSS style. Zero build step. |
| **Real-time** | Server-Sent Events (SSE) via `hono/streaming` | One-way updates are sufficient for v0.1 (server → browser). WebSocket is overkill. WebSocket is added in v0.2+ for the "send message to agent" flow (where the browser needs to write back). |
| **Database** | better-sqlite3 | Synchronous SQLite, fast, zero-config, single-file. Perfect for a single-user local app. v0.2+ might add a Postgres option for multi-user. |
| **Process management** | `node --watch` for dev; `pm2` or `systemd` for production (optional, documented but not required) | v0.1 is "open the terminal and run the command". v0.2+ adds daemon mode. |
| **Tunnel** | `cloudflared tunnel --url http://localhost:8765` | Quick tunnel, no account required for v0.1. The user just runs `bizar-remote tunnel` and gets a `https://*.trycloudflare.com` URL. (Cloudflare's "TryCloudflare" feature is free and doesn't require a Cloudflare account.) v0.2+ adds persistent named tunnels. |
| **Testing** | Vitest 1.x | Fast, ESM-native, works with TypeScript out of the box. |
| **Packaging** | `tsc` to `dist/` | No bundler. The output is a small set of JS files + a `package.json` with a `bin` entry. |

### 3.1 Why Hono (not Express, not Fastify)

- **Hono** is ~15kb, has built-in SSE and JSX support, runs anywhere (Node, Bun, Deno, Workers, edge runtimes). The TypeScript inference is excellent. It's the most modern option.
- **Express** is the default but is showing its age (ESM support is awkward, no first-class TypeScript, no built-in streaming).
- **Fastify** is fast but heavier and the ecosystem is plugin-heavy (Schemas, Pino, etc.) — overkill for v0.1.
- **Elysia** is a Bun-first alternative; we don't want a Bun-only dep.

### 3.2 Why server-rendered HTML + HTMX-style (not React, not a SPA)

- **No build step.** The webui is server-rendered HTML. No webpack, no Vite, no npm install of a 200MB toolchain.
- **Small payload.** A server-rendered page is ~5-15KB. A React SPA is 200KB+ before any app code.
- **Works without JavaScript.** The webui functions with JS disabled (the user just can't see live updates). Progressive enhancement.
- **Matches the existing plan command.** The plan viewer is a single self-contained HTML file with embedded JS. Bizar Remote follows the same pattern but with the JS in a separate file (served from `/public/`).
- **Easier to debug.** Right-click → View Source shows the actual HTML, not a `<div id="root">` shell.

The "HTMX-style" part: we use a small vanilla JS file (~5KB) that subscribes to the SSE stream and updates the DOM in place. No framework. The server is the source of truth; the client just renders updates.

### 3.3 Why SSE (not WebSocket)

For v0.1, the browser only needs to RECEIVE updates (agent started, agent finished, plan updated, comment added). SSE is perfect for this:

- One-way (server → browser).
- Built on HTTP, no upgrade handshake, no protocol overhead.
- Auto-reconnects (the browser handles reconnection automatically).
- Works through HTTP/2 multiplexing.

WebSocket is needed for the "send message to agent" flow (the browser writes back to the server). v0.1 doesn't have that flow — agents are spawned via POST `/api/projects/:id/agents`, and the user views messages via GET `/api/agents/:id/messages`. Sending a follow-up message to a running agent is a v0.2+ feature. (We can revisit SSE vs WebSocket in v0.2 when we add bidirectional.)

### 3.4 Why better-sqlite3 (not Postgres, not lowdb, not JSON files)

- **better-sqlite3** is the standard for local-only Node apps. Synchronous API is faster than async for local DB, and the perf is great.
- **Postgres** is for production multi-user. v0.1 is single-user; v0.2+ might add Postgres.
- **lowdb** is a JSON file wrapper. Fine for tiny data, but SQLite is just as easy and far more capable.
- **JSON files** (no DB) work for v0.1, but the moment we need indexes or transactions, SQLite is the right call.

The SQLite database stores:
- Session tokens (future, v0.2+).
- Audit log (every API call, every agent spawn, every plan view).
- Cached project metadata (5min TTL, refreshed on discovery).
- User preferences (theme, default project, etc.).

The plan content itself is NOT in SQLite — it's on disk in `plans/<slug>/plan.mdx`. The DB is for metadata, not content.

---

## 4. Project Layout

```
bizar-remote/                       # github.com/DrB0rk/bizar-remote
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore
├── LICENSE
├── src/
│   ├── server.ts                   # Hono app, route registration
│   ├── config.ts                   # Config loading (defaults, env, CLI flags)
│   ├── adapters/
│   │   ├── index.ts                # Adapter interface barrel
│   │   ├── plugin.ts               # BizarPluginAdapter (HTTP → opencode serve)
│   │   ├── hindsight.ts            # HindsightAdapter (MCP stdio → banks)
│   │   ├── plans.ts                # PlansAdapter (FS → plans/)
│   │   └── tunnel.ts               # TunnelAdapter (cloudflared CLI)
│   ├── routes/
│   │   ├── index.ts                # Route barrel
│   │   ├── api/
│   │   │   ├── projects.ts         # GET /api/projects
│   │   │   ├── agents.ts           # GET/POST/DELETE /api/agents
│   │   │   ├── messages.ts         # GET /api/agents/:id/messages
│   │   │   ├── plans.ts            # GET /api/plans
│   │   │   └── stream.ts           # GET /api/stream (SSE)
│   │   └── pages/
│   │       ├── index.tsx           # GET / (project list)
│   │       ├── project.tsx         # GET /p/:id (project detail)
│   │       ├── agent.tsx           # GET /a/:id (agent detail)
│   │       └── plan.tsx            # GET /plan/:project/:slug (plan view)
│   ├── components/                 # Reusable JSX components
│   │   ├── Layout.tsx
│   │   ├── ProjectCard.tsx
│   │   ├── AgentRow.tsx
│   │   ├── PlanRow.tsx
│   │   ├── StatusBadge.tsx
│   │   └── ...
│   ├── lib/
│   │   ├── discovery.ts            # Project discovery
│   │   ├── events.ts               # Event bus (EventEmitter wrapper)
│   │   ├── sse.ts                  # SSE helpers
│   │   ├── auth.ts                 # (v0.2+) auth
│   │   └── format.ts               # Date/duration formatters
│   ├── styles/
│   │   ├── reset.css
│   │   ├── tokens.css              # CSS variables
│   │   ├── layout.css
│   │   ├── components.css
│   │   └── dark.css
│   ├── public/                     # Static assets
│   │   ├── app.js                  # ~5KB vanilla JS for SSE + minor interactions
│   │   ├── favicon.svg
│   │   └── ...
│   ├── db/
│   │   ├── schema.sql              # SQLite schema
│   │   └── migrations/             # v0.1 only has the initial schema
│   └── cli/
│       ├── bin.ts                  # Entry: `bizar-remote <command>`
│       ├── init.ts                 # `bizar-remote init`
│       ├── serve.ts                # `bizar-remote serve`
│       └── tunnel.ts               # `bizar-remote tunnel`
├── tests/
│   ├── adapters/
│   │   ├── plugin.test.ts
│   │   ├── hindsight.test.ts
│   │   ├── plans.test.ts
│   │   └── tunnel.test.ts
│   ├── routes/
│   │   ├── projects.test.ts
│   │   ├── agents.test.ts
│   │   ├── messages.test.ts
│   │   └── plans.test.ts
│   ├── lib/
│   │   ├── discovery.test.ts
│   │   ├── sse.test.ts
│   │   └── format.test.ts
│   └── e2e/
│       └── spawn-and-view.test.ts
└── docs/
    ├── README.md                   # already in root
    ├── architecture.md
    ├── api.md
    ├── security.md
    └── deployment.md
```

The package has TWO entry points:

1. `bizar-remote` — the CLI (`src/cli/bin.ts`).
2. (internal) `bizar-remote/server` — the Hono app, used by the CLI and by tests.

---

## 5. Setup & CLI

### 5.1 Setup

```bash
# Install
npm install -g bizar-remote

# Initialize (creates config + discovers projects)
bizar-remote init

# Serve
bizar-remote serve

# (Optional) tunnel
bizar-remote tunnel
```

### 5.2 `init` subcommand

```bash
bizar-remote init [--config <path>] [--port <port>]
```

The `init` command:

1. Creates `~/.config/bizarharness/remote.json` (or the path passed via `--config`).
2. Sets defaults: `port: 8765`, `host: 127.0.0.1`, `logLevel: 'info'`, `cacheTtl: 300`.
3. Runs the discovery pass and writes the result to `~/.local/share/bizar-remote/cache/projects.json`.
4. Prints the discovered projects in a table.

Example output:

```
  Discovered 3 projects:
  ──────────────────────────────────────────────────────────────────────
   Project         Path                                  Plans  Banks
  ──────────────────────────────────────────────────────────────────────
   BizarHarness    /home/drb0rk/Projects/BizarHarness    5      1
   ams-studio      /mnt/c/vscode/ams-studio              2      1
   my-app          /home/drb0rk/Projects/my-app           0      1
  ──────────────────────────────────────────────────────────────────────

  ✓ Config written to /home/drb0rk/.config/bizarharness/remote.json
  ✓ Project cache written to /home/drb0rk/.local/share/bizar-remote/cache/projects.json

  Next: bizarharness remote serve
```

The config file:

```json
{
  "port": 8765,
  "host": "127.0.0.1",
  "logLevel": "info",
  "cacheTtl": 300,
  "opencode": {
    "url": "http://127.0.0.1:4096",
    "passwordEnvVar": "OPENCODE_SERVER_PASSWORD"
  },
  "tunnel": {
    "provider": "cloudflared",
    "autoStart": false
  }
}
```

### 5.3 `serve` subcommand

```bash
bizar-remote serve [--port <port>] [--host <host>] [--no-browser]
```

The `serve` command:

1. Loads the config.
2. Starts the Hono server on `127.0.0.1:8765` (or the port from `--port`).
3. Opens `http://localhost:8765/` in the default browser (unless `--no-browser` is passed).
4. Logs to stdout.
5. Stays running until Ctrl-C.

The server's stdout is human-readable:

```
  2026-06-17 14:30:00 [info] bizar-remote v0.1.0 starting
  2026-06-17 14:30:00 [info] config: /home/drb0rk/.config/bizarharness/remote.json
  2026-06-17 14:30:00 [info] discovery: 3 projects
  2026-06-17 14:30:00 [info] opencode: connected to http://127.0.0.1:4096
  2026-06-17 14:30:00 [info] hindsight: connected to 3 banks
  2026-06-17 14:30:00 [info] server: listening on http://127.0.0.1:8765
  2026-06-17 14:30:00 [info] browser: opened http://localhost:8765
```

### 5.4 `tunnel` subcommand

```bash
bizar-remote tunnel [--provider cloudflared|ngrok]
```

The `tunnel` command:

1. Verifies that the local server is running (or starts it).
2. Spawns the tunnel provider (`cloudflared tunnel --url http://localhost:8765` by default).
3. Captures the public URL from the provider's stdout.
4. Prints the URL.
5. Stays running. The user shares the URL with whoever needs access.

Example output:

```
  Starting cloudflared quick tunnel to http://localhost:8765
  Your tunnel is live at: https://random-word-random-word.trycloudflare.com
  This URL is publicly accessible. Anyone with the link can control your agents.
  Press Ctrl-C to stop the tunnel.
```

The `tunnel` command refuses to start if the local server is bound to `0.0.0.0` instead of `127.0.0.1`. (This is a safety check: the tunnel is only useful if the local server is reachable, but a `0.0.0.0` bind would expose the server to the local network regardless of the tunnel.)

### 5.5 Other subcommands

```bash
bizar-remote status           # Show local server status, port, project count
bizar-remote doctor           # Diagnostic checks: opencode reachable, hindsight reachable, ports free
bizar-remote config           # Print the current config
bizar-remote projects         # Re-run discovery and print
bizar-remote help
```

---

## 6. API Design

All endpoints are JSON unless otherwise noted. All endpoints are unauthenticated (localhost-only in v0.1). The server returns standard HTTP status codes: 200, 201, 204, 400, 404, 409, 500.

### 6.1 Project endpoints

#### `GET /api/projects`

List all discovered projects.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "projects": [
      {
        "id": "bizarharness",
        "name": "BizarHarness",
        "path": "/home/drb0rk/Projects/BizarHarness",
        "description": "Norse-pantheon multi-agent system for opencode",
        "hindsightBank": "bizarharness",
        "lastDiscovered": "2026-06-17T14:30:00.000Z",
        "stats": {
          "plans": 5,
          "agents": {
            "running": 0,
            "done": 3,
            "failed": 1
          },
          "openThreads": 4
        }
      },
      {
        "id": "ams-studio",
        "name": "AMS7 Studio",
        "path": "/mnt/c/vscode/ams-studio",
        "description": "Medical device firmware + Tauri host",
        "hindsightBank": "ams-studio",
        "lastDiscovered": "2026-06-17T14:30:00.000Z",
        "stats": {
          "plans": 2,
          "agents": {
            "running": 1,
            "done": 0,
            "failed": 0
          },
          "openThreads": 1
        }
      }
    ]
  }
}
```

#### `GET /api/projects/:id`

Get a single project with full details.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "id": "bizarharness",
    "name": "BizarHarness",
    "path": "/home/drb0rk/Projects/BizarHarness",
    "description": "Norse-pantheon multi-agent system for opencode",
    "hindsightBank": "bizarharness",
    "git": {
      "branch": "master",
      "lastCommit": "abc123",
      "isDirty": true
    },
    "config": {
      "defaultAgent": "thor",
      "model": "minimax/MiniMax-M3"
    },
    "stats": {
      "plans": 5,
      "agents": { "running": 0, "done": 3, "failed": 1 },
      "openThreads": 4
    },
    "agents": [
      {
        "instanceId": "bgr_abc123",
        "agent": "mimir",
        "status": "running",
        "startedAt": "2026-06-17T14:00:00.000Z",
        "toolCallCount": 12,
        "durationMs": 12345,
        "promptPreview": "Research the new opencode serve API…"
      }
    ],
    "plans": [
      {
        "slug": "v2-plan-feature-x",
        "title": "v2 Plan: Feature X",
        "status": "draft",
        "author": "drb0rk",
        "lastEdited": "2026-06-17T13:00:00.000Z",
        "openThreads": 4
      }
    ]
  }
}
```

### 6.2 Agent endpoints

#### `GET /api/projects/:id/agents`

List agents for a project. The `:id` is the project ID (e.g., `bizarharness`).

**Query params:**

- `status` (optional): filter by status. One of `pending`, `running`, `done`, `failed`, `killed`, `timed_out`, or `all` (default).
- `limit` (optional, default 50): max number of agents to return.
- `since` (optional, ISO timestamp): only return agents started after this.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "agents": [
      {
        "instanceId": "bgr_abc123",
        "sessionId": "ses_xyz789",
        "agent": "mimir",
        "status": "running",
        "startedAt": "2026-06-17T14:00:00.000Z",
        "completedAt": null,
        "toolCallCount": 12,
        "durationMs": 12345,
        "model": "minimax/MiniMax-M3",
        "promptPreview": "Research the new opencode serve API…",
        "resultPreview": null,
        "error": null,
        "parentAgent": "odin"
      }
    ],
    "total": 1
  }
}
```

#### `POST /api/projects/:id/agents`

Spawn a new background agent. The `:id` is the project ID.

**Request body:**

```json
{
  "agent": "mimir",
  "prompt": "Research the new opencode serve API and write a summary",
  "model": "minimax/MiniMax-M3",
  "timeoutMs": 300000
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `agent` | string | yes | — | One of `mimir`, `thor`, `tyr`, `vidarr`, etc. |
| `prompt` | string | yes | — | The prompt. **Warning:** untrusted content should not be in the prompt. |
| `model` | string | no | agent's default | Format: `providerID/modelID`. |
| `timeoutMs` | number | no | 300000 (5min) | Clamped to [1000, 1800000]. |

**Response 201:**

```json
{
  "ok": true,
  "data": {
    "instanceId": "bgr_def456",
    "sessionId": "ses_uvw012",
    "agent": "mimir",
    "status": "pending",
    "startedAt": "2026-06-17T14:35:00.000Z",
    "model": "minimax/MiniMax-M3",
    "timeoutMs": 300000
  }
}
```

**Response 400 (invalid request):**

```json
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "agent must be one of: mimir, thor, tyr, vidarr",
    "field": "agent"
  }
}
```

**Response 409 (cap reached):**

```json
{
  "ok": false,
  "error": {
    "code": "cap_reached",
    "message": "Max concurrent agents reached (8). Wait for one to finish or kill one."
  }
}
```

#### `GET /api/agents/:id`

Get a single agent's status.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "instanceId": "bgr_def456",
    "sessionId": "ses_uvw012",
    "agent": "mimir",
    "status": "done",
    "startedAt": "2026-06-17T14:35:00.000Z",
    "completedAt": "2026-06-17T14:36:30.000Z",
    "toolCallCount": 8,
    "durationMs": 90000,
    "model": "minimax/MiniMax-M3",
    "promptPreview": "Research the new opencode serve API…",
    "resultPreview": "The new opencode serve API is documented at…",
    "error": null,
    "parentAgent": "odin"
  }
}
```

#### `DELETE /api/agents/:id`

Kill a running agent.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "instanceId": "bgr_def456",
    "status": "killed",
    "completedAt": "2026-06-17T14:40:00.000Z"
  }
}
```

#### `GET /api/agents/:id/messages`

Get the conversation history of an agent. Returns the full message log from the opencode session.

**Query params:**

- `limit` (optional, default 100): max number of messages to return.
- `offset` (optional, default 0): pagination offset.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "instanceId": "bgr_def456",
    "agent": "mimir",
    "status": "done",
    "messages": [
      {
        "id": "msg_001",
        "role": "user",
        "content": "Research the new opencode serve API",
        "createdAt": "2026-06-17T14:35:00.000Z"
      },
      {
        "id": "msg_002",
        "role": "assistant",
        "content": "I'll research the opencode serve API. Let me start by looking at the source code…",
        "toolCalls": [
          {
            "id": "tool_001",
            "name": "read",
            "args": { "filePath": "/usr/local/lib/node_modules/opencode/..." },
            "result": "…",
            "status": "ok",
            "durationMs": 45
          }
        ],
        "createdAt": "2026-06-17T14:35:05.000Z"
      },
      {
        "id": "msg_003",
        "role": "assistant",
        "content": "The new opencode serve API is documented at https://…\n\nKey endpoints:\n- POST /session…",
        "toolCalls": [],
        "createdAt": "2026-06-17T14:36:30.000Z"
      }
    ],
    "total": 3
  }
}
```

#### `POST /api/agents/:id/messages` (v0.2+)

Send a follow-up message to a running agent. NOT in v0.1.

### 6.3 Plan endpoints

#### `GET /api/plans`

List all plans across all projects.

**Query params:**

- `project` (optional): filter by project ID.
- `status` (optional): filter by status (`draft`, `in-review`, `approved`, `archived`).
- `author` (optional): filter by author.
- `q` (optional): search in title and content.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "plans": [
      {
        "project": "bizarharness",
        "slug": "v2-plan-feature-x",
        "title": "v2 Plan: Feature X",
        "status": "draft",
        "author": "drb0rk",
        "lastEdited": "2026-06-17T13:00:00.000Z",
        "openThreads": 4
      },
      {
        "project": "ams-studio",
        "slug": "postmortem-2026-06-15",
        "title": "Postmortem: 2026-06-15",
        "status": "approved",
        "author": "thor",
        "lastEdited": "2026-06-15T18:00:00.000Z",
        "openThreads": 0
      }
    ],
    "total": 2
  }
}
```

#### `GET /api/plans/:project/:slug`

Get a single plan with full content.

**Response 200:**

```json
{
  "ok": true,
  "data": {
    "project": "bizarharness",
    "slug": "v2-plan-feature-x",
    "title": "v2 Plan: Feature X",
    "status": "draft",
    "author": "drb0rk",
    "created": "2026-06-16T10:00:00.000Z",
    "lastEdited": "2026-06-17T13:00:00.000Z",
    "content": "# v2 Plan: Feature X\n\n## Overview\n…",
    "meta": { ... },
    "commentCount": 7,
    "openThreadCount": 4
  }
}
```

#### `PATCH /api/plans/:project/:slug` (v0.2+)

Update a plan's meta (status, title). NOT in v0.1.

### 6.4 Streaming endpoint

#### `GET /api/stream`

Server-Sent Events. The browser subscribes once on page load and receives all subsequent events.

**Event types:**

| Event | Data | Triggered by |
|---|---|---|
| `agent.started` | `{ instanceId, project, agent, startedAt }` | Background agent spawned |
| `agent.updated` | `{ instanceId, status?, toolCallCount?, resultPreview? }` | Agent status / progress update |
| `agent.completed` | `{ instanceId, status, durationMs, toolCallCount }` | Agent finished (done/failed/killed/timed_out) |
| `plan.updated` | `{ project, slug, lastEdited? }` | Plan edited |
| `plan.status` | `{ project, slug, status }` | Plan status changed |
| `project.discovered` | `{ project, stats }` | New project discovered |
| `heartbeat` | `{}` | Every 30s (keep-alive) |

**Example event stream:**

```
event: agent.started
data: {"instanceId":"bgr_def456","project":"bizarharness","agent":"mimir","startedAt":"2026-06-17T14:35:00.000Z"}

event: agent.updated
data: {"instanceId":"bgr_def456","status":"running","toolCallCount":3}

event: agent.completed
data: {"instanceId":"bgr_def456","status":"done","durationMs":90000,"toolCallCount":8}

event: heartbeat
data: {}

```

### 6.5 Page routes (server-rendered HTML)

| Route | Purpose | Renders |
|---|---|---|
| `GET /` | Project list | `pages/index.tsx` — list of all projects with stats |
| `GET /p/:id` | Project detail | `pages/project.tsx` — agents + plans for a project |
| `GET /a/:instanceId` | Agent detail | `pages/agent.tsx` — full message history of an agent |
| `GET /plan/:project/:slug` | Plan view | `pages/plan.tsx` — read-only plan viewer (links to the local plan server) |
| `GET /agents` | All agents | `pages/agents.tsx` — flat list of all agents across all projects |
| `GET /plans` | All plans | `pages/plans.tsx` — flat list of all plans across all projects |
| `GET /settings` | Settings | `pages/settings.tsx` — config, theme, etc. |

The plan view is a read-only embedded view of the plan's MDX. The plan server (`127.0.0.1:4321`) is the canonical editor; the Bizar Remote webui is for browsing. Editing a plan from Bizar Remote is v0.2+ (it'll link to the local plan server's URL with a `?open=editor` query param).

### 6.6 API error format

All errors return a consistent JSON shape:

```json
{
  "ok": false,
  "error": {
    "code": "agent_not_found",
    "message": "Agent 'bgr_invalid' not found.",
    "details": {
      "instanceId": "bgr_invalid"
    }
  }
}
```

| Code | HTTP | Meaning |
|---|---|---|
| `bad_request` | 400 | Request body is invalid |
| `unauthorized` | 401 | (v0.2+) auth required |
| `forbidden` | 403 | (v0.2+) auth fails |
| `not_found` | 404 | Resource doesn't exist |
| `conflict` | 409 | Cap reached, name conflict, etc. |
| `internal` | 500 | Server error |
| `upstream_unavailable` | 502 | opencode serve / Hindsight MCP is down |
| `upstream_timeout` | 504 | opencode serve / Hindsight MCP timed out |

---

## 7. WebUI Pages (Server-Rendered HTML)

### 7.1 `GET /` — Project list

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Bizar Remote · localhost:8765                              [🌙 Dark] [⚙]   │
│  3 projects · 1 running agent · 14 open threads                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  BizarHarness                                                  [📂 Open ↗] │
│  /home/drb0rk/Projects/BizarHarness · bank: bizarharness · master (dirty)  │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ Agents: 0 running, 3 done, 1 failed                                  │ │
│  │ Plans: 5 (2 drafts, 1 in-review, 2 approved)                         │ │
│  │ Threads: 4 unresolved                                                │ │
│  │ Recent agents:                                                        │ │
│  │   ● bgr_abc123  mimir  done  2h ago    Research the opencode API     │ │
│  │   ● bgr_def456  thor   done  1d ago    Implement plan spec v2        │ │
│  │ Recent plans:                                                         │ │
│  │   ● draft      v2-plan-feature-x           2h ago   4 open threads    │ │
│  │   ◐ in-review  plugin-v0.4.2-audit        1d ago   1 open thread     │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│  AMS7 Studio                                                   [📂 Open ↗] │
│  /mnt/c/vscode/ams-studio · bank: ams-studio · main (clean)               │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ Agents: 1 running, 0 done, 0 failed                                  │ │
│  │ Plans: 2 (1 drafts, 0 in-review, 1 approved)                         │ │
│  │ Threads: 1 unresolved                                                │ │
│  │ Running agents:                                                       │ │
│  │   ● bgr_ghi789  thor  running  2m ago  8 tool calls  Implement Tauri│ │
│  └──────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────────┤
│  [↻ Refresh]  [🚇 Tunnel]  [⚙ Settings]  [⏻ Quit]                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

The page is server-rendered HTML. The browser's SSE subscription updates the "running" status, the "tool call count", and the "result preview" in real time.

### 7.2 `GET /a/:instanceId` — Agent detail

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← back to projects   bgr_abc123  mimir  ✓ done  2h ago                    │
│  model: minimax/MiniMax-M3 · 8 tool calls · 90s                             │
│  parent: odin                                                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  Prompt:                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Research the new opencode serve API and write a summary.             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Conversation:                                                                │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ 👤 user · 14:00:00                                                  │  │
│  │ Research the new opencode serve API and write a summary.              │  │
│  │                                                                       │  │
│  │ 🤖 assistant · 14:00:05                                              │  │
│  │ I'll research the opencode serve API.                                │  │
│  │ [read /usr/local/lib/node_modules/opencode/dist/serve.js] 45ms ok    │  │
│  │ [read /usr/local/lib/node_modules/opencode/dist/types.gen.d.ts] 32ms │  │
│  │ The new opencode serve API is documented at https://…                │  │
│  │                                                                       │  │
│  │ Key endpoints:                                                        │  │
│  │ - POST /session                                                       │  │
│  │ - POST /session/:id/prompt_async                                      │  │
│  │ - GET /event?directory=…                                              │  │
│  │                                                                       │  │
│  │ 🤖 assistant · 14:01:30 (final)                                      │  │
│  │ I've summarized the API. See the full report below.                   │  │
│  │ [read /tmp/notes.md]                                                  │  │
│  │ [write /home/drb0rk/notes/opencode-serve-summary.md] 1.2kb           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  Result preview:                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ The new opencode serve API is documented at…                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  [🔄 Re-spawn]  [🗑 Delete history]  [📋 Copy prompt]  [📋 Copy result]    │
└─────────────────────────────────────────────────────────────────────────────┘
```

For `running` agents, the conversation updates live via SSE.

### 7.3 `GET /plan/:project/:slug` — Plan view

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ← back to projects   v2-plan-feature-x  ● draft   @drb0rk   2h ago        │
│  project: bizarharness                                                       │
│  [↗ Open in editor]  (opens http://127.0.0.1:4321/feature-x/)              │
├─────────────────────────────────────────────────────────────────────────────┤
│  # v2 Plan: Feature X                                                       │
│                                                                             │
│  ## Overview                                                                 │
│  This plan describes the v2 of feature X. It builds on v1 with:             │
│  - status badges                                                            │
│  - callouts                                                                 │
│  - mermaid diagrams                                                         │
│                                                                             │
│  ## Goals                                                                    │
│  ☐ Goal 1                                                                   │
│  ☐ Goal 2                                                                   │
│                                                                             │
│  ## Diagram                                                                  │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │  A[Client] ──▶ B[Server] ──▶ C[DB]                                  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ## Open Questions                                                           │
│  1. Question 1                                                                │
│  2. Question 2                                                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

The plan view is **read-only**. Editing happens in the local plan server (linked from the "Open in editor" button).

### 7.4 The `app.js` client

A single ~5KB vanilla JS file (`src/public/app.js`) does the following:

1. On page load, opens an `EventSource` to `/api/stream`.
2. Listens for `agent.started`, `agent.updated`, `agent.completed`, `plan.updated`, `plan.status`, `project.discovered` events.
3. For each event, finds the relevant DOM element and updates it.
4. For `running` agents, periodically polls `GET /api/agents/:id` for the latest tool call count and result preview (the SSE event for `agent.updated` is fired by the server, but the server also polls the opencode serve every 2s and emits an event on change).

The JS file is included in every page via `<script src="/app.js" defer></script>`. It uses no framework; it's a few hundred lines of vanilla JS with a single `updateAgentRow(instanceId, data)` function and a few event handlers.

---

## 8. Security Model

### 8.1 v0.1: localhost-only, no auth

- The server binds to `127.0.0.1` (or `::1` for IPv6 localhost). It never binds to `0.0.0.0`.
- All endpoints are unauthenticated. The server is reachable only from the local machine.
- The `tunnel` subcommand is the only way to expose the server externally. It uses Cloudflare's quick tunnel (`*.trycloudflare.com`), which is publicly accessible but only via the tunnel URL.
- No secrets are stored on disk. The `OPENCODE_SERVER_PASSWORD` is read from the env var (passed through to the Bizar plugin HTTP calls).

### 8.2 v0.2: optional auth for tunneled access

When the tunnel is enabled, the server generates a random `BIZAR_REMOTE_TOKEN` (32 bytes, base64) and prints it. The user must include this token in all requests:

```
Authorization: Bearer <token>
```

OR a `?token=<token>` query param for SSE subscriptions (since `EventSource` can't set headers).

The webui prompts for the token on first load (stored in `localStorage` after that).

### 8.3 v0.3: full auth with JWT, multi-user

- A real auth flow: user signs up, gets a token, the local server validates the token against the cloud (or against a local SQLite user table).
- Multi-user: the webui shows a "Switch user" menu.
- The local server still binds to 127.0.0.1; auth is for the tunnel.

### 8.4 Threat model

| Threat | Mitigation |
|---|---|
| **Local attacker** (someone with shell access on the machine) | Out of scope. If someone has shell access, they have full control. The local server doesn't add risk. |
| **Network attacker** (someone on the local network) | v0.1: server binds to 127.0.0.1; not reachable. v0.2+: tunnel requires a token. |
| **Tunnel URL leak** (user shares the URL accidentally) | v0.2+: token-based auth. v0.1: the URL is the only auth, and it's long enough to be unguessable. v0.3+: short-lived tokens. |
| **opencode serve compromise** | The local Bizar plugin's `opencode serve` is already authenticated with a random password (per the v0.4.1 spec). The Bizar Remote server uses this password. The attacker would need to read the env var. |
| **Hindsight MCP compromise** | Out of scope for v0.1. The Hindsight MCP is a local service. v0.3+ might add a separate auth layer. |
| **Prompt injection via webui** | The webui displays agent results but does not allow the user to inject prompts directly into a running agent (in v0.1). v0.2+ will need to sanitize any user-provided prompt before sending it to the opencode session. |
| **Denial of service** | The server has a max-connection limit (default 100) and a request-rate limit (default 10 req/s per IP). v0.1 is localhost-only so DoS is a non-issue; v0.2+ adds the limits. |

### 8.5 What the server does NOT do

- The server does NOT store the user's prompts or results. All agent data lives in the opencode session DB and the Bizar plugin's BackgroundState files. The server only READS from these.
- The server does NOT send telemetry. No analytics, no error reporting, no usage data.
- The server does NOT call any external service (other than the opencode serve and the Hindsight MCP, which are local). The tunnel is opt-in.

---

## 9. Setup Steps (User Perspective)

The user follows these steps to get the v0.1 webui running:

```bash
# 1. Install
npm install -g bizar-remote

# 2. Make sure BizarHarness is installed and the plugin is running
#    (opencode serve is running on 127.0.0.1:4096)
#    (the Bizar plugin's BackgroundState files are at ~/.cache/bizarharness/bg/)

# 3. Initialize
bizar-remote init
# → discovers projects, writes config

# 4. Serve
bizar-remote serve
# → starts the webui on http://localhost:8765
# → opens browser automatically

# 5. (Optional) Tunnel for remote access
bizar-remote tunnel
# → starts cloudflared
# → prints the public URL

# 6. Use it
# → open http://localhost:8765 in browser
# → see all projects, all running agents, all plans
# → spawn new agents, kill agents, view plan content
```

---

## 10. Why Option C is the Right Starting Point

Re-emphasizing the architecture decision:

**Option C (pure local, with optional tunnel) is the right starting point for v0.1** because:

1. **Local-first aligns with BizarHarness's ethos.** The agent runtime is local. The plan server is local. The control surface should also be local. The "remote" name is aspirational.
2. **Zero setup.** The user runs one command and gets a working webui. No accounts, no API keys, no cloud dependencies.
3. **No privacy concerns.** A localhost-only webui has no privacy implications. The user can use it to view agent prompts and results without worrying about data leaving their machine.
4. **Tunnel is opt-in.** If the user wants remote access, they explicitly run `bizar-remote tunnel`. There's no "phone-home" by default.
5. **v0.3+ can add the hosted version.** The local-first architecture doesn't preclude a future `bizar.dev` hosted offering. In fact, the local-first approach lets us iterate on the API and UI before launching a hosted product, with a much smaller team and no compliance burden.
6. **Matches the user's instinct.** The user explicitly said "Option C with optional tunnel support (via Cloudflare Tunnel integration) is the right starting point." Confirmed.

The local webui is the **only** v0.1 deliverable. Everything else (auth, multi-user, hosted control plane) is v0.2+.

---

## 11. Future (v0.2+)

### 11.1 v0.2 (3-6 months after v0.1)

- **Auth.** Token-based for tunnel access. User generates a token with `bizar-remote token` and includes it in the URL or `Authorization` header.
- **Send message to agent.** Bidirectional flow: the browser can send a follow-up prompt to a running agent. WebSocket for the bidirectional stream.
- **Plan editing.** Open a plan in the local plan server (`http://127.0.0.1:4321/<slug>/`) via a "Edit" button.
- **Mobile-friendly layout.** The webui works on small screens.
- **Dark/light theme toggle.** Stored in `localStorage`.

### 11.2 v0.3 (6-12 months after v0.1)

- **Multi-user.** Multiple users can have separate Bizar Remote instances on the same machine. Each gets their own port and their own SQLite DB.
- **Hosted control plane (`bizar.dev`).** Users can sign up, install the `bizar-remote` agent on their machines, and control their agents from `bizar.dev` without running a local server. The local agent "phones home" over WebSocket. This is the Option A path.
- **End-to-end encryption.** Local agent encrypts prompts/results before sending to the cloud. The cloud can only see metadata (agent name, status, duration).
- **Audit log.** Every action (spawn, kill, view, edit) is logged to a tamper-evident log.

### 11.3 v0.4+ (12+ months after v0.1)

- **Mobile app.** React Native or native Swift/Kotlin. Reuses the same API.
- **Desktop app.** Tauri or Electron. Reuses the same webui.
- **Slack/Discord integration.** `/bizar status` slash command. Channel notifications when agents finish.
- **Webhook support.** `bizar-remote webhook add https://example.com/hook --event agent.completed`.
- **Per-project or per-user billing** (for the hosted version).
- **Mobile push notifications** (via APNs / FCM).
- **CLI completion.** The `bizar-remote` CLI has shell completions for bash, zsh, fish.

---

## 12. Scaffolding Plan (This Session)

The user asked us to start setting up the foundation. We do the following in this session:

### 12.1 New repo

- Create a new repo at `github.com/DrB0rk/bizar-remote` (private for now).
- Add a README, LICENSE (MIT), .gitignore.

### 12.2 Project structure

Create the following files in the new repo (or in a `bizar-remote-scaffold/` folder in the main BizarHarness repo, to be moved later):

```
bizar-remote-scaffold/
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore
├── LICENSE
├── src/
│   ├── server.ts                # Hono app (skeleton, with route stubs)
│   ├── config.ts                # Config loader
│   ├── adapters/
│   │   ├── index.ts
│   │   └── hindsight.ts         # The ONE adapter we implement
│   ├── routes/
│   │   ├── index.ts
│   │   └── api/
│   │       └── projects.ts      # The ONE endpoint we implement
│   ├── cli/
│   │   ├── bin.ts               # Entry: `bizar-remote <command>`
│   │   ├── init.ts
│   │   └── serve.ts
│   ├── lib/
│   │   └── discovery.ts
│   ├── styles/
│   │   ├── reset.css
│   │   └── tokens.css
│   └── public/
│       └── app.js
├── tests/
│   └── routes/
│       └── projects.test.ts
└── docs/
    ├── architecture.md
    └── api.md
```

### 12.3 The ONE proof-of-concept endpoint

We implement `GET /api/projects` — it returns the list of projects from Hindsight banks. This is the foundation; everything else is built on top of it.

The implementation:

1. `src/adapters/hindsight.ts` — calls the Hindsight MCP via stdio, lists all banks, returns them as `Project[]`.
2. `src/lib/discovery.ts` — uses the Hindsight adapter to discover projects, merges with a FS scan, caches the result.
3. `src/routes/api/projects.ts` — Hono route handler that returns `GET /api/projects`.
4. `tests/routes/projects.test.ts` — unit tests with a mock Hindsight adapter.

This is a 2-4 hour task. We don't implement any of the other endpoints, the webui pages, the SSE, or the tunnel. We just lay the foundation.

### 12.4 README

The README explains:
- What `bizar-remote` is.
- How to install (`npm install -g bizar-remote`).
- The three setup steps (`init`, `serve`, `tunnel`).
- The v0.1 scope (local-only, single-user, no auth).
- A link to the full spec (`docs/architecture.md`, `docs/api.md`).
- A "Status: scaffold / v0.1 in progress" notice.

### 12.5 Architecture doc

`docs/architecture.md` — a copy of the architecture section of this spec, simplified for the public README.

### 12.6 API doc

`docs/api.md` — a copy of the API design section, with full request/response examples.

### 12.7 What we do NOT do in this session

- We do NOT implement any endpoint other than `GET /api/projects`.
- We do NOT implement the webui pages.
- We do NOT implement the SSE stream.
- We do NOT implement the tunnel integration.
- We do NOT implement the CLI subcommands other than `serve` (no `init`, no `tunnel`, no `status`, no `doctor`).
- We do NOT publish the package to npm.
- We do NOT push to the new GitHub repo.
- We do NOT commit anything.

The user said: "Don't implement the full system — just the foundation." This is the foundation.

---

## 13. File Structure Summary

### 13.1 New files (scaffolding only, in this session)

```
BizarHarness/bizar-remote-scaffold/      # temporary, to be moved to its own repo
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore
├── LICENSE
├── src/
│   ├── server.ts
│   ├── config.ts
│   ├── adapters/
│   │   ├── index.ts
│   │   └── hindsight.ts
│   ├── routes/
│   │   ├── index.ts
│   │   └── api/
│   │       └── projects.ts
│   ├── cli/
│   │   ├── bin.ts
│   │   ├── init.ts
│   │   └── serve.ts
│   ├── lib/
│   │   └── discovery.ts
│   ├── styles/
│   │   ├── reset.css
│   │   └── tokens.css
│   └── public/
│       └── app.js
├── tests/
│   └── routes/
│       └── projects.test.ts
└── docs/
    ├── architecture.md
    └── api.md
```

### 13.2 The full v0.1 (future work)

The full v0.1 is the entire project layout in §4, with all the routes, adapters, and CLI subcommands implemented. This is a 2-4 week effort after the scaffold.

---

## 14. Test Plan

### 14.1 Unit tests (scaffold)

- `adapters/hindsight.test.ts` — mock the Hindsight MCP, verify the adapter returns the expected `Project[]`.
- `lib/discovery.test.ts` — verify the discovery merges Hindsight banks with FS-scanned projects.
- `routes/api/projects.test.ts` — call the route with a mock Hindsight adapter, verify the response.
- `cli/serve.test.ts` — verify the CLI starts the server on the configured port.

### 14.2 Integration tests (scaffold)

In a dev sandbox:

1. Run `bizar-remote init` with a real Hindsight MCP (e.g., the `bizarharness` bank).
2. Verify `~/.config/bizarharness/remote.json` is written.
3. Verify `~/.local/share/bizar-remote/cache/projects.json` is written with the discovered projects.
4. Run `bizar-remote serve`.
5. `curl http://localhost:8765/api/projects` returns the project list.
6. `curl http://localhost:8765/` returns the project list HTML.
7. Kill the server with Ctrl-C.

### 14.3 Manual tests

- Open the webui in a browser, verify the project list renders.
- Click on a project, verify the project detail page loads.
- (Future) Spawn an agent, verify the SSE updates the UI.
- (Future) Use a tunnel, verify the URL is accessible from another device on the same network.

### 14.4 Future v0.1 tests

(For the full v0.1, not the scaffold.)

- All endpoints return the documented shapes.
- SSE events fire correctly.
- Tunnel integration works.
- Discovery is stable across restarts.
- Concurrent requests don't crash the server.
- The SQLite DB is created with the right schema on first run.
- The CSS is responsive at 320px, 768px, 1280px, 1920px.

---

## 15. Open Questions

1. **What is the exact Hindsight MCP API for listing banks?** Is it `hindsight_list_banks` (which I see in the system's available tools)? Or is there a different method? The v0.1 scaffold implements this, but the real implementation needs the verified API. — **Lean: use `hindsight_list_banks` from the MCP, which is already available.**

2. **Discovery from where?** We said "Hindsight banks + filesystem scan for `package.json` with `.bizar/`". But BizarHarness is one project; the user might have 10+ projects in `~/Projects/`. Should we walk the entire `~/Projects/` directory? Or should the user configure a list of project paths in `remote.json`? — **Lean: walk `~/Projects/` (configurable via `remote.json.projectsRoot`) and look for any directory with a `package.json` and a `.bizar/` folder. This matches the user's mental model.**

3. **Hindsight MCP transport.** Is it stdio (subprocess) or HTTP? In the BizarHarness skill, the system shows MCP tools. The v0.1 scaffold needs to know whether to spawn the MCP server as a subprocess (stdio) or connect to it over HTTP. — **Lean: check the opencode config for the Hindsight MCP transport. If stdio, use `child_process.spawn`. If HTTP, use `fetch`.**

4. **Naming: "bizar-remote" or "bizar-remote" (with hyphen).** The user wrote "bizar remote" (with a space) in the spec, but npm package names can't have spaces. The natural name is `bizar-remote`. The CLI binary is `bizar-remote` (or could be `bizar-remote-webui` for clarity). — **Lean: package `bizar-remote`, CLI binary `bizar-remote`.**

5. **The webui in the browser** — is it OK to use Hono JSX server-side, or should we use a separate templating engine? Hono JSX is React-like but compiles to strings. — **Lean: Hono JSX. It's a first-class Hono feature, no build step, no React dep.**

6. **Persist settings in `~/.config/bizarharness/remote.json` or `~/.config/bizar-remote/config.json`?** The `bizarharness` folder is shared; `bizar-remote` is a separate package. — **Lean: `~/.config/bizarharness/remote.json`. The remote is a sibling of the agent runtime, and reusing the `bizarharness` config dir makes the install cleaner (one folder for everything).**

7. **Audit log: SQLite or append-only file?** SQLite is queryable but a single point of failure. Append-only file is more durable but harder to query. — **Lean: SQLite. The audit log is for the user; they can `rm` it if it gets too large. v0.2+ might switch to a structured append-only log.**

8. **Should `bizar-remote` depend on the BizarHarness npm package, or should it be standalone?** If standalone, it duplicates some code (config loading, log formatting). If dependent, it adds a 25MB dep to a tool that should be lightweight. — **Lean: standalone. Duplicate ~200 lines of code. The shared types can be vendored.**

9. **What's the relationship to the opencode serve?** The Bizar plugin already runs `opencode serve` on 127.0.0.1:4096. `bizar-remote` connects to it. But what if the user has multiple opencode instances? — **Lean: v0.1 supports one opencode serve (the one started by the Bizar plugin). v0.2+ adds support for multiple instances.**

10. **Tunnel auth in v0.1** — should the tunnel require a token, or is the URL alone enough? The URL is `https://random-word-random-word.trycloudflare.com` which is unguessable. — **Lean: v0.1 has NO tunnel auth. The URL is the only auth. v0.2 adds token-based auth.**

11. **Static files — should we serve them from the Hono server, or use a separate static server?** Hono has `serveStatic` middleware that works for v0.1. — **Lean: Hono's `serveStatic`. No separate static server.**

12. **Will the opencode HTTP API require auth in v0.1?** Per the Bizar plugin v0.4.1 spec, `opencode serve` requires `OPENCODE_SERVER_PASSWORD` as a Basic auth header. The Bizar Remote server needs to read this env var (or the user configures it in `remote.json`). — **Lean: read from `OPENCODE_SERVER_PASSWORD` env var, fall back to the config field. Document the requirement.**

13. **Should `bizar-remote` be MIT-licensed, or something more restrictive?** BizarHarness is MIT. — **Lean: MIT. Matches the parent project.**

14. **The `bizar-remote` repo — is it `github.com/DrB0rk/bizar-remote`?** — **Lean: yes. (User has GitHub SSH access confirmed.)**

15. **Where does the scaffold go in this session?** The user said "you can create a `bizar-remote-scaffold/` folder in the main repo with the basic structure, and we'll move it to its own repo later." — **Lean: `BizarHarness/bizar-remote-scaffold/`. The user moves it later. We do not commit it (per the user's "DO NOT" list).**

---

## 16. Implementation Order

This is the order of work for the FULL v0.1 (not the scaffold). Total: 4-6 weeks of work.

1. **Tyr:** Scaffold (this session). Repo, README, package.json, tsconfig, Hono skeleton, ONE endpoint (`GET /api/projects`), ONE adapter (Hindsight), ONE test. (~3-4h)
2. **Thor:** Add the rest of the adapters (plugin, plans, tunnel) and the discovery merge logic. (~2d)
3. **Thor:** Add the rest of the project + agent + plan + messages endpoints. (~3d)
4. **Tyr:** Add the SSE event bus and the `/api/stream` endpoint. (~1d)
5. **Thor:** Add the webui pages (project list, project detail, agent detail, plan view). Server-rendered HTML with Hono JSX. (~3d)
6. **Thor:** Add the `app.js` client-side script for SSE. (~1d)
7. **Tyr:** Add the CLI subcommands (`init`, `serve`, `tunnel`, `status`, `doctor`, `config`, `projects`). (~1d)
8. **Thor:** Add CSS, theme, responsive layout. (~1d)
9. **Tyr:** Add the SQLite schema and migrations. (~0.5d)
10. **Tyr:** Add comprehensive tests (unit + integration). (~2d)
11. **Heimdall:** Write the docs (`README`, `docs/architecture.md`, `docs/api.md`, `docs/security.md`, `docs/deployment.md`). (~1d)
12. **Forseti:** Audit pass on the spec and the implementation. (~1d)
13. **Tyr + Thor:** End-to-end manual testing. (~2d)
14. **Tyr:** Publish to npm as `bizar-remote@0.1.0`. (~0.5d)

Total: ~17 days, split across Tyr, Thor, Heimdall, Forseti.

---

## 17. Estimated Effort

| Phase | Owner | LOC | Hours |
|---|---|---|---|
| Scaffold (this session) | Tyr | ~500 | 3-4h |
| Adapters + discovery | Thor | ~800 | 16h |
| API endpoints | Thor | ~1200 | 24h |
| SSE event bus | Tyr | ~400 | 8h |
| Webui pages | Thor | ~1500 | 24h |
| Client-side JS | Thor | ~200 | 8h |
| CLI subcommands | Tyr | ~600 | 8h |
| CSS + theme | Thor | ~600 | 8h |
| SQLite + migrations | Tyr | ~300 | 4h |
| Tests | Tyr + Thor | ~2500 | 16h |
| Docs | Heimdall | ~2000 | 8h |
| Forseti audit | Forseti | — | 8h |
| Manual testing | Tyr + Thor | — | 16h |
| npm publish | Tyr | — | 4h |
| **Total v0.1** | | **~10,600** | **~155h (≈4 weeks)** |

The scaffold (this session) is ~500 LOC and ~3-4h.

---

## 18. Release Criteria (v0.1)

A v0.1 build is releasable ONLY if ALL of the following hold:

1. `bizar-remote init` discovers projects and writes the config.
2. `bizar-remote serve` starts the webui on `127.0.0.1:8765`.
3. The webui shows the project list at `http://localhost:8765/`.
4. The webui shows the project detail at `http://localhost:8765/p/:id`.
5. The webui shows the agent list and per-project agent view.
6. The webui shows the plan list and per-project plan view.
7. The SSE stream delivers `agent.started`, `agent.updated`, `agent.completed`, `plan.updated` events.
8. The CLI can spawn a new background agent via `POST /api/projects/:id/agents`.
9. The CLI can kill a running agent via `DELETE /api/agents/:id`.
10. The CLI can view an agent's messages via `GET /api/agents/:id/messages`.
11. `bizar-remote tunnel` starts a Cloudflare quick tunnel and prints the URL.
12. The server binds to `127.0.0.1` only. It refuses to start if `--host 0.0.0.0` is passed.
13. The server has no external network requests (other than the opencode serve and Hindsight MCP, which are local).
14. The CLI is published to npm as `bizar-remote@0.1.0`.
15. The README explains the install + setup + usage.
16. The `docs/architecture.md` and `docs/api.md` are written.
17. All unit tests pass.
18. The integration test in the BizarHarness-dev sandbox passes.
19. Forseti audit passes.
20. The webui works in Chrome, Firefox, and Safari (latest stable).
