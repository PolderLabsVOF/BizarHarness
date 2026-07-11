# Bizar Harness — Claude Code Hooks

This directory contains the **Claude Code** adapter scripts that back the
project-scoped hooks defined in `.claude/settings.json`.

They replaced the legacy Cline hooks in `config/hooks/*` (PreToolUse,
PostToolUse, TaskStart, TaskResume, UserPromptSubmit). The Claude Code
set is the only supported path on Bizar v6.3.0+; the legacy Cline hooks
are no longer installed.

## Adapter inventory

| File | Event | Matcher | Behaviour |
|------|-------|---------|-----------|
| `pretooluse-editwrite.mjs`   | `PreToolUse`       | `Write\|Edit\|MultiEdit\|Bash` | Blocks `.env`/secrets/lockfiles; warns on `console.log`/`debugger`/`.only()` in `src/`; scans `Bash` against the 36-pattern dangerous-pattern list |
| `posttooluse-editwrite.mjs`  | `PostToolUse`      | `Edit\|Write\|MultiEdit`        | Logs edit/write latency + size to `~/.config/bizar/hook-logs/` |
| `sessionstart-prime.mjs`     | `SessionStart`     | (none — branches on `source`)  | Primes the agent with CLAUDE.md, AGENTS.md, feature_list state |
| `userpromptsubmit-tag.mjs`   | `UserPromptSubmit` | (none)                          | Tags prompt for `/team`, `/plow-through`, `/test`, `/validate`, `/plan`, `/audit`, `/pr-review` |
| `sessionend-recall.mjs`      | `SessionEnd`       | (none)                          | Records a session summary to the memory vault at `~/.bizar_home/memory/projects/<name>/sessions/` |

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
