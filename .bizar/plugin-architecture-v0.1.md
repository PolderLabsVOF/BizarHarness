# Bizar Plugin — Architecture Spec (v0.1, for Forseti review)

> **Status:** Draft, awaiting adversarial review. Implementation follows on approval.

## Purpose

A BizarHarness-bundled opencode plugin that gives Odin better visibility into subagent activity and a mechanism to stop/reassign agents that are stuck. Three capabilities:

1. **Loop detection** — fingerprint tool calls and warn/block on repetition.
2. **Periodic status reporting** — log subagent activity so Odin (and the human) can see what is happening.
3. **Handoff signal** — when a subagent is clearly stuck, inject a message that nudges it (or the parent) to reassign via the `task` tool.

This lives in the **main BizarHarness repo** (not BizarHarness-dev) because it ships with the product. Dev testing happens in BizarHarness-dev's Docker sandbox.

## Location

```
BizarHarness/
└── plugins/
    └── bizar/
        ├── package.json       (npm package metadata; "type": "module")
        ├── tsconfig.json      (extends Node 22 + Bun-compatible)
        ├── README.md
        ├── index.ts           (plugin entry; exports default Plugin function)
        ├── src/
        │   ├── state.ts       (per-session state, persisted to ~/.cache/bizarharness/)
        │   ├── fingerprint.ts (stable hash of (tool, args) for loop detection)
        │   ├── loop.ts        (thresholds, decision logic)
        │   ├── report.ts      (per-session log writer)
        │   └── handoff.ts     (message templates)
        └── tests/
            ├── fingerprint.test.ts
            ├── loop.test.ts
            └── state.test.ts
```

## Hook Surface Used

From the opencode plugin API (per `customize-opencode` skill):

| Hook | What we do |
|---|---|
| `config(cfg)` | No mutation. Use the hook to read final config and resolve plugin options. |
| `event(input)` | Track every event. Used to count turns per session, observe session boundaries, and update last-activity timestamp. |
| `tool.execute.before(input, output)` | **Primary loop-detection point.** Compute fingerprint of `(tool, args)`, look up session state, decide whether to warn/inject/block. Mutate `output` in place if we want to short-circuit. |
| `tool.execute.after(input, output)` | Record the call result and increment the per-tool counter in session state. |
| `chat.message` | Detect when a parent agent (Odin) sends a task to a subagent. Use this to seed session state for the new subagent. |

