> **SUPERSEDED — v6.1.0 (Cline-exclusive).** The OpenCode → Cline migration
> described in this document landed in v5.6.0. As of v6.1.0, Bizar is
> Cline-only and the OpenCode support surface has been removed. Kept for
> historical reference only.

> **SUPERSEDED — v6.3.0 (Claude Code migration).** This ADR records the
> OpenCode → Cline migration that landed in v5.6.0 and was the active
> runtime until v6.2.x. As of v6.3.0 (DEC-011), Bizar migrated from
> Cline to Claude Code and the Cline support surface is no longer
> active. The OpenCode → Cline rewrite decision stands (it got us to
> an in-process, typed plugin runtime); what changed in v6.3.0 is the
> host. Kept for historical reference only.

# DEC-001 — Complete rewrite of the plugin framework (OpenCode → Cline)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @karen, @drb0rk
**Supersedes:** none
**Related:** DEC-002, DEC-003, DEC-004, DEC-005

## Context

The Bizar plugin was originally built on `@opencode-ai/plugin`, an
in-process AgentPlugin API. Cline has a more mature tool/hook system
with first-class support for:

1. **Multi-agent orchestration** via the `team_progress_projection`
   and `team.lifecycle.v1` events.
2. **Discrete hook bag** (`beforeTool` / `afterTool` / `beforeModel` /
   `onEvent`) — clean separation vs. OpenCode's array-of-hooks
   pattern that mixed concerns.
3. **TypeScript-first SDK** (`@cline/sdk`) with `createTool` +
   `z.object` for inputSchema, vs. OpenCode's hand-rolled `tool()`
   factory.
4. **In-process `ClineCore` runtime** — no subprocess spawn, no
   port negotiation, no serve-info file. The plugin can be tested
   in-process without an external service.

The OpenCode plugin API also has a slow release cadence and fewer
contributors; the Cline SDK is more actively maintained.

## Decision

Rewrite every plugin component to use `@cline/sdk` and `@cline/core`
directly. No compatibility shims. Full cutover, atomic commits, one
phase at a time:

- **Phase 1** (97ddb19): Mechanical rename (`@opencode-ai/plugin` →
  `@cline/sdk`).
- **Phase 2** (f8d0d87): All 17 tools ported to `createTool` +
  `z.object` schemas; 4 hooks wired.
- **Phase 3** (3511390): In-process `ClineRuntime` replaces the
  `cline serve` subprocess. New `bizar_spawn_team` and
  `bizar_team_status` tools.
- **Phase 4** (0fcdec2): Harness engineering audit at 73/73 = 100%.
- **v5.6.0-beta.4** (863e837): 4 new safety / curator / graph tools
  added; pre-compaction memory flush wired in.

## Consequences

### Positive

- All 17 tools use the canonical `createTool({ name, description,
  inputSchema, execute })` shape.
- Hooks have discrete, type-checked signatures.
- Plugin `setup()` returns in ~3 ms (was: 30s+ timeout in headless
  envs when `cline serve` failed to start).
- 19 tools total (17 core + 2 team tools) registered via the same
  `createTool` API.
- `enableAgentTeams: true` is implied by the team coordinator's
  system prompt.
- Tests run in-process; no subshell needed.

### Negative

- Any OpenCode-era test fixtures (a11y tests, plugins-registry,
  plugins-sandbox) had to be deleted. Most were tests for
  functionality that was removed in the rewrite.
- `AGENTS.md` had to be updated to point to the new SDK; any
  downstream code that imported from `@opencode-ai/plugin` needs
  to be migrated.

### Neutral

- The `~/.local/share/bizar/memory/` legacy path is still readable
  for back-compat (see DEC-003).
- Background-agent HTTP API on the dashboard is unchanged; the
  dashboard's `bg-spawner.mjs` now embeds ClineCore in-process
  instead of calling the legacy plugin's HTTP.

## Migration

```sh
# From OpenCode-era bizar
npm install @polderlabs/bizar@beta

# Update any custom slash commands that consumed the old tool shape:
#   { output: JSON.stringify({ ok: true, ... }) }
# to the new shape:
#   { ok: true, ... } | { ok: false, error, ... }

# Stop any running cline serve
pkill -f "cline serve" || true
```

## References

- `plugins/bizar/index.ts` — the Cline `AgentPlugin` entry point
- `plugins/bizar/ARCHITECTURE.md` — module architecture
- `CHANGELOG.md` — full phase-by-phase changelog
- `research/agent-harness-survey/final-reports/06-bizar-improvement-plan.md` —
  the 12-item improvement plan
- https://docs.cline.bot — Cline documentation
