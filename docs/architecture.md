# Architecture — Bizar Harness

> The layer model, module map, inter-component contracts, and
> v6.0.0 safety primitives for Bizar Harness. Read this before
> making changes that cross layers or add new tools.

## Layer model

```
┌────────────────────────────────────────────────────────────────────┐
│ Layer 1: UI (bizar-dash/)                                          │
│   - React + TypeScript dashboard (17 tabs)                        │
│   - Express server (HTTP + WS)                                     │
│   - In-process ClineCore via @cline/sdk (replaces cline serve)    │
│   - Harness engineering dashboard view                             │
│   - Kanban board (5 columns + backlog)                             │
└────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP REST + WebSocket
┌────────────────────────────────────────────────────────────────────┐
│ Layer 0: Core (plugins/bizar/)                                     │
│   - Cline plugin entry (AgentPlugin from @cline/sdk)              │
│   - 19 tools + 4 hooks + 1 approval gate                          │
│   - In-process ClineRuntime (wraps ClineCore.create())            │
│   - In-process memory vault                                       │
│   - DANGEROUS_PATTERNS approval gate                               │
│   - Skill curator (closed learning loop)                           │
│   - Pre-compaction memory flush                                   │
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

**Entry point**

- `index.ts` — `AgentPlugin` entry. `setup()` builds the runtime
  context and registers all 19 tools.

**Runtime**

- `src/clineruntime.ts` — `ClineRuntime` wrapper around `ClineCore`
  (replaces the legacy subprocess).

**Memory**

- `src/memory-vault.ts` — In-process Obsidian-compatible vault
  (replaces the legacy HTTP calls).
- `src/tools/memory-{list,read,write,search}.ts` — 4 agent-facing
  tools that read/write the vault directly.

**Tools** (19 total)

- `src/tools/bg-{spawn,status,collect,kill,pause,resume,send-message,get-comments,report-progress}.ts` —
  9 background-agent tools (via dashboard HTTP).
- `src/tools/memory-{list,read,write,search}.ts` — 4 memory tools
  (in-process vault).
- `src/tools/plan-action.ts`, `open-kb.ts`,
  `wait-for-feedback.ts`, `read-glyph-feedback.ts` — 4
  plan/glyph tools.
- `src/tools/team-{spawn,status}.ts` — 2 Cline agent team tools.
- `src/tools/graph-{query,path,explain}.ts` — 3 knowledge-graph
  tools (read `.bizar/graph/graph.json`).

**Hooks** (4 + 2 safety)

- `beforeTool` — loop-guard + DANGEROUS_PATTERNS approval gate
  (runs `checkDangerous()`; deny stops the tool call).
- `afterTool` — log per-tool call to `LogWriter`.
- `beforeModel` — pre-compaction memory flush (writes
  `compaction-snapshots/<ts>-<session>.md` to the vault when
  `shouldCompact()` returns true).
- `onEvent` — `message-added` (slash command interception) +
  `run-finished`/`run-failed` (memory write hook).
- `src/hooks/skill-curator.ts` — closed learning loop
  (Hermes pattern; `~/.bizar/skills/usage.jsonl`).
- `src/hooks/memory-flush-on-compact.ts` — OpenClaw pattern
  (writes durable snapshots before compaction).

**Safety**

- `src/dangerous-patterns.ts` — 36 patterns (25 deny + 11
  require-approval) covering filesystem destruction, SSRF,
  privilege escalation, process control, sensitive file reads,
  dangerous git operations, and prompt injection.

**Other**

- `src/background.ts` — `InstanceManager` (state tracking only,
  bg-only mode; HTTP-dependent operations disabled).
- `src/plan-fs.ts` / `src/plan-schema.ts` — plan directory IO.
- `src/settings.ts` / `src/state.ts` — settings + state stores.
- `src/commands.ts` / `src/commands-impl.ts` — slash commands.
- `src/logger.ts` — typed logger interface.

### `packages/sdk/` — SDK wrapper

- `src/cline.ts` — TypeScript types for the dashboard's HTTP
  client (legacy compat; not used in the in-process plugin).
- `src/cline-events.ts` — event shape definitions.

### `bizar-dash/` — Layer 1

**Server**

- `src/server/index.mjs` — Express server entry.
- `src/server/routes/{memory,tasks,background,history,…}.mjs` —
  REST API routes.
- `src/server/bg-spawner.mjs` — Background-agent spawner
  (uses `ClineCore` in-process).
- `src/server/tasks-store.mjs` — per-project task storage.
- `src/server/memory-store.mjs` — full-featured memory service
  (LightRAG, git sync, secret scanning, schema validation).

**Web (17 views)**

`Overview`, `Chat`, `Agents`, `Artifacts` (glyphs), `Tasks`,
`Activity`, `BackgroundAgents`, `Skills`, `Memory`, `Mods`,
`Schedules`, `History`, `MiniMaxUsage`, `Eval`, `Doctor`,
`Harness`, `Settings`.

Key views:

- `views/Harness.tsx` — 73/73 audit score, subsystem status, make
  targets, docs pointers. (v6.0.0)
- `views/Tasks.tsx` — 5-column kanban + team badge.
- `views/BackgroundAgents.tsx` — live BG agent viewer (5s poll
  + WebSocket events).
- `views/Chat.tsx` — 3-column chat (rail / thread / info).
- `views/Memory.tsx` — memory subsystem (4 sources + config).

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
// POST   /api/background            → spawn
// GET    /api/background            → list
// POST   /api/background/:id/steer  → mid-flight steer
// POST   /api/background/:id/pause  → pause
// POST   /api/background/:id/resume → resume
// DELETE /api/background/:id       → kill
```

