# Bizar Plugin — Architecture Spec (v0.3.1)

> **Status:** Approved for implementation. v0.2 incorporates all 34 findings from Forseti's adversarial audit of v0.1 plus resolutions for the 5 open questions. **v0.3 applies 8 targeted fixes** identified during v0.2 review: recognition-pattern alignment with emitted strings, corrupt-state schema, agent-list completeness, state-file creation lifecycle, secret-dir matching algorithm, CI test-script command for the `node:` import ban, canonical-text framing for `## Loop Guard Handling`, and a test stub for canonical key order. **v0.3.1 fixes the N4 contradiction** between §4.5.1 and §12.1 — `event.test.ts` now matches the canonical lifecycle.

---

## Changelog (v0.3 → v0.3.1)

**v0.3.1 — Fixed N4 contradiction between §4.5.1 and §12.1** (event.test.ts now matches the canonical lifecycle: `session.created` does not create the file; `chat.message` seed does; `tool.execute.before` is a lazy fallback).

### Targeted fix

| # | Finding | Resolution |
|---|---|---|
| 1 | §12.1 — `event.test.ts` still asserted that `session.created` initializes the state file, contradicting §4.5.1 (canonical lifecycle: file is created at the `chat.message` seed; `session.created` only updates the in-memory seen-message set and may warm caches). | §12.1 rewritten to match §4.5.1: the `session.created` test now asserts no file is created on disk and only the in-memory seen-message set is updated; the "Duplicate `session.created` events are idempotent" test is replaced with "Duplicate `session.created` events for the same session ID are a no-op (no extra file, no error)"; two new tests added — first `chat.message` per session creates the state file with the §4.7 schema (`parentAgent` set to the message sender, `startedAt`/`lastActivityAt` set to the current time, other fields zeroed), and first `tool.execute.before` (subagent-only lazy fallback) creates the state file with `parentAgent: null` and the §4.7 empty-state shape when `chat.message` has not yet fired. |

---

## Changelog (v0.2 → v0.3)

### HIGH severity — addressed

| # | Finding | Resolution |
|---|---|---|
| 1 | §11.1 — Recognition patterns did not match the strings the plugin actually emits. §11.1 said to match `[BLOCKED: loop guard]` (never emitted) and `[loop guard: N identical calls]` (missing the trailing `to <tool>` substring). This would have broken the threshold-12 handoff because Odin's recogniser would never fire on the real error string `Loop protection: 12 identical calls to <tool>`. | §11.1 rewritten to match the three literal substrings the plugin emits (per §5.4): `[loop guard: 5 identical calls to <tool>]`, `[loop guard: 8 identical calls to <tool>]`, and `Loop protection: 12 identical calls to <tool>`. Added a note that `<tool>` is a runtime-supplied identifier, NOT the literal text `<tool>`. |

### MEDIUM severity — addressed

| # | Finding | Resolution |
|---|---|---|
| 2 | §4.7 — Corrupt-state fallback described behaviour but did not pin the empty-state shape. A future contributor could legitimately decide that "empty" means `undefined` or that `parentAgent` defaults to `"odin"`, breaking the corrupt-recovery contract. | §4.7 now contains an explicit empty-state schema: same fields as §4.1, all zeroed (`startedAt: 0`, `lastActivityAt: 0`, `turnCount: 0`, `toolCalls: []`, `warningsIssued: 0`, `blocksTriggered: 0`), with `parentAgent: null`. Notes cover the rationale for each value (e.g. epoch-zero distinguishes "never bootstrapped" from "started now"). |
| 3 | §11.2 — Agent list was missing `vidarr` and `quick`. | §11.2 now lists eleven agents, adding `quick.md` (primary — fast-path) and `vidarr.md` (subagent — hardest problems). The canonical `## Loop Guard Handling` section applies to both. |
| 4 | §4.5 — Spec did not say when the state file is first created. `event.test.ts` implied `session.created`, §4.5 implied `chat.message`, and §5.4 implied `tool.execute.before`. Three different stories. | §4.5.1 picks `chat.message` seed (first user message per session) as the canonical creation point, with documented rationale, and specifies a lazy fallback for subagent-only sessions on first `tool.execute.before`. The `session.created` event does NOT create the file. |

### LOW severity — addressed

| # | Finding | Resolution |
|---|---|---|
| 5 | §6.4 — "Refuses to start" but no algorithm. Reviewers could not tell whether a target equal to the secret dir should be rejected, or whether a target like `~/.ssh-foo` should falsely match. | §6.4 now includes the matching algorithm: `path.resolve(target) === path.resolve(secretDir) || path.resolve(target).startsWith(path.resolve(secretDir) + path.sep)`. The `+ path.sep` is justified (avoids `~/.ssh-foo` matching the `~/.ssh` prefix). |
| 6 | §7.5 — CI enforcement described in prose but no test-script command. The intended check could have been written inconsistently across machines (BSD vs GNU grep, busybox vs coreutils). | §7.5 now includes the exact bash block to add to the `test` script: `if grep -rE 'from "node:(dns|net|http|https)"' plugins/bizar/src/; then ... exit 1; fi`. The check is fail-closed and runs before the unit tests. |
| 7 | §11.2 — Canonical text was shown but not labelled as canonical. A contributor could legitimately "improve" the wording and break loop-guard recognition in every subagent. | §11.2 now has a `CANONICAL TEXT — VERBATIM. DO NOT MODIFY.` blockquote header above the section text, a "reviewers must reject any PR that paraphrases" guard, and a "matches the `## Hindsight Memory Protocol` convention" rationale. Count updated from "nine agents" to "eleven agents" to reflect Fix 3. |
| 8 | §12.1 — Canonical-key-order test was mentioned by name in the fingerprint test list but no assertion code was provided. A contributor writing the test from scratch could miss the recursive case. | §12.1 now includes a minimal test stub with two assertions: (a) flat object with different key insertion order, (b) nested object with different insertion order at both levels. Both must pass for §15 #18. |

---

## Changelog (v0.1 → v0.2)

### HIGH severity — addressed

| # | Finding | Resolution |
|---|---|---|
| 1 | §1.1 — Drop per-tool-call agent attribution (`tool.execute.before` does not carry agent name) | Per-call attribution removed. State is per-session. Subagent identity seeds from `chat.message`. See §4.4. |
| 2 | §1.2 — `chat.message` fires for every user message, not just on dispatch | Dedupe by message ID; seed `parentAgent` only on the FIRST user message per session. Section title renamed to "Seed session state on first user message per session." See §4.5. |
| 3 | §3.1 — `__ABS__` global sentinel is unsafe (collision attack) | Replaced with `path.relative(worktree, absPath)` for in-worktree paths, per-path stable hash for out-of-worktree paths. See §5.3. (Resolves Open Q 12.1.) |
| 4 | §4.3 — No handling of re-entrancy in async state writes | Per-session async mutex (Promise chain keyed by session ID). See §4.3. |
| 5 | §5.1 — Message-injection mechanism undeclared | Pinned: `experimental.chat.system.transform` for thresholds 5 and 8; `throw` from `tool.execute.before` for threshold 12. Hook surface table updated. Injected string is a static template. See §3.1, §5.4, §7.2. |
| 6 | §7.1 — Spec contradicts itself on paths in per-call log | Resolved: log line is metadata-only. **Args (and therefore paths) are never written to the log at any level.** Path privacy is therefore not a concern. See §7.1, §7.6. |
| 7 | §7.2 — Prompt-injection vector | Added security invariant: "All injected text is a static string template. No tool args, no LLM output, no agent-controlled content is ever interpolated into the injected message." See §7.2. |
| 8 | §9.1 — Install path unresolved | New `installPluginBizar()` function in `cli/copy.mjs`. Copies `plugins/bizar/` → `<project>/.opencode/plugins/bizar/`. Wired into `install.mjs` as a component option. See §9.2. |
| 9 | §11.1 — Missing test for threshold-12 throw | Added `tests/block.test.ts`: 11 entries with same fingerprint, 12th identical call → plugin throws; error contains tool name + "loop" or "escalate". See §12.1. |
| 10 | §11.2 — Integration test prereqs undocumented | Documented: BizarHarness-dev Docker image must contain `opencode` binary, valid `OPENCODE_API_KEY`, outbound HTTPS. Verified by `test-integration.sh` that fails fast. See §12.2. |

