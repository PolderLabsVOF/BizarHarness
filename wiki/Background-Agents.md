# Background Agents

Background agents are asynchronous subagents that Odin can spawn without blocking the main conversation. They run on a single shared `opencode serve` instance, are managed by the Bizar plugin, and are designed for independent work that doesn't need a tight coordination loop with the main agent.

This page documents the experimental v0.4 implementation. See [Bizar Plugin](Bizar-Plugin) for the underlying loop-detection and handoff machinery.

## When to use background vs sync

Use a background agent when **all three** of these are true:

1. The result is **not needed for the next response** (you can keep the main conversation moving).
2. The work is **self-contained** (research, exploration, isolated edit — not tight coordination).
3. It can run **independently of other in-flight work** (no dependency on another background's result).

If any of those is false, use sync `task` dispatch instead.

Common patterns:

- "Research how the auth module is structured" — Mimir in the background.
- "Generate test fixtures for the new module" — Heimdall in the background.
- "Implement feature X" (main conversation depends on it) — sync `task` to Thor.
- "Refactor the import order across the repo" (main conversation doesn't need to wait) — Heimdall in the background.

## The 4 tools

The plugin registers four custom tools, all prefixed with `bizar_`:

| Tool | Privilege | Purpose |
|---|---|---|
| `bizar_spawn_background` | Odin only | Spawns a background agent. Returns `{ instanceId, sessionId, status: "pending" }`. |
| `bizar_status` | Any agent | Lists all instances (or one). Read-only. |
| `bizar_collect` | Odin only | Blocks until the instance completes or times out. Returns `{ instanceId, status, result, toolCallCount, durationMs, error? }`. |
| `bizar_kill` | Odin only | Aborts the running instance. Returns `{ instanceId, status: "killed" }`. |

Only Odin can spawn, collect, or kill background agents. Vör, Frigg, and Quick (the other primary agents) can call `bizar_status` to inspect progress, but they cannot modify background state. This is enforced at the tool's `execute` function.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Odin (primary)                        │
│   Task tool: task(subagent_type="thor", ...) — sync     │
│   Custom tool:  bizar_spawn_background(...) — async     │
└──────────────────────────────────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │   Bizar plugin (v0.4+)        │
                │   • InstanceManager          │
                │   • BackgroundState store    │
                │   • SSE event subscription    │
                └──────────────────────────────┘
                                │
                                ▼
                ┌──────────────────────────────┐
                │  opencode serve (one child)  │
                │  --port <port>               │
                │  --hostname 127.0.0.1        │
                │  Bound to 127.0.0.1 only     │
                │  Auth: Basic + random secret │
                └──────────────────────────────┘
                                │
                ┌───────────────┼───────────────┐
                ▼               ▼               ▼
        ┌──────────┐    ┌──────────┐    ┌──────────┐
        │ bg Mimir │    │ bg Thor  │    │ bg Tyr   │
        │ session  │    │ session  │    │ session  │
        └──────────┘    └──────────┘    └──────────┘
```

The plugin starts **one** `opencode serve` process on init. All background sessions share this process. The plugin subscribes to a single SSE event stream on init and dispatches incoming events to the in-memory instance map. There are no per-instance HTTP connections — the single SSE stream handles all event delivery.

The serve child binds to `127.0.0.1` (never `0.0.0.0`) and authenticates with a random 32-byte secret generated on plugin init. The secret is passed via the `OPENCODE_SERVER_PASSWORD` env var to the serve child and is held in memory only — never written to disk. When the plugin process exits, the serve child is killed and the secret becomes invalid.

## Spawning a background agent

Inside Odin's task decomposition, the call looks like:

```typescript
const result = await bizarre_spawn_background({
  agent: "mimir",                  // which agent to run
  prompt: "Research X and return findings",
  model: "minimax/MiniMax-M3",     // optional — overrides the agent default
  timeoutMs: 300_000,              // optional — default 5 min, max 30 min
}, ctx);

console.log(result.instanceId);    // "bgr_01ARSH3J5V..."
console.log(result.sessionId);     // opencode session ID
console.log(result.status);        // "pending"
```

The `model` parameter is parsed on the first `/`: `"minimax/MiniMax-M3"` → `{ providerID: "minimax", modelID: "MiniMax-M3" }`. Anything other than exactly two parts is rejected with a clear error.

The `timeoutMs` parameter is clamped to `[1000, 1800000]` (1 second to 30 minutes). Out-of-range values are rejected.

## Checking status

```typescript
// All instances
const all = await bizarre_status({}, ctx);

// One instance
const one = await bizarre_status({ instanceId: "bgr_01ARSH..." }, ctx);
```

The status response includes `instanceId`, `agent`, `status`, `startedAt`, `toolCallCount`, `promptPreview`, `resultPreview`, `error`, `parentAgent`, and (for nested spawns, not yet supported) `parentInstanceId`.

The status translation table:

| opencode event | bg `BackgroundState.status` |
|---|---|
| `EventSessionIdle` | `done` |
| `EventSessionStatus` with `idle` | `done` |
| `EventSessionStatus` with `busy` | `running` |
| `EventSessionStatus` with `retry` | `running` (with warning logged) |
| `EventSessionError` | `failed` |
| Threshold-12 throw captured | `failed` |
| `bizar_kill` called | `killed` |
| `timeoutMs` reached | `timed_out` |
| Serve child died | `failed` |
| Plugin shutdown | `failed` |

## Collecting results

```typescript
const r = await bizar_collect({
  instanceId: "bgr_01ARSH...",
  timeoutMs: 120_000,  // optional override
}, ctx);

console.log(r.status);          // "done" | "failed" | "killed" | "timed_out"
console.log(r.result);          // concatenated assistant text
console.log(r.toolCallCount);   // how many tool calls the instance made
console.log(r.durationMs);      // wall-clock time
```

On collect, the plugin fetches all assistant messages from the opencode session, concatenates the text parts in order, and returns the result. Tool parts, reasoning parts, step parts, and snapshots are skipped.

If the threshold-12 loop-guard throw was captured during the instance's run, the result is prepended with `[loop guard: 12 identical calls to <tool>]` as a marker. Treat the instance as failed.

If the timeout fires before terminal state, the call returns the partial result with `status: "running"` and `error: "collect timed out after <ms>ms"`. The caller (Odin) is then responsible for retrying, status-checking, or killing.

## Killing an instance

```typescript
await bizar_kill({ instanceId: "bgr_01ARSH..." }, ctx);
```

`bizar_kill` calls `POST /session/{id}/abort` (operationId `session.abort`, returns `200: boolean`). It does **not** delete the session record. After abort, the next event is `EventSessionIdle` (or `EventSessionError`); the plugin updates the instance status to `killed`.

Note: `bizar_kill` aborts the opencode session, not the plugin's in-memory tracking. Both are updated.

## Limits and security

- **Max 8 concurrent background instances.** If you hit the cap, wait for one to finish or call `bizar_kill`. The cap is configurable via `BIZAR_MAX_CONCURRENT_INSTANCES`.
- **Per-instance tool-call cap: 500.** Configurable via `BIZAR_BACKGROUND_TOOL_CALL_CAP`. The plugin auto-aborts instances that hit it to prevent cost runaway.
- **Localhost only.** The serve child binds to `127.0.0.1`. Never exposed externally.
- **Random shared secret.** Generated on plugin init, passed via env var to the serve child, held in memory only.
- **Odin-only spawn.** Other agents can call `bizar_status` (read-only) but not `bizar_spawn_background`, `bizar_collect`, or `bizar_kill`.
- **Permissions default: respected.** The serve child does not pass `--dangerously-skip-permissions` by default. Set `BIZAR_BACKGROUND_SKIP_PERMISSIONS=1` to opt in (not recommended).

## Odin usage example

```typescript
// Odin decomposes a task and spots two independent research branches
const [resultA] = await Promise.all([
  bizarre_spawn_background({
    agent: "mimir",
    prompt: "Research feature X. Return file:line references and a 1-page summary.",
    timeoutMs: 300_000,
  }, odinCtx),
  // Branch 2: sync work doesn't block the main conversation
  // task(subagent_type="thor", prompt="Implement feature Y", ...)
]);

// Continue the main conversation while background work runs
appendMessage("Background research launched for feature X.");

// Later, collect when needed
const findings = await bizar_collect({
  instanceId: resultA.instanceId,
  timeoutMs: 120_000,
}, odinCtx);
console.log(findings.result);
```

## Prompt content warning

The `prompt` argument to `bizar_spawn_background` is sent verbatim to the LLM in the background session. **Do not include untrusted external content** (raw web pages, untrusted file contents, untrusted user input) in the prompt. The LLM may act on it as if it were instructions. Summarize or sanitize first.

## Known limitations

1. **Threshold-5/8 in background are not visible to Odin.** They happen in the background session's LLM context. Odin only sees the threshold-12 marker in the result. Developers can see threshold-5/8 in the plugin log.
2. **Loop-guard markers are added at collect time, not stored.** `resultPreview` does not contain the marker; `bizar_collect` prepends it.
3. **File-level races between concurrent background agents are the user's problem.** The plugin does not coordinate file access between instances.
4. **Loop-guard detection requires SSE events.** If the SSE stream is dropped, the plugin may miss the threshold-12 throw until reconnect.
5. **No nested spawns in v0.4.** `parentInstanceId` is reserved but no tool exposes background-to-background spawning.
6. **Serve child is per-process.** Multiple worktrees in the same plugin process share one SSE subscription — not supported for multi-worktree setups.
7. **Password is in-memory only.** Restarting the plugin generates a new password; old `BackgroundState` files point to sessions in the old serve child.
8. **`bizar_collect` on a killed/failed instance returns the partial result.** It does not retry.
9. **The `model` parameter is not validated.** opencode will reject unknown providers/models with a 4xx.
10. **Custom agents without loop-guard instructions will not see the marker as a task cue.**

## Next steps

Next: [Dev Sandbox](Dev-Sandbox) — the Docker-based development environment for testing changes to the harness and plugin without touching your real `~/.config/opencode/`.
