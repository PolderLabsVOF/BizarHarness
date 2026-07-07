# plugins/bizar/ — Architecture

> The Cline plugin entry and all 19 tools. This module is Layer 0
> (Core) and runs inside the Cline host. See
> [docs/architecture.md](../docs/architecture.md) for the layer
> model.

## Top-level layout

```
plugins/bizar/
├── index.ts                       # AgentPlugin entry; setup() + tools + hooks
├── src/
│   ├── clineruntime.ts            # ClineCore wrapper (in-process)
│   ├── memory-vault.ts            # Obsidian-compatible vault (in-process)
│   ├── dangerous-patterns.ts      # 36 safety patterns (v6.0.0)
│   ├── background.ts              # InstanceManager (state tracking)
│   ├── background-state.ts        # Persisted state shape
│   ├── plan-fs.ts                 # Plan directory read/write
│   ├── plan-schema.ts             # Zod schema for plans
│   ├── settings.ts                # User settings store
│   ├── state.ts                   # Session state store (loop guard)
│   ├── settings-store.ts          # Settings file IO
│   ├── log-writer.ts              # Append-only tool-call log
│   ├── reasoning-clean.ts         # <think> block stripper for fetch
│   ├── key-rotation.ts            # API key rotation for fetch
│   ├── compaction.mjs             # Compaction threshold
│   ├── commands.ts                # Slash command parser (pure)
│   ├── commands-impl.ts           # Slash command executor
│   ├── logger.ts                  # Logger interface
│   ├── hooks/
│   │   ├── memory-inject.ts       # beforeModel hook
│   │   ├── memory-write-on-end.ts # onEvent hook (session.idle/error)
│   │   ├── skill-curator.ts       # Closed learning loop (v6.0.0)
│   │   └── memory-flush-on-compact.ts # Pre-compact snapshot (v6.0.0)
│   └── tools/                     # 19 tools
│       ├── bg-collect.ts
│       ├── bg-get-comments.ts
│       ├── bg-kill.ts
│       ├── bg-pause.ts
│       ├── bg-report-progress.ts
│       ├── bg-resume.ts
│       ├── bg-send-message.ts
│       ├── bg-spawn.ts
│       ├── bg-status.ts
│       ├── memory-list.ts
│       ├── memory-read.ts
│       ├── memory-search.ts
│       ├── memory-write.ts
│       ├── open-kb.ts
│       ├── plan-action.ts
│       ├── read-glyph-feedback.ts
│       ├── team-spawn.ts
│       ├── team-status.ts
│       ├── wait-for-feedback.ts
│       ├── graph-query.ts         # Knowledge graph (v6.0.0)
│       ├── graph-path.ts          # Shortest path (v6.0.0)
│       └── graph-explain.ts       # Node summary (v6.0.0)
└── tests/                         # bun:test (45 files)
```

## Public contract

```ts
const plugin: AgentPlugin = {
  name: "bizar",
  manifest: { capabilities: ["tools", "hooks"] },
  hooks: {...},  // computed from runtimeCtx
  async setup(api, ctx) {
    const { runtimeCtx, tools } = await initRuntime(api, ctx);
    for (const t of tools) api.registerTool(t);
  },
};
export default plugin;
```

## Tools (19 total)

| Category | Count | Tools |
| --- | --- | --- |
| **Background agents** | 9 | `bizar_spawn_background`, `bizar_status`, `bizar_collect`, `bizar_kill`, `bizar_pause`, `bizar_resume`, `bizar_send_message`, `bizar_get_comments`, `bizar_report_progress` |
| **Memory** | 4 | `bizar_memory_list`, `bizar_memory_read`, `bizar_memory_write`, `bizar_memory_search` |
| **Plan / Glyphs** | 4 | `bizar_plan_action`, `bizar_open_kb`, `bizar_wait_for_feedback`, `bizar_read_glyph_feedback` |
| **Cline agent teams** | 2 | `bizar_spawn_team`, `bizar_team_status` |
| **Knowledge graph** | 3 | `bizar_graph_query`, `bizar_graph_path`, `bizar_graph_explain` |
| **Total** | **22** | (19 + 3 graph) |

> Note: 19 was the count before v6.0.0 added the 3 graph tools.
> Current total: **22 tools**.

## Hooks (4 + 2 safety)

| Hook | Purpose |
| --- | --- |
| `beforeTool` | Loop guard + DANGEROUS_PATTERNS gate |
| `afterTool` | Per-tool-call log to `LogWriter` |
| `beforeModel` | Pre-compaction memory flush (writes snapshot to vault) |
| `onEvent` | `message-added` (slash commands) + `run-finished`/`run-failed` (memory write) |

| Safety hook | Purpose |
| --- | --- |
| `skill-curator` (manual) | Reports skill usage + flags revisions |
| `memory-flush-on-compact` (auto) | Writes snapshot to vault when `shouldCompact()` returns true |

## State flow

1. `setup()` builds the runtime context (logger, env flags,
   stores).
2. Brings up `ClineRuntime` (best-effort; team tools only if
   it works).
3. Brings up `InstanceManager` in bg-only mode (no HTTP).
4. Builds 22 tools via `buildTools(runtimeCtx, instanceManager,
   clineRuntime)`.
5. Each tool uses
   `createTool({ name, description, inputSchema: z.object({...}).shape, execute })`.
6. Hooks are computed lazily from the runtime context.

## Key invariants

- **Plugin must NOT import from `bizar-dash/`** (Layer 1).
- **Memory tools MUST use the in-process vault** (no HTTP).
- **Tools MUST use `createTool`** (no manual `AgentTool` shapes).
- **ClineRuntime MUST be used** (no `cline serve` subprocess).
- **All tool calls MUST pass `checkDangerous()`** in `beforeTool`.
- **Compaction MUST trigger a flush** in `beforeModel`.

## Verification

- `make check` — TS compile + tests
- `make e2e` — real plugin load + 27 tool/hook checks
- `make check-arch` — arch-rules.json enforcement (7 rules)
- `make clean-check` — 5-dimension clean-state check

## See also

- [plugins/bizar/CONSTRAINTS.md](CONSTRAINTS.md) — module hard rules
- [docs/architecture.md](../docs/architecture.md) — layer model
- [docs/safety.md](../docs/safety.md) — DANGEROUS_PATTERNS reference
- [docs/curator.md](../docs/curator.md) — Skill curator
- [docs/graph-tools.md](../docs/graph-tools.md) — Graph tools
- [docs/decisions/DEC-001-cline-rewrite.md](../docs/decisions/DEC-001-cline-rewrite.md)
  — the OpenCode → Cline rewrite
