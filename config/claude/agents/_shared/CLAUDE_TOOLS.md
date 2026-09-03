# Claude Code Tools Reference

> **Read this before calling any Claude Code tool.** Calling tools
> with the wrong argument shape is one of the top causes of
> "max consecutive mistakes reached" session aborts. When in doubt,
> read this file.

Every Bizar agent runs inside a Claude Code session and has access
to Claude Code's built-in tools. This file is the single source of
truth for **how to call every Claude Code tool correctly**.

For a list of what each tool does, see
https://code.claude.com/docs/en/agent-sdk/overview. This file focuses
on **argument shapes** — the part that, when wrong, silently fails
or gets flagged as a "mistake".

---

## Quick reference (cheat sheet)

| Tool | Required fields | Common mistake |
|---|---|---|
| `Read` | `file_path` | passing a dir instead of a file |
| `Glob` | `pattern` (or `path` + `pattern`) | forgetting `pattern` glob for nested lookups |
| `Grep` | `pattern` | passing non-regex without `glob` filter |
| `Edit` | `file_path`, `new_string` (and `old_string`) | `old_string` not matching whitespace exactly |
| `Write` | `file_path`, `content` | writing a directory path |
| `Bash` | `command` | shell redirects (`>`, `>>`) sometimes blocked; default 2-min timeout, max 10 min |
| `WebFetch` | `url`, `prompt` | passing a non-HTTP URL |
| `WebSearch` | `query` | none common |
| `AskUserQuestion` | `question`, `options` (array of 2–4) | **`options: null` or empty → silent failure** |
| `Skill` | `skill` | passing a skill that isn't installed |
| `Agent` | `subagent_type`, `prompt` (and `description`) | passing a name not declared in `.claude/agents/` |

---

## `Read`

Read a file (or a slice of one).

