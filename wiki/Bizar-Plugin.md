# Bizar Plugin

The Bizar plugin is an opencode plugin bundled with BizarHarness. It runs inside opencode alongside the agents and does three things: detects subagent loops, reports per-session activity, and injects handoff messages so a stuck subagent can be reassigned. It is the only piece of BizarHarness that runs *as* a plugin (not as an agent).

## What it does

1. **Loop detection.** Fingerprints every tool call and counts how often the same fingerprint appears in the recent window. When the count crosses a threshold, the plugin acts: warn at 5, escalate at 8, hard-block at 12.
2. **Periodic status reporting.** Logs every tool call (metadata only) to `~/.cache/bizar/logs/<sessionId>.log`. The log is one line per call and contains no tool args, paths, or session content.
3. **Handoff signal.** When a subagent is clearly stuck, the plugin injects a system message into the agent's next-turn context. The message is a static string that tells the subagent to use the `task` tool to escalate to its parent.

The plugin is read-only on the project. It makes no outbound network calls and writes only to `~/.cache/bizar/`.

## Loop detection

The plugin fingerprints each `tool.execute.before` call as a stable hash of the tool name and the normalized arguments. It keeps a rolling window of the last 10 (default) tool calls per session. When the count of matching fingerprints in the window crosses a threshold, the plugin acts:

| Repetitions in last 10 | Action | Mechanism |
|---|---|---|
| 3 | Log a warning via `client.app.log`. No injection. | Diagnostic only |
| 5 (warn) | Inject system message via `experimental.chat.system.transform` | Subagent sees it on its next turn |
| 8 (escalate) | Inject stronger system message | Subagent sees it on its next turn |
| 12 (block) | **Block.** Throw from `tool.execute.before` | Surfaces in the TUI as a tool error |

The plugin's hard block at threshold 12 runs **before** opencode's built-in `doom_loop` recovery. The plugin wins.

## Log location and format

Per-session log files are written to:

```
~/.cache/bizar/logs/<sessionId>.log
```

The log rotates at 10 MB by default. Rotation keeps the last 3 files: `plan.html` → `.1.log` → `.2.log` → `.3.log`. The `.3.log` is deleted.

The per-call log line is metadata only:

```
2026-06-17T14:30:01.123Z session=<sid> tool=read fingerprint=ab12cd outcome=ok duration=45ms
```

It contains the ISO timestamp, session ID, tool name, fingerprint hash, outcome, and duration. It does **not** contain raw tool args, session content, environment values, or LLM output. This is the §7.6 invariant from the plugin spec and is verified by the integration test.

State files (per-session metadata) are written to:

```
~/.cache/bizar/<sessionId>.json
```

State is keyed by session ID, not by agent name. The `parentAgent` field is seeded from the first user message in a session and is not updated for subagent dispatches within the same session.

## Handoff — the three emitted strings

The plugin injects one of three static message templates depending on the threshold crossed. The strings are **literal — do not modify** in the agent prompts:

| Threshold | Emitted string |
|---|---|
| 5 | `[loop guard: 5 identical calls to <tool>]. Consider using the task tool to report back to your parent with what you've learned and what you need.` |
| 8 | `[loop guard: 8 identical calls to <tool>]. Consider using the task tool to report back to your parent with what you've learned and what you need.` |
| 12 (throw) | `Loop protection: 12 identical calls to <tool>. Use task to escalate.` |

The only interpolation is `<tool>`, which is the tool name from opencode's tool registry (e.g., `read`, `bash`, `edit`). It is not user-controlled content.

Odin matches on these literal substrings. Every BizarHarness subagent prompt includes a `## Loop Guard Handling` section that tells the agent to recognize these strings and use the `task` tool to escalate. The section is byte-identical across all twelve subagents.

## Configuration

Plugin options are passed in the `opencode.json` `plugin` array:

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

