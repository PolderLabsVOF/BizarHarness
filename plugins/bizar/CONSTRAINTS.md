# plugins/bizar/ — Hard Rules

> Module-specific hard rules. These complement the root
> [AGENTS.md](../../AGENTS.md) constraints. Violations break the
> plugin's portability or safety guarantees.

## Hard rules

- **MUST** use `createTool` from `@cline/sdk` for every tool.
  # why: Ensures the `AgentTool` shape is correct and the host can
  # validate the inputSchema.
- **MUST** use the in-process `ClineRuntime` (no `cline serve` subprocess).
  # why: The subprocess hangs in headless test environments.
- **MUST** use the in-process `memory-vault.ts` for memory operations.
  # why: The plugin must work without the dashboard.
- **MUST** run the `InstanceManager` in bg-only mode (http=null).
  # why: No HTTP server means no background-agent controls via HTTP.
  # The dashboard owns the actual Cline session lifecycle.
- **MUST NOT** import from `bizar-dash/`.
  # why: Cross-layer violation. Use `@cline/sdk` or `packages/sdk/`.
- **MUST NOT** use `fetch('http://127.0.0.1:...')` for memory.
  # why: The plugin must work in-process without a dashboard.
- **MUST NOT** return `{ output: JSON.stringify(...) }` from tool `execute()`.
  # why: Use the structured `AgentToolResult` shape (`{ ok, ... }`).
- **MUST NOT** hand-roll `AgentTool` shapes (use `createTool`).
  # why: Hand-rolled tools drift from the Cline contract.
- **MUST** pass every tool call through `checkDangerous()` in `beforeTool`.
  # why: 36 dangerous patterns must be checked before the call
  # reaches the host. Deny decisions stop the call.
- **MUST** call `createMemoryFlushOnCompact().maybeFlush()` in
  `beforeModel` when usage crosses the compaction threshold.
  # why: Compaction drops context before persistence; the flush
  # writes a durable snapshot first.
- **MUST NOT** spawn subagents with `rm -rf`, `sudo`, SSRF, or
  prompt-injection content. (Enforced by `checkDangerous()`.)
  # why: Defense in depth — even legitimate agents sometimes
  # generate bad tool calls.

## Soft rules

- Prefer `bun:test` over `vitest` for new tests.
- Prefer `Bun.file().text()` over `fs.readFileSync` for async reads.
- Use `logger.debug()` not `console.debug()`.
- Use `process.env.BIZAR_*` for environment-driven config.
- The plugin's `setup()` should not block. Use `try/catch` for
  ClineRuntime setup; fall back gracefully.

## Anti-patterns

- ❌ Adding new tool types via the old OpenCode `tool()` factory
  → Use `createTool()`.
- ❌ Putting state in the plugin entry's module scope
  → Use `ctx.stateStore` for per-session state.
- ❌ Calling `process.exit()` from a hook
  → Return `{ stop: true, reason: '...' }` to the host.
- ❌ Spawning long-lived side effects in `beforeTool`
  → Use the `afterTool` hook for post-call actions.
- ❌ Skipping `checkDangerous()` for "trusted" tools
  → All tool calls go through the gate, no exceptions.

## When in doubt

1. Read [docs/architecture.md](../../docs/architecture.md) for the layer model.
2. Check [.harness/arch-rules.json](../../.harness/arch-rules.json) for enforced rules.
3. Run `make check-arch` before committing.
4. Read [docs/decisions/DEC-007-tool-approval-gate.md](../../docs/decisions/DEC-007-tool-approval-gate.md)
   for the safety gate.