### MEDIUM severity — addressed

| # | Finding | Resolution |
|---|---|---|
| 11 | §1.4 — Interaction with `doom_loop` permission | Documented: plugin's hard-block at threshold 12 runs BEFORE opencode's soft `doom_loop` recovery. Plugin wins. See §3.3. |
| 12 | §3.2 — Known miss class undocumented | Documented as known limitation: syntactically different but semantically identical args (e.g., `ls -la` vs `ls -la .`) are not caught. Mandatory README warning. See §13 #1, §15 #4. |
| 13 | §3.4 — Window vs counter semantics ambiguous | Specified: window is last 10 tool calls; repetitions counted by re-scanning window each time, not by running counter. Example: `[bash X, bash X, read, bash X]` in window of 4 = 3 reps. See §5.5. |
| 14 | §4.4 — Stale session file cleanup | On plugin init, scan `~/.cache/bizarharness/*.json` and delete files where `lastActivityAt` is older than 7 days OR session ID is no longer present in opencode (best-effort `client.session.list()`). See §4.6. |
| 15 | §4.5 — Corrupt-state fallback | If state file is malformed, log warning via `client.app.log` and start with empty state. Never throw. File preserved for forensic inspection. See §4.7. |
| 16 | §5.4 — Injection text vs prompt text misaligned | Aligned. Injection: "Loop guard: N identical calls to `<tool>`. Consider using the `task` tool to report back to your parent with what you've learned and what you need." Subagent prompt: "If you see a 'Loop guard' message of any kind (system reminder, tool error, or repeated identical tool calls), use `task` to report back to your parent agent." See §5.4, §10.2, §11. |
| 17 | §6.1 — No clamping/validation of options | Added: empty → defaults; negative thresholds → `Math.max(1, Math.floor(value))`; out-of-order fixed by +1; window clamped `[3, 50]`; never throws on bad config. See §6.2. |
| 18 | §6.2 — No refusal of secret-dir paths | Refuse to start if `logDir` or `stateDir` resolves inside `~/.ssh/`, `~/.gnupg/`, `~/.aws/`, `~/.kube/`. Logs error. See §6.4. |
| 19 | §6.3 — No constraint on `block` vs window size | Enforced `loopThresholdBlock <= loopWindowSize + 2` with warning if violated. See §6.3. |
| 20 | §8.1 — Cache dir creation unspecified | On init: `mkdirSync(stateDir, { recursive: true })` and `mkdirSync(logDir, { recursive: true })`. On EACCES/EROFS, log error and disable plugin for session. See §8.2. |
| 21 | §8.2 — Init not in try/catch | Plugin function MUST wrap initialization in try/catch. Errors logged via `client.app.log`. Plugin returns empty hooks. See §8.1. |
| 22 | §8.3 — Log rotation strategy unspecified | Rotation: current → `.1.log`, `.1.log` → `.2.log`, `.2.log` → `.3.log`. `.3.log` deleted. Each `fs.renameSync` in its own try/catch; on failure, skip step and log warning. See §8.3. |
| 23 | §9.2 — Install path not resolved explicitly | Resolved: `opencode.json` at `<project>/.opencode/opencode.json`; `plugins/bizar/` at `<project>/.opencode/plugins/bizar/`; plugin entry references `./plugins/bizar/index.ts` relative to config dir. See §9.1. |
| 24 | §9.3 — Pick install strategy (A) or (B) | Picked (B): copy to project AND reference explicitly in `opencode.json`. Supports option overrides. See §9.3. |
| 25 | §10.1 — Odin loop-guard instructions too vague | Rewrote as concrete rule with conditions. Exact replacement text in §11.1. |
| 26 | §10.2 — Missing `## Loop Guard Handling` H2 in subagents | Added canonical section to all 9 subagents (Thor, Tyr, Mimir, Heimdall, Hermod, Baldr, Vör, Frigg, Forseti). Placed AFTER `## Hindsight Memory Protocol`, BEFORE closing material. See §11.2. |
| 27 | §11.3 — Missing `options.test.ts` | Added: empty → defaults; negative → clamped; out-of-order → fixed; `~/.ssh/` refused. See §12.1. |
| 28 | §11.4 — Missing `event.test.ts` | Added: `session.created` initializes state file; `session.deleted` removes it; unknown events are no-ops. See §12.1. |

### LOW severity — addressed

| # | Finding | Resolution |
|---|---|---|
| 29 | §1.3 — Must explicitly justify not using `command.execute.before` | Added explicit justification: tool surface is what subagents actually call; slash-commands are user-facing and out of scope for v0.1. See §3.2. |
| 30 | §7.5 — Forbid `node:dns`/`node:net`/`node:http`/`node:https` | README must state plugin does not import these. Verifiable by `grep -r 'from "node:' plugins/bizar/src/`. CI enforces. See §7.5. |
| 31 | §7.6 — No raw args in any log level | Invariant added: log contains only timestamp, session ID, tool name, fingerprint hash, outcome, duration. No args, no session content. See §7.6. |
| 32 | §10.3 — One canonical wording for all subagents | All 9 subagents get identical `## Loop Guard Handling` section. See §11.2. |
| 33 | §10.4 — Add Vör, Frigg, Forseti to update list | Added. Full list of 9 agents in §11.2 and §14. |
| 34 | §11.5 — Add canonical-key-order test to `fingerprint.test.ts` | Added. `fingerprint.ts` must sort keys before `JSON.stringify`. Test verifies two objects with same keys/values but different key order produce same fingerprint. See §12.1. |

### Open questions — resolved

| # | Question | Resolution |
|---|---|---|
| 12.1 | Aggressive path normalization? | Use `path.relative(worktree, absPath)` for in-worktree; per-path hash for out-of-worktree. See §5.3. |
| 12.2 | `<system-reminder>` vs regular message? | Use `experimental.chat.system.transform` for thresholds 5 and 8. Injected text is static template. Threshold 12 remains throw. See §3.1, §5.4, §7.2. |
| 12.3 | `~/.cache/bizarharness/` correct? | Confirmed. See §4.2. |
| 12.4 | Disable env vars? | Added: `BIZAR_DISABLE=1`, `BIZAR_DISABLE_LOOP=1`, `BIZAR_DISABLE_LOG=1`, `BIZAR_LOG_LEVEL`. See §6.5. |
| 12.5 | Accept limitation re: custom agents? | Accepted. README warning is **mandatory** and is part of Release Criteria. See §13 #4, §15 #4. |

---

## 1. Purpose

A BizarHarness-bundled opencode plugin that gives Odin better visibility into subagent activity and a mechanism to stop/reassign agents that are stuck. Three capabilities:

1. **Loop detection** — fingerprint tool calls and warn/block on repetition.
2. **Periodic status reporting** — log subagent activity so Odin (and the human) can see what is happening.
3. **Handoff signal** — when a subagent is clearly stuck, inject a message that nudges it (or the parent) to reassign via the `task` tool.

