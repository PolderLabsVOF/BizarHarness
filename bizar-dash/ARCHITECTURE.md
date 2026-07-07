# bizar-dash/ — Architecture

> The dashboard server + React UI. This module is Layer 1 (UI) and
> communicates with the plugin via HTTP/WS. It also embeds ClineCore
> in-process for background-agent spawning. See
> [docs/architecture.md](../docs/architecture.md) for the layer
> model.

## Top-level layout

```
bizar-dash/
├── src/
│   ├── server/
│   │   ├── index.mjs              # Express server entry
│   │   ├── bg-spawner.mjs         # Background agent spawner (ClineCore in-process)
│   │   ├── cline-sdk.mjs          # SDK wrapper (legacy compat)
│   │   ├── serve-info.mjs         # Serve-info file IO
│   │   ├── tasks-store.mjs        # Per-project task storage
│   │   ├── memory-store.mjs       # Obsidian markdown vault
│   │   ├── memory-schema.mjs      # Memory note schema validation
│   │   ├── memory-secrets.mjs     # Secret scanner
│   │   ├── memory-git.mjs         # Memory vault git ops
│   │   ├── memory-lightrag.mjs    # Semantic search (optional)
│   │   ├── memory-config.mjs      # Memory config
│   │   ├── memory-obsidian.mjs    # Obsidian-style read API
│   │   ├── memory-sync.mjs        # Memory sync
│   │   ├── memory-conflicts.mjs   # Memory conflict resolution
│   │   ├── memory-path-safety.mjs # Memory path safety
│   │   ├── memory-cli.mjs         # Memory CLI commands
│   │   ├── memory-protocol-drift.mjs # Memory protocol drift detection
│   │   ├── activity-log.mjs       # Activity log
│   │   ├── auth.mjs               # Auth
│   │   ├── otel.mjs               # OpenTelemetry
│   │   ├── metrics.mjs            # Metrics
│   │   ├── diagnostics-store.mjs  # Diagnostics
│   │   ├── obsidian-store.mjs     # Obsidian store
│   │   ├── settings-store.mjs     # Settings store
│   │   ├── background-store.mjs   # Background state
│   │   ├── agents-store.mjs       # Agents store
│   │   ├── backup-store.mjs       # Backups
│   │   ├── dialog-store.mjs       # Dialog state
│   │   ├── dialog-poller.mjs      # Dialog polling
│   │   ├── search-store.mjs       # Search index
│   │   ├── providers-store.mjs    # Provider catalog
│   │   ├── plan-delegator.mjs     # Task → agent delegator
│   │   ├── task-delegator.mjs     # Task delegator
│   │   ├── cline-runner.mjs       # Cline runner
│   │   ├── cline-sdk.mjs          # Cline SDK wrapper
│   │   ├── v2-auth-file.mjs       # v2 auth file
│   │   ├── v2-event-bus.mjs       # v2 event bus
│   │   └── routes/                # REST API routes
│   │       ├── memory.mjs
│   │       ├── tasks.mjs
│   │       ├── background.mjs
│   │       ├── overview.mjs
│   │       ├── projects.mjs
│   │       ├── history.mjs
│   │       ├── settings.mjs
│   │       ├── providers.mjs
│   │       ├── env-vars.mjs
│   │       ├── usage.mjs
│   │       ├── update.mjs
│   │       ├── lightrag.mjs
│   │       ├── opencode-sessions.mjs
│   │       ├── opencode-session-detail.mjs
│   │       ├── doctor.mjs
│   │       ├── dialogs.mjs
│   │       ├── artifacts.mjs
│   │       ├── agents.mjs
│   │       ├── memory.mjs
│   │       ├── agents.mjs
│   │       ├── chat.mjs
│   │       ├── cline-sessions.mjs
│   │       ├── cline-session-detail.mjs
│   │       ├── config.mjs
│   │       ├── artifacts.mjs
│   │       ├── chat.mjs
│   │       └── misc.mjs
│   └── web/
│       ├── App.tsx                # Root shell + WS routing (v6.0.0)
│       ├── MobileApp.tsx          # Mobile root shell
│       ├── views/                 # Page-level views (17)
│       │   ├── Overview.tsx
│       │   ├── Chat.tsx
│       │   ├── Agents.tsx
│       │   ├── Artifacts.tsx       # Glyphs
│       │   ├── Tasks.tsx           # 5-column kanban + team badge
│       │   ├── Activity.tsx
│       │   ├── BackgroundAgents.tsx # Live BG agent viewer
│       │   ├── Skills.tsx
│       │   ├── Memory.tsx
│       │   ├── Mods.tsx
│       │   ├── Marketplace.tsx
│       │   ├── Schedules.tsx
│       │   ├── History.tsx
│       │   ├── MiniMaxUsage.tsx
│       │   ├── Eval.tsx
│       │   ├── Doctor.tsx
│       │   ├── Harness.tsx         # v6.0.0 — 73/73 audit
│       │   └── Settings.tsx
│       ├── components/             # Reusable components (~50)
│       │   ├── Topbar.tsx          # 17-tab nav + Cline runtime badge (v6.0.0)
│       │   ├── Sidebar.tsx
│       │   ├── Modal.tsx
│       │   ├── Toast.tsx
│       │   ├── SearchModal.tsx
│       │   ├── Notifications.tsx
│       │   ├── CommandDialog.tsx
│       │   ├── Card.tsx
│       │   ├── Button.tsx
│       │   ├── Tag.tsx
│       │   ├── Spinner.tsx
│       │   ├── SettingsNav.tsx
│       │   ├── StatusBadge.tsx
│       │   └── ... (~40 more)
│       ├── hooks/                 # React hooks
│       ├── lib/                    # API client + types
│       └── styles/                # CSS (~10 files)
├── scripts/                       # smoke-bg-retry.mjs
├── styles/                        # CSS (legacy)
└── tests/                         # bun:test + vitest (~150 files)
```

