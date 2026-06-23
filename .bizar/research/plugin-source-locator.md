# Plugin Source Code Locator

## Plugin entry point
- **`plugins/bizar/index.ts`** (1246 lines) — default-exported `Plugin` function (line 254). Wraps `init()` in try/catch. Builds the `Hooks` object with 7 hooks + 7 tools. This is the single file opencode loads via `opencode.json` → `"./plugins/bizar/index.ts"`.

## Plugin hooks implemented
All defined in `buildHooks()` (line 702) in `plugins/bizar/index.ts`:
| Hook | File:Line | Purpose |
|------|-----------|---------|
| `experimental.chat.system.transform` | index.ts:810 | Pushes reasoning directive + pending loop injections into system prompt |
| `experimental.chat.messages.transform` | index.ts:831 | Strips `` blocks from assistant messages (v0.6.2) |
| `event` | index.ts:860 | Tracks `session.deleted` to clean up state |
| `chat.message` | index.ts:900 | Slash command detection, state seeding, message dedup |
| `tool.execute.before` | index.ts:1048 | Loop detection, fingerprinting, threshold escalation |
| `tool.execute.after` | index.ts:1120 | Records outcome, writes per-call log line |
| `dispose` | index.ts:1174 | Cleanup on plugin teardown (shutdown instances, close SSE, kill serve, clear serve-info) |
| `tool` | index.ts:1168 | Registers the 7 tools (see below) |

## HTTP Client
- **`plugins/bizar/src/http-client.ts`** (467 lines) — `HttpClient` class.
- Exported methods:
  - `createSession(opts, directory)` — `POST /api/session` (line 158)
  - `sendPrompt(opts, directory)` — `POST /api/session/{id}/prompt` (line 204)
  - `abortSession(sessionId, directory)` — `POST /api/session/{id}/abort` (line 243)
  - `listMessages(sessionId, directory)` — `GET /api/session/{id}/message` (line 279)
  - `fetchEventStream(directory, signal?)` — `GET /api/event?location[directory]=...` (line 323)
  - `healthCheck()` — `GET /health` (line 381)
- Auth: `Authorization: Basic base64("opencode:<password>")` (line 140)
- Timeout: 30s default via `AbortController` (line 136, `BIZAR_HTTP_TIMEOUT_MS`)
- Never throws — returns `HttpResult<T>` discriminated union
- Uses global `fetch` (Bun runtime), no `node:` imports

## Event stream
- **`plugins/bizar/src/event-stream.ts`** (574 lines) — `EventStream` class.
- One global SSE connection per plugin process: `GET /api/event?location[directory]=<worktree>`
- Auto-reconnect with exponential backoff (1s, 2s, 4s, ..., 30s cap)
- Handles two wire formats: direct events (`{type, properties: {sessionID}}`) and sync events (CloudEvents-style `{type: "sync", syncEvent: {type, data}}` with version suffix stripping)
- Dispatches to per-session handlers registered via `onSessionEvent(sessionId, handler)`
- Public methods: `connect()`, `disconnect()`, `onSessionEvent()`

## State files
### SessionState (loop detection state)
- **`plugins/bizar/src/state.ts`** (298 lines) — `StateStore` class
- Schema: `SessionState` — `{ sessionId, parentAgent, startedAt, lastActivityAt, turnCount, toolCalls[], warningsIssued, blocksTriggered }`
- Per-session async mutex, atomic writes via tmp+rename
- Stored at `~/.cache/bizar/<sessionID>.json` (or configured `stateDir`)

### BackgroundState (background agent state)
- **`plugins/bizar/src/background-state.ts`** (515 lines) — `BackgroundStateStore` class
- Schema: `BackgroundState` — `{ instanceId, sessionId, agent, status, startedAt, completedAt?, model, promptPreview, resultPreview?, error?, parentAgent, toolCallCount, lastEventAt?, lastToolOrTextAt?, interventionCount?, ... }`
- Per-instance async mutex, atomic writes
- Stored at `~/.cache/bizar/bg/<instanceId>.json`

