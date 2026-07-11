> **v6.3.0 — Cline → Claude Code migration.** This guide covers the move
> from the Cline-based Bizar plugin (v6.2.x) to the Claude Code-based
> plugin (v6.3.0). The full Cline → Claude Code rewrite happened in
> the v6.3.0 cycle. Claude Code is in-process; the legacy `claude
> daemon` is not used.

# Migration Guide — Cline → Claude Code (v6.2.x → v6.3.0)

> Upgrade guide for users moving from the Cline-based Bizar
> plugin (v6.2.x) to the Claude Code-based plugin (v6.3.0).

## What changed

The Bizar plugin was **completely rewritten** to use the
Claude Code Agent SDK instead of Cline. The full rewrite
landed in v6.3.0.

### Framework

| Layer | Before (v6.2.x) | After (v6.3.0) |
| --- | --- | --- |
| Plugin framework | `@cline/sdk` | `@anthropic-ai/claude-agent-sdk` |
| Runtime | `cline serve` subprocess + HTTP/SSE | Claude Code Agent SDK in-process |
| Tool shape | Cline's `createTool` | Claude Code MCP tool registration |
| Hook shape | Cline discrete bag (`beforeTool` / `afterTool`) | Claude Code typed events (`PreToolUse` / `PostToolUse`) |

### User-visible changes

- **No `claude daemon` subprocess.** Claude Code runs
  in-process via the Agent SDK. No port, no serve-info file.
- **Skills + MCP replace the plugin surface.** The previous
  `plugins/bizar/` is replaced by `.claude/skills/`,
  `.claude/mcp.json`, and `.claude/agents/`.
- **New hook contract.** Hooks are now Claude Code typed
  event payloads (`PreToolUse` returns
  `{ hookSpecificOutput: { permissionDecision: "deny",
  permissionDecisionReason: "..." } }` for denies). See the
  [Hook reference](docs/safety.md) for the full mapping.
- **Agent teams setting stays on.** `enableAgentTeams: true`
  still works (always-on in Claude Code).
- **Agent tool always-on.** The previous
  `enableSpawnAgent: true` toggle is replaced by Claude Code's
  Agent tool, which is always-on by default.
- **Tool approval gate preserved.** The approval gate is
  wired into `PreToolUse`; the deny decision is returned in
  the Claude Code shape.
- **Skill curator preserved.** Per-skill use/failure tracking
  remains the differentiator pattern.
- **Pre-compaction memory flush preserved.** Wired into
  `UserPromptSubmit` instead of the Cline `beforeModel` hook.

## Install / upgrade

```sh
# Stable (still on v6.2.x if you don't want the rewrite)
npm install @polderlabs/bizar@6.2.5

# Beta (v6.3.0-beta.1 — the Claude Code rewrite)
npm install @polderlabs/bizar@beta

# Or pin
npm install @polderlabs/bizar@6.3.0-beta.1
```

## If you were on v6.2.x (Cline)

1. The plugin still loads in Claude Code the same way —
   `.claude/mcp.json` registers the Bizar MCP server; skills
   live under `.claude/skills/`.
2. **Update any imports from `@cline/sdk`:**
   ```ts
   // Before (v6.2.x)
   import { createTool } from "@cline/sdk";

   // After (v6.3.0)
   import { createTool } from "@anthropic-ai/claude-agent-sdk";
   ```
3. **Update hook names:**

   | Cline hook (v6.2.x) | Claude Code event (v6.3.0) |
   | --- | --- |
   | `beforeTool` | `PreToolUse` |
   | `afterTool` | `PostToolUse` |
   | `beforeModel` | `UserPromptSubmit` |
   | `onEvent` | `SessionStart` / `SessionEnd` / `Stop` |

4. **Update the runtime wrapper name (file kept for back-compat):**
   ```ts
   // Before (v6.2.x)
   import { ClineRuntime } from "./clineruntime.js";

   // After (v6.3.0)
   import { AgentSdkRuntime } from "./clineruntime.js";
   // file is still called clineruntime.ts for spec naming
   ```
5. **Settings:**

   | Cline setting (v6.2.x) | Claude Code default (v6.3.0) |
   | --- | --- |
   | `enableAgentTeams: true` | always-on (Claude Code agent teams) |
   | `enableSpawnAgent: true` | always-on (Claude Code Agent tool) |

