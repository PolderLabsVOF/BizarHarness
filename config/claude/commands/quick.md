---
description: Use direct primary-session execution for this turn instead of Bizar's default agent team.
argument-hint: "[task]"
disable-model-invocation: true
allowed-tools: Read, Bash, Edit, Write, Grep, Glob
---

# /quick — Direct Execution

Run `$ARGUMENTS` directly in this session. Do not create an Agent team,
dispatch a subagent, or start a workflow for this turn.

## Mechanism

The `worker-suggest` hook recognizes `/quick` directly and applies the direct
execution policy for this request. `/quick` changes coordination only: it never
bypasses model selection, safety hooks, approval boundaries, or verification.

## What this is for

- A focused implementation you want handled in the primary session
- Quick lookups ("find X", "show me Y")
- A single-owner debugging or editing task

## What this is NOT for

- Work that benefits from independent research, implementation, and review
- Work with disjoint lanes where a team will be materially faster
- A task whose scope is unclear after bounded orientation

If the task expands into independent lanes or becomes materially unclear, stop
and re-run it without `/quick` so Bizar can form the default agent team.
