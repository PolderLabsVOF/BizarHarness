# Cline Tools Reference

> **Read this before calling any Cline tool.** Calling tools with the
> wrong argument shape is the #1 cause of "max consecutive mistakes
> reached" session aborts. When in doubt, read this file.

Every Bizar agent runs inside a Cline session and has access to
Cline's built-in tools plus the Bizar plugin's `bizar_*` tools. This
file is the single source of truth for **how to call every Cline
tool correctly**.

For a list of what each tool does, see https://docs.cline.bot.
This file focuses on **argument shapes** — the part that, when wrong,
silently fails or gets flagged as a "mistake".

---

## Quick reference (cheat sheet)

| Tool | Required fields | Common mistake |
|---|---|---|
| `read_file` | `path` | passing a dir instead of a file |
| `list_files` | `path` | forgetting `recursive: true` for nested lookups |
| `search_files` | `query` (regex) | passing non-regex without `include_pattern` |
| `editor` | `path`, `new_text` (and `old_text` OR `insert_line`) | `old_text` not matching whitespace exactly |
| `apply_patch` | `path`, `patch_text` | missing `*** Begin Patch` / `*** End Patch` sentinels |
| `execute_command` | `command` | shell redirects (`>`, `>>`) blocked by default; 10-min timeout |
| `web_fetch` | `url` | passing a non-HTTP URL |
| `ask_question` | `question`, `options` (array of 2–5) | **`options: null` → silent failure → mistake limit** |
| `use_skill` | `skill` | passing a skill that isn't installed |
| `use_subagents` | `prompts` (array of strings) | one prompt per subagent |
| `task` | `agent` (Bizar agent name), `prompt` | passing a non-Bizar agent name |

---

## `read_file`

Read a file (or a slice of one).

