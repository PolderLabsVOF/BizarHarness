# Bizar opencode plugin

A BizarHarness-bundled opencode plugin that gives Odin better visibility into
subagent activity and a mechanism to stop or reassign agents that are stuck.
It does three things:

1. **Loop detection** — fingerprint tool calls and warn/block on repetition.
2. **Periodic status reporting** — log subagent activity so Odin (and the
   human) can see what is happening.
3. **Handoff signal** — when a subagent is clearly stuck, inject a message
   that nudges it (or the parent) to reassign via the `task` tool.

The plugin is specified in `.bizar/plugin-architecture-v0.3.md` and
implemented against that contract. v0.4.0 adds slash commands and the
visual-plan flow (settings store, slash command parser, plan action
tool, and wait-for-feedback tool).

## Install

The plugin is copied to `<project>/.opencode/plugins/bizar/` by the
BizarHarness install script. After install, the layout is:

```
<project-root>/
└── .opencode/
    ├── opencode.json
    └── plugins/
        └── bizar/
            ├── package.json
            ├── tsconfig.json
            ├── README.md
            ├── index.ts
            ├── scripts/
            │   └── check-forbidden-imports.sh
            ├── src/
            │   ├── loop.ts
            │   ├── handoff.ts
            │   ├── logger.ts
            │   ├── options.ts
            │   ├── fingerprint.ts
            │   ├── state.ts
            │   └── report.ts
            └── tests/
                ├── loop.test.ts
                ├── block.test.ts
                ├── fingerprint.test.ts
                ├── state.test.ts
                ├── event.test.ts
                ├── options.test.ts
                └── integration.test.ts
```

`opencode.json` references the plugin via the relative path
`./plugins/bizar/index.ts` (relative to the config directory).

## Options

Plugin options are passed as the second element of the `plugin` tuple in
`opencode.json`:

```jsonc
"plugin": [
  ["./plugins/bizar/index.ts", {
    "loopThresholdWarn": 5,
    "loopThresholdEscalate": 8,
    "loopThresholdBlock": 12,
    "loopWindowSize": 10,
    "logDir": "~/.cache/bizar/logs",
    "stateDir": "~/.cache/bizar",
    "logRotationBytes": 10485760
  }]
]
```

All options are optional. Missing options fall back to the defaults. Bad
input is clamped, never rejected — the plugin never throws on bad config.

| Option | Default | Clamp / behavior |
|---|---|---|
| `loopThresholdWarn` | `5` | `Math.max(1, Math.floor(value))`. Out-of-order: `escalate = warn + 1`, `block = escalate + 1`. |
| `loopThresholdEscalate` | `8` | `Math.max(1, Math.floor(value))`. |
| `loopThresholdBlock` | `12` | `Math.max(1, Math.floor(value))`. Constrained: `block <= loopWindowSize + 2`. |
| `loopWindowSize` | `10` | Clamped to `[3, 50]`. |
| `logDir` | `~/.cache/bizar/logs` | Refused if inside `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, `~/.kube/`. |
| `stateDir` | `~/.cache/bizar` | Refused if inside a secret directory (same list as `logDir`). |
| `logRotationBytes` | `10485760` (10 MB) | `Math.max(1024, Math.floor(value))`. |
| `backgroundStallTimeoutMs` | `180000` (3 min) | v0.3.0 — stall timeout in ms. Clamped to `[10000, 600000]`. |
| `backgroundThinkingLoopTimeoutMs` | `300000` (5 min) | v0.3.0 — thinking-loop timeout in ms. Clamped to `[30000, 900000]`. |
| `backgroundMaxInterventions` | `1` | v0.3.0 — max research interventions before forced abort. Clamped to `[1, 3]`. |

## Environment variables

| Env var | Effect |
|---|---|
| `BIZAR_DISABLE=1` | Disables the plugin entirely. The plugin returns empty hooks and logs once at debug level. |
| `BIZAR_DISABLE_LOOP=1` | Loop guard disabled (no fingerprint, no threshold check, no throw). Status reporting still active. |
| `BIZAR_DISABLE_LOG=1` | Status reporting disabled. Loop guard still active. |
| `BIZAR_LOG_LEVEL=debug\|info\|warn\|error` | Sets log verbosity. Default `info`. Invalid values fall back to `info` with a warning. |
| `BIZAR_STALL_TIMEOUT_MS` | v0.3.0 — overrides `backgroundStallTimeoutMs`. |
| `BIZAR_THINKING_LOOP_TIMEOUT_MS` | v0.3.0 — overrides `backgroundThinkingLoopTimeoutMs`. |
| `BIZAR_MAX_INTERVENTIONS` | v0.3.0 — overrides `backgroundMaxInterventions`. |

Env vars are read once at plugin init. Mid-session changes are ignored.

## How loop detection works

The plugin fingerprints every `tool.execute.before` call as a stable hash of
the tool name and the normalized arguments. It keeps a rolling window of the
last 10 (default) tool calls per session. When the count of matching
fingerprints in the window crosses a threshold, the plugin acts:

| Repetitions | Action | Mechanism |
|---|---|---|
| 3 (default) | Log a warning via `client.app.log`. **No injection.** | Diagnostic only. |
| 5 (default) | Inject a system message via `experimental.chat.system.transform`. | Subagent sees it on its next turn. |
| 8 (default) | Inject a stronger system message via `experimental.chat.system.transform`. | Subagent sees it on its next turn. |
| 12 (default) | **Block.** Throw from `tool.execute.before`. | Surfaces in the TUI as a tool error. |

The plugin's hard-block at threshold 12 runs BEFORE opencode's soft
`doom_loop` recovery. The plugin wins. See `.bizar/plugin-architecture-v0.3.md`
§3.3 for the interaction with the `doom_loop` permission.

## What the plugin does NOT do

- It does **not** modify user files.
- It does **not** call external APIs (no LLM calls, no telemetry).
- It does **not** override agent prompts (only injects ephemeral system
  messages into the current turn's context).
- It does **not** manage subagent lifecycle (opencode does that).
- It does **not** read environment variables other than the four listed above.
- It does **not** write outside `~/.cache/bizar/` by default.
- It does **not** register slash commands in v0.1.

## Background Agents

v0.4 adds **background agents** — asynchronous subagent execution via a single long-running `opencode serve` instance. Background agents enable Odin to parallelize independent work without blocking the main conversation.

### Architecture

The plugin starts one `opencode serve` process on init (single-serve, multi-session). All background sessions share this process. Each background instance is tracked in `BackgroundState` at `~/.cache/bizar/bg/<instanceId>.json`.

### The 4 tools

| Tool | Who can call | What it does |
|---|---|---|
| `bizar_spawn_background` | Odin only | Spawns a background agent; returns `{ instanceId, sessionId, status: "pending" }` |
| `bizar_status` | Any agent | Lists all instances or a single one; read-only |
| `bizar_collect` | Odin only | Blocks until instance completes or times out; returns `{ instanceId, status, result, toolCallCount, durationMs }` |
| `bizar_kill` | Odin only | Sends `POST /session/{id}/abort`; marks instance `killed` |

#### Spawning a background agent

```typescript
// From within Odin's task decomposition:
const result = await bizarre_spawn_background({
  agent: "mimir",                  // which agent to run
  prompt: "Research X and return findings",  // what to do
  model: "minimax/minimax-m3",  // optional: override model
  timeoutMs: 300_000,              // optional: default 5 min, max 30 min
}, ctx);
console.log(result.instanceId);    // "bgr_01ARSH3J5V..."
```

#### Checking status

```typescript
// All instances
const all = await bizarre_status({}, ctx);