We **do not** use `tool.definition` (would alter the agent's tool surface — too invasive) or `command.execute.before` (we expose commands via the tool: {} namespace instead if needed).

## State Management

### Storage
- Per-session JSON file at `~/.cache/bizarharness/<sessionId>.json`
- Schema:
  ```ts
  {
    sessionId: string;
    parentAgent: string | null;       // "odin" if spawned via Odin
    startedAt: number;                 // epoch ms
    lastActivityAt: number;
    turnCount: number;
    toolCalls: Array<{
      tool: string;
      fingerprint: string;             // sha256 of normalized (tool, args)
      at: number;                      // epoch ms
      outcome?: "ok" | "error";
    }>;
    warningsIssued: number;            // count of injected warnings
    blocksTriggered: number;
  }
  ```
- Cap `toolCalls` at last 50 (rolling window — older entries pruned on write).

### Concurrency
- opencode's plugin runtime is Bun, single-threaded. We don't need locking.
- Multiple subagents in the same session share a session id (opencode's session model). State is keyed by `sessionId`, not agent name. We tag each tool call with the agent name from the event payload to attribute counts.

## Loop Detection

### Algorithm
1. Compute `fingerprint = sha256(JSON.stringify({ tool, args: normalize(args) }))`
2. `normalize(args)` strips: `cwd` paths, absolute paths (replace with `__ABS__`), timestamps, request ids, and any field named `id`/`uuid`/`nonce`/`timestamp`. This makes the fingerprint stable across retry attempts that vary only in noise.
3. Count how many of the last N=10 `toolCalls` share the fingerprint.
4. Apply thresholds (configurable via plugin options, defaults shown):

   | Repetitions | Action |
   |---|---|
   | 3 | Log a warning. **No injection** — too noisy. |
   | 5 | Inject a `<system-reminder>`-style message: "You have called `<tool>` 5 times with the same arguments. Consider whether you should change your approach, delegate via `task`, or report back to your parent agent." |
   | 8 | Inject a stronger message: "You are looping on `<tool>`. Stop and use the `task` tool to report back to your parent agent (`odin`) with what you've learned and what you need." |
   | 12 | **Block.** Throw an error from `tool.execute.before` with a clear message: "Loop protection: 12 identical calls to `<tool>`. Use `task` to escalate." The opencode TUI surfaces this as a tool error. |

5. Window resets if a different fingerprint is seen in between (counted as "broken the cycle").

### Why a sliding window of 10, not "last 3 in a row"?
A common non-loop pattern is `read foo` → `edit foo` → `read foo` → `edit foo` (read/edit alternation). A 3-in-a-row check would not catch this. A 10-window check is robust to that and still catches real loops (8+ identical calls in 10).

### Why these specific thresholds?
- 3 = harmless repetition, common in legitimate use
- 5 = suspicious, worth flagging
- 8 = almost certainly a loop, escalate
- 12 = definitely stuck, block

All configurable. Defaults are conservative.

## Status Reporting

### What we report
- Every tool call logged to `~/.cache/bizarharness/logs/<sessionId>.log` (one line per call):
  ```
  2026-06-17T14:30:01.123Z agent=thor tool=read fingerprint=ab12cd outcome=ok duration=45ms
  ```
- Log is rotated at 10 MB (keep last 3 files).

### What we do NOT do
- **No TUI injection** for status (too noisy — agents would constantly see their own status).
- **No system-reminder injection** at intervals (would pollute context).
- **No parent-to-child status pings** (opencode doesn't surface these to the user anyway).

The log file is the artifact. A future Odin-side change could read this log to display status, but that's out of scope for v0.1.

## Handoff Mechanism

The plugin cannot directly kill a subagent. The mechanism is message injection:

1. At threshold 8 (loop), inject a message that says: "You are looping. Use `task` to report back to your parent agent with what you've tried and what you need."

2. At threshold 12, throw an error from the hook. The TUI surfaces it. The subagent's next turn starts with the error in its context. Hopefully the subagent's own routing rules (or the parent's instructions) trigger handoff.

3. **For v0.1, the plugin only injects the message and blocks the tool call. The actual reassignment behavior comes from updates to agent prompts:**

   - **`odin.md`** gets a new section: "If a subagent reports it is stuck, looping, or unable to complete, you may re-dispatch the task to a different subagent via `task` with a new prompt that includes the prior agent's findings. Do not retry the same agent on the same task."
   - **`thor.md` / `tyr.md`** etc. (the subagents) get a small addition: "If you receive a `<system-reminder>` saying you are looping, you must use the `task` tool to report back to your parent agent with what you have learned and what you need to proceed. Do not continue the same approach."

   These prompt updates are **required** for the handoff to work end-to-end. They are part of this change.

## Configuration

Plugin options (set in `config/opencode.json`):

```jsonc
"plugin": [
  ["../plugins/bizar/index.ts", {
    "loopThresholdWarn": 5,
    "loopThresholdEscalate": 8,
    "loopThresholdBlock": 12,
    "loopWindowSize": 10,
    "logDir": "~/.cache/bizarharness/logs",
    "stateDir": "~/.cache/bizarharness",
    "logRotationBytes": 10485760
  }]
]
```

Defaults are applied if not specified. All thresholds are user-overridable.

## What the Plugin Does NOT Do

- **Does not modify user files** (read-only on the project).
- **Does not call external APIs** (no LLM calls, no telemetry).
- **Does not override agent prompts** (only injects ephemeral system messages into the current turn's context).
- **Does not manage subagent lifecycle** (opencode does that).
- **Does not read environment variables, secrets, or auth tokens.**
- **Does not write to anywhere outside `~/.cache/bizarharness/`** by default.
- **Does not register slash commands in v0.1** (v0.2 may add `/bizar status`, `/bizar reset`).

## Security Considerations

- **State files contain tool call args.** If a user runs opencode in a directory with sensitive file paths, those paths will end up in `~/.cache/bizarharness/`. The plugin normalizes absolute paths to `__ABS__` in fingerprints but NOT in the per-call log. This is a deliberate trade-off (paths in logs are useful for debugging). The log directory is `~/.cache/bizarharness/logs/` with default umask; users who care can set restrictive perms. The plugin should not weaken the umask.
- **The plugin throws errors from `tool.execute.before`.** These surface to the user as tool errors. This is intentional, not a denial-of-service — the user is the one whose session is being protected.
- **The plugin runs inside Bun sandbox.** A bug in the plugin cannot break the user's opencode install. Worst case: the plugin crashes, opencode shows a toast, and the user disables the plugin.
- **No network access.** The plugin makes zero outbound calls. Auditable by `grep -r fetch\\|http\\|https plugins/bizar/src/`.

## Testing Approach

- **Unit tests** for `fingerprint.ts` (stable hashing, normalization edge cases) and `loop.ts` (threshold logic with synthetic histories).
- **Integration test** in the BizarHarness-dev Docker sandbox:
  1. Install the plugin into the test config.
  2. Run `opencode run` non-interactively with a prompt designed to make an agent loop (e.g., "find all .ts files and print the result 20 times").
  3. Verify the log file contains the expected fingerprints.
  4. Verify that after threshold 12, the tool call is blocked.
- **Manual test** by the developer: launch the sandbox, run a real session, watch the log file in another terminal.

## Open Questions for Forseti

1. **Is the path normalization aggressive enough?** A user could legitimately call `read /home/drb0rk/file1.ts` then `read /home/drb0rk/file2.ts` and those should NOT be the same fingerprint. The current normalize strips absolute paths entirely, replacing them with `__ABS__`. So they'd be different fingerprints if the filenames differ. But if the args include `cwd: "/home/drb0rk/project"` and only the file changes, the fingerprint stays the same after normalization — which is the desired behavior for "read same file 5 times in a row" loop detection. Is this right?
2. **Should the handoff message be injected as `<system-reminder>` or as a regular message?** System reminders are not shown to the user in the TUI; regular messages are. For "stop looping" prompts, system-reminder feels right (user shouldn't be spammed with agent meta-talk). For "report back to parent" the message needs to actually be acted on — subagents read system reminders, so this is fine. Confirm.
3. **Is `~/.cache/bizarharness/` the right location?** XDG cache home is `~/.cache` by default, and BizarHarness already has a precedent of using XDG paths in `cli/utils.mjs`. Confirmed.
4. **Should the plugin disable itself if the user has a specific env var set?** e.g., `BIZAR_DISABLE=1` for users who don't want the plugin active in a particular session. Recommend adding.
5. **What happens to a subagent that gets blocked at threshold 12 mid-tool-call?** The `tool.execute.before` throw causes opencode to skip the tool and return an error to the agent. The agent's next turn starts with the error in context. We rely on the subagent's own routing to escalate. If the subagent has NO routing instructions (e.g., a custom user agent), the loop will repeat indefinitely. Acceptable for v0.1 since the user installed a custom agent without loop handling — but worth flagging in the README.

## Files That Will Change (post-approval)

- **New:** `plugins/bizar/` (this whole directory)
- **Modified:** `config/opencode.json` (add the plugin entry)
- **Modified:** `config/agents/odin.md` (add handoff instructions)
- **Modified:** `config/agents/thor.md`, `config/agents/tyr.md`, `config/agents/mimir.md`, `config/agents/heimdall.md`, `config/agents/hermod.md` (small "if looping, hand off" additions)
- **New in BizarHarness-dev:** `plugins/bizar/test/` (Docker-based integration test scripts)

## Implementation Order (post-approval)

1. **Tyr:** `plugins/bizar/package.json`, `tsconfig.json`, `index.ts` skeleton with empty hook implementations.
2. **Thor:** `fingerprint.ts` + tests.
3. **Tyr:** `loop.ts` + tests.
4. **Thor:** `state.ts` + tests.
5. **Tyr:** `report.ts` (log writer).
6. **Tyr:** `handoff.ts` (message templates).
7. **Tyr:** Wire it all together in `index.ts`.
8. **Thor:** Update `odin.md` and subagent prompts.
9. **Thor:** Add to `config/opencode.json` and install logic.
10. **Heimdall:** Update `cli/install.mjs` to copy the plugin directory on install.
11. **Thor:** Run integration test in the BizarHarness-dev Docker sandbox.

Total: ~6–8 hours of work split across the agents.