### InstanceManager
- **`plugins/bizar/src/background.ts`** (1118 lines) — orchestrates the in-memory map of background instances
- Public methods: `add()`, `get()`, `list()`, `update()`, `kill()`, `restart()`, `collect()`, `rebuildInMemoryMap()`, `shutdownAll()`, `attachEventHandler()`, `disablePeriodicChecks()`, `runStallAndLoopChecks()`
- Stalls and thinking-loop protection via periodic checker (15s interval)

## Tools
All tools live in `plugins/bizar/src/tools/`:

| Tool | File | Lines | Agent Access | Purpose |
|------|------|-------|-------------|---------|
| `bizar_spawn_background` | `tools/bg-spawn.ts` | 283 | Odin-only | Spawn async bg agent |
| `bizar_status` | `tools/bg-status.ts` | 99 | All agents | List/inspect bg instances |
| `bizar_collect` | `tools/bg-collect.ts` | 104 | Odin-only | Wait for result, return text |
| `bizar_kill` | `tools/bg-kill.ts` | 87 | Odin-only | Kill a running instance |
| `bizar_get_plan_comments` | `tools/bg-get-comments.ts` | 239 | All agents | Read comments on plan canvas |
| `bizar_plan_action` | `tools/plan-action.ts` | 767 | All agents | CRUD on plan canvas + meta |
| `bizar_wait_for_feedback` | `tools/wait-for-feedback.ts` | 402 | All agents | Poll until user feedback arrives |

All tools use `@opencode-ai/plugin`'s `tool()` factory and `zod` for schema validation. They never throw — errors are returned as JSON.

## Dashboard integration
The plugin communicates with the dashboard (separate process `bizar-dash/`) via an on-disk serve-info file:

- **Plugin side**: `plugins/bizar/src/serve-info.ts` (228 lines) — writes/reads/clears `serve.json` at `~/.cache/bizar/serve.json`
- **Dashboard side**: `bizar-dash/src/server/serve-info.mjs` (651 lines) — out-of-process reader for the same file. Walks multiple paths, re-reads on every call (no caching).
- **Bridge**: `bizar-dash/src/server/background-store.mjs` (402 lines) — reads bg state files from `~/.cache/bizar/bg/` to list instances in the dashboard UI
- **Task delegation**: `bizar-dash/src/server/task-delegator.mjs` — uses serve-info to reach the opencode serve child for dispatching tasks to bg agents

The plugin writes the file at init (after `ServeLifecycle.start()` succeeds) and clears it on signal/shutdown (index.ts:526-527). The dashboard reads it but does NOT subscribe to the plugin's SSE stream — currently the dashboard only does HTTP calls (abort, list sessions).

## Serve lifecycle (opencode serve child)
- **`plugins/bizar/src/serve.ts`** (496 lines) — `ServeLifecycle` class
- `Bun.spawn(["opencode", "serve", "--port", String(port), "--hostname", "127.0.0.1"], ...)`
- `OPENCODE_SERVER_PASSWORD` set in child env (32-byte base64 secret from `node:crypto`)
- Health check: poll `GET /health` with 100ms interval, 5s timeout
- Crash recovery: `proc.exited` callback + exponential backoff restart (250/500/1000ms, 3 tries)
- `--dangerously-skip-permissions` only added when `BIZAR_BACKGROUND_SKIP_PERMISSIONS=1`

## Build config
- **`plugins/bizar/package.json`**: `@polderlabs/bizar-plugin` v0.6.2. Deps: `zod: 4.1.8`. DevDeps: `@opencode-ai/plugin: ^1.17.7`, `@types/bun`, `typescript: ^5.6.0`. Peer dep: `@opencode-ai/plugin: >=1.17.0`
- **`plugins/bizar/tsconfig.json`**: Target ES2022, module ESNext, moduleResolution Bundler, strict mode, outDir `./dist`. Bun types.
- **Scripts**: `typecheck` (tsc --noEmit), `test` (bun test after import check), `check:imports` (bash script banning `node:crypto` except in serve.ts)
- **Build tool**: Bun (not node/npm for build). `bun.lock` instead of `package-lock.json`.

## Tests
30 test files at `plugins/bizar/tests/`:

