# DEC-002 — In-process ClineCore (no `cline serve` subprocess)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @tyr
**Related:** DEC-001, DEC-005

## Context

The legacy plugin spawned `cline serve` as a child subprocess.
The subprocess exposes an HTTP + SSE API on a random port with a
random password, persisted to a serve-info file at
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

```ts
// plugins/bizar/src/clineruntime.ts (excerpt)
import { ClineCore } from "@cline/core";

export class ClineRuntime {
  private core: ClineCore | null = null;

  async start(): Promise<void> {
    this.core = await ClineCore.create({ clientName: "bizar-plugin" });
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

  subscribe(opts: { sessionId: string }, cb: (event: CoreSessionEvent) => void): () => void {
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

- `setup()` returns in ~3 ms (was: 30s+ timeout).
- No port, no password, no serve-info file.
- Tests run in-process; no subshell needed.
- `InstanceManager` runs in "bg-only mode" (http/serve/stream all
  null) — the plugin tracks state, the dashboard owns the actual
  Cline session lifecycle.
- The dashboard's `bg-spawner.mjs` uses the same `ClineCore` API
  in-process, so background-agent spawns go through the same
  runtime.

### Negative

- The plugin's `setup()` now depends on the provider-credentials
  check inside `ClineCore.create()`. If no creds are present, the
  plugin falls back gracefully (logs a warning, skips the team
  tools, continues with the 17 non-team tools).
- The `clineruntime.ts` is the only Cline coupling in the plugin;
  if `@cline/core` adds breaking changes, only this file needs to
  be updated.

### Neutral

- The HTTP API on the dashboard (`POST /api/background`, etc.) is
  unchanged. It's now used to coordinate with the dashboard's
  in-process `ClineCore` instead of the plugin's subprocess.

## Implementation notes

- `ClineCore.create()` is async; the plugin's `initRuntime()` is
  also async, so no API breakage.
- `cline.send` is typed as `runTurn` with an object input, so the
  wrapper uses a defensive type cast.
- `subscribe()` returns an unsubscribe function; the runtime
  preserves this contract.

## References

- `plugins/bizar/src/clineruntime.ts` (160 lines)
- `plugins/bizar/index.ts` — `initRuntime` (the only caller)
- `bizar-dash/src/server/bg-spawner.mjs` — same pattern in the
  dashboard