| Option | Default | Notes |
|---|---|---|
| `loopThresholdWarn` | 5 | Clamped to `Math.max(1, floor(value))` |
| `loopThresholdEscalate` | 8 | Auto-set to `warn + 1` if out of order |
| `loopThresholdBlock` | 12 | Auto-set to `escalate + 1` if out of order |
| `loopWindowSize` | 10 | Clamped to `[3, 50]` |
| `logDir` | `~/.cache/bizar/logs` | Refused if inside `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, `~/.kube/` |
| `stateDir` | `~/.cache/bizar` | Same secret-dir refusal |
| `logRotationBytes` | 10485760 (10 MB) | `Math.max(1024, floor(value))` |

Missing options fall back to defaults. Bad input is clamped, never rejected. The plugin never throws on bad config.

## Environment variables

| Env var | Effect |
|---|---|
| `BIZAR_DISABLE=1` | Disables the plugin entirely. Returns empty hooks; logs once at debug level. |
| `BIZAR_DISABLE_LOOP=1` | Loop guard disabled. Status reporting still active. |
| `BIZAR_DISABLE_LOG=1` | Status reporting disabled. Loop guard still active. |
| `BIZAR_LOG_LEVEL=debug\|info\|warn\|error` | Log verbosity. Default `info`. Invalid values fall back to `info`. |

Env vars are read once at plugin init. Mid-session changes are ignored.

## Limitations

These are documented in the plugin spec and are part of the release contract. Custom integrations must work around them, not against them:

1. **Syntactically different but semantically identical args are not caught.** `ls -la` and `ls -la .` produce different fingerprints.
2. **Cross-tool loops are not caught.** A `read` → `grep` → `read` → `grep` pattern is not detected (the fingerprint includes the tool name).
3. **Arg-mutating loops are not caught.** `read foo1`, `read foo2`, `read foo3` produces three distinct fingerprints even if the intent is to loop.
4. **Custom agents without the `## Loop Guard Handling` section will loop indefinitely past threshold 12.** The plugin throws at threshold 12, but a subagent that doesn't recognize the message and use `task` will simply retry. All BizarHarness subagents include the canonical section. **Users who add custom agents without this section will experience infinite-block loops.** This warning is mandatory. See [Limitations](#limitations) for the full list.
5. **Corrupt state files are not auto-recovered.** A corrupt JSON file is logged and ignored; the session starts with empty state. The corrupt file is preserved for forensic inspection.
6. **Out-of-worktree paths are hashed, not stored.** A loop involving files outside the worktree produces stable fingerprints across runs (good) but the original path is not recoverable from the log.
7. **Stale session cleanup is best-effort.** If `client.session.list()` fails, the age-based cleanup still runs but the "session no longer in opencode" branch is skipped.
8. **Single-host state.** State files are local to `~/.cache/bizar/`. Cross-host loop detection is out of scope.
9. **Env var changes mid-session are ignored.** Env vars are read once at plugin init.
10. **Log rotation is best-effort.** If a `renameSync` fails, that step is skipped and a warning is logged. The log may grow past `logRotationBytes` in degenerate cases.
11. **Canonical handoff messages hardcode the default threshold numbers.** The warn, escalate, and block message templates contain the literal text `"5 identical calls"`, `"8 identical calls"`, and `"12 identical calls"`. If you reconfigure the thresholds via plugin options, the action still fires at the new counts, but the message text still says the defaults. The agent prompts' recognition patterns match the default text — non-default thresholds may cause subagents to fail to recognize the handoff. Leave the thresholds at defaults unless you also update the agent prompts.

## Disabling the plugin

To disable the plugin for a single session, set `BIZAR_DISABLE=1` in the environment before launching opencode:

```bash
BIZAR_DISABLE=1 opencode
```

To disable only the loop guard (status reporting still active):

```bash
BIZAR_DISABLE_LOOP=1 opencode
```

To disable only status reporting (loop guard still active):

```bash
BIZAR_DISABLE_LOG=1 opencode
```

To disable the plugin permanently, remove the entry from the `plugin` array in `opencode.json` and remove the `plugins/bizar/` directory from `~/.config/opencode/`.

## Security

The plugin is verified to:

