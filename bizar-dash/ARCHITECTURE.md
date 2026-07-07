# bizar-dash/ — Architecture

> The dashboard server + React UI. This module is Layer 1 (UI) and
> communicates with the plugin via HTTP/WS. It also embeds ClineCore
> in-process for background-agent spawning. See `docs/architecture.md`
> for the layer model.

## Top-level layout

```
bizar-dash/
├── src/
│   ├── server/
│   │   ├── index.mjs              # Express server entry
│   │   ├── bg-spawner.mjs         # Background agent spawner (ClineCore)
│   │   ├── cline-sdk.mjs          # SDK wrapper (legacy compat)
│   │   ├── serve-info.mjs         # Serve-info file IO
│   │   ├── tasks-store.mjs        # Per-project task storage
│   │   ├── memory-store.mjs       # Obsidian markdown vault
│   │   ├── memory-schema.mjs      # Memory note schema validation
│   │   ├── memory-secrets.mjs     # Secret scanner
│   │   ├── memory-git.mjs         # Memory vault git ops
│   │   ├── memory-lightrag.mjs    # Semantic search (optional)
│   │   ├── routes/                # REST API routes
│   │   │   ├── tasks.mjs
│   │   │   ├── memory.mjs
│   │   │   ├── background.mjs
│   │   │   ├── overview.mjs
│   │   │   ├── projects.mjs
│   │   │   ├── history.mjs
│   │   │   └── misc.mjs
│   │   └── ...
│   └── web/
│       ├── App.tsx                # Root shell + WS routing
│       ├── views/                 # Page-level views
│       │   ├── Tasks.tsx          # Kanban board (5 columns)
│       │   ├── BackgroundAgents.tsx # Live BG agent viewer
│       │   ├── Chat.tsx
│       │   ├── Overview.tsx
│       │   ├── Agents.tsx
│       │   └── ...
│       ├── components/            # Reusable components
│       └── lib/                   # API client + types
├── scripts/                       # smoke-bg-retry.mjs
├── styles/                        # CSS
└── tests/                         # bun:test + vitest
```

## Public contract

The dashboard listens on `BIZAR_DASHBOARD_PORT` (default 4321). It
exposes:

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

## Key invariants

- Dashboard must NOT re-implement ClineCore features (use `@cline/core`).
- Background spawner uses ClineCore in-process (not `cline serve`).
- Kanban board consumes `tasks:change` + `tasks:delete` WS events.
- Memory store is on disk at `~/.bizar_memory/` (shared with the plugin).
- Express order matters: `/tasks/bulk` and `/tasks/submit` MUST be
  declared before `/tasks/:id` so the literal segment isn't captured
  as an `:id` parameter.

## Verification

- `make check` — TS compile + tests
- `make e2e` — exercises the dashboard's kanban board via the
  `Tasks.tsx` view against the `/api/tasks` REST endpoints
