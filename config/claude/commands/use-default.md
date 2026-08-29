---
description: Revert Claude Code to the default tier (claude-minimax/MiniMax-M3). Prints the exact shell command and env vars to unset.
allowed-tools: Bash
---

# /use-default — Revert to claude-minimax/MiniMax-M3 (default)

The provider gateway you have configured defaults to `claude-minimax/MiniMax-M3`
for everyday reasoning. Bizar is provider-agnostic — set
`BIZAR_MODEL_ROUTER_URL` (or `ANTHROPIC_BASE_URL`) to whatever gateway URL
your operator runs. Use this when you've been running on premium
(`claude-qwen/qwen3.8-max`) and want to drop back to the cheaper default.

## Commands

### One-shot launch (recommended)

```bash
ANTHROPIC_BASE_URL="${BIZAR_MODEL_ROUTER_URL:-http://your-gateway/v1}" \
claude
```

If `ANTHROPIC_MODEL` is set in your shell, unset it first:

```bash
unset ANTHROPIC_MODEL
ANTHROPIC_BASE_URL="${BIZAR_MODEL_ROUTER_URL:-http://your-gateway/v1}" \
claude
```

### Revert a project-level override

If you added `ANTHROPIC_MODEL` to `.claude/settings.local.json` for
this project, remove it (or set it back to `claude-minimax/MiniMax-M3`).

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "${BIZAR_MODEL_ROUTER_URL}"
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
