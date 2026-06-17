# Bizar Plugin — Background Agent System (v0.4 spec, for Forseti review)

> **Status:** Draft. Reuses the v0.3.1 plugin core; adds background-agent capability.
> **Goal:** Asynchronous background agents with full integration into existing state store, log writer, loop detection, and Odin orchestration.

## What This Adds

The v0.3.1 plugin can already do loop detection, status logging, and handoff injection for **synchronous** subagents (the ones Odin spawns via the built-in `task` tool). What's missing is the ability to:

1. **Run agents in the background** — the calling agent returns immediately while the spawned agent works asynchronously.
2. **Run multiple instances of the same agent concurrently** — two Mimir instances doing different research at the same time.
3. **Surface status to Odin** — Odin (or any user-accessible agent) can ask "what's running, what's done, what's stuck?".
4. **Reuse existing systems** — loop detection, state store, log writer, fingerprinting, secret-dir refusal, env var disable all apply to background instances too.

## Architecture: One `opencode serve`, Many Sessions, Custom Tools

### Why a single `opencode serve` instance (verified via opencode source)

Per Mimir's research on the opencode source:

- `opencode run` with no `--attach` flag spins up its own **in-process** HTTP server per invocation (no port exposure, no singleton). Each invocation is a new process. State is shared via SQLite at `~/.local/share/opencode/opencode.db` (WAL mode — safe for concurrent readers).
- `opencode serve --port PORT` starts a long-lived HTTP server. Default port 4096, falls back to random port if busy. Multiplexes sessions over one process. No singleton check.
- A plugin's `execute` function can call `Bun.spawn` to launch `opencode serve`, then talk to it via HTTP.

**Decision:** The plugin starts ONE `opencode serve` instance on init. All background agents are created as separate sessions on that server. The plugin's tools talk to the server via HTTP. This avoids per-spawn cold boots, reuses provider connections, and gives us a single PID to track for cleanup.

### Lifecycle

```
Plugin init (index.ts config hook)
  └─> startServe() — spawns `opencode serve --port 4096` (or random if 4096 busy)
       └─> blocks until health check returns 200
       └─> registers servePID in background state

First tool call (bizar_spawn_background)
  └─> HTTP POST /session (creates new session)
  └─> HTTP POST /session/:id/prompt_async (sends prompt, returns 204)
  └─> returns instance ID immediately to the calling agent

Plugin dispose (index.ts dispose hook)
  └─> kill all running instance processes
  └─> kill servePID
  └─> clean up state files
```

### Custom tools (4)

All tools are registered via the plugin's `tool:` namespace per the opencode plugin API. The `execute` function is async. The agent sees them alongside built-in tools.

| Tool | Args | Returns | Purpose |
|---|---|---|---|
| `bizar_spawn_background` | `agent: string` (required), `prompt: string` (required), `model?: string`, `timeoutMs?: number` (default 300000 = 5 min) | `{ instanceId: string, sessionId: string, status: "running" }` | Spawn a new background agent. Returns immediately. |
| `bizar_status` | `instanceId?: string` (omit for all) | Array of `{ instanceId, agent, status, startedAt, toolCallCount, resultPreview?, error? }` | Get status of one or all background instances. Status is `pending`, `running`, `done`, `failed`, `killed`, or `timed_out`. |
| `bizar_collect` | `instanceId: string`, `timeoutMs?: number` (default 60000) | `{ instanceId, status, result: string, toolCallCount, durationMs }` | Block until the instance completes (or timeout). Returns the result. |
| `bizar_kill` | `instanceId: string` | `{ instanceId, status: "killed" }` | Terminate a running instance. |

### Per-instance state (extends existing SessionState)

The background system reuses the existing `~/.cache/bizarharness/<sessionId>.json` state file. Two new fields are added to `SessionState`:

```ts
{
  // ... existing fields ...
  isBackground: boolean;        // true for background instances, false/undefined for sync subagents
  parentInstanceId?: string;    // for nested spawns (background agent spawning another background)
  backgroundStatus: "pending" | "running" | "done" | "failed" | "killed" | "timed_out";
  backgroundStartedAt?: number; // epoch ms
  backgroundCompletedAt?: number;
  backgroundResult?: string;    // last assistant message when done
  backgroundError?: string;     // error message if failed/killed/timed_out
  backgroundAgent: string;      // which agent was spawned (e.g. "mimir", "thor")
}
```

The existing `toolCalls` array, fingerprint logic, loop detection, and log writer all work as-is for background instances. **No new state files. No new state directories.** Just two new fields in the existing schema.