// One instance
const one = await bizarre_status({ instanceId: "bgr_01ARSH..." }, ctx);
```

#### Collecting results

```typescript
// Block until done/failed/killed/timeout
const r = await bizarre_collect({
  instanceId: "bgr_01ARSH...",
  timeoutMs: 120_000,  // optional override
}, ctx);
console.log(r.result);   // concatenated assistant text
console.log(r.status);   // "done" | "failed" | "killed" | "timed_out"
```

#### Killing an instance

```typescript
await bizarre_kill({ instanceId: "bgr_01ARSH..." }, ctx);
```

### Security Model

- **Localhost only** — `opencode serve` binds to `127.0.0.1`, never exposed externally.
- **Random shared secret** — a 32-byte secret is generated at plugin init and passed as `OPENCODE_SERVER_PASSWORD` to the serve child. Every HTTP call from the plugin authenticates with `Authorization: Basic base64("opencode:<secret>")`.
- **Password is in-memory only** — not written to disk. On process exit, the serve child is killed and the secret becomes invalid.
- **`--dangerously-skip-permissions` opt-in** — by default the serve child respects the user's agent permission config. Set `BIZAR_BACKGROUND_SKIP_PERMISSIONS=1` to skip (not recommended).
- **Odin-only spawn** — only Odin can spawn background agents. Other agents (Vör, Frigg, Mimir, etc.) can call `bizar_status` (read-only).

## Stall and thinking loop protection

Background agents can hang in two ways:

1. **Stall** — the LLM provider drops the connection or the model stops emitting tokens. No SSE events arrive. The session is "alive" but not making progress.
2. **Thinking loop** — the model is in its internal reasoning phase, emitting `thinking` parts, but never calling tools or producing output. Events are flowing, just not useful ones.

v0.3.0 adds automatic protection against both:

| Guard | Default | Triggers when | Action |
|---|---|---|---|
| `backgroundStallTimeoutMs` | 180000 (3 min) | No SSE event arrives for N seconds | Abort session, mark `failed` with "No activity for N ms — LLM appears stalled" |
| `backgroundThinkingLoopTimeoutMs` | 300000 (5 min) | No tool/text part arrives for N minutes (only `thinking` parts) | Send research intervention prompt (1 by default), then abort if still stuck |

The intervention prompt instructs the LLM to:
- Spawn a Mimir agent for research
- Or use read/grep/glob for codebase info
- Or use bash for observable commands

This nudges the agent out of pure thinking and toward concrete progress. The intervention counter is reset to 0 the moment the agent makes progress (any `tool` or `text` part after an intervention), so a single intervention followed by activity does not count against the next thinking loop.

### Limitations

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
11. **v0.3.0 — Stall and thinking-loop detection has a 15-second polling latency.** The periodic checker runs every 15 seconds, so the actual detection happens within `timeout + 15s`. Adjust the timeouts downward if you need tighter SLAs.
12. **v0.3.0 — A stalled-but-already-closing serve child may briefly show `failed` with the stall message.** The abort call is best-effort; if the serve child has just died, the stall message is the user-visible reason. The underlying cause is captured in the plugin log.

## Slash commands and visual plan flow

v0.4.0 introduces a "visual plan that waits for feedback" feature. The
plugin supports slash commands in any user message and ships two new
tools for the agent to drive the visual plan canvas.

### Slash commands

The `chat.message` hook detects slash commands before state seeding.
A recognized command runs to completion; the response text is surfaced
to the user (the host renders it as a tool error, the same pattern
`tool.execute.before` uses for loop blocks).

| Command | Effect |
|---|---|
| `/visual-plan on` / `/off` | Toggle visual plan mode. Persists to settings. |
| `/visual-plan` | Show current state (mode, default template, last slug). |
| `/plan new <slug> [template]` | Create a new plan. Optional template: `blank`, `feature-design`, `bug-investigation`, `decision-record`. |
| `/plan list` | List all plans in the worktree's `plans/` directory. |
| `/plan open <slug>` | Return the URL for a plan. (Server startup is deferred to v0.5.0 — the URL is informational.) |
| `/help` or `/commands` | List available commands. |

Unknown commands return an error response (not a crash). Non-slash
messages pass through to the LLM unchanged.

### The visual plan flow

When visual plan mode is enabled, the agent's first action on a complex
task is to create a plan canvas (using `bizar_plan_action`), present
it to the user (via `bizar_wait_for_feedback`), and **wait for approval
or feedback** before continuing.

The agent uses two new tools to interact with the plan:

- `bizar_plan_action` — CRUD on the canvas (add elements, comments,
  connections, set plan status). Pure file I/O — does not require the
  `opencode serve` child, so it works in any environment.
- `bizar_wait_for_feedback` — polls every 2 seconds until a new comment
  appears, status becomes `approved` / `rejected`, or the timeout fires.
  Default timeout 10 minutes; range `[5 s, 30 min]`.

### Settings persistence

Plan settings are persisted at
`~/.cache/bizar/plan-settings.json`:

```json
{
  "visualPlanEnabled": true,
  "defaultTemplate": "blank",
  "lastUsedSlug": "my-feature"
}
```

The `SettingsStore` writes atomically (via `writeFileSync(tmp) + renameSync`)
and falls back to defaults on missing or corrupt files. All methods
are async and never throw on bad input.

### Odin usage example

```typescript
// Odin decomposes a task and spots two independent research branches
const [resultA, resultB] = await Promise.all([
  // Branch 1: Mimir researches feature X
  bizarre_spawn_background({ agent: "mimir", prompt: "Research X", timeoutMs: 300_000 }, odinCtx),
  // Branch 2: Thor implements feature Y (sync, doesn't block)
  // ... use task tool for sync work ...
]);

// Continue the main conversation while background work runs
appendMessage("Background agents launched for independent branches.");

// Later, collect results when needed
const findings = await bizar_collect({ instanceId: resultA.instanceId, timeoutMs: 120_000 }, odinCtx);
console.log(findings.result);
```

## Network and forbidden imports

The plugin does not import `node:dns`, `node:net`, `node:http`, or
`node:https`. The plugin makes zero outbound calls.

This is enforced by `scripts/check-forbidden-imports.sh`, which is run as
part of the `test` script (it fails the build if any match is found):

```bash
if grep -rE 'from "node:(dns|net|http|https)"' src/; then
  echo "FAIL: src/ contains a forbidden node: import (dns|net|http|https)"
  exit 1
