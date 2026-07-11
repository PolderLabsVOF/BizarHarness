---
name: memory-protocol
description: How Bizar agents use the project memory vault via the `bizar memory` CLI. Read at session start, append on session end. No codebase exploration needed. Triggers on session-start checks, memory writes/reads, and any vault interaction.
---

# Bizar Memory Protocol

**MANDATORY at every new session.** Run before starting any work. No codebase exploration needed.

The Bizar Memory Service is the project's long-term memory. Every project has a vault (Markdown + Git) located by reading `.bizar/memory.json`. **Agents that skip this step are likely to contradict decisions already made, break things already fixed, or suggest things the user already tried.**

## First-time setup

**If `.bizar/memory.json` does not exist on this checkout**, run:

```bash
bizar memory setup --remote git@github.com:you/bizar-memory.git
```

This creates the vault, writes the config, and configures the remote. Idempotent — re-run with a new `--remote` to update the URL.

For HTTPS remotes (e.g. private repos behind a proxy):
```bash
bizar memory setup --remote https://github.com/you/bizar-memory.git
```

For local-only mode (no git remote — vault lives only on this machine):
```bash
bizar memory setup --mode local-only
```

After setup, verify with `bizar memory status` and `bizar memory doctor`.

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
