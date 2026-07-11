# plugins/bizar/ — Hard Rules

> Module-specific hard rules. Because this directory is a
> back-compat shim (post-F-037), the constraints are minimal:
> don't reintroduce Cline-era source files here. The active
> rules live in
> [`packages/sdk/`](../packages/sdk/) and the root
> [AGENTS.md](../../AGENTS.md).

## Hard rules

- **MUST NOT** add Cline-era source files (no
  `src/clineruntime.ts`, no `src/hooks/`, no
  `src/tools/<name>.ts` using `@cline/sdk`).
  # why: F-037 (v6.5.0) removed the Cline-era plugin surface.
  # The Claude Code MCP server in `packages/sdk/src/mcp/`
  # is the only tool registration surface now.
- **MUST NOT** import from `@cline/sdk`, `@cline/core`, or
  `@cline/shared`.
  # why: Bizar is Claude Code-native (v6.3.0+). The Agent SDK
  # dependency is `@anthropic-ai/claude-agent-sdk`.
- **MUST NOT** spawn a `cline serve` subprocess.
  # why: Claude Code runs in-process; any subprocess-based
  # runtime breaks headless test environments.
- **MUST NOT** import from `bizar-dash/`.
  # why: Cross-layer violation. This is a Layer 0 (Core) shim;
  # the dashboard sits at Layer 1.
- **MUST NOT** import from `node:dns`, `node:net`, `node:http`,
  or `node:https` (network-bearing).
  # why: The plugin must remain a pure shim with zero network
  # calls. (The historical `scripts/check-forbidden-imports.sh`
  # enforced this against `src/`; the directory is empty now, so
  # the script was deleted.)
- **MUST** keep `index.ts` a pure re-export of
  `@polderlabs/bizar-sdk`.
  # why: The shim's only job is to forward legacy consumers. No
  # runtime logic should accumulate here.

## Soft rules

- Prefer extending the SDK in `packages/sdk/src/mcp/server.ts`
  over adding any code to this directory.
- If a new npm dep is needed, declare it in `package.json` and
  audit it against `docs/safety.md` patterns.

## Anti-patterns

- ❌ Re-implementing tools here instead of in
  `packages/sdk/src/mcp/server.ts`.
  → Add to `BIZAR_TOOLS` and re-export from the SDK.
- ❌ Adding `src/` or `tests/` subdirectories.
  → If real source is needed, it belongs in `packages/sdk/`.
- ❌ Pinning to `@cline/*` packages.
  → Use `@anthropic-ai/claude-agent-sdk`.

## When in doubt

1. Read [docs/architecture.md](../../docs/architecture.md) for
   the layer model.
2. Read [docs/migration-guide.md](../../docs/migration-guide.md)
   for the v6.3.0 → v6.5.0 migration history.
3. Run `make check` and `make test` before committing.