### Per-instance log (extends existing report.ts)

Background instances log to the same `~/.cache/bizarharness/logs/<sessionId>.log` path. The metadata-only log line gets ONE additional field:

```
2026-06-17T14:30:01.123Z agent=mimir tool=read fingerprint=ab12cd outcome=ok duration=45ms bg=true parent=odin-inst-abc123
```

The `LogWriter.write` method already takes an `event` object — just add an optional `isBackground: boolean` and `parentInstanceId?: string` to the type. Existing tests pass unchanged.

### Concurrency model

- ONE `opencode serve` process (PID tracked).
- N concurrent sessions on that server (one per background instance).
- Each session is an independent conversation with its own state.
- Multiple instances of the SAME agent type (e.g., 3 Mimirs doing different research) just create 3 sessions — the server multiplexes them.
- The plugin enforces a `maxConcurrentInstances` cap (default 8) to prevent resource exhaustion. If the cap is hit, `bizar_spawn_background` returns an error.

### Loop detection integration

The existing per-session loop detection in `loop.ts` already works for any session. Background sessions are no different. The fingerprint counter, the 5/8/12 thresholds, the handoff injection via `experimental.chat.system.transform`, and the hard-block at 12 all apply identically.

This means: a background agent that loops is detected, warned, and eventually blocked — same as a sync subagent. The only difference is that the blocked instance is a background process. The plugin should:

- Mark the instance as `failed` with `backgroundError: "Loop protection: 12 identical calls..."`.
- NOT call `dispose` on the whole plugin (the instance is dead, but the serve process and other instances are fine).
- Surface the loop-guard marker in the result so Odin can decide what to do.

### Status reporting to Odin

Odin calls `bizar_status` (no args) to get a table of all background instances. Format:

```json
[
  {
    "instanceId": "bgr-1a2b3c",
    "agent": "mimir",
    "status": "running",
    "startedAt": 1718628000000,
    "toolCallCount": 47,
    "durationMs": 12340,
    "resultPreview": "Reading src/auth/login.ts..."
  },
  {
    "instanceId": "bgr-4d5e6f",
    "agent": "thor",
    "status": "done",
    "startedAt": 1718627900000,
    "toolCallCount": 12,
    "durationMs": 8765,
    "resultPreview": "Renamed foo → bar in 3 files."
  }
]
```

This is a clean, parseable view. Odin can poll this periodically, or call `bizar_collect(instanceId)` to wait for a specific instance.

### Odin prompt additions

A new section in `config/agents/odin.md`:

```markdown
## Background Agents (Asynchronous Work)

When a sub-task is large or can run independently, spawn it as a **background agent** instead of using the synchronous `task` tool. This lets the main conversation continue while the background work progresses.

### When to use background vs sync

| Use background when... | Use sync `task` when... |
|---|---|
| The result isn't needed for the next response | The next step depends on the result |
| The work is research-y, exploratory, or can be polled | The work is a small edit or quick check |
| You want to run multiple independent tasks in parallel | You need a strict sequence |
| The user said "do X and Y in parallel" | The user said "do X, then Y" |

### How to spawn

Call `bizar_spawn_background` with:
- `agent`: the agent name (e.g. "mimir", "thor", "tyr")
- `prompt`: what to do (be specific, give context)
- `model`: optional override (default: the agent's configured model)
- `timeoutMs`: optional (default 5 min, max 30 min)

You get back an `instanceId` immediately.

### How to monitor

Call `bizar_status` (no args) to see all background instances. Call `bizar_status(instanceId)` for one. The result includes `status`, `toolCallCount`, `durationMs`, and a `resultPreview`.

### How to collect

When you're ready for the result, call `bizar_collect(instanceId, timeoutMs)`. This blocks until the instance completes or times out. Returns the result string and metadata.

If an instance timed out, you can:
- Call `bizar_collect` again with a longer timeout (it'll keep waiting).
- Call `bizar_kill(instanceId)` to give up.

### Loop guard handling (existing protocol still applies)

If a background instance's result begins with `[BLOCKED: loop guard]` or contains a `Loop protection: 12 identical calls` error, treat it as failed. Read `~/.cache/bizarharness/logs/<sessionId>.log` for the full tool history, then either:
- Re-spawn the same task with a clearer prompt
- Dispatch to a different agent tier
- Kill it and report failure to the user

### Limits

- Max 8 concurrent background instances. If you hit the cap, wait for one to finish or kill it.
- Default timeout 5 min. Set longer for genuinely long tasks; set shorter to fail fast.
```

