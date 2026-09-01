---
description: Skip Bizar\'s mandatory routing for this turn. Use for trivial single-step work the chat can handle directly.
argument-hint: "[task]"
disable-model-invocation: true
allowed-tools: Read, Bash, Edit, Write, Grep, Glob
---

# /quick — One-Turn Routing Bypass

Run `$ARGUMENTS` directly in this session. Do NOT delegate to subagents.

## Mechanism

The `worker-suggest` hook recognizes `/quick` directly, but honors the bypass
only when the argument still qualifies as an unmistakably tiny edit. Legacy
`.bizar/.quick-once` sentinels are consumed on their first prompt and cannot
bypass routing for substantive work.

## What this is for

- One-line file edits
- Quick lookups ("find X", "show me Y")
- One-token style adjustments

## What this is NOT for

- Multi-step implementations
- Anything that requires verification across multiple files
- Any task that should be tracked in `feature_list.json`

If the task balloons, abort, delete the sentinel, and re-run the request
without `/quick` so the orchestrator can dispatch properly.
