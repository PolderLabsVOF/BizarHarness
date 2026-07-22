# DEC-006 — Kanban board (Tasks.tsx + `/api/tasks`)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @karen

## Context

The dashboard needs a kanban-style task board (Backlog / Todo /
In-progress / Done / Failed) for human oversight of agent work.
The board should consume live events from background agents and
Cline agent teams.

## Decision

Build three components:

1. **`bizar-dash/src/web/views/Tasks.tsx`** — 5-column kanban
   (Backlog / Todo / In-progress / Done / Failed). The UI maps
   API statuses (`queued`/`doing`/`done`/`blocked`/`backlog`) to
   friendlier labels.

2. **`bizar-dash/src/server/routes/tasks.mjs`** — REST: list,
   create, update, delete, start, status PATCH, comments,
   archive, etc. 12 endpoints.

3. **`bizar-dash/src/server/tasks-store.mjs`** — per-project
   JSON storage at `.bizar/tasks/<projectId>.json`.

WebSocket events: `tasks:change` (any task mutation) and
`tasks:delete` (any task deletion). Handled in
`bizar-dash/src/web/App.tsx` (lines 431-445).

## Express order constraint

`/tasks/bulk` and `/tasks/submit` MUST be declared before
`/tasks/:id` so the literal segment isn't captured as an `:id`
parameter. See `tasks.mjs:15-42` for the route ordering.

## Consequences

### Positive

- The kanban board is fully integrated in the dashboard.
- API statuses are stable (`queued`/`doing`/`done`/`blocked`/
  `backlog`); the UI can rename labels without breaking the
  server.
- WebSocket events give the board real-time updates from BG agents
  and Cline agent teams.

### Negative

- The UI surface is 5 columns + a backlog panel — more than the
  3-column kanban that some users expect.
- "Submit to Odin" re-delegates the task; users need to be
  careful not to create loops.

### Neutral

- Tasks tagged with `team:*` show a small "team" badge. This is a
  manual marker; auto-detection from `team_progress_projection`
  events is queued for v6.1.0.

## References

- `bizar-dash/src/web/views/Tasks.tsx` (784 lines)
- `bizar-dash/src/server/routes/tasks.mjs` (370 lines)
- `bizar-dash/src/server/tasks-store.mjs`
- `bizar-dash/src/web/App.tsx` — WS event routing
