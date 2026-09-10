---
name: ultrawork
description: Execute a researched plan through bounded parallel agent waves with disjoint ownership and leader-controlled integration.
argument-hint: "<task with independent work lanes>"
---

# Ultrawork

Use Ultrawork only when at least two implementation or verification scopes are independent. The office manager owns sequencing, shared files, state transitions, and the final completion claim.

> **No `bizar workflow` CLI exists.** All durable state lives in the
> OpenKan `.ok/` workspace. Ultrawork claims and advances OpenKan tasks
> under one active plan; integration is recorded in the plan's
> milestone metadata.

## Durable run

Query and resume first; otherwise start a default-profile plan:

```sh
ok task list --json
ok plan list --json
ok plan show "$ACTIVE_PLAN_ID" --json
# When no plan exists:
ok plan add "$ARGUMENTS" --summary "Ultrawork bounded parallel waves" --json
ok task add "research/spec" --plan "$PLAN_ID" --priority normal --json
```

Advance only after re-reading status and collecting bounded evidence:

```sh
ok task update "$TASK_ID" --status in_progress --json
ok task complete "$TASK_ID" --evidence "$BOUNDED_EVIDENCE" --json
ok task add "<next-stage>" --plan "$PLAN_ID" --priority normal --json
```

## Wave protocol

1. Complete research/spec and consensus planning before implementation fan-out.
2. Build a dependency graph. Give every edit path exactly one owner; root configuration and lockfiles have a single integration owner.
3. Claim durable OpenKan tasks with `ok task claim` for editing lanes and dispatch all ready, disjoint scopes in one Agent-tool block. Use worktree isolation when the project contract requires it.
4. Each worker returns changed files, targeted test output, blockers, and an integration handoff. Workers do not edit shared state, broaden scope silently, or overwrite sibling work.
5. Integrate completed waves serially, re-run impacted checks, then dispatch the next ready wave.
6. Run bounded QA/fix and independent functional, security, and quality validation before final gates.
7. Complete the final `validate` task only when the integrated tree—not isolated worktrees—has fresh proving evidence.

Use `ok task cancel <task-id> --reason "<bounded reason>"` after a bounded unrecoverable failure and the `cancel` skill for user-requested cancellation. Never auto-commit, push, publish, release, deploy, change credentials/access, use daemon/tmux coordination, or create a memory/wiki subsystem.
