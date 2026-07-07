# DECISIONS.md — Architectural Decision Log

> ADRs (Architecture Decision Records) for the Bizar Harness. New
> decisions append to this file. Each decision gets a unique ID
> (DEC-NNN), date, status, and a short rationale. Long-form context
> lives in `docs/decisions/DEC-NNN-*.md`.

## Index

| ID     | Date       | Status   | Title                                                         |
| ------ | ---------- | -------- | ------------------------------------------------------------- |
| DEC-001 | 2026-07-07 | Accepted | Replace OpenCode with Cline SDK in-process                    |
| DEC-002 | 2026-07-07 | Accepted | In-process ClineCore (no `cline serve` subprocess)            |
| DEC-003 | 2026-07-07 | Accepted | In-process memory vault (no dashboard HTTP)                   |
| DEC-004 | 2026-07-07 | Accepted | Cline agent teams integration (`bizar_spawn_team`)            |
| DEC-005 | 2026-07-07 | Accepted | Background agents via dashboard (HTTP), in-process Cline     |
| DEC-006 | 2026-07-07 | Accepted | Kanban board via Tasks.tsx + `/api/tasks` REST                |

---

## DEC-001 — Replace OpenCode with Cline SDK in-process

**Date:** 2026-07-07
**Status:** Accepted

### Context

The original Bizar plugin was built on `@opencode-ai/plugin`, which
uses an in-process AgentPlugin API similar to Cline's. The Cline SDK
provides a more mature tool/hook system with first-class support for
multi-agent orchestration (agent teams).

### Decision

Rewrite every plugin component to use `@cline/sdk` and `@cline/core`
directly. No compatibility shims — full cutover.

### Consequences

- All 17 tools use `createTool({ name, description, inputSchema, execute })`.
- Hooks use Cline's discrete hook bag (`beforeTool`, `afterTool`,
  `beforeModel`, `onEvent`).
- TypeScript types are stricter (e.g. `AgentToolContext` has fixed
  fields; no more `metadata()` method).
- The plugin can run inside the Cline host without modification.

## DEC-002 — In-process ClineCore (no `cline serve` subprocess)

**Date:** 2026-07-07
**Status:** Accepted

### Context

The legacy plugin spawned `cline serve` as a child subprocess. The
subprocess exposes an HTTP + SSE API on a random port with a
random password. In headless test environments the subprocess
never came up (no `cline` CLI on PATH, no provider credentials),
so `setup()` hung for 30+ seconds.

### Decision

Embed `ClineCore` directly via a new `ClineRuntime` wrapper
(`plugins/bizar/src/clineruntime.ts`). Single class replaces the
old ServeLifecycle + HttpClient + EventStream trio.

### Consequences

- `setup()` returns in ~3ms (was: 30s timeout).
- No port, no password, no serve-info file.
- Tests can run in-process; no subshell needed.
- The InstanceManager runs in "bg-only mode" (http/serve/stream all null).

## DEC-003 — In-process memory vault (no dashboard HTTP)

**Date:** 2026-07-07
**Status:** Accepted

### Context

The 4 memory tools (list/read/write/search) called the dashboard's
HTTP API. When the dashboard wasn't running, the tools returned
`dashboard_not_running`. The plugin should be self-contained.

### Decision

Implement an in-process Obsidian-compatible markdown vault
(`plugins/bizar/src/memory-vault.ts`). Reads/writes the vault
directory directly (`~/.bizar_memory/` by default, override via
`BIZAR_MEMORY_VAULT`).

### Consequences

- Memory tools work without a dashboard.
- Full-text search is in-process; the dashboard's semantic/lightrag
  search remains the source of truth for higher-quality results.
- A minimal YAML frontmatter parser handles the tags/type/title
  metadata the dashboard writes.

## DEC-004 — Cline agent teams integration

**Date:** 2026-07-07
**Status:** Accepted

### Context

Cline has first-class support for agent teams — multiple agents
collaborating on a shared mission, coordinated by a lead agent.
The harness should expose this via tools so agents can spawn
teams on demand.

### Decision

Add `bizar_spawn_team` and `bizar_team_status` tools. The spawn
tool creates a session with the lead-agent team-coordination
system prompt. The status tool subscribes to team events and
returns the latest `team_progress_projection` / `team.lifecycle.v1`.

### Consequences

- Both tools registered when ClineRuntime is up.
- `enableAgentTeams: true` is implied (lead agent has the tools).
- The kanban board consumes team events for real-time progress.

## DEC-005 — Background agents via dashboard (HTTP) AND in-process Cline

**Date:** 2026-07-07
**Status:** Accepted

### Context

Background agents can run either as dashboard-spawned sessions
(via HTTP to the dashboard's `/api/background`) or as in-process
ClineCore sessions. The harness should support both.

### Decision

The plugin's `bizar_spawn_background` tool POSTs to the dashboard
HTTP API (existing behavior). The dashboard's `bg-spawner.mjs`
uses ClineCore in-process. The plugin's local `InstanceManager`
tracks state and exposes kill/pause/resume/collect locally.

### Consequences

- Background tools work when the dashboard is running.
- The dashboard owns the actual Cline session lifecycle.
- The plugin tracks state for `bizar_status`, `bizar_collect`,
  `bizar_kill`, etc.

## DEC-006 — Kanban board via Tasks.tsx + /api/tasks REST

**Date:** 2026-07-07
**Status:** Accepted

### Context

The dashboard needs a kanban-style task board (Backlog / Todo /
In-progress / Done / Failed) for human oversight of agent work.

### Decision

Build `bizar-dash/src/web/views/Tasks.tsx` (5-column kanban) +
`bizar-dash/src/server/routes/tasks.mjs` (REST: list, create,
update, delete, start, status PATCH, comments, archive, etc.) +
`bizar-dash/src/server/tasks-store.mjs` (per-project JSON
storage) + WS events `tasks:change` / `tasks:delete` handled in
`App.tsx`.

### Consequences

- The kanban board is fully integrated in the dashboard.
- API statuses (`queued` / `doing` / `done` / `blocked` / `backlog`)
  are mapped to friendly UI labels.
- The Cline agent teams tools feed progress events into this board.