| Test file | What it covers |
|-----------|----------------|
| `tests/state.test.ts` | StateStore (SessionState) |
| `tests/background.test.ts` | InstanceManager |
| `tests/background-state.test.ts` | BackgroundStateStore |
| `tests/event-stream.test.ts` | EventStream |
| `tests/event.test.ts` | Event dispatch logic |
| `tests/http-client.test.ts` | HttpClient |
| `tests/serve.test.ts` | ServeLifecycle |
| `tests/loop.test.ts` | Loop detection logic |
| `tests/block.test.ts` | Block threshold behavior |
| `tests/stall-think.test.ts` | Stall + thinking-loop protection |
| `tests/options.test.ts` | Options parsing/clamping |
| `tests/fingerprint.test.ts` | Fingerprint generation |
| `tests/settings.test.ts` | SettingsStore |
| `tests/commands.test.ts` | Slash command parser |
| `tests/commands-impl.test.ts` | Side-effect executor |
| `tests/init-helpers.test.ts` | `withTimeout()` helper |
| `tests/config.test.ts` | Plugin config validation |
| `tests/dispose.test.ts` | Dispose/shutdown behavior |
| `tests/canonical-key-order.test.ts` | JSON key ordering |
| `tests/attach-handler-bug.test.ts` | v0.5.1 bugfix |
| `tests/update-deadlock.test.ts` | v0.3.0 deadlock fix |
| `tests/tools/bg-spawn.test.ts` | bizar_spawn_background |
| `tests/tools/bg-collect.test.ts` | bizar_collect |
| `tests/tools/bg-kill.test.ts` | bizar_kill |
| `tests/tools/bg-status.test.ts` | bizar_status |
| `tests/tools/bg-get-comments.test.ts` | bizar_get_plan_comments |
| `tests/tools/plan-action.test.ts` | bizar_plan_action |
| `tests/tools/wait-for-feedback.test.ts` | bizar_wait_for_feedback |
| `tests/integration/tool-routing.test.ts` | Tool routing integration |
| `tests/integration/slash-command.test.ts` | Slash command integration |

Tests use `bun test`. Run with `bun test` or `npm test` (which also runs `check:imports` first).

## Source directory tree
```
plugins/bizar/
├── index.ts                    # Plugin entry point (1246 lines)
├── package.json                # @polderlabs/bizar-plugin v0.6.2
├── tsconfig.json               # ES2022, ESNext, Bundler
├── LICENSE
├── README.md
├── bun.lock
├── scripts/
│   └── check-forbidden-imports.sh
├── src/
│   ├── background.ts           # InstanceManager (1118 lines)
│   ├── background-state.ts     # BackgroundState + BackgroundStateStore (515 lines)
│   ├── commands.ts             # Slash command parser
│   ├── commands-impl.ts        # Side-effect executor
│   ├── event-stream.ts         # SSE subscription (574 lines)
│   ├── fingerprint.ts          # Tool call fingerprinting
│   ├── handoff.ts              # Handoff signal
│   ├── http-client.ts          # HTTP client (467 lines)
│   ├── logger.ts               # Logger wrapper (144 lines)
│   ├── loop.ts                 # Loop detection decision engine
│   ├── options.ts              # Plugin option normalization (421 lines)
│   ├── plan-fs.ts              # Plan filesystem helpers
│   ├── reasoning-clean.ts      # Inline think block stripping
│   ├── report.ts               # Log writer
│   ├── research-prompt.ts      # Intervention prompt builder
│   ├── serve.ts                # ServeLifecycle (496 lines)
│   ├── serve-info.ts           # serve.json bridge (228 lines)
│   ├── settings.ts             # SettingsStore
│   ├── state.ts                # SessionState + StateStore (298 lines)
│   ├── tools/
│   │   ├── bg-collect.ts       # bizar_collect (104 lines)
│   │   ├── bg-get-comments.ts  # bizar_get_plan_comments (239 lines)
│   │   ├── bg-kill.ts          # bizar_kill (87 lines)
│   │   ├── bg-spawn.ts         # bizar_spawn_background (283 lines)
│   │   ├── bg-status.ts        # bizar_status (99 lines)
│   │   ├── plan-action.ts      # bizar_plan_action (767 lines)
│   │   └── wait-for-feedback.ts # bizar_wait_for_feedback (402 lines)
├── tests/                      # 30 test files (see table above)
└── dist/                       # Compiled output
```