This lives in the **main BizarHarness repo** (not BizarHarness-dev) because it ships with the product. Dev testing happens in BizarHarness-dev's Docker sandbox.

## 2. Location

```
BizarHarness/
└── plugins/
    └── bizar/
        ├── package.json       (npm package metadata; "type": "module")
        ├── tsconfig.json      (extends Node 22 + Bun-compatible)
        ├── README.md          (MUST contain ## Limitations — see §15 #4)
        ├── index.ts           (plugin entry; exports default Plugin function)
        ├── src/
        │   ├── state.ts       (per-session state, persisted to ~/.cache/bizarharness/)
        │   ├── fingerprint.ts (stable hash of (tool, args) for loop detection)
        │   ├── loop.ts        (thresholds, decision logic)
        │   ├── report.ts      (per-session log writer)
        │   ├── handoff.ts     (message templates)
        │   └── options.ts     (clamping, validation, secret-dir check)
        └── tests/
            ├── fingerprint.test.ts
            ├── loop.test.ts
            ├── state.test.ts
            ├── options.test.ts
            ├── event.test.ts
            └── block.test.ts
```

After install, the layout mirrors this under `<project>/.opencode/plugins/bizar/`. See §9.1.

## 3. Hook Surface Used

### 3.1 Hooks used

From the opencode plugin API (per `customize-opencode` skill):

| Hook | What we do |
|---|---|
| `config(cfg)` | No mutation. Read final config and resolve plugin options. Wrap whole init in try/catch — see §8.1. |
| `event(input)` | Track events. Used to count turns per session, observe session boundaries (`session.created`, `session.deleted`), update last-activity timestamp. |
| `tool.execute.before(input, output)` | **Primary loop-detection point.** Compute fingerprint of `(tool, args)`, look up session state, decide warn/inject/block. Throw at threshold 12. See §5.4. |
| `tool.execute.after(input, output)` | Record the call result and append to `toolCalls` array in session state. |
| `chat.message` | **Seed session state on first user message per session.** Dedupe by message ID. See §4.5. |
| `experimental.chat.system.transform` | **Handoff injection point** for thresholds 5 and 8. Inserts a static-template string into the agent's next-turn context. See §5.4, §7.2. |

### 3.2 What we explicitly do NOT use

- **Not `tool.definition`** — would alter agent tool surface; too invasive.
- **Not `command.execute.before` / `command.execute.after`** — slash-commands are user-facing. The loop guard targets the **tool** surface that subagents actually invoke during execution (which is where loops manifest). Slash-command interception is a separate concern (e.g., `/bizar status`) deferred to v0.2+ if added. *(Justifies LOW finding 29.)*

### 3.3 Interaction with opencode's `doom_loop` permission

opencode has a built-in `doom_loop` permission (a soft recovery that prompts the user after several repeated tool calls). **The plugin's hard-block at threshold 12 runs BEFORE opencode's soft `doom_loop` recovery. The plugin wins.**

When both fire on the same call:
1. `tool.execute.before` throws first.
2. opencode catches the throw and surfaces the loop-guard error to the user/agent.
3. `doom_loop` is never triggered because the call did not complete.

Rationale: a deterministic hard block is preferable to a user prompt because (a) it prevents the agent from continuing the loop while the user reads the prompt, and (b) the loop-guard error message is specifically designed to drive the subagent to use `task` rather than continuing to retry.

## 4. State Management

### 4.1 Storage

- Per-session JSON file at `~/.cache/bizarharness/<sessionId>.json` (see §4.2).
- Schema:
  ```ts
  {
    sessionId: string;
    parentAgent: string | null;       // seeded on first user message via chat.message
    startedAt: number;                // epoch ms
    lastActivityAt: number;
    turnCount: number;
    toolCalls: Array<{
      tool: string;
      fingerprint: string;            // sha256 of normalized (tool, args)
      at: number;                     // epoch ms
      outcome?: "ok" | "error";
    }>;
    warningsIssued: number;
    blocksTriggered: number;
  }
  ```
- Cap `toolCalls` at last 50 (rolling window — older entries pruned on write).

### 4.2 State directory location

Confirmed: `~/.cache/bizarharness/` (XDG cache home). BizarHarness already has a precedent of using XDG paths in `cli/utils.mjs`. *(Resolves Open Q 12.3.)*

### 4.3 Concurrency: per-session async mutex

Bun is single-threaded, but async I/O (filesystem reads/writes) interleaves across awaits. Concurrent state writes for the same session could lose updates. To prevent this, the plugin maintains a **per-session async mutex** implemented as a chain of pending Promises keyed by session ID:

```ts
// Pseudocode
const locks = new Map<string, Promise<unknown>>();

async function withSessionLock<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(sessionId) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(sessionId, next.catch(() => {})); // don't poison the chain on failure
  return next;
}
```

Every state read/write goes through `withSessionLock(sessionId, …)`. This serializes writes per session while letting different sessions proceed in parallel.

### 4.4 Per-session state (not per-call agent attribution)

The plugin **does not** track per-call agent attribution in tool call metadata. `tool.execute.before` does not carry the agent name; only `chat.message` carries it. Tool calls are attributed to the **session**, not to a specific agent within the session. *(HIGH finding 1.)*

The `parentAgent` field is the **first** user-message sender seen for the session (typically "odin"). Subsequent subagent dispatches within the same session do not update this field.

### 4.5 `chat.message` seeding

`chat.message` fires for every user message, not just on dispatch. Implementation:

- Plugin maintains an in-memory `Set<string>` of seen message IDs per session (not persisted).
- On `chat.message`, if the `messageId` is new AND this is the first message seen for the session, write `parentAgent` into the state file.
- Duplicate `chat.message` events for the same message ID are no-ops.

*(HIGH finding 2.)*

#### 4.5.1 State-file creation lifecycle

**The state file is first created on the `chat.message` seed — the first user message per session.** This is the canonical lifecycle point. Rationale:

- It is the earliest event in a session for which the plugin has identifying information (the parent agent name and the session ID).
- It happens before any `tool.execute.before` fires, so loop detection always finds the state file already present.
- It bundles state creation with the `parentAgent` seed into a single write, avoiding a "create empty, then update" pattern.
- `plugin init` is too early — opencode has not yet told us which sessions exist.
- `tool.execute.before` is too late — by the time the first tool call fires, the state file should already exist; creating it lazily there adds a race window with the per-session mutex (§4.3).

**Lazy fallback for subagent-only sessions.** If a session produces `tool.execute.before` events but never produces a `chat.message` (e.g. a fully programmatic subagent dispatch with no user prompt), the state file is created on the first `tool.execute.before` instead, with `parentAgent: null` and the same empty-state shape as §4.7. This fallback is best-effort and does not change the canonical "first write is on chat.message seed" rule for ordinary sessions.

The `session.created` event observed in `event.test.ts` (§12.1) does NOT create the state file. It only updates the in-memory seen-message set and may be used to warm caches, but the file on disk is created at the chat.message seed.

*(Added in v0.3.)*

### 4.6 Stale session cleanup (on plugin init)

On the `config` hook, the plugin scans `~/.cache/bizarharness/*.json` and deletes any file that satisfies either:

1. **Age:** `lastActivityAt` is older than 7 days (relative to current time).
2. **Orphaned:** the `sessionId` is no longer present in opencode (best-effort: `client.session.list()`). If `list()` fails or is unavailable, this branch is silently skipped.

Cleanup is best-effort: failures are logged via `client.app.log` and do not block plugin startup. Files that cannot be deleted are left in place and warned about.

*(MEDIUM finding 14.)*

### 4.7 Corrupt-state fallback

If reading a state file fails with a JSON parse error, the plugin:

1. Logs a warning via `client.app.log`: `"bizar: corrupt state file for session <id>, starting empty"`.
2. Starts with empty in-memory state for that session.
3. **Does not** delete the corrupt file (preserves it for forensic inspection).
4. **Does not throw.** A corrupt file is never fatal.

**Empty-state schema.** The empty state is the same shape as a fresh state file (§4.1) with every value zeroed (or the natural empty value). The plugin MUST use exactly this shape — no extra fields, no missing fields, no `undefined`:

```ts
{
  sessionId: <string>;             // the session ID of the corrupt file
  parentAgent: null;               // unknown until chat.message seeds it
  startedAt: 0;                    // zero — not yet bootstrapped
  lastActivityAt: 0;               // zero — not yet bootstrapped
  turnCount: 0;
  toolCalls: [];                   // empty array
  warningsIssued: 0;
  blocksTriggered: 0;
}
```

Notes on the empty shape:

- `startedAt` and `lastActivityAt` are `0` (epoch zero) rather than `Date.now()`. This distinguishes "never bootstrapped" from "started at this moment" in the log, and avoids rewriting the corrupt file with current time when the fallback fires.
- `parentAgent` is `null` (matches the type `string | null` in §4.1) because no `chat.message` has been seen yet.
- `toolCalls` is an empty array, not `undefined`. The rolling-window logic in §5.1 must be able to scan an empty array without special-casing.
- `sessionId` is preserved from the corrupt file's filename so subsequent `chat.message` and `tool.execute.before` hooks can find and update the in-memory state.

When the next `chat.message` or `tool.execute.before` arrives, the plugin promotes this empty state to a live state by writing `startedAt` and `lastActivityAt` to the current time and persisting normally. *(See §4.5.)*

*(MEDIUM finding 15.)*

## 5. Loop Detection

### 5.1 Algorithm

1. Compute `fingerprint = sha256(stableStringify({ tool, args: normalize(args) }))`. Keys must be sorted canonically before stringify (see LOW finding 34, §12.1).
2. `normalize(args)` strips noise fields per §5.3.
3. Count how many of the last N=10 `toolCalls` share the fingerprint. Re-scan the window each call (see §5.5).
4. Apply thresholds (§5.4).

### 5.2 Fingerprint inputs

- `tool` — the tool name (string).
- `args` — the tool arguments after normalization.

### 5.3 Argument normalization

Stable across retries and noise:

- **Timestamps:** drop any field matching `/(^|_)time($|_)|stamp|created|updated/i` whose value is a number or ISO date string.
- **IDs / nonces:** drop any field matching `/^(id|uuid|nonce|requestId|traceId)$/i`.
- **Paths (critical — HIGH finding 3):**
  - For each string value `v` that parses as an absolute path:
    - Compute `rel = path.relative(worktree, v)`.
    - If `rel` does not start with `..` and is not absolute (i.e., the path IS under the worktree): replace `v` with `rel` (e.g., `src/index.ts`).
    - Otherwise (path is outside the worktree): replace `v` with the per-path stable hash, format `path:<16 hex chars>` where the hex is `sha256(v).slice(0, 16)`.
  - **Never** collapse to a global sentinel like `__ABS__`. A global sentinel allows two distinct paths in different worktrees to collide, breaking loop detection and creating a fingerprint-collision attack vector.
- **`cwd` field:** strip entirely (working directory noise).
- **Recurse into nested objects** with the same rules.
- **Array elements** are normalized positionally. Arrays of different lengths are not normalized to the same fingerprint.

### 5.4 Thresholds (defaults)

| Repetitions in last 10 | Action | Mechanism |
|---|---|---|
| 3 | Log a warning via `client.app.log`. **No injection.** | — |
| 5 | Inject system message via `experimental.chat.system.transform`. | Static template (§7.2). |
| 8 | Inject a stronger system message via `experimental.chat.system.transform`. | Static template (§7.2). |
| 12 | **Block.** Throw from `tool.execute.before`. | Hard error surfaces in TUI as a tool error. |

Injected message text (canonical, static — see §7.2):

- **Threshold 5:** `"[loop guard: 5 identical calls to <tool>]. Consider using the task tool to report back to your parent with what you've learned and what you need."`
- **Threshold 8:** `"[loop guard: 8 identical calls to <tool>]. Consider using the task tool to report back to your parent with what you've learned and what you need."`
- **Threshold 12 (in thrown error):** `"Loop protection: 12 identical calls to <tool>. Use task to escalate."`

The only interpolation in any of these is `<tool>`, which is the tool name from opencode's tool registry (a short identifier, not user-controllable content).

### 5.5 Window vs counter semantics

The window is the last 10 tool calls in the session. **Repetitions are counted by re-scanning the window each time, not by a running counter.**

Example: with `loopWindowSize = 4` and the most recent window being `[bash X, bash X, read, bash X]`, the fingerprint for X reports **3 repetitions** — not 4 (window size) and not "3 in a row" (counter). The intermediate `read` does not "reset" a counter; it just sits in the window and shifts older X entries out as the window rolls forward.

The threshold check is: "how many entries in the last `loopWindowSize` tool calls share this fingerprint?"

This design catches both rapid-fire loops and slow, persistent loops. *(MEDIUM finding 13.)*

### 5.6 Why these specific thresholds?

- 3 = harmless repetition, common in legitimate use (retry, look-around)
- 5 = suspicious, worth flagging
- 8 = almost certainly a loop, escalate
- 12 = definitely stuck, block

All configurable. Defaults are conservative.

### 5.7 Known miss classes

These are documented in §13 and the README:

- Syntactically different but semantically identical args (e.g., `ls -la` vs `ls -la .`).
- Cross-tool loops (alternating `read` and `grep` on the same content).
- Arg-mutating loops (`read foo1`, `read foo2`, …).

## 6. Configuration

### 6.1 Plugin options (in `opencode.json`)

```jsonc
"plugin": [
  ["./plugins/bizar/index.ts", {
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

### 6.2 Option clamping and validation

The plugin never throws on bad config. On load, options are normalized:

| Input | Normalized value |
|---|---|
| Missing option | Default. |
| Empty options object | All defaults applied. |
| `loopThresholdWarn` < 1 | `Math.max(1, Math.floor(value))`. |
| `loopThresholdEscalate` < 1 | `Math.max(1, Math.floor(value))`. |
| `loopThresholdBlock` < 1 | `Math.max(1, Math.floor(value))`. |
| `warn >= escalate` | `escalate = warn + 1`. |
| `escalate >= block` | `block = escalate + 1`. |
| `loopWindowSize` | Clamped to `[3, 50]`. |
| `logRotationBytes` | `Math.max(1024, Math.floor(value))` (minimum 1 KB to prevent thrashing). |
| Non-integer numeric value | `Math.floor(value)` then apply above rules. |
| String where number expected | `Number(...)`; if `NaN`, apply default. |

After clamping, log a `client.app.log` warning if any non-default normalization was applied. *(MEDIUM finding 17.)*

### 6.3 Threshold/window constraint

Enforce `loopThresholdBlock <= loopWindowSize + 2`. If violated (e.g., `block=20`, `window=10`), set `block = loopWindowSize + 2` and log a warning explaining the constraint. *(MEDIUM finding 19.)*

### 6.4 Secret-directory refusal

If `logDir` or `stateDir` resolves (after `~` expansion and normalization) to a path inside any of:

- `~/.ssh/`
- `~/.gnupg/`
- `~/.aws/`
- `~/.kube/`

…then the plugin **refuses to start** and logs an error via `client.app.log`:

```
bizar: refusing to start — logDir/stateDir <resolved-path> is inside a secret directory (<kind>). Set BIZAR_DISABLE=1 or specify a different path.
```

The plugin returns empty hooks. opencode continues without the plugin for the session. *(MEDIUM finding 18.)*

**Matching algorithm.** A target path is REJECTED if it is the secret directory itself OR a descendant of it. Concretely, the plugin MUST use `path.resolve` to absolutize both sides and then apply the standard "is equal to OR is a strict descendant of" test:

```ts
import path from "node:path";