fi
```

Other `node:` modules (`fs`, `path`, `os`, `util`, etc.) are allowed because
they are not network-bearing.

## What gets logged

The per-call log line at `~/.cache/bizar/logs/<sessionId>.log` is
metadata only:

```
2026-06-17T14:30:01.123Z session=<sid> tool=read fingerprint=ab12cd outcome=ok duration=45ms
```

It contains the ISO timestamp, session ID, tool name, fingerprint hash,
outcome, and duration. It does **not** contain raw tool args, session
content, environment values, or LLM output. This is the §7.6 invariant and
is verified by the integration test.

## Limitations

The following are known limitations of v0.1. They are part of the release
contract; custom integrations must work around them, not against them.

1. **Syntactically different but semantically identical args are not caught.**
   Example: `ls -la` and `ls -la .` produce different fingerprints. The
   plugin only catches identical-args loops.

2. **Cross-tool loops are not caught.** Example: `read foo` → `grep foo` →
   `read foo` → `grep foo` is not detected as a loop. The fingerprint
   includes the tool name, so different tools produce different fingerprints.

3. **Arg-mutating loops are not caught.** Example: `read foo1`, `read foo2`,
   `read foo3` produces 3 distinct fingerprints even if the agent's
   *intent* is to loop. The fingerprint is on the actual call, not on
   inferred intent.

4. **Custom agents without loop-guard instructions will loop indefinitely
   past threshold 12.** The plugin throws at threshold 12, but if the
   subagent has no `## Loop Guard Handling` section in its prompt, it may
   simply retry the same call indefinitely — each retry blocked, but the
   agent does not progress. All BizarHarness subagents (Thor, Tyr, Mimir,
   Heimdall, Hermod, Baldr, Vör, Frigg, Forseti, Quick, Vidarr) include the
   canonical section. **Users who add custom agents without this section
   will experience infinite-block loops.** This warning is mandatory.

5. **Corrupt state files are not auto-recovered.** A corrupt JSON state
   file is logged and ignored; the session starts with empty state. The
   corrupt file is preserved on disk for forensic inspection, not deleted.

6. **Out-of-worktree paths are hashed, not stored.** A loop involving files
   outside the worktree will produce stable fingerprints across runs (good)
   but the original path is not recoverable from the log (acceptable since
   args are not logged at all).

7. **Stale session cleanup is best-effort.** If `client.session.list()`
   fails, the age-based cleanup still runs but the "session no longer in
   opencode" branch is skipped.

8. **Single-host state.** State files are local to `~/.cache/bizar/`.
   A user with multiple machines will have separate state on each.
   Cross-host loop detection is out of scope.

9. **Env var changes mid-session are ignored.** Env vars (`BIZAR_DISABLE`,
   `BIZAR_LOG_LEVEL`, etc.) are read once at plugin init.

10. **Log rotation is best-effort.** If a `renameSync` fails, that step is
    skipped and a warning logged. The log may grow past `logRotationBytes`
    in degenerate cases.

11. **Canonical handoff messages hardcode the default threshold numbers.**
    The warn, escalate, and block message templates contain the literal
    text `"5 identical calls"`, `"8 identical calls"`, and
    `"12 identical calls"`. If a user reconfigures the thresholds
    (`loopThresholdWarn`, `loopThresholdEscalate`, `loopThresholdBlock`),
    the action still fires at the configured counts, but the message text
    still says the default numbers. The agent prompts' recognition
    patterns in §11.2 of the spec match the default text, so non-default
    thresholds may cause subagents to fail to recognize the handoff.
    Leave the thresholds at their defaults unless you also update the
    agent prompts.

## For plugin developers

```
plugins/bizar/
├── package.json              (ESM; deps: zod for option validation)
├── tsconfig.json             (ES2022, strict, declaration files)
├── index.ts                  (Plugin entry; hook wiring; init try/catch)
├── src/
│   ├── loop.ts               (decide() — threshold table, decision tree)
│   ├── handoff.ts            (3 static message templates; only tool name interpolated)
│   ├── logger.ts             (thin wrapper over client.app.log; BIZAR_LOG_LEVEL)
│   ├── options.ts            (clamping, validation, secret-dir refusal, env vars)
│   ├── fingerprint.ts        (stable hash of (tool, args))
│   ├── state.ts              (per-session state, per-session mutex)
│   └── report.ts             (per-session log writer)
├── scripts/
│   └── check-forbidden-imports.sh   (CI: forbids node:dns/net/http/https imports)
└── tests/
    ├── loop.test.ts          (decision tree, window rolling, edge cases)
    ├── block.test.ts         (threshold-12 throw)
    ├── fingerprint.test.ts
    ├── state.test.ts
    ├── event.test.ts
    ├── options.test.ts
    └── integration.test.ts   (Docker-based; runs against a real opencode install)
```

To run the unit tests:

```bash
cd plugins/bizar
npm install          # if not already installed
npm test             # runs the CI import check + bun test
```

To typecheck only:

```bash
cd plugins/bizar
npm run typecheck
```
