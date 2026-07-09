> **SUPERSEDED — v6.1.0 (Cline-exclusive).** The OpenCode → Cline migration
> described in this document landed in v5.6.0. As of v6.1.0, Bizar is
> Cline-only and the OpenCode support surface has been removed. Kept for
> historical reference only.

# OpenCode → Cline replacement

This document tracks the ongoing migration from
[OpenCode](https://opencode.ai) (the original agent harness under
BizarHarness) to [Cline](https://docs.cline.bot) (the new agent harness).

The migration is staged. This commit is **Phase 1** — mechanical
identifier/path/URL renaming plus the start of `@cline/sdk` wiring.
The plugin rewrite, in-process agent swap, and runtime CLI swap land
in follow-up PRs.

## What changed in this commit

### Renamed identifiers and paths

| Before                          | After                          |
| ------------------------------- | ------------------------------ |
| `.opencode/`                    | `.cline/`                      |
| `config/opencode.json(.template)`| `config/cline.json(.template)`  |
| `.opencode/commands-bizar/`     | `.cline/commands-bizar/`       |
| `OPENCODE_DIR` / `OPENCODE_JSON`| `CLINE_DIR` / `CLINE_JSON`     |
| `opencodeConfigDir` etc.        | `clineConfigDir` etc.          |
| `OpencodeSdk`, `OpencodeSdkConfig`, `OpencodeEventEnvelope`, `OpencodeConnectionError` | `ClineSdk`, `ClineSdkConfig`, `ClineEventEnvelope`, `ClineConnectionError` |
| `opencode-session-detail` / `opencode-sessions` routes | `cline-session-detail` / `cline-sessions` |
| `bizar-dash/src/server/opencode-runner.mjs` | `cline-runner.mjs` |
| `bizar-dash/src/server/opencode-sdk.mjs` | `cline-sdk.mjs` |
| `plugins/bizar/src/opencode-runner.ts` | `cline-runner.ts` |
| `packages/sdk/src/opencode*.ts` | `packages/sdk/src/cline*.ts` |
| `~/.config/opencode/` etc.      | `~/.config/cline/` etc.        |

### Renamed URLs

| Before                            | After                          |
| --------------------------------- | ------------------------------ |
| `https://opencode.ai/...`         | `https://docs.cline.bot/...`   |

### Dependencies

* `@polderlabs/bizar-sdk` now declares `@cline/sdk` as an optional
  peer dep and exports the wrapper under the `./cline` subpath.
* The root package still keeps `@opencode-ai/plugin` as the plugin
  peer dep. **This is intentional** — see "Why we kept
  `@opencode-ai/plugin`" below.

### CLI / installer helpers

`cli/utils.mjs#detectOpenCode` is renamed to `detectCline` (probes
for `which cline` and the `cline` npm package). The CLI command
prompts that still say "OpenCode" get cleaned up in Phase 4.

## Why we kept `@opencode-ai/plugin`

Cline's plugin API is `AgentPlugin` from `@cline/sdk`, not a separate
`@cline/plugin` package. Its shape is materially different from
OpenCode's:

| Concern           | OpenCode (`@opencode-ai/plugin`)        | Cline (`@cline/sdk`)                                  |
| ----------------- | --------------------------------------- | ----------------------------------------------------- |
| Plugin factory    | `const Plugin = (input) => ({...})`     | `const plugin: AgentPlugin = { setup, hooks, ... }`   |
| Tool definition   | `tool({ args, description, execute })`  | `createTool({ name, description, inputSchema, execute })` |
| Tool context      | `ToolContext { agent, sessionID, ... }` | `AgentToolContext { agentId, conversationId, ... }`    |
| Lifecycle hooks   | per-event (`chat.message`, `tool.execute.before`, …) | discrete (`beforeRun`, `afterRun`, `beforeTool`, `afterTool`, …) |
| Registration      | declared in `opencode.json`             | declared in `cline.json` `plugins[]` / `pluginPaths[]` |

Rewriting `plugins/bizar/index.ts` against the new shape is a
non-trivial refactor (1.6k LoC, 16 tool modules, 30+ hook surfaces).
It is the single biggest item left for Phase 2.

## What's still on OpenCode

* `plugins/bizar/index.ts` + every file under `plugins/bizar/src/`
  still imports `@opencode-ai/plugin`. They will be rewritten against
  `AgentPlugin` / `createTool` in Phase 2.
* `bizar-dash/src/server/serve-info.mjs` and
  `bizar-dash/src/server/bg-spawner.mjs` speak the **OpenCode serve
  child HTTP protocol** (Basic-auth, `/api/session/*`, `/api/event`).
  They will be rewritten in Phase 3 to talk directly to an
  in-process `ClineCore` / `Agent` (Cline is in-process; there is no
  serve child).
* The fallback path inside
  `packages/sdk/src/cline.ts#createOpencodeSdk` still re-wraps an
  `@opencode-ai/sdk` v2 client. It guards the dynamic `@cline/sdk`
  import with `@ts-expect-error` and falls back gracefully when the
  package is absent.
* `cli/utils.mjs#detectCline` and `cli/copy.mjs#installClineJson`
  still write `config/cline.json` whose schema references
  OpenCode's `plugin` / `agent` / `provider` keys. The schema will be
  reconciled with Cline's manifest in Phase 4.

## Migration phases

| Phase | Status   | Scope                                                                 |
| ----- | -------- | --------------------------------------------------------------------- |
| 1     | **this** | Mechanical renames + add `@cline/sdk` peer dep + migration doc        |
| 2     | TODO     | Rewrite `plugins/bizar/` against `AgentPlugin` / `createTool`         |
| 3     | TODO     | Swap `bg-spawner` / `serve-info` from OpenCode serve-child to in-process `ClineCore` |
| 4     | TODO     | Update `cli/utils.mjs#detectCline` to install Cline CLI binary; reconcile `cline.json` schema; clean up prompt text |
| 5     | TODO     | Run the full test gate and cut v5.6.0                                 |

## How to test

```sh
npm run typecheck
npm run test:sdk
# (Phase 2 onward) bun test plugins/bizar/tests/...
```

## References

* Cline overview: <https://docs.cline.bot/cline-overview>
* Cline SDK overview: <https://docs.cline.bot/sdk/overview>
* Cline writing-plugins guide: <https://docs.cline.bot/sdk/guides/writing-plugins>
* Cline tools API: <https://docs.cline.bot/sdk/reference/tools-api>