const SECRET_DIRS = ["~/.ssh", "~/.gnupg", "~/.aws", "~/.kube"];

function isInsideSecretDir(target: string): { hit: boolean; kind?: string } {
  const resolvedTarget = path.resolve(expandHome(target));
  for (const secret of SECRET_DIRS) {
    const resolvedSecret = path.resolve(expandHome(secret));
    const isEqual = resolvedTarget === resolvedSecret;
    const isDescendant = resolvedTarget.startsWith(resolvedSecret + path.sep);
    if (isEqual || isDescendant) {
      return { hit: true, kind: secret };
    }
  }
  return { hit: false };
}
```

The two clauses in the `if` are both required and neither is sufficient on its own:

- `path.resolve(target) === path.resolve(secretDir)` catches the case where the target IS exactly the secret directory (e.g. `logDir: "~/.ssh"`).
- `path.resolve(target).startsWith(path.resolve(secretDir) + path.sep)` catches every strict descendant. The `+ path.sep` is critical — without it, `~/.ssh-foo` would falsely match the prefix `~/.ssh`. (Trailing separator on `secretDir` is not safe to add directly because `path.resolve` strips trailing separators; appending `path.sep` to the resolved form is the canonical idiom.)

**Why not `fs.realpath`?** `realpath` would resolve symlinks, but at config-validation time the secret directories may not exist yet, and we do not want to assume the user's home is a symlink. `path.resolve` is deterministic and filesystem-free; symlink resolution is out of scope for v0.3.

*(Added in v0.3.)*

### 6.5 Environment-variable overrides

*(Resolves Open Q 12.4.)*

| Env var | Effect |
|---|---|
| `BIZAR_DISABLE=1` | Disables the plugin entirely. Plugin returns empty hooks; logs once at debug level. |
| `BIZAR_DISABLE_LOOP=1` | Loop guard disabled (no fingerprint, no threshold check, no throw). Status reporting still active. |
| `BIZAR_DISABLE_LOG=1` | Status reporting disabled. Loop guard still active. |
| `BIZAR_LOG_LEVEL=debug\|info\|warn\|error` | Sets log verbosity. Default: `info`. Invalid values fall back to `info` with a warning. |

Env vars are read once at plugin init. Changes during a session are ignored.

## 7. Security Considerations

### 7.1 Path privacy — log is metadata-only

**The per-call log line is metadata-only and does NOT include tool args.** The log format is:

```
2026-06-17T14:30:01.123Z session=<sid> tool=read fingerprint=ab12cd outcome=ok duration=45ms
```

Tool args (and therefore file paths) are never written to the log file at any level. Path privacy is therefore not a concern in v0.1.

The v0.1 spec contained contradictory language (saying args were not in the log line but also that paths were in the log). This is resolved: **paths are not in the log**. The `fingerprint` hash is computed from normalized args, but the args themselves never reach disk. *(HIGH finding 6.)*

### 7.2 Prompt-injection invariant

**All injected text is a static string template. No tool args, no LLM output, no agent-controlled content is ever interpolated into the injected message.**

Concretely:

- The threshold-5 and threshold-8 messages are string literals in `handoff.ts` (see §5.4).
- The only interpolation is `<tool>`, which is the tool name from opencode's tool registry — a short, well-known identifier (e.g., `read`, `bash`, `edit`). It is not user-controlled content.
- No session content, no agent output, no tool result, no environment value, no LLM-generated string is ever concatenated into an injected message.

Enforcement: any PR that adds string concatenation or template interpolation involving non-tool-name values into the injected message is rejected at review. The `block.test.ts` (§12.1) also pins the exact injected strings. *(HIGH finding 7.)*

### 7.3 What the plugin does NOT do

- **Does not modify user files** (read-only on the project).
- **Does not call external APIs** (no LLM calls, no telemetry).
- **Does not override agent prompts** (only injects ephemeral system messages into the current turn's context).
- **Does not manage subagent lifecycle** (opencode does that).
- **Does not read environment variables, secrets, or auth tokens** (other than the Bizar-specific env vars in §6.5).
- **Does not write outside `~/.cache/bizarharness/`** by default.
- **Does not register slash commands in v0.1** (v0.2 may add `/bizar status`, `/bizar reset`).

### 7.4 Network access

The plugin makes zero outbound calls. See also §7.5 for module-import guarantees.

### 7.5 Forbidden imports

The plugin does not import any network module. The README must state:

> The plugin does not import `node:dns`, `node:net`, `node:http`, or `node:https`.

This is verifiable by:

```
grep -r 'from "node:' plugins/bizar/src/
```

A CI check enforces this: the build fails if any match is found. *(LOW finding 30.)*

**CI test-script command.** The build's test script MUST include the following block, verbatim, before the unit tests run. It is a fail-closed check — the test suite fails immediately if any forbidden `node:` import is found:

```bash
# CI: forbid network-bearing node: imports in plugin source (bizar §7.5)
if grep -rE 'from "node:(dns|net|http|https)"' plugins/bizar/src/; then
  echo "FAIL: plugins/bizar/src/ contains a forbidden node: import (dns|net|http|https)"
  exit 1