### Other agent prompt updates (minimal)

The other agents (Mimir, Thor, Tyr, etc.) need only a small change — they're NOT the ones spawning background agents (only Odin/Vör/Frigg/Quick are primary agents who can call tools). But any of them CAN be spawned AS a background agent. The subagent prompt changes are zero — they just run normally inside the background session. Loop guard handling is already in their prompts from v0.3.1.

## What This Doesn't Add (out of scope for v0.4)

- **HTTP API client library** — just use `fetch` directly. Don't pull in axios/got/etc.
- **Web UI for background agents** — the TUI is the UI. `bizar_status` is the command.
- **Persistent queue** — if opencode exits, background instances are killed. State on disk is preserved so you can see what was running.
- **Auto-retry on instance failure** — Odin decides whether to retry based on the result.
- **Cross-instance communication** — background instances don't talk to each other. They report results to Odin.
- **Background agents for non-Odin primary agents** — Vör/Frigg/Quick are read-only or quick-task. They can call `bizar_status` to see what Odin spawned, but they don't spawn their own background work.

## Files That Change

### New files (8)

```
plugins/bizar/src/
├── background.ts          # InstanceManager — tracks PIDs, session IDs, lifecycle
├── serve.ts               # ServeLifecycle — start/stop opencode serve, health check
├── http-client.ts         # Typed client for opencode HTTP API (sessions, messages, events)
└── tools/
    ├── bg-spawn.ts        # bizarre_spawn_background tool
    ├── bg-status.ts       # bizarre_status tool
    ├── bg-collect.ts      # bizarre_collect tool
    └── bg-kill.ts         # bizarre_kill tool
```

### New tests (5)

```
plugins/bizar/tests/
├── background.test.ts     # InstanceManager unit tests
├── serve.test.ts          # ServeLifecycle unit tests (mock Bun.spawn)
├── http-client.test.ts    # HTTP client unit tests (mock fetch)
└── tools/
    ├── bg-spawn.test.ts
    ├── bg-status.test.ts
    ├── bg-collect.test.ts
    └── bg-kill.test.ts
```

(Tests in subdir for organization; bun test still finds them via `bun test tests/`.)

### Modified files (5)

```
plugins/bizar/
├── index.ts               # Start serve on init, register tools, add dispose hook
├── src/state.ts           # Add 2 fields to SessionState (isBackground, parentInstanceId, etc.)
├── src/report.ts          # Add isBackground + parentInstanceId to LogEvent type
├── src/options.ts         # Add maxConcurrentInstances option (default 8), servePort option (default 4096)
└── src/logger.ts          # (no changes expected — but verify dispose logs work)

config/agents/odin.md      # Add the "Background Agents" section above
config/opencode.json       # (verify tools are allowed — likely already allowed)
```

### New env vars (3)

- `BIZAR_SERVE_PORT` — port for the opencode serve instance (default 4096, falls back to random)
- `BIZAR_MAX_CONCURRENT_INSTANCES` — cap on concurrent background instances (default 8, max 32)
- `BIZAR_SERVE_DISABLE=1` — disable the serve instance entirely (revert to v0.3.1 behavior — no background agents)

## Test Plan

### Unit tests

- `background.test.ts`: instance registration, status transitions, cleanup, max-concurrent enforcement
- `serve.test.ts`: start, health check retry, port fallback, stop, port-conflict detection
- `http-client.test.ts`: session create, message send, event stream parsing, error handling
- `tools/bg-*.test.ts`: each tool's args validation, return shape, error cases

### Integration test in dev sandbox

1. Build image: `cd BizarHarness-dev && ./scripts/dev.sh --rebuild`
2. Launch sandbox with API keys set in `.env`
3. Verify `opencode serve` starts on init
4. Run a script that:
   - Spawns 2 background Mimir instances (research task A and B)
   - Spawns 1 background Thor instance (editing task C)
   - Polls `bizar_status` until all 3 complete
   - Asserts all 3 have results
   - Asserts the 2 Mimirs ran concurrently (overlapping timestamps in their logs)
5. Run a script that:
   - Spawns a background Mimir with a prompt designed to loop (e.g., "find all .ts files and cat them 20 times")
   - Polls `bizar_status` until the loop-guard threshold is hit
   - Asserts the instance status is `failed` with `backgroundError: "Loop protection..."`
