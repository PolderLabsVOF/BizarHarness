---
name: memory-protocol
description: How Bizar agents use the project memory vault. Read at session start, append on session end. No codebase exploration needed.
---

# Bizar Memory Protocol

**⚠️ MANDATORY at every new session.** Run before starting any work. No codebase exploration needed.

The Bizar Memory Service is the project's long-term memory. Every project has a vault (Markdown + Git) located by reading `.bizar/memory.json`. **Agents that skip this step are likely to contradict decisions already made, break things already fixed, or suggest things the user already tried.**

## Session Start — DO THIS FIRST

Run these three commands in order. If any fail, fix the underlying problem before proceeding.

```bash
bizar memory status    # confirm vault reachable
bizar memory doctor    # schema + secret scan + git state
```

If the project has prior context, search for the task topic:

```bash
bizar memory search "<topic keyword>"
```

Read notes by path (the vault root is in the status output, usually `~/.local/share/bizar/memory/bizar-memory/projects/<projectId>/`).

## During Work

When you learn something durable — an architecture decision, a non-obvious convention, a bug pattern, an API contract — write it:

```bash
bizar memory write <relpath> \
  --type <type> \
  --status active \
  --confidence verified|inferred|speculative \
  --tag <tag> \
  --body "<markdown body>"
```

`<relpath>` is relative to the project namespace root, e.g.:
- `decisions/0001-router-ordering.md`
- `conventions/secret-scanning.md`
- `bug-patterns/hindsight-token-leak.md`
- `api/memory-rest.md`

**Do NOT include the namespace prefix** (`projects/<projectId>/`) — the system adds it.

### Valid types

`project_overview`, `architecture_decision`, `coding_convention`, `bug_pattern`, `command`, `api_contract`, `dependency_note`, `environment_fact`, `task_summary`, `session_summary`, `user_preference`

### Valid statuses

`active`, `superseded`, `stale`, `conflict`, `draft`, `archived`

### Valid confidences

`verified`, `inferred`, `speculative`

## Session End

If you wrote notes, commit them (if shared vault):

```bash
bizar memory sync
```

If anything is broken:

```bash
bizar memory conflicts   # list notes with status:conflict
bizar memory doctor      # health check
```

## Quick Rules

1. **One note per durable fact.** Don't append to existing notes unless updating them.
2. **Frontmatter is required.** `bizar memory write` builds it; if you write directly to a file, include all required fields.
3. **No secrets.** The system scans for AWS keys, GitHub tokens, etc. and rejects the write. Use env var references in notes.
4. **Path is relative.** `decisions/foo.md`, not `projects/BizarHarness/decisions/foo.md`.
5. **Don't write ephemeral state.** Task status, current WIP, scratch notes — use `.bizar/` instead.
