---
description: Revert Claude Code to the default tier (bizar/MiniMax-M3). Prints the exact shell command and env vars to unset.
allowed-tools: Bash
---

# /use-default — Revert to bizar/MiniMax-M3 (default)

The local model router at `http://localhost:20128/v1` defaults to
`bizar/MiniMax-M3` for everyday reasoning. Use this when you've
been running on premium (`cx/gpt-5.6-sol`) and want to drop back to
the cheaper default.

## Commands

### One-shot launch (recommended)

```bash
ANTHROPIC_BASE_URL=http://localhost:20128/v1 \
claude
```

If `ANTHROPIC_MODEL` is set in your shell, unset it first:

```bash
unset ANTHROPIC_MODEL
ANTHROPIC_BASE_URL=http://localhost:20128/v1 \
claude
```

### Revert a project-level override

If you added `ANTHROPIC_MODEL` to `.claude/settings.local.json` for
this project, remove it (or set it back to `bizar/MiniMax-M3`).

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "http://localhost:20128/v1"
  }
}
```

## When default is fine

- Trivial edits, mechanical work, single-file obvious fixes.
- Read-only Q&A (use `@susan` directly anyway).
- Research (always use `@greg` on default).
- Moderate-complexity implementation (route to `@todd`).
- Most everyday sessions.

The session loop on default is the cheapest path that still
handles Claude Code's tool surface well. Subagents still pick their
own tier per the routing table in `.claude/model-router.json`.