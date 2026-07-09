# Bizar Harness — Cline Hooks

This directory contains Cline-native hook scripts. They are NOT markdown
behavioral patterns — they are real Cline hook executables that run at
specific lifecycle events.

## Format

Cline hooks are executable scripts (no extension) with a shebang line:

```bash
#!/usr/bin/env node
```

They live in two locations:
- **Global**: `~/Documents/Cline/Hooks/` (applies to all workspaces)
- **Workspace**: `.clinerules/hooks/` (applies to one project)

The `bizar install` / `bizar update` commands install these scripts to
**both** locations with `chmod +x` so Cline picks them up.

## What each hook does

| Hook | Stage | Job |
|------|-------|-----|
| `TaskStart` | New task | Prime the AI with `.bizar/PROJECT.md` + memory-vault search |
| `TaskResume` | Existing task resumed | Re-read project state, check `git log` since last run |
| `UserPromptSubmit` | User submits prompt | Tag the prompt for routing (`/team`, `/plow-through`, etc.) |
| `PreToolUse` | Before every tool | Block writes to `.env`, `secrets/`, `node_modules/`, lockfiles; warn on `console.log`/`debugger`/`.only()` in `src/` |
| `PostToolUse` | After every tool | Log latency to `~/.config/bizar/hook-logs/`, remind to run `/test` after edits |

## I/O contract

Cline invokes each hook with **JSON on stdin** and reads **JSON on stdout**.

Input shape (Cline → hook):

```json
{
  "clineVersion": "3.0.39",
  "hookName": "PreToolUse",
  "taskId": "...",
  "preToolUse": { "toolName": "write_to_file", "parameters": { "path": "src/foo.ts", ... } }
}
```

Output shape (hook → Cline):

```json
{
  "cancel": false,
  "contextModification": "small note for the next AI decision"
}
```

Set `cancel: true` to block the tool call. The optional `errorMessage`
is shown to the user.

## Disabling a hook

Rename the file to add a `.disabled` suffix (e.g. `PreToolUse.disabled`)
or remove the executable bit (`chmod -x PreToolUse`). Cline silently
skips hooks it can't execute.

## See also

- [Cline hooks documentation](https://docs.cline.bot/customization/hooks)
- `cli/commands/validate.mjs` — `bizar validate` includes a `hooks-installed` check