```json
{
  "file_path": "/abs/path/to/file.ts",
  "offset": 10,
  "limit": 50
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `file_path` | string | **yes** | Absolute path. Reading a directory errors. |
| `offset` | number | no | 1-based line number to start at. Defaults to 1. |
| `limit` | number | no | Lines to read from offset. If omitted, reads to EOF. |

**Failure modes:** `file_path` to a directory errors. `file_path` to a non-existent file errors. Don't pass `offset` > file line count.

---

## `Glob`

List files matching a glob pattern.

```json
{
  "pattern": "**/*.ts",
  "path": "/abs/path/to/project"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `pattern` | string | **yes** | Glob, e.g. `*.ts`, `src/**/*.tsx`. |
| `path` | string | no | Absolute root. Defaults to the working directory. |

**Failure modes:** Invalid glob syntax errors. The output excludes common build dirs (node_modules, .git, dist, build, .next, coverage, __pycache__, .venv, target, out, bin, obj) by default.

---

## `Grep`

Regex search across files (ripgrep under the hood).

```json
{
  "pattern": "class \\w+ extends Plugin",
  "path": "/abs/path/to/project",
  "glob": "*.ts",
  "output_mode": "files_with_matches",
  "-n": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `pattern` | string | **yes** | Treated as a regex. Use `rg` syntax. |
| `path` | string | no | Defaults to cwd. Absolute path recommended. |
| `glob` | string | no | Include filter, e.g. `*.ts`, `*.{ts,tsx}`. |
| `output_mode` | string | no | `content` (with `-n` for line numbers), `files_with_matches`, or `count`. |
| `-n` | bool | no | Show line numbers (with `output_mode: content`). |

**Failure modes:** An invalid regex errors. Path to a file errors when used without a glob filter — must be a directory.

---

## `Edit`

The workhorse edit tool.

### Mode 1 — `old_string` / `new_string` (replace a block)

```json
{
  "file_path": "/abs/path/to/file.ts",
  "old_string": "export const foo = 1;\n",
  "new_string": "export const foo = 2;\n"
}
```

- `old_string` must match EXACTLY including whitespace and trailing newline.
- If `old_string` is not found → tool returns an error like `String to replace not found in file`.
- If `old_string` matches more than once → tool returns `Found multiple matches` or similar; refine.

**This is the #1 cause of agent mistakes.** When in doubt:
1. First call `Read` on the file
2. Copy the exact bytes (including indentation and trailing newline)
3. Make the smallest possible edit

### Mode 2 — `replace_all` (replace every occurrence)

```json
{
  "file_path": "/abs/path/to/file.ts",
  "old_string": "foo",
  "new_string": "bar",
  "replace_all": true
}
```

Use when the same exact string appears multiple times and you genuinely want every occurrence replaced.

### File does not exist (use `Write` instead)

If the file does not exist, use the `Write` tool — `Edit` requires the file to exist.

**Common failures:**
- "String to replace not found" — whitespace mismatch. Re-read the file and copy the bytes exactly.
- "multiple matches" — your `old_string` is too generic. Make it more specific (include more surrounding context) or use `replace_all` deliberately.
- Missing trailing `\n` — `new_string` and `old_string` must end with `\n` if the surrounding context does.

---

## `Write`

Create or fully overwrite a file.

```json
{
  "file_path": "/abs/path/to/new-file.ts",
  "content": "// brand new file content\n"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `file_path` | string | **yes** | Absolute path. Parent dirs are NOT created automatically. |
| `content` | string | **yes** | Full file body. |

**Common failures:**
- Path to a directory errors.
- Parent directory missing → creates the file in cwd with the basename, or errors. Use `Bash` to `mkdir -p` first.

---

## `Bash`

Run a shell command.

```json
{
  "command": "ls -la /tmp",
  "timeout": 30000,
  "description": "List /tmp contents"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `command` | string | **yes** | Passed to `/bin/bash -c` (Linux/macOS) or `cmd /c` (Windows). |
| `timeout` | number | no | **Max 600,000 ms (10 min).** Default ~120,000 (2 min). |
| `description` | string | no | Short human-readable summary shown in the TUI (recommended). |

**Critical constraints:**
- **No shell redirects** (`>`, `>>`, `<`) in some runtimes / sandboxes. Use `Edit` or `Write` to author files.
- Long-running processes hit the timeout. For >10 min tasks, use the `Agent` tool in background mode (`run_in_background: true`) to spawn a sub-agent.
- The `command` string IS a shell command. Quote carefully. Use `&&` to chain, `;` to sequence, `|` to pipe.

**Common failures:**
- `command not found` — the binary isn't on PATH. Use absolute path or `which <name>` first.
- `Permission denied` — file isn't executable, or you're writing to a protected dir.
- `timeout` — increase `timeout` (max 600,000) or move to a background agent.

---

## `WebFetch`

Fetch a URL and answer a prompt against it.

```json
{
  "url": "https://example.com/docs",
  "prompt": "Summarize the authentication section"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `url` | string | **yes** | Must be HTTP/HTTPS. No `file://`. |
| `prompt` | string | **yes** | The question you want the page answered against. |

**Failure modes:** Non-HTTP URLs error. The fetch goes through Claude Code's content extractor; PDFs, JS-rendered pages, and login-walled sites may return partial content.

---

## `WebSearch`

Run a web search and return ranked results.

```json
{
  "query": "Claude Code Agent SDK sub-agent routing"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string | **yes** | Natural-language search. |

---

## `AskUserQuestion`

Ask the user ONE clarifying question with 2–4 options. **This is the most-misused tool.**

```json
{
  "question": "Which database do you want to use?",
  "options": [
    { "label": "PostgreSQL", "description": "Recommended for relational + JSON" },
    { "label": "MySQL", "description": "Traditional RDBMS" },
    { "label": "SQLite", "description": "Embedded, no server" },
    { "label": "MongoDB", "description": "Document store" }
  ],
  "header": "Database",
  "multi_select": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `question` | string | **yes** | One question. Multi-question calls fail. |
| `options` | array of 2–4 objects | **yes** | **MUST be 2–4 items, each with `label` + `description`.** |
| `header` | string | no | Short (≤12 chars) shown in the picker chip. |
| `multi_select` | bool | no | Allow multiple selections. Default false. |

### ⚠️ CRITICAL — `options` is REQUIRED, not optional

If you pass `options: []`, omit `options`, or pass strings instead of
objects, Claude Code **silently rejects the call** and counts it as a
mistake. After several such silent failures the session aborts.

### When to use `AskUserQuestion`

- A key implementation decision has multiple valid paths
- The user said something ambiguous and you need to clarify before doing real work
- You're about to make a destructive change (rm, drop table, force-push)

### When NOT to use `AskUserQuestion`

- You can decide safely using sensible defaults
- The user's intent is clear from context
- You're just confirming something you should have done already
- The answer is in the codebase (use `Read` / `Grep` first)

### Alternatives to `AskUserQuestion`

- **Use multiple `Agent` calls in one message** to parallelize the investigation
- **Use the `Agent` tool (background)** for long-running research
- **Just pick a sensible default** and document it in your final response

### Recovery from `AskUserQuestion` mistakes

If you accidentally pass the wrong shape and the tool errors, **DO NOT
retry the same broken call**. Instead:
1. Switch to a sensible default
2. Document the decision in your final response
3. Let the user override later if they disagree

---

## `Skill`

Activate a skill.

```json
{
  "skill": "commit",
  "args": "Add auth bug fix"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `skill` | string | **yes** | Exact skill name. Run `skills list` (or check `~/.claude/skills/`) to see available. |
| `args` | string | no | Passed to the skill's runner. |

**Failure modes:** Unknown skill name errors. Skills are case-sensitive.

---

## `Agent`

Dispatch a sub-agent. Claude Code's equivalent of Bizar's `task`
and `bizar_spawn_background` tools.

```json
{
  "subagent_type": "todd",
  "prompt": "Implement the rate-limiter middleware in src/middleware/ratelimit.ts",
  "description": "Implement rate limiter"
}
```

Synchronous (default):

```json
{
  "subagent_type": "todd",
  "prompt": "Implement the rate-limiter middleware in src/middleware/ratelimit.ts",
  "description": "Implement rate limiter",
  "run_in_background": false
}
```

Background (async, returns immediately):

```json
{
  "subagent_type": "greg",
  "prompt": "Research the auth flow across the codebase. Cite file paths.",
  "description": "Research auth flow",
  "run_in_background": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `subagent_type` | string | **yes** | A Bizar agent name declared in `.claude/agents/*.md`: `mike`, `paul`, `todd`, `karen`, `brenda`, `greg`, `susan`, `steve`, `brad`, `ria`, `janet`, `carl`, `linda`, `pam`, `kevin`, `oscar`. |
| `prompt` | string | **yes** | What to do. Be specific. |
| `description` | string | no | Short summary shown in the TUI. |
| `run_in_background` | bool | no | Default `false`. Set true for async dispatch. |

**Failure modes:** Unknown `subagent_type` errors. Sync runs block until the sub-agent returns. Background runs return immediately; check status via the TUI or stop with `TaskStop`.

### Sync vs async dispatch

- **`Agent` (sync)** — blocks until the sub-agent returns. Use when the parent needs the result before continuing.
- **`Agent` with `run_in_background: true`** — async, returns immediately. Use for long-running work that doesn't block the parent. Replaces Cline's `bizar_spawn_background`.

### Coordinating multiple background agents

When fanning out several research or exploration tasks, issue multiple `Agent` calls in the **same message** with `run_in_background: true`. Each runs in parallel. Collect the original final summary/result when the task completes. Do not re-dispatch a completed background agent to summarize its work: that creates a new, context-poor task and its acknowledgement is not a replacement for the original deliverable.

---

## Claude Code's other useful tools

These are available in many Claude Code sessions but not declared
in Bizar agents' `tools` frontmatter by default. Add them when the
agent needs them:

- **`TaskStop`** — stop a background `Agent` that's looping, stalling, or no longer relevant.
- **`TodoWrite`** — track a multi-step plan in the agent's scratchpad. Use 3-7 items max; refine as you go.
- **`NotebookEdit`** — edit Jupyter notebook cells. Rarely needed outside data work.
- **`EnterWorktree` / `ExitWorktree`** — git worktree isolation. Bizar's
  code-writing subagents use `isolation: worktree` by default; use these tools
  directly when an additional isolated session is explicitly needed.
- **`WebSearch`** — covered above.

These are documented at https://code.claude.com/docs/en/agent-sdk/overview.

---

## Recovery: when you hit the mistake limit

If Claude Code surfaces "max consecutive mistakes reached" and aborts the session:

1. **Stop retrying the same broken call.** Each retry wastes a mistake.
2. **Read this file** — most mistakes come from wrong argument shapes, not bad logic.
3. **Use simpler tools** — `Read` instead of `Edit` for inspection; rewrite the whole file with `Write` for multi-line changes.
4. **Spawn a fresh session** if the runtime is in a bad state.

---

## Per-tool I/O contract

All Claude Code tools return text via stdout-like output. Failed tools return either:
- A structured error message (e.g. `String to replace not found in /path`)
- An exception thrown back to the agent (which Claude Code wraps as a mistake)

There is no `success: true|false` field. You must read the response text
to know what happened.