6. **Stop any running `claude daemon`** — Claude Code runs
   in-process; no daemon is needed.

## If you have custom hooks

The hook shape changed from Cline's discrete bag to Claude
Code's typed event payloads:

```ts
// Before (v6.2.x — Cline discrete bag)
"beforeTool": async (toolName, args) => {
  if (dangerous(args)) return { stop: true, reason: "..." };
}
"afterTool": async (toolName, args, result) => { ... }
"beforeModel": async (ctx) => { ... }
"onEvent": async (event) => { ... }

// After (v6.3.0 — Claude Code typed events)
"PreToolUse": async (input) => {
  // input: { toolName, toolInput, sessionId, ... }
  if (dangerous(input.toolInput)) {
    return {
      hookSpecificOutput: {
        permissionDecision: "deny",
        permissionDecisionReason: "...",
      },
    };
  }
}
"PostToolUse": async (input) => { ... }       // replaces afterTool
"UserPromptSubmit": async (input) => { ... }   // replaces beforeModel
"SessionStart" / "SessionEnd" / "Stop": async (input) => { ... } // replaces onEvent
```

See [docs/safety.md](safety.md) for the full approval-gate
mapping and the `checkDangerous()` API.

## If you have custom tools

The tool shape changed from Cline's `createTool` to Claude
Code's MCP tool registration shape:

```ts
// Before (v6.2.x — Cline createTool)
import { createTool } from "@cline/sdk";
import { z } from "zod";
export const myTool = createTool({
  name: "my_tool",
  description: "...",
  inputSchema: z.object({ foo: z.string() }).shape,
  execute: async (args) => ({ ok: true, ...args }),
});

// After (v6.3.0 — Claude Code MCP tool registration)
import { createTool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
export const myTool = createTool({
  name: "my_tool",
  description: "...",
  inputSchema: z.object({ foo: z.string() }).shape,
  execute: async (args) => ({ ok: true, ...args }),
});
```

Tools are still registered in the Claude Code skill/MCP
setup callback (the v6.2.x `setup()` equivalent).

## Compatibility shims?

**No.** The decision ([DEC-011](decisions/DEC-011-claude-code-migration.md))
was to do a full cutover with no compatibility shims. The
two APIs are different enough that shims would add
complexity without preserving meaningful functionality.

## Side effects

- `AGENTS.md` rewritten. The v6.0.0 constraints remain;
  v6.3.0 adds the new hook contract and Claude Code runtime.
- The plugin surface is now `.claude/skills/` +
  `.claude/mcp.json` + `.claude/agents/` (was
  `plugins/bizar/`).
- The runtime wrapper file is still `clineruntime.ts` (for
  the spec naming); the exported type is `AgentSdkRuntime`.
- Tests run with `bun test` (unchanged).
- The dashboard's bundle is unchanged.

## Verify your upgrade

```sh
# 1. TypeScript check
npx tsc --noEmit

# 2. Unit tests
bun test plugins/bizar

# 3. E2E test (real plugin load + tool/hook checks)
bun run /tmp/bh-full-e2e.mjs

# 4. Harness audit (73/73 = 100%)
bash tools/audit-harness.sh .

# 5. VCR
make vcr

# 6. Clean-state check
make clean-check
```

## See also

- [CHANGELOG.md](../CHANGELOG.md) — full release history
- [docs/decisions/DEC-011-claude-code-migration.md](decisions/DEC-011-claude-code-migration.md)
  — the v6.3.0 Claude Code migration decision
- [docs/decisions/DEC-001-cline-rewrite.md](decisions/DEC-001-cline-rewrite.md)
  — the v6.0.0 OpenCode → Cline decision (historical)
- https://docs.claude.com/claude-code — Claude Code docs
- https://github.com/walkinglabs/awesome-harness-engineering —
  the course that inspired the harness engineering improvements

---

## Historical — OpenCode → Cline (v5.5.x → v6.0.0)

> **Archived.** Kept for historical reference only. The
> OpenCode → Cline rewrite landed in v5.6.0; Bizar was
> Cline-only from v6.1.0 onward. Claude Code replaced Cline
> in v6.3.0 (see above).

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