Memory and kanban do NOT cross this boundary; the plugin
reads/writes the vault directly and the dashboard does the same.

### Dashboard ↔ ClineCore (in-process)

```mjs
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
   `bizar-dash/`. Dashboard must not re-implement ClineCore
   features.
2. **No subprocess for Cline.** Both plugin and dashboard embed
   `ClineCore` in-process.
3. **No HTTP for memory.** Memory tools read/write the vault
   directly (`~/.bizar_memory/`).
4. **Tools use `createTool` from `@cline/sdk`.** No manual
   `AgentTool` shapes.
5. **Hooks use the Cline discrete bag.** No legacy hook arrays.
6. **State is persisted to the repo.** PROGRESS.md,
   DECISIONS.md, feature_list.json are the source of truth for
   cross-session memory.
7. **No dangerous tool call escapes the gate.** The
   `beforeTool` hook runs `checkDangerous()`; deny decisions
   stop the tool call before it reaches the host.
8. **The kanban board is the only UI for tasks.** No separate
   "Plugins" view (v5.6.0-beta.3).
9. **No global side effects in `index.ts`.** All tool factories
   are stateless; the `ClineRuntime` is constructed in `init()`.

## Invariant enforcement

`make check-arch` runs `.harness/arch-rules.json`. Each rule has
`what` / `why` / `fix` fields. New code-review findings become
new rules.

Current rules (7):

- ARCH-001: Plugin must not import from dashboard
- ARCH-002: Plugin must not call dashboard HTTP for memory
- ARCH-003: Plugin must not spawn `cline serve` subprocess
- ARCH-004: All tools must use `createTool` from `@cline/sdk`
- ARCH-005: No debug artifacts in `src/`
- ARCH-006: Memory vault location must be configurable via
  `BIZAR_MEMORY_VAULT`
- ARCH-007: All 17 + 2 = 19 tools must be registered

## v6.0.0 safety primitives (NEW)

### DANGEROUS_PATTERNS gate

36 patterns checked on every tool call:

- **25 deny** — `rm -rf /`, sudo, SSRF (AWS/GCP/Azure metadata),
  fork bomb, prompt injection, /etc/shadow read, ~/.ssh/ read,
  force-push to main, shutdown, kill PID 1, crypto miners, …
- **11 require-approval** — sudo, chmod 777, chown root, git
  reset --hard, git clean -fd, path traversal, /etc/(shadow|passwd|sudoers), …

See [DEC-007](decisions/DEC-007-tool-approval-gate.md) and
`plugins/bizar/src/dangerous-patterns.ts`.

### Skill curator (closed learning loop)

Tracks per-skill use/failure in `~/.bizar/skills/usage.jsonl`.
Flags skills for revision when 5+ failures accumulate. The
differentiator pattern — of 106 cataloged projects, only
Hermes has this.

See [DEC-008](decisions/DEC-008-skill-curator.md) and
`plugins/bizar/src/hooks/skill-curator.ts`.

### Pre-compaction memory flush

When `shouldCompact()` returns true, writes a
`compaction-snapshots/<ts>-<session>.md` note to the vault
with the recent 10 messages. Closes the durability gap.

See [DEC-009](decisions/DEC-009-pre-compaction-flush.md) and
`plugins/bizar/src/hooks/memory-flush-on-compact.ts`.

### Knowledge graph query tools

3 new tools expose the existing `.bizar/graph/graph.json` (814
nodes in the BizarHarness project) to agents:

- `bizar_graph_query` — substring search
- `bizar_graph_path` — BFS shortest path
- `bizar_graph_explain` — node summary with neighbors

See [DEC-010](decisions/DEC-010-knowledge-graph-tools.md) and
`plugins/bizar/src/tools/graph-query.ts`.

## See also

- [docs/decisions/](decisions/) — full ADR archive
- [docs/quality-document.md](quality-document.md) — per-module
  A/B/C/D scores
- [AGENTS.md](../AGENTS.md) — agent entry point
- [DECISIONS.md](../DECISIONS.md) — ADR index
- [CHANGELOG.md](../CHANGELOG.md) — full release history
