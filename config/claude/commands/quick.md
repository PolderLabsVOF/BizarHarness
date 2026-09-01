---
description: Skip Bizar\'s mandatory routing for this turn. Use for trivial single-step work the chat can handle directly.
argument-hint: "[task]"
disable-model-invocation: true
allowed-tools: Read, Bash, Edit, Write, Grep, Glob
---

# /quick — One-Turn Routing Bypass

Run `$ARGUMENTS` directly in this session. Do NOT delegate to subagents.

## Mechanism

The `worker-suggest` hook recognizes `/quick` directly and skips orchestration
for this command only. Legacy `.bizar/.quick-once` sentinels are consumed and
deleted on their first prompt, so they cannot disable routing for a session.

## What this is for

- One-line file edits
- Quick lookups ("find X", "show me Y")
- Mechanical renames
- Single-tool invocations

## What this is NOT for

- Multi-step implementations
- Anything that requires verification across multiple files
- Any task that should be tracked in `feature_list.json`

If the task balloons, abort, delete the sentinel, and re-run the request
without `/quick` so the orchestrator can dispatch properly.