6. Run a script that:
   - Spawns 9 background instances (above the default 8 cap)
   - Asserts the 9th call returns an error about the cap
7. Run cleanup: kill the sandbox, restart, verify state files persist and the next run picks them up correctly

## Open Questions for Forseti

1. **`opencode serve` port conflicts** — what if port 4096 is already in use by another opencode instance on the host? The serve command's `startWithPortFallback` tries 4096 then port 0 (random). Should the plugin use 0 from the start (random) to avoid conflicts, or use 4096 + fallback? Random is safer for sandbox use; 4096 is friendlier for debugging.

2. **Session ID stability** — when the plugin calls `POST /session`, opencode returns a session ID. The plugin stores this as the instance ID (or maps instance ID → session ID). If the user opens the opencode TUI, will they see the background sessions? If yes, that's a feature (they can see what their background agents are doing in real time). If no, we need to make sure session IDs are namespaced so they don't clash with the user's main session.

3. **Long-running sessions** — if a background agent's task naturally takes 10 minutes, and our default timeout is 5 min, the instance will be killed. Should the default be longer (15 min)? Or should we have separate timeouts for "expected duration" vs "max duration"?

4. **Loop-guard behavior in background context** — when threshold 12 is hit in a background session, the `tool.execute.before` throws. This surfaces as a tool error to the agent. In a sync context, the parent (Odin) sees this in the result. In a background context, the same thing happens, but the result is stored in `backgroundResult`/`backgroundError`. Should the plugin ALSO inject a "loop-guard" marker into the result string so Odin (when it calls `bizar_collect`) can see `[loop guard: 12 identical calls to <tool>]` in the text? This would let Odin's existing recognition patterns work unchanged.

5. **`dangerously-skip-permissions`** — `opencode run` defaults to auto-rejecting permission requests in non-interactive mode. To avoid the agent getting stuck on a `bash` permission prompt, we need to either pass `--dangerously-skip-permissions` to the serve instance, or configure the agent's permissions to allow everything. The latter is safer (the user's permission config still applies). What's the right default?

6. **The `dispose` hook only fires on plugin unload** — what about when the user just quits the TUI normally? Does opencode call `dispose` on the plugin? If not, background instances become orphans. We need a SIGTERM trap in the plugin's index.ts.

7. **State file contention** — multiple background instances writing to the same `~/.cache/bizarharness/logs/` dir. The existing per-session mutex (per session ID) handles this — different session IDs don't block each other. Confirm this is enough.

8. **Tool call attribution** — the existing `LogWriter.write` accepts `agent: string | null`. In a background context, we should pass the agent name (e.g., "mimir"). The session ID is the key. Confirm this is right.

## Release Criteria (extends v0.3.1 list)

- `bun test` passes for ALL new test files AND all existing tests (no regressions)
- `./scripts/dev.sh --rebuild` succeeds
- Integration test in dev sandbox: 2 concurrent Mimirs + 1 Thor all complete with results, with overlapping timestamps in their logs
- Loop-guard integration test: a forced-loop background instance is marked `failed` with the right error string
- Max-concurrent enforcement: 9th concurrent spawn returns a clear error
- Plugin dispose (in tests): kills the serve child + all running instances; leaves no orphan processes
- README updated: "Background Agents" section explaining the 4 tools, with a small example

## Estimated Implementation Time

- background.ts + serve.ts + http-client.ts: 2-3 hours
- 4 tool files: 1-2 hours
- 5 test files: 2-3 hours
- Odin prompt + config updates: 30 min
- Integration test in dev sandbox: 1-2 hours
- **Total: 7-10 hours of work, split across Thor and Tyr**

## Why This Is the Right Design (Quick Rationale)

1. **Single serve instance, multiple sessions** — opencode's architecture explicitly supports this. No per-spawn cold boots, no port gymnastics.
2. **Custom tools, not a separate API** — the user accesses background agents via the same `task`-like tool interface, in the same conversation flow.
3. **Reuse state store + log writer + loop detection** — the user asked for "fully integrated." This isn't a separate system bolted on; it's an extension of what already exists.
4. **Concurrent same-agent instances** — opencode's session model is the natural unit of concurrency. Multiple Mimirs are just multiple sessions on the same server.
5. **Odin orchestrates** — the tools are available to any agent, but only Odin is documented to use them. Other agents use the tools reactively (e.g., a Mimir could call `bizar_status` to see if a parallel research task is done before continuing its own work).
6. **Clean lifecycle** — `dispose` hook + PID tracking + per-instance timeouts = no orphan processes.
