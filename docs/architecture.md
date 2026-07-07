# Architecture — Bizar Harness

> The layer model, module map, and inter-component contracts for
> Bizar Harness. Read this before making changes that cross layers.

## Layer model

```
┌────────────────────────────────────────────────────────────────────┐
│ Layer 1: UI (bizar-dash/)                                          │
│   - React + TypeScript dashboard                                  │
│   - Express server (HTTP + WS)                                     │
│   - In-process ClineCore via @cline/sdk (replaces cline serve)    │
└────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP REST + WebSocket
┌────────────────────────────────────────────────────────────────────┐
│ Layer 0: Core (plugins/bizar/)                                     │
│   - Cline plugin entry (AgentPlugin from @cline/sdk)              │
│   - 19 tools (plan, memory, bg, kanban, Cline agent teams)         │
│   - 4 hooks (beforeTool, afterTool, beforeModel, onEvent)          │
│   - In-process ClineRuntime (wraps ClineCore.create())            │
└────────────────────────────────────────────────────────────────────┘
                              ↕ Cline SDK
┌────────────────────────────────────────────────────────────────────┐
│ Substrate: ClineCore (@cline/core)                                 │
│   - In-process runtime, no subprocess                              │
│   - startSession / send / abort / subscribe                        │
│   - Session storage, model dispatch, agent team tools              │
└────────────────────────────────────────────────────────────────────┘
```

## Module map

### `plugins/bizar/` — Layer 0

- `index.ts` — AgentPlugin entry. `setup()` builds the runtime
  context and registers all 19 tools.
- `src/clineruntime.ts` — ClineRuntime wrapper around ClineCore.
- `src/memory-vault.ts` — In-process Obsidian-compatible vault.
- `src/background.ts` — InstanceManager (state tracking only,
  bg-only mode; HTTP-dependent operations disabled).
- `src/tools/*.ts` — 19 tools. Each uses `createTool` from
  `@cline/sdk` directly.
- `src/hooks/*.ts` — Hooks for memory inject / write-on-end.
- `src/commands-impl.ts` — Slash-command side-effect executor.
- `src/commands.ts` — Slash-command parser (pure).

### `packages/sdk/` — SDK wrapper

- `src/cline.ts` — TypeScript types and helpers for the
  dashboard's HTTP client (legacy compat).
- `src/cline-events.ts` — Event shape definitions.

### `bizar-dash/` — Layer 1

- `src/server/index.mjs` — Express server entry.
- `src/server/routes/*.mjs` — REST API routes (memory, tasks, etc.).
- `src/server/bg-spawner.mjs` — Background agent spawner
  (uses ClineCore in-process).
- `src/server/tasks-store.mjs` — Per-project task storage.
- `src/web/views/Tasks.tsx` — Kanban board view (5 columns).
- `src/web/views/Chat.tsx` — Chat view.
- `src/web/views/BackgroundAgents.tsx` — Live BG agent viewer.
- `src/web/App.tsx` — App shell + WS event routing.

## Inter-component contracts

### Plugin ↔ ClineCore (in-process)

```ts
// ClineRuntime
const sessionId = await runtime.startSession({
  providerId, modelId,
  workspaceRoot, prompt,
  systemPrompt?, sessionMetadata?, source?,
});
await runtime.send({ sessionId, prompt });
await runtime.abort({ sessionId, reason });
const unsubscribe = runtime.subscribe({ sessionId }, (event) => {...});
```

### Plugin ↔ Dashboard (HTTP for bg only)

```ts
// POST /api/background  → spawn
// POST /api/background/:id/steer → mid-flight steer
// POST /api/background/:id/pause → pause
// POST /api/background/:id/resume → resume
// DELETE /api/background/:id → kill
// GET /api/background → list
```

Memory and kanban do NOT cross this boundary; the plugin reads/writes
the vault directly and the dashboard does the same.

### Dashboard ↔ ClineCore (in-process)

```ts
// Dashboard's bg-spawner.mjs
import { ClineCore } from "@cline/core";
const cline = await ClineCore.create({ clientName: "bizar-dashboard" });
const { sessionId } = await cline.start({ config, prompt, source });
await cline.send(sessionId, { prompt });
await cline.abort(sessionId);
const off = cline.subscribe((event) => {...});
```

## Architectural invariants

1. **No cross-layer imports.** Plugin must not `import` from
   `bizar-dash/`. Dashboard must not re-implement ClineCore features.
2. **No subprocess for Cline.** Both plugin and dashboard embed
   ClineCore in-process.
3. **No HTTP for memory.** Memory tools read/write the vault
   directly (`~/.bizar_memory/`).
4. **Tools use `createTool` from `@cline/sdk`.** No manual
   `AgentTool` shapes.
5. **Hooks use the Cline discrete bag.** No legacy hook arrays.
6. **State is persisted to the repo.** PROGRESS.md, DECISIONS.md,
   feature_list.json are the source of truth for cross-session memory.

## Invariant enforcement

`make check-arch` runs `.harness/arch-rules.json`. Each rule has
`what` / `why` / `fix` fields. New code-review findings become new
rules.
