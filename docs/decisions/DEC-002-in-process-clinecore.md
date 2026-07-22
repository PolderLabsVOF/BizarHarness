> **Superseded by DEC-011 (Claude Code migration), v6.3.0.** This ADR
> records the v6.0.0 decision to embed ClineCore in-process instead
> of running `cline serve` as a subprocess. v6.3.0 keeps the spirit
> of this decision (in-process is still right) but the runtime is
> now Claude Code's Agent SDK, not ClineCore. The ClineCore file
> `plugins/bizar/src/clineruntime.ts` survives as a renamed
> wrapper around `@anthropic-ai/claude-agent-sdk`.

# DEC-002 — In-process ClineCore (no `cline serve` subprocess) — superseded by DEC-011

**Date:** 2026-07-07
**Status:** Superseded (by DEC-011)
**Deciders:** @karen
**Related:** DEC-001, DEC-005, DEC-011

## Context

The legacy plugin spawned `cline serve` as a child subprocess
(no longer relevant as of v6.3.0; Claude Code is in-process — there
is no `claude daemon` subprocess to avoid; if background sessions
are needed the operator runs `claude --bg` explicitly).
The Cline-era subprocess exposed an HTTP + SSE API on a random port
with a random password, persisted to a serve-info file at
`~/.config/bizar/serve.json`.

In headless test environments (CI, no `$DISPLAY`, no `cline` CLI on
PATH, no provider credentials), the subprocess never came up. The
plugin's `setup()` blocked for 30+ seconds on the port-read
timeout, then the dashboard's HTTP client also timed out trying to
reach the dead subprocess. End result: the harness was untestable
in any non-interactive environment.

## Decision

Embed `ClineCore` directly via a new `ClineRuntime` wrapper
(`plugins/bizar/src/clineruntime.ts`). Single class replaces the
old ServeLifecycle + HttpClient + EventStream trio.

> **v6.3.0 update (DEC-011):** The wrapper class is now
> `ClaudeSdkRuntime` and imports from `@anthropic-ai/claude-agent-sdk`
> instead of `@cline/core`. The source file path is preserved for
> back-compat with the plugin manifest. There is no `claude daemon`
> subprocess to embed against — the Agent SDK is in-process by
> default.

```ts
// plugins/bizar/src/clineruntime.ts (v6.3.0 excerpt)
import { AgentSdk, type SessionOptions, type SessionEvent } from "@anthropic-ai/claude-agent-sdk";

export class ClaudeSdkRuntime {
  private core: AgentSdk | null = null;

  async start(): Promise<void> {
    this.core = await AgentSdk.create({ clientName: "bizar-plugin" });
  }

  async startSession(opts: StartSessionOpts): Promise<string> {
    const { sessionId } = await this.core!.start({
      config: { providerId: opts.providerId, modelId: opts.modelId },
      prompt: opts.prompt,
      systemPrompt: opts.systemPrompt,
      workspaceRoot: opts.workspaceRoot,
      source: opts.source ?? "bizar-plugin",
    });
    return sessionId;
  }

  async send(opts: { sessionId: string; prompt: string }): Promise<void> {
    await this.core!.send(opts.sessionId, { prompt: opts.prompt });
  }

  async abort(opts: { sessionId: string; reason?: string }): Promise<void> {
    await this.core!.abort(opts.sessionId, opts.reason);
  }

  subscribe(opts: { sessionId: string }, cb: (event: SessionEvent) => void): () => void {
    return this.core!.subscribe((e) => {
      if (e.sessionId === opts.sessionId) cb(e);
    });
  }

  async stop(): Promise<void> {
    await this.core?.stop();
    this.core = null;
  }
}
```

## Consequences

### Positive

- `setup()` returns in ~3 ms (was: 30s+ timeout under Cline; the
  Agent SDK has no port-read phase at all).
- No port, no password, no serve-info file. No `claude daemon`
  subprocess (Claude Code is in-process by default).
- Tests run in-process; no subshell needed.
- `InstanceManager` runs in "bg-only mode" (http/serve/stream all
  null) — the plugin tracks state, the dashboard owns the actual
  Claude Code session lifecycle.
- The dashboard's `bg-spawner.mjs` uses the same `ClaudeSdkRuntime`
  API in-process, so background-agent spawns go through the same
  runtime.

### Negative

- The plugin's `setup()` now depends on the provider-credentials
  check inside `AgentSdk.create()`. If no creds are present, the
  plugin falls back gracefully (logs a warning, skips the team
  tools, continues with the 17 non-team tools).
- The `clineruntime.ts` is the only Claude Code coupling in the
  plugin; if `@anthropic-ai/claude-agent-sdk` adds breaking
  changes, only this file needs to be updated.

### Neutral

- The HTTP API on the dashboard (`POST /api/background`, etc.) is
  unchanged. It's now used to coordinate with the dashboard's
  in-process `ClaudeSdkRuntime` instead of the plugin's subprocess.

## Implementation notes

- `AgentSdk.create()` is async; the plugin's `initRuntime()` is
  also async, so no API breakage.
- `core.send` is typed as `runTurn` with an object input, so the
  wrapper uses a defensive type cast.
- `subscribe()` returns an unsubscribe function; the runtime
  preserves this contract.
- v6.3.0 (DEC-011) renamed the wrapper class from `ClineRuntime`
  to `ClaudeSdkRuntime`; the file path stays at
  `plugins/bizar/src/clineruntime.ts` for back-compat with the
  plugin manifest.

## References

- `plugins/bizar/src/clineruntime.ts` (160 lines)
- `plugins/bizar/index.ts` — `initRuntime` (the only caller)
- `bizar-dash/src/server/bg-spawner.mjs` — same pattern in the
  dashboard