fi
```

Why the alternation is restricted to `(dns|net|http|https)`: these are the only `node:` modules that give the plugin network capability. Other `node:` modules (`node:fs`, `node:path`, `node:os`, `node:util`, `node:crypto`, etc.) are allowed because they are not network-bearing. The `^` anchor is intentionally absent — the regex matches the literal substring anywhere in a line, which is sufficient for `from "node:..."` import statements and avoids false negatives from comments or whitespace.

`grep -E` (extended regex) is used rather than `grep -F` (fixed string) so the alternation works on minimal BusyBox / Alpine CI images where extended regex is in the default `grep` build. The check is run from the repository root, with `plugins/bizar/src/` as the search root, and exits non-zero on the first match.

The block above is added to the `test` script in `package.json` immediately before the call to the unit-test runner. CI is allowed to add additional checks (e.g. `grep -rE 'require\("node:(dns|net|http|https)"\)'`) but MUST keep the import-statement form shown here.

*(Added in v0.3.)*

### 7.6 Log content invariant

At no log level does the plugin emit raw tool args, raw session content, raw environment values, or raw LLM output. The log contains only:

- ISO timestamp
- Session ID
- Tool name
- Fingerprint hash (hex)
- Outcome (`ok` / `error`)
- Duration in milliseconds

This invariant is tested: `state.test.ts` and `report.test.ts` (if added) must assert no args appear in the written log. *(LOW finding 31.)*

## 8. Plugin Lifecycle

### 8.1 Init: try/catch wrapper

The plugin's exported function **MUST** wrap its initialization in a try/catch:

```ts
export default async function plugin(ctx): Promise<PluginHooks> {
  try {
    // … init: options, mkdir, stale cleanup, session-list call
    return hooks;
  } catch (err) {
    await ctx.client.app.log({
      level: "error",
      message: `bizar: init failed: ${String(err)}`,
    });
    return {}; // empty hooks — plugin is a no-op for this session
  }
}
```

Any error during init (config parsing, directory creation, session-list call, etc.) is caught. The plugin returns empty hooks and opencode continues normally. **A broken plugin never crashes opencode.** *(MEDIUM finding 21.)*

### 8.2 Directory creation

On init, before anything else:

```ts
fs.mkdirSync(stateDir, { recursive: true });
fs.mkdirSync(logDir, { recursive: true });
```

If either fails with `EACCES`, `EROFS`, or any other error, the plugin logs the error via `client.app.log` and returns empty hooks (per §8.1). **The plugin does not crash opencode.** *(MEDIUM finding 20.)*

### 8.3 Log rotation

On each log write, before appending, the plugin checks the current log file's size:

```
if (currentSize + writeSize > logRotationBytes) {
  rotate();
}
```

Rotation sequence (each `fs.renameSync` in its own try/catch):

1. Delete `logDir/.3.log` if it exists (try/catch — failure is non-fatal).
2. Rename `logDir/.2.log` → `logDir/.3.log` (try/catch).
3. Rename `logDir/.1.log` → `logDir/.2.log` (try/catch).
4. Rename `logDir/<sessionId>.log` → `logDir/.1.log` (try/catch).

If any `renameSync` throws (e.g., source file does not exist yet for an early step, or transient filesystem error), that step is skipped, a warning is logged via `client.app.log`, and the write proceeds against whatever state was reached. Rotation is best-effort: it never blocks the log write. *(MEDIUM finding 22.)*

## 9. Installation

### 9.1 Install path (resolved)

After install, the layout is:

```
<project-root>/
└── .opencode/
    ├── opencode.json              (plugin entry references ./plugins/bizar/index.ts)
    └── plugins/
        └── bizar/
            ├── package.json
            ├── tsconfig.json
            ├── README.md          (must contain ## Limitations — see §15 #4)
            ├── index.ts
            ├── src/...
            └── tests/...
```

The plugin entry in `opencode.json`:

```jsonc
"plugin": [
  ["./plugins/bizar/index.ts", { /* options per §6.1 */ }]
]
```

The path `./plugins/bizar/index.ts` is **relative to the config file's directory** (`<project-root>/.opencode/`). *(Resolves HIGH finding 8 / MEDIUM finding 23.)*

### 9.2 Install function: `installPluginBizar()`

In `cli/copy.mjs`, add:

```js
export function installPluginBizar(projectRoot) {
  const srcDir = path.resolve(__dirname, "../plugins/bizar");
  const dstDir = path.join(projectRoot, ".opencode", "plugins", "bizar");
  copyDirRecursive(srcDir, dstDir);
  patchOpencodeConfig(projectRoot, "./plugins/bizar/index.ts");
}
```

Where `patchOpencodeConfig` is an idempotent helper that adds the plugin entry to `<project-root>/.opencode/opencode.json` if it is not already present.

Wired into `cli/install.mjs` as a new component option (e.g., `--with-bizar-plugin`) and **enabled by default** for new installs. Existing installs require an explicit opt-in.

### 9.3 Copy strategy: pick (B)

*(Resolves MEDIUM finding 24.)*

The plugin is copied to `<project>/.opencode/plugins/bizar/` AND explicitly referenced in `opencode.json`. This gives:

- Per-project isolation (each project can pin its own plugin version).
- Option support via the inline options object (which opencode passes through to the plugin entry).

## 10. Status Reporting

### 10.1 What we report

- Every tool call is appended to `~/.cache/bizarharness/logs/<sessionId>.log` (one line per call, metadata-only per §7.1):
  ```
  2026-06-17T14:30:01.123Z session=<sid> tool=read fingerprint=ab12cd outcome=ok duration=45ms
  ```
- Log is rotated at 10 MB by default (keep last 3 files; see §8.3).

### 10.2 What we do NOT do

- **No TUI injection** for status (too noisy — agents would constantly see their own status).
- **No system-reminder injection** at intervals (would pollute context).
- **No parent-to-child status pings** (opencode doesn't surface these to the user anyway).

The log file is the artifact. A future Odin-side change could read this log to display status, but that's out of scope for v0.1.

## 11. Agent Prompt Updates

The handoff mechanism (message injection at thresholds 5 and 8; throw at 12) only works if subagents **recognize** the injected message and **act on it**. Without prompt updates, a loop-blocked subagent may simply retry the same call.

### 11.1 Odin: concrete loop-guard rule

In `config/agents/odin.md`, add the following section (placed AFTER `## Hindsight Memory Protocol`, BEFORE any closing material):

```markdown
## Loop Guard Handling

**Loop guard protocol.** When a subagent's response contains any of the strings the plugin actually emits (§5.4), treat the subagent as failed on this task. Do NOT re-dispatch the same agent on the same task. The plugin emits exactly three recognisable patterns:

- `[loop guard: 5 identical calls to <tool>]` (threshold 5, system message injected via `experimental.chat.system.transform`)
- `[loop guard: 8 identical calls to <tool>]` (threshold 8, system message injected via `experimental.chat.system.transform`)
- `Loop protection: 12 identical calls to <tool>` (threshold 12, error thrown from `tool.execute.before`)

Match on the literal substrings above. `<tool>` is whatever tool name the opencode tool registry supplied at runtime (e.g. `read`, `bash`, `edit`) — it is NOT the literal text `<tool>`.

Recovery procedure:

1. Read the subagent's findings from `~/.cache/bizarharness/logs/<sessionId>.log` to understand what it did before looping.
2. Decompose the remaining work into a new task whose prompt begins with a summary of those findings.
3. Dispatch to a different agent tier if possible (e.g., escalate from @thor to @tyr). If only the same tier is available, re-dispatch to the same agent with the rewritten prompt — never with the original one.
```

*(Replaces vague v0.1 wording; resolves MEDIUM finding 25.)*

### 11.2 All subagents: canonical `## Loop Guard Handling` section

The following section is added, with **identical wording**, to each subagent's prompt file:

- `config/agents/thor.md`
- `config/agents/tyr.md`
- `config/agents/mimir.md`
- `config/agents/heimdall.md`
- `config/agents/hermod.md`
- `config/agents/baldr.md`
- `config/agents/vor.md` (clarifier)
- `config/agents/frigg.md` (Q&A)
- `config/agents/forseti.md` (auditor)
- `config/agents/quick.md` (primary — fast-path)
- `config/agents/vidarr.md` (subagent — hardest problems)

*(Adds Vör, Frigg, Forseti to the v0.1 list; resolves LOW finding 33. Adds Quick and Vidarr per v0.3 — Quick is the primary fast-path tier, Vidarr is the subagent for the hardest problems.)*

Section text (verbatim across all eleven agents — resolves LOW finding 32):

> **CANONICAL TEXT — VERBATIM. DO NOT MODIFY. COPY THIS BLOCK INTO EVERY SUBAGENT PROMPT EXACTLY AS SHOWN, INCLUDING WHITESPACE, PUNCTUATION, AND THE THREE BULLETED MESSAGE FORMS AT THE END. ANY DEVIATION BREAKS THE LOOP-GUARD HANDOFF (§11.1) AND §15 #5 RELEASE CRITERION.**

```markdown
## Loop Guard Handling

If you see a "Loop guard" message of any kind (system reminder, tool error, or repeated identical tool calls), use the `task` tool to report back to your parent agent with what you have learned and what you need to proceed. Do not continue the same approach.

Specifically, if a tool call fails with an error containing `Loop protection:` or `Loop guard:`, your next action must be `task` to your parent agent — not another attempt at the same tool call.

The injected message you will see is exactly one of:

- `[loop guard: 5 identical calls to <tool>]. Consider using the task tool to report back to your parent with what you've learned and what you need.`
- `[loop guard: 8 identical calls to <tool>]. Consider using the task tool to report back to your parent with what you've learned and what you need.`
- An error containing: `Loop protection: 12 identical calls to <tool>. Use task to escalate.`
```

The three bulleted message forms at the end are the **only** strings the plugin emits (§5.4). They are the contract: whatever the subagent sees in the wild, the three strings above are the complete set. Reviewers must reject any PR that paraphrases, reorders, or omits the bullet list — the subagent's recognition depends on seeing these literal substrings.

**Placement:** AFTER `## Hindsight Memory Protocol`, BEFORE any closing material (footer, version note, etc.). The wording is canonical across all eleven agents because the loop-guard message is the same regardless of which agent sees it. The wording is also self-contained — it does not depend on any other section of the agent prompt being present.

**Why this is identical to how `## Hindsight Memory Protocol` is referenced.** The `## Hindsight Memory Protocol` section is specified in the same "canonical, copy verbatim" style elsewhere in the project: a single source of truth, named in the spec, and copy-pasted into each agent's prompt file. `## Loop Guard Handling` follows the same convention so reviewers have one mental model for "do not edit this section" across both areas.

*(Canonical-text framing added in v0.3; resolves LOW finding 32.)*

## 12. Testing Approach

### 12.1 Unit tests

`tests/fingerprint.test.ts`:
- Stable hash for same args.
- Different hash for different tools.
- Different hash for different args.
- **Canonical key order:** two objects with the same keys/values but different key insertion order produce the same fingerprint. *(LOW finding 34.)* Implementation note: `fingerprint.ts` must sort object keys before `JSON.stringify` (or use a stable-stringify library). Minimal test stub:

  ```ts
  import { describe, test, expect } from "bun:test";
  import { fingerprint } from "../src/fingerprint";

  describe("fingerprint — canonical key order", () => {
    test("same keys/values in different insertion order produce the same fingerprint", () => {
      const a = {
        tool: "read",
        args: { path: "/tmp/foo.ts", recursive: false, limit: 10 },
      };
      const b = {
        tool: "read",
        args: { limit: 10, recursive: false, path: "/tmp/foo.ts" },
      };
      // Same keys, same values, different insertion order — must match.
      expect(fingerprint(a)).toBe(fingerprint(b));
    });

    test("nested objects with different insertion order also match", () => {
      const a = { tool: "edit", args: { meta: { z: 1, a: 2 }, path: "/x" } };
      const b = { tool: "edit", args: { path: "/x", meta: { a: 2, z: 1 } } };
      expect(fingerprint(a)).toBe(fingerprint(b));
    });
  });
  ```

  The first test catches the canonical-key-order regression directly. The second test pins the recursive behaviour described in §5.3. Both must pass for §15 #18 to be satisfied.
- Path normalization: in-worktree absolute path → worktree-relative string; out-of-worktree absolute path → `path:<16 hex>`.
- Two distinct absolute paths outside the worktree produce two distinct hashes (no global-sentinel collision).
- Noise fields stripped: timestamps, IDs, nonces, `cwd`.
- Empty args object → stable hash.
- Nested objects normalized recursively.

`tests/loop.test.ts`:
- Threshold-3: log warning, no injection.
- Threshold-5: trigger injection (verify by inspecting the function output for the static template string).
- Threshold-8: trigger stronger injection.
- Threshold-12: throw with message containing tool name and "loop" (case-insensitive) or "escalate".
- Window rolling: `[bash X, bash X, read, bash X]` with `loopWindowSize=4` reports 3 repetitions of X. *(MEDIUM finding 13.)*
- Out-of-window entries do not count.

`tests/state.test.ts`:
- Read/write round-trip preserves all fields.
- `toolCalls` array pruned to last 50 on write.
- Corrupt file → warning logged, in-memory state starts empty, file preserved on disk.
- Per-session mutex serializes concurrent writes (test with `Promise.all` of 10 writes to the same session; assert final state has all 10 entries in order, no lost updates).

`tests/options.test.ts` — *(MEDIUM finding 27):*
- Empty options object → all defaults applied.
- Negative `loopThresholdWarn: -5` → clamped to 1.
- Out-of-order: `warn: 8, escalate: 5, block: 12` → corrected to `warn: 8, escalate: 9, block: 10` (after applying other clamps).
- `logDir: "~/.ssh/evil"` → plugin refuses to start, returns empty hooks, logs error.
- `stateDir: "~/.aws/creds"` → refused.
- `loopWindowSize: 100` → clamped to 50.
- `loopThresholdBlock: 20, loopWindowSize: 10` → block clamped to 12 (= 10 + 2).
- Invalid input (NaN, non-numeric string) → default applied.
- Plugin never throws on bad config.

`tests/event.test.ts` — *(MEDIUM finding 28; updated in v0.3.1 to match §4.5.1):*
- `session.created` event does NOT create the state file on disk; it only updates the in-memory seen-message set (and may warm caches). The file is created later at the `chat.message` seed. *(Matches §4.5.1.)*
- `session.deleted` event removes the state file.
- Unknown event types are no-ops (no state file created, no error).
- Duplicate `session.created` events for the same session ID are a no-op — no extra file written, no error raised.
- First `chat.message` per session creates the state file with the schema from §4.7 — all fields zeroed per the empty-state shape, `parentAgent` set to the message sender, `startedAt` and `lastActivityAt` set to the current time.
- First `tool.execute.before` for a session where `chat.message` has not yet fired creates the state file (subagent-only lazy fallback per §4.5.1) with `parentAgent: null` and the §4.7 empty-state shape.

`tests/block.test.ts` — *(HIGH finding 9):*
- Pre-populate state with 11 entries sharing fingerprint `F`.
- Call `tool.execute.before({ tool: "read", args: <same args as F> }, output)`.
- Assert the call rejects (the returned Promise rejects / the function throws).
- Assert the rejection message contains:
  - the tool name (`read`), AND
  - the substring `loop` (case-insensitive) OR the substring `escalate`.

### 12.2 Integration test prerequisites

The integration test runs in the BizarHarness-dev Docker sandbox. Prerequisites:

1. The `opencode` binary is installed in the image and on `PATH`.
2. `OPENCODE_API_KEY` is set in the container environment to a valid key.
3. Outbound HTTPS is permitted from the container to the opencode API endpoint.
4. The test repo (`/test/repo`) has been initialized with `bizarharness install`.

A `test-integration.sh` script runs at the start of the integration test and fails fast:

```bash
#!/usr/bin/env bash
set -euo pipefail

command -v opencode >/dev/null 2>&1 \
  || { echo "FAIL: opencode not on PATH"; exit 1; }

[[ -n "${OPENCODE_API_KEY:-}" ]] \
  || { echo "FAIL: OPENCODE_API_KEY not set"; exit 1; }

curl -fsS --max-time 5 https://api.opencode.ai/healthz >/dev/null \
  || { echo "FAIL: no outbound HTTPS to opencode API"; exit 1; }

[[ -f /test/repo/.opencode/opencode.json ]] \
  || { echo "FAIL: test repo not installed (missing .opencode/opencode.json)"; exit 1; }

echo "All integration prerequisites met."
```

If any check fails, the script exits non-zero before the integration test begins. *(HIGH finding 10.)*

### 12.3 Integration test

In the BizarHarness-dev Docker sandbox:

1. Install the plugin into the test config.
2. Run `opencode run` non-interactively with a prompt designed to make an agent loop (e.g., "find all .ts files and print the result 20 times").
3. Verify the log file contains the expected fingerprints.
4. Verify that after threshold 12, the tool call is blocked (the error message appears in the agent's transcript).

### 12.4 Manual test

Developer launches the sandbox, runs a real session, watches the log file in another terminal:

```
tail -f ~/.cache/bizarharness/logs/<sessionId>.log
```

## 13. Limitations

Known limitations of v0.1 — documented in the README as a **mandatory** `## Limitations` section (see Release Criteria §15 #4):

1. **Syntactically different but semantically identical args are not caught.** Example: `ls -la` vs `ls -la .` produce different fingerprints. The plugin only catches identical-args loops.

2. **Cross-tool loops are not caught.** Example: `read foo` → `grep foo` → `read foo` → `grep foo` is not detected as a loop. The fingerprint includes the tool name, so different tools produce different fingerprints.

3. **Arg-mutating loops are not caught.** Example: `read foo1`, `read foo2`, `read foo3` produces 3 distinct fingerprints even if the agent's *intent* is to loop. The fingerprint is on the actual call, not on inferred intent.

4. **Custom agents without loop-guard instructions will loop indefinitely past threshold 12.** The plugin throws at threshold 12, but if the subagent has no `## Loop Guard Handling` section in its prompt, it may simply retry the same call indefinitely — each retry blocked, but the agent does not progress. All BizarHarness subagents (Thor, Tyr, Mimir, Heimdall, Hermod, Baldr, Vör, Frigg, Forseti, Quick, Vidarr) include the canonical section (§11.2). **Users who add custom agents without this section will experience infinite-block loops.** This warning is mandatory in the README. *(Resolves MEDIUM finding 12, Open Q 12.5; v0.3 adds Quick and Vidarr.)*

5. **Corrupt state files are not auto-recovered.** A corrupt JSON state file is logged and ignored; the session starts with empty state. The corrupt file is preserved on disk for forensic inspection, not deleted. *(See §4.7.)*

6. **Out-of-worktree paths are hashed, not stored.** A loop involving files outside the worktree will produce stable fingerprints across runs (good) but the original path is not recoverable from the log (acceptable per §7.1 since args are not logged at all).

7. **Stale session cleanup is best-effort.** If `client.session.list()` fails, the age-based cleanup still runs but the "session no longer in opencode" branch is skipped. *(See §4.6.)*

8. **Single-host state.** State files are local to `~/.cache/bizarharness/`. A user with multiple machines will have separate state on each. Cross-host loop detection is out of scope.

9. **Env var changes mid-session are ignored.** Env vars (`BIZAR_DISABLE`, `BIZAR_LOG_LEVEL`, etc.) are read once at plugin init. *(See §6.5.)*

10. **Log rotation is best-effort.** If a `renameSync` fails, that step is skipped and a warning logged. The log may grow past `logRotationBytes` in degenerate cases. *(See §8.3.)*

## 14. Files That Will Change (post-approval)

### New

- `plugins/bizar/` (this whole directory per §2)
- `plugins/bizar/tests/block.test.ts` (HIGH finding 9)
- `plugins/bizar/tests/options.test.ts` (MEDIUM finding 27)
- `plugins/bizar/tests/event.test.ts` (MEDIUM finding 28)

### Modified

- `config/opencode.json` (add plugin entry — install path per §9.1)
- `cli/copy.mjs` (add `installPluginBizar()` per §9.2)
- `cli/install.mjs` (wire `installPluginBizar` as a component option)
- `config/agents/odin.md` (add loop-guard rule per §11.1)
- `config/agents/thor.md`, `tyr.md`, `mimir.md`, `heimdall.md`, `hermod.md`, `baldr.md`, `vor.md`, `frigg.md`, `forseti.md`, `quick.md`, `vidarr.md` (add canonical `## Loop Guard Handling` section per §11.2 — note additions of Vör, Frigg, Forseti per LOW finding 33, plus Quick and Vidarr per v0.3 Fix 3)

### New in BizarHarness-dev

- `plugins/bizar/test/test-integration.sh` (prereq check per §12.2)
- `plugins/bizar/test/` (Docker-based integration test scripts)

## 15. Release Criteria

A v0.1 build is releasable **only if ALL** of the following hold:

1. All unit tests in §12.1 pass.
2. The integration test in §12.3 passes in the BizarHarness-dev Docker sandbox.
3. `plugins/bizar/src/` contains zero matches for `from "node:dns"`, `from "node:net"`, `from "node:http"`, `from "node:https"`. CI enforces this.
4. **The plugin's `README.md` contains a `## Limitations` section that warns that custom agents without loop-handling instructions will loop indefinitely past threshold 12.** If this section is missing, or does not contain the explicit warning, **the build fails.** *(Resolves Open Q 12.5 — non-negotiable.)*
5. All eleven subagent prompt files (`thor.md`, `tyr.md`, `mimir.md`, `heimdall.md`, `hermod.md`, `baldr.md`, `vor.md`, `frigg.md`, `forseti.md`, `quick.md`, `vidarr.md`) contain the canonical `## Loop Guard Handling` section with verbatim wording per §11.2.
6. `odin.md` contains the loop-guard rule per §11.1.
7. The plugin handles all clamping cases in §6.2 without throwing.
8. The plugin refuses to start when `logDir` or `stateDir` is inside a secret directory per §6.4.
9. `experimental.chat.system.transform` is the injection mechanism for thresholds 5 and 8 per §5.4; threshold 12 throws from `tool.execute.before`.
10. `client.app.log` is used for all diagnostic output (no `console.*`).
11. The plugin's init is wrapped in try/catch per §8.1.
12. State writes go through the per-session mutex per §4.3.
13. `chat.message` dedupes by message ID and only seeds `parentAgent` on the first message per session per §4.5.
14. Per-call tool records do not contain agent attribution metadata per §4.4.
15. `tests/block.test.ts` exists and passes per §12.1 (HIGH finding 9).
16. `tests/options.test.ts` exists and passes per §12.1 (MEDIUM finding 27).
17. `tests/event.test.ts` exists and passes per §12.1 (MEDIUM finding 28).
18. `tests/fingerprint.test.ts` includes the canonical-key-order test per §12.1 (LOW finding 34).
19. No match for `from "node:` in `plugins/bizar/src/` (CI-enforced; §7.5).
20. No raw tool args, session content, or LLM output in any log line (verifiable by inspecting `report.ts` and by inspection of a sample log file in the integration test).

## 16. Implementation Order (post-approval)

1. **Tyr:** `plugins/bizar/package.json`, `tsconfig.json`, `index.ts` skeleton with empty hook implementations and the init try/catch (§8.1).
2. **Thor:** `fingerprint.ts` + `tests/fingerprint.test.ts` (canonical key sort; LOW finding 34).
3. **Tyr:** `loop.ts` + `tests/loop.test.ts` (window/counter semantics; §5.5).
4. **Thor:** `state.ts` + `tests/state.test.ts` (per-session mutex; corrupt fallback; §4.3, §4.7).
5. **Tyr:** `report.ts` (log writer; metadata-only; §7.1, §7.6).
6. **Tyr:** `handoff.ts` (static-template message strings; §7.2).
7. **Tyr:** `options.ts` (clamping, validation, secret-dir refusal; §6.2–§6.4).
8. **Tyr:** Wire it all together in `index.ts`; integrate `experimental.chat.system.transform`; honor env vars.
9. **Thor:** `tests/block.test.ts`, `tests/options.test.ts`, `tests/event.test.ts` (HIGH finding 9, MEDIUM findings 27/28).
10. **Thor:** Update `odin.md` (loop-guard rule) and the eleven subagent prompts (canonical section).
11. **Heimdall:** Add `installPluginBizar()` to `cli/copy.mjs`; wire into `cli/install.mjs`.
12. **Thor:** Add `test-integration.sh` to BizarHarness-dev; verify prereq check works.
13. **Thor:** Run integration test in the BizarHarness-dev Docker sandbox.
14. **Heimdall:** Verify all Release Criteria §15 are satisfied; CI gates pass.

Total: ~8–10 hours of work split across the agents.