## Public contract

The dashboard listens on `BIZAR_DASHBOARD_PORT` (default 4321).
It exposes:

- `GET  /api/snapshot` — full state for the UI
- `GET  /api/agents` — registered agents
- `POST /api/background` — spawn a background agent
- `POST /api/background/:id/steer` — mid-flight steer
- `POST /api/background/:id/pause` / `resume`
- `DELETE /api/background/:id` — kill
- `GET  /api/tasks` — list tasks (kanban)
- `POST /api/tasks` — create task
- `PATCH /api/tasks/:id/status` — move task between columns
- `WS   /ws` — server-sent events for live updates
- `GET  /api/doctor/health` — health endpoint (Harness view consumes)

## Tabs (17, v6.0.0)

| Tab | Description |
| --- | --- |
| `overview` | Status cards, recent activity, project selector |
| `chat` | 3-column chat (rail / thread / info) |
| `agents` | Agent roster, dispatch visualization |
| `glyphs` | Glyph artifact viewer |
| `tasks` | 5-column kanban + team badge |
| `activity` | Activity feed |
| `active` | Live BG agent viewer (5s poll + WS) |
| `skills` | Skills browser (bizar-dash/skills/*) |
| `memory` | Memory subsystem (4 sources + config) |
| `mods` | Mod manager |
| `schedules` | Cron schedules |
| `history` | Session history |
| `usage` | MiniMax Usage (hand-rolled SVG chart) |
| `eval` | Eval framework |
| `doctor` | System health + diagnostics |
| `harness` | **NEW v6.0.0** — 73/73 audit + make targets |
| `settings` | Settings (theme, network, agent, etc.) |

## Key invariants

- Dashboard must NOT re-implement ClineCore features (use
  `@cline/core`).
- Background spawner uses ClineCore in-process (not `cline serve`).
- Kanban board consumes `tasks:change` + `tasks:delete` WS
  events.
- Memory store is on disk at `~/.bizar_memory/` (shared with
  the plugin).
- Express order matters: `/tasks/bulk` and `/tasks/submit`
  MUST be declared before `/tasks/:id` so the literal segment
  isn't captured as an `:id` parameter.

## Verification

- `make check` — TS compile + tests
- `make e2e` — exercises the dashboard's kanban board via the
  `Tasks.tsx` view against the `/api/tasks` REST endpoints
- `make clean-check` — 5-dimension clean-state check

## v6.0.0 highlights

- **Cline runtime badge in topbar** (pulsing purple)
- **Harness tab** — 73/73 audit, subsystem status, make targets
- **Tasks kanban team badge** — tasks tagged with `team:*`
  show a "team" badge with sparkle icon
- **Brand version pill** — gradient style for "v6.0.0"
- **No Plugins tab** — removed in v5.6.0-beta.3 (Mods only)

## See also

- [docs/architecture.md](../docs/architecture.md) — layer model
- [docs/safety.md](../docs/safety.md) — DANGEROUS_PATTERNS reference
- [docs/decisions/DEC-006-kanban-board.md](../docs/decisions/DEC-006-kanban-board.md)
