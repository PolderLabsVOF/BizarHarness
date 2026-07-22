# Bizar Harness — Claude Code Hooks

This directory contains the **Claude Code** adapter scripts that back the
project-scoped hooks defined in `.claude/settings.json`.

They replaced the legacy Cline hooks. The Claude Code
set is the only supported path on Bizar v6.3.0+; the legacy Cline hooks
are no longer installed.

## Adapter inventory

| File | Event | Matcher | Behaviour |
|------|-------|---------|-----------|
| `pretooluse-editwrite.mjs`   | `PreToolUse`       | `Write\|Edit\|MultiEdit\|Bash` | Blocks `.env`/secrets/lockfiles; warns on `console.log`/`debugger`/`.only()` in `src/`; scans `Bash` against the 36-pattern dangerous-pattern list |
| `posttooluse-editwrite.mjs`  | `PostToolUse`      | `Edit\|Write\|MultiEdit`        | Logs edit/write latency + size to `~/.config/bizar/hook-logs/` |
| `sessionstart-prime.mjs`     | `SessionStart`     | (none — branches on `source`)  | Reads PROGRESS.md + feature_list.json + git log + .bizar/PROJECT.md; branches on `startup`/`clear`/`resume`; WIP=1 guard |
| `thinking-route.mjs`         | `UserPromptSubmit` | (none)                          | Slash-command routing (team/plow-through/test/validate/plan/audit/pr-review) + 35-bucket thinking-* mental-model router |
| `worker-suggest.mjs`        | `UserPromptSubmit` | (none)                          | Calls `cli/worker-dispatcher.mjs:dispatch()` against `config/trigger-patterns.json` |
| `sessionend-recall.mjs`      | `SessionEnd`       | (none)                          | Reads `transcript_path`; writes `.bizar/sessions/<date>-<id>.md` + `.bizar/session-state.json` handoff |

## SessionStart ↔ SessionEnd handoff

The two lifecycle hooks form a state machine via the `.bizar/session-state.json`
file:

```
SessionEnd (session N)
  ↓ writes .bizar/session-state.json with {nextStep, blockers, filesTouched}
SessionStart (session N+1, source: "resume")
  ↑ reads it; primes the agent with "Last nextStep: …" + blockers
```

If `.bizar/session-state.json` is missing, the resume branch degrades
gracefully to "No prior session-state.json found — treating as fresh start."

## I/O contract

Claude Code invokes each hook as a child process, pipes JSON on
**stdin**, and reads JSON on **stdout**. The five adapters above all
read using `process.stdin` and write a single JSON object to
`process.stdout`.

### Stdin (varies by event)

```jsonc
// PreToolUse
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "/home/drb0rk/Projects/BizarHarness",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": { "file_path": "/path", "content": "..." }
}

// PostToolUse  (adds tool_response)
// UserPromptSubmit  (uses .user_prompt instead of .tool_name/.tool_input)
// SessionStart  (uses .source = "startup" | "resume" | "clear")
// SessionEnd  (uses .reason = "exit" | "clear" | "logout" | "prompt_input_exit")
```

### Stdout

```jsonc
// Block (PreToolUse only)
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "..."
  }
}

// Inject context for the next turn (all events)
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",   // or PreToolUse / SessionStart / UserPromptSubmit
    "additionalContext": "..."
  }
}
```

For a non-blocking `PreToolUse`, omitting `permissionDecision` and
emitting only `additionalContext` is a soft hint to the model — the
tool call still proceeds.

## Claude Code lifecycle mapping

The legacy Cline plugin used four separate events (PreToolUse,
PostToolUse, TaskStart, TaskResume, UserPromptSubmit). Claude Code
collapses "task start" and "task resume" into a single `SessionStart`
event that branches on `source` (`startup`, `resume`, `clear`). The
adapter `sessionstart-prime.mjs` reads `source` and applies the
appropriate priming logic for each branch.

## Disabling an individual hook

Easiest path: comment out the matching `hooks` array entry in
`.claude/settings.json`. Removing the executable bit
(`chmod -x …`) also works — Claude Code silently skips hooks it can't
execute.

## See also

- `cli/provision-claude.mjs` — installs Claude Code hooks to
  `~/.claude/hooks/` and wires them via `~/.claude/settings.json`.
- `.claude/settings.json` — the project hook wiring
- `.bizar/session-state.json` — handoff artifact between SessionEnd and SessionStart
