# plugins/bizar/ — Architecture

> The Cline plugin entry and all 19 tools. This module is Layer 0
> (Core) and runs inside the Cline host. See `docs/architecture.md`
> for the layer model.

## Top-level layout

```
plugins/bizar/
├── index.ts                       # AgentPlugin entry; setup() + tools + hooks
├── src/
│   ├── clineruntime.ts            # ClineCore wrapper (in-process)
│   ├── memory-vault.ts            # Obsidian-compatible vault (in-process)
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
│   │   └── memory-write-on-end.ts # onEvent hook
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
│       └── wait-for-feedback.ts
└── tests/                         # bun:test (43 files)
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

## State flow

1. `setup()` builds the runtime context (logger, env flags, stores).
2. Brings up `ClineRuntime` (best-effort; team tools only if it works).
3. Brings up `InstanceManager` in bg-only mode (no HTTP).
4. Builds 19 tools via `buildTools(runtimeCtx, instanceManager, clineRuntime)`.
5. Each tool uses `createTool({ name, description, inputSchema: z.object({...}).shape, execute })`.
6. Hooks are computed lazily from the runtime context.

## Key invariants

- Plugin must NOT import from `bizar-dash/` (Layer 1).
- Memory tools MUST use the in-process vault (no HTTP).
- Tools MUST use `createTool` (no manual `AgentTool` shapes).
- ClineRuntime MUST be used (no `cline serve` subprocess).

## Verification

- `make check` — TS compile + tests
- `make e2e` — real plugin load + 22 tool/hook checks
- `make check-arch` — arch-rules.json enforcement
