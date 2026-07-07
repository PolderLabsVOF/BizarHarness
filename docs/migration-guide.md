# Migration Guide — OpenCode → Cline (v5.5.x → v5.6.0)

> Upgrade guide for users moving from the OpenCode-based Bizar
> plugin (v5.5.x) to the Cline-based plugin (v5.6.0).

## What changed

The Bizar plugin was **completely rewritten** to use Cline's
SDK instead of OpenCode. The full rewrite happened across 4
phases (commits `97ddb19` → `0fcdec2`).

### Framework

| Layer | Before (v5.5.x) | After (v5.6.0) |
| --- | --- | --- |
| Plugin framework | `@opencode-ai/plugin` | `@cline/sdk` |
| Runtime | `cline serve` subprocess + HTTP/SSE | `ClineCore.create()` in-process |
| Tool shape | `{ output: JSON.stringify({...}) }` | structured `{ ok, ... }` |
| Hook shape | `experimental.chat.system.*` arrays | discrete `beforeTool` / `afterTool` / `beforeModel` / `onEvent` |

### User-visible changes

- **No `cline serve` subprocess.** The plugin embeds ClineCore
  in-process. No port, no password, no serve-info file.
- **Tool calls return structured data.** `{ ok: true, ... }` or
  `{ ok: false, error, ... }`. Update any custom code that
  consumed the old shape.
- **New tools.** `bizar_spawn_team`, `bizar_team_status` (Cline
  agent teams), `bizar_graph_query`, `bizar_graph_path`,
  `bizar_graph_explain` (knowledge graph).
- **Removed tools.** `Plugins` and `Marketplace` views (use
  `Mods` instead).
- **In-process memory.** Tools no longer need the dashboard
  running. They read/write the vault at `~/.bizar_memory/`
  directly.
- **Tool approval gate.** The `beforeTool` hook now runs
  `checkDangerous()`. Dangerous operations (rm -rf, sudo, SSRF,
  prompt injection) are blocked before reaching the host.
- **Skill curator.** Per-skill use/failure tracking. The
  differentiator pattern (1 of 106 cataloged projects has it).
- **Pre-compaction memory flush.** When `shouldCompact()` returns
  true, a snapshot is written to the vault before compaction.

## Install / upgrade

```sh
# Stable (still on v5.5.6 if you don't want the rewrite)
npm install @polderlabs/bizar@5.5.6

# Beta (v5.6.0-beta.4 — the rewrite)
npm install @polderlabs/bizar@beta

# Or pin
npm install @polderlabs/bizar@5.6.0-beta.4
```

## If you were on v5.5.x

1. The plugin still loads in cline the same way — `claude
   plugins add @polderlabs/bizar` (or the equivalent).
2. **Update any custom slash commands that consumed the old
   tool shape:**
   ```ts
   // Before (v5.5.x)
   const r = await tool.execute(args);
   const data = JSON.parse(r.output);

   // After (v5.6.0)
   const r = await tool.execute(args);
   if (r.ok) { /* use r directly */ }
   else { /* r.error, r.message */ }
   ```
3. **Stop any running `cline serve`** — the plugin no longer
   needs it.
4. **The dashboard is now optional.** Memory tools work
   in-process. The dashboard is still useful for visualizing
   / curating memory, viewing tasks, and running the Harness
   audit.

## If you have custom hooks

The hook shape changed:

```ts
// Before (v5.5.x — array-based)
"experimental.chat.system": async (ctx, output) => {
  output.system = [...output.system, "new prompt"];
}

// After (v5.6.0 — discrete hook bag)
"beforeModel": async (ctx) => {
  return { systemPrompt: "...new prompt..." };
}
```

See the [Hook reference in plugins/bizar/ARCHITECTURE.md](../plugins/bizar/ARCHITECTURE.md#hooks-4--2-safety).

## If you have custom tools

The tool shape changed:

```ts
// Before (v5.5.x — OpenCode tool factory)
import { tool } from "@opencode-ai/plugin";
export default tool({
  name: "my_tool",
  description: "...",
  args: { foo: tool.schema.string() },
  async execute(args) {
    return `output: ${JSON.stringify({ ok: true, ...args })}`;
  },
});

// After (v5.6.0 — Cline createTool)
import { createTool } from "@cline/sdk";
import { z } from "zod";
export const myTool = createTool({
  name: "my_tool",
  description: "...",
  inputSchema: z.object({ foo: z.string() }).shape,
  execute: async (args) => ({ ok: true, ...args }),
});
```

The plugin no longer uses default exports for tools. Each tool
is created via `createTool()` and registered via
`api.registerTool(tool)` in `setup()`.

## Compatibility shims?

**No.** The decision (DEC-001) was to do a full cutover with
no compatibility shims. The two APIs are different enough that
shims would add complexity without preserving meaningful
functionality.

## Side effects

- `AGENTS.md` rewritten. The old "Bizar v0.5.2" constraints
  are gone; the new v6.0.0 constraints are stricter.
- The plugin entry is now `plugins/bizar/index.ts` (was
  `plugins/bizar/src/index.ts`).
- Tests run with `bun test` (was: a mix of `bun test` +
  `vitest`).
- The dashboard's bundle is 414 KB (was: 425 KB before
  v5.6.0-beta.3's Plugin removal).

## Verify your upgrade

```sh
# 1. TypeScript check
npx tsc --noEmit

# 2. Unit tests
bun test plugins/bizar

# 3. E2E test (real plugin load + 27 tool/hook checks)
bun run /tmp/bh-full-e2e.mjs

# 4. Harness audit (73/73 = 100%)
bash tools/audit-harness.sh .

# 5. VCR (15/15 = 1.000)
make vcr

# 6. Clean-state check
make clean-check
```

## See also

- [CHANGELOG.md](../CHANGELOG.md) — full release history
- [docs/decisions/DEC-001-cline-rewrite.md](decisions/DEC-001-cline-rewrite.md)
- https://docs.cline.bot — Cline documentation
- https://github.com/walkinglabs/awesome-harness-engineering —
  the course that inspired the harness engineering improvements