- Not import `node:dns`, `node:net`, `node:http`, or `node:https`.
- Not call any external API.
- Not write outside `~/.cache/bizar/` (configurable).
- Not read environment variables other than the four documented above.
- Not override agent prompts (only injects ephemeral system messages into the current turn's context).
- Not modify user files.

The forbidden-import check is enforced by `scripts/check-forbidden-imports.sh` in the plugin repo and runs as part of the test script. CI fails the build if any forbidden `node:` import is found.

## Background agents (v0.4+)

The plugin also runs an asynchronous subagent system. See [Background Agents](Background-Agents) for the full reference. Briefly:

- **`bizar_spawn_background`** (Odin only) — spawns a subagent on a shared `opencode serve` instance. Returns an `instanceId` immediately.
- **`bizar_status`** (any agent) — read-only list of instances and their state.
- **`bizar_collect`** (Odin only) — blocks until the instance completes or times out.
- **`bizar_kill`** (Odin only) — aborts a running instance via `POST /session/{id}/abort`.
- **`bizar_wait_for_feedback`** — blocks on user feedback for a plan (or a timeout).

The plugin tracks each instance's state on disk in `~/.cache/bizar/state/bg/<instanceId>.json` so it survives an opencode restart. Recovery on restart: any instance still in `running` or `pending` is marked `failed` with `error: "recovered after restart"`.

## Recent fixes

### v0.5.1 — `bizarre_spawn_background` empty-sessionId bug

**Symptom:** `bizar_spawn_background` failed immediately with `EventStream.onSessionEvent: sessionId must be non-empty`.

**Root cause:** `InstanceManager.add()` was calling `attachEventHandler(full)` synchronously with `sessionId: ""` (the real sessionId is filled in later by `POST /session`). The EventStream guard rejects empty strings.

**Fix:**

- `plugins/bizar/src/background.ts` — removed inline `attachEventHandler` from `add()`; made `attachEventHandler` `public`.
- `plugins/bizar/src/tools/bg-spawn.ts` — calls `attachEventHandler` after `POST /session` returns the real sessionId. Wrapped in try/catch so a disconnected SSE stream doesn't fail the spawn.
- The "track BEFORE HTTP" invariant (HIGH-21) is preserved — the instance is in the map immediately. Only the per-session event subscription is deferred.

**Regression test:** `plugins/bizar/tests/attach-handler-bug.test.ts` (3 tests). The tests exercise the **real** `InstanceManager` (not a fake) with a minimal `EventStream` stub. One of the three tests was designed to fail on the buggy code; it was verified by reverting the fix and re-running.

**Test count:** 488 → **491 pass, 0 fail**.

### v0.5.1 — `install.sh` now deploys `commands/` and `hooks/`

The original `install.sh` only copied `agents/`, `skills/`, and the Bizar plugin to `~/.config/opencode/`. Slash commands and hooks were not deployed, so commands like `/init` and `/learn` had to be set up manually. The updated `install.sh` adds two new copy blocks for `config/commands/*.md` and `config/hooks/*` (recursive, so the `post-tool-use.md` and `pre-tool-use.md` files are included).

## Limitations (v0.5+ additions)

The full [Limitations](#limitations) list is above. Two v0.5+-specific ones to be aware of:

12. **Plugin has no hot-reload.** Once opencode loads the plugin, source changes don't take effect until you restart opencode. This makes the install-then-iterate loop slow. There is no fix planned — restarting opencode is reliable and the cycle is short. See [Troubleshooting](Troubleshooting#installed-plugin-source-changes-arent-taking-effect).

13. **`install.sh` is not idempotent against source changes.** If you `git pull` updated plugin source, you must re-run `bash install.sh` to deploy it. The script does not detect that the installed copy is older than the source. There is a proposed fix in [Self-Improvement](Self-Improvement#active-rules) to add a `git rev-parse` check at the top of `install.sh`.

## Next steps

Next: [Background Agents](Background-Agents) — the full async subagent reference.

For the slash commands this plugin surfaces (`/plan`, `/visual-plan`, `/help`), see [Commands Reference](Commands-Reference).