```json
{
  "path": "/abs/path/to/file.ts",
  "start_line": 10,
  "end_line": 50
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `path` | string | **yes** | Absolute path. Reading a directory throws. |
| `start_line` | number | no | 1-based. Defaults to 1. |
| `end_line` | number | no | 1-based, inclusive. If omitted, reads to EOF. |

**Failure modes:** `path` to a directory throws `Path is not a file`. `path` to a non-existent file throws. Don't pass `start_line` > `end_line`.

---

## `list_files`

List files in a directory.

```json
{
  "path": "/abs/path/to/dir",
  "recursive": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `path` | string | **yes** | Absolute path to a directory. |
| `recursive` | bool | no | Default false. **Set true for nested lookups.** |

**Failure modes:** `path` to a file throws. The output excludes common build dirs (node_modules, .git, dist, build, .next, coverage, __pycache__, .venv, target, out, bin, obj). Don't rely on the default for deep trees.

---

## `search_files`

Regex search across files.

```json
{
  "query": "class \\w+ extends Plugin",
  "path": "/abs/path/to/project",
  "include_pattern": "*.ts",
  "max_results": 50
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | **yes** | Treated as a regex. Use `rg` syntax. |
| `path` | string | no | Defaults to cwd. Absolute path recommended. |
| `include_pattern` | string | no | Glob, e.g. `*.ts`, `*.{ts,tsx}`. |
| `max_results` | number | no | Default 100. Clamped server-side. |

**Failure modes:** An invalid regex throws `Invalid regex pattern`. Path to a file throws — must be a directory.

---

## `editor`

The workhorse edit tool. Three modes:

### Mode 1 — `old_text` / `new_text` (replace a block)

```json
{
  "path": "/abs/path/to/file.ts",
  "old_text": "export const foo = 1;\n",
  "new_text": "export const foo = 2;\n"
}
```

- `old_text` must match EXACTLY including whitespace and trailing newline.
- If `old_text` is not found → tool returns error `text not found in <path>`.
- If `old_text` matches more than once → tool returns error `multiple occurrences of text found`.

**This is the #1 cause of agent mistakes.** When in doubt:
1. First call `read_file` on the file
2. Copy the exact bytes (including indentation and trailing newline)
3. Make the smallest possible edit

### Mode 2 — `insert_line` (insert at line N)

```json
{
  "path": "/abs/path/to/file.ts",
  "insert_line": 42,
  "new_text": "// new comment\nconst x = 1;\n"
}
```

- `insert_line` is 1-based. The new content is INSERTED before line N.
- Use `insert_line: <last line + 1>` to append at EOF.
- `insert_line` must be in `1..<last line + 1>`. Out-of-range throws.

### Mode 3 — file does not exist (create new)

If the file does not exist, omit `old_text` and pass only `new_text`. Cline creates the parent directories automatically.

```json
{
  "path": "/abs/path/to/new-file.ts",
  "new_text": "// brand new file content\n"
}
```

**Common failures:**
- "No replacement performed: text not found" — whitespace mismatch. Re-read the file and copy the bytes exactly.
- "multiple occurrences" — your `old_text` is too generic. Make it more specific (include more surrounding context).
- Missing trailing `\n` — the new_text and old_text must end with `\n` if the file does.

---

## `apply_patch`

Multi-file unified-diff patches. Use when editing several files atomically.

```
*** Begin Patch
*** Update File: /abs/path/file.ts
@@ context line
-old line
+new line
*** End Patch
```

**Sentinels are mandatory.** Missing `*** Begin Patch` or `*** End Patch` → throws `Invalid patch text - incomplete sentinels. Try breaking it into smaller patches.`

**Prefer `editor` for single-file edits.** Use `apply_patch` only when you need to:
- Edit 2+ files in one atomic operation
- Apply a unified diff you already have

---

## `execute_command`

Run a shell command.

```json
{
  "command": "ls -la /tmp",
  "cwd": "/abs/path",
  "timeout": 30000
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `command` | string | **yes** | Passed to `/bin/bash -c` (Linux/macOS) or `cmd /c` (Windows). |
| `cwd` | string | no | Defaults to the Cline session's cwd. |
| `timeout` | number | no | **Max 600,000 ms (10 min).** Larger values are clamped. |

**Critical constraints:**
- **No shell redirects** (`>`, `>>`, `<`) unless `CLINE_COMMAND_PERMISSIONS.allowRedirects` is true. Use `editor` or `apply_patch` to write files.
- Long-running processes will hit the timeout. For >10min tasks, use `bizar_spawn_background` instead (Bizar plugin tool).
- The `command` string IS a shell command. Quote carefully. Use `&&` to chain, `;` to sequence, `|` to pipe.

**Common failures:**
- `command not found` — the binary isn't on PATH. Use absolute path or `which <name>` first.
- `Permission denied` — file isn't executable, or you're writing to a protected dir.
- `timeout` — increase `timeout` (max 600000) or move to background agent.

---

## `web_fetch`

Fetch a URL and return the content as text.

```json
{
  "url": "https://example.com/docs"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | **yes** | Must be HTTP/HTTPS. No `file://`. |

**Failure modes:** Non-HTTP URLs throw. The fetch goes through Cline's content extractor; PDFs, JS-rendered pages, and login-walled sites may return partial content.

---

## `ask_question`

Ask the user ONE clarifying question with 2–5 options. **This is the most-misused tool.**

```json
{
  "question": "Which database do you want to use?",
  "options": ["PostgreSQL", "MySQL", "SQLite", "MongoDB"]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `question` | string | **yes** | One question. Multi-question calls fail. |
| `options` | array of 2–5 strings | **yes** | **MUST be an array of strings.** Must be 2–5 items. |

### ⚠️ CRITICAL — `options` is REQUIRED, not optional

If you pass `options: null`, `options: undefined`, or `options: []`, Cline
**silently rejects the call** and counts it as a mistake. After 3 such
silent failures (since v6.2.0; 10 since v6.2.4), the session aborts.

### When to use `ask_question`

- A key implementation decision has multiple valid paths
- The user said something ambiguous and you need to clarify before doing real work
- You're about to make a destructive change (rm, drop table, force-push)

### When NOT to use `ask_question`

- You can decide safely using sensible defaults
- The user's intent is clear from context
- You're just confirming something you should have done already
- The answer is in the codebase (use `read_file` / `search_files` first)

### Alternatives to `ask_question`

- **Use `bizar_spawn_team`** to spawn a team that investigates and proposes options
- **Use `use_subagents`** to parallelize the investigation
- **Just pick a sensible default** and document it in your final response

### Recovery from `ask_question` mistakes

If you accidentally pass `options: null` and the tool errors, **DO NOT retry the same broken call**. Instead:
1. Switch to a sensible default
2. Document the decision in your final response
3. Let the user override later if they disagree

---

## `use_skill`

Activate a skill.

```json
{
  "skill": "commit",
  "args": "-m \"Fix auth bug\""
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `skill` | string | **yes** | Exact skill name. Run `skills list` to see available. |
| `args` | string | no | Passed to the skill's runner. |

**Failure modes:** Unknown skill name throws. Skills are case-sensitive.

---

## `use_subagents`

Spawn parallel read-only research subagents.

```json
{
  "prompts": [
    "Trace the auth flow from login button to JWT verification. Cite file paths.",
    "Find every place the database schema is migrated. Cite file paths.",
    "List all the env vars the app reads at startup. Cite file paths."
  ]
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `prompts` | array of strings | **yes** | **One research question per subagent.** Each prompt should be focused and self-contained. |

### Subagent rules

- Subagents are **read-only**. They can read files, search, run read-only commands (ls, grep, git log). They **cannot** edit, write, apply patches, or use the browser.
- Subagents return a focused report citing the most relevant file paths. Read those files yourself before editing.
- Subagents run in parallel — fire 3–5 at once for broad research, not one at a time.
- Subagent results do NOT trigger approval — they run under the "Read project files" auto-approve permission.

### When to use subagents

- Onboarding to an unfamiliar codebase (map architecture in parallel)
- Investigating cross-cutting concerns (auth + logging + errors)
- Pre-edit research (gather context from related files)

### When NOT to use subagents

- Small focused task where you already know which file
- Editing files (use `editor` or `apply_patch` instead)
- Running commands that mutate state (use `execute_command` with `cwd`)

---

## `task` (Bizar plugin — dispatch to a Bizar agent)

Synchronously delegate to a Bizar agent (Odin, Thor, Tyr, Heimdall, Mimir, etc.).

```json
{
  "agent": "thor",
  "prompt": "Implement the rate-limiter middleware in src/middleware/ratelimit.ts"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `agent` | string | **yes** | A Bizar agent name: `odin`, `thor`, `tyr`, `heimdall`, `mimir`, `frigg`, `hermod`, `baldr`, `vor`, `vidarr`, `forseti`. NOT a Cline-built-in agent. |
| `prompt` | string | **yes** | What to do. Be specific. |

**Failure modes:** Unknown agent name throws. The agent runs synchronously and returns its result inline.

### Sync vs async dispatch

- `task` — synchronous, blocks until the agent returns. Use when the parent needs the result before continuing.
- `bizar_spawn_background` (Bizar plugin) — async, returns immediately. Use for long-running work that doesn't block the parent.

---

## `bizar_*` tools (Bizar plugin)

The Bizar plugin adds these on top of the Cline built-ins:

- `bizar_spawn_background(agent, prompt, timeoutMs)` — async background agent
- `bizar_status(instanceId)` — check background instance
- `bizar_collect(instanceId, timeoutMs)` — wait for background result (BLOCKS)
- `bizar_kill(instanceId)` — terminate background
- `bizar_spawn_team(teamName, mission)` — coordinated agent team
- `bizar_team_status(sessionId)` — team progress
- `bizar_plan_action(action, planSlug, ...)` — visual plan canvas
- `bizar_wait_for_feedback(planSlug)` — block until human reviews plan
- `bizar_memory_search(query)` / `read` / `write` / `list` — Bizar memory vault
- `bizar_graph_query(concept)` / `path` / `explain` — knowledge graph

These are documented in `.cline/instructions/bizar-tools.md` (auto-loaded into every session).

---

## Recovery: when you hit the mistake limit

If Cline says "max consecutive mistakes reached (3 in v6.2.0–v6.2.3, 10 since v6.2.4)", the session aborts. To recover:

1. **Stop retrying the same broken call.** Each retry wastes a mistake.
2. **Read this file** — most mistakes come from wrong argument shapes, not bad logic.
3. **Use simpler tools** — `read_file` instead of `editor` for inspection; `apply_patch` instead of `editor` for multi-line.
4. **Spawn a fresh session** if the runtime is in a bad state.

---

## Per-tool I/O contract

All Cline tools return text via stdout-like output. Failed tools return
either:
- A structured error message (e.g. "No replacement performed: text not found in /path")
- An exception thrown back to the agent (which Cline wraps as a mistake)

There is no `success: true|false` field. You must read the response text
to know what happened.