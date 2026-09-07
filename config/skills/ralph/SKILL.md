---
name: ralph
description: Persistently iterate on one scoped objective until fresh evidence proves completion or a bounded failure is recorded.
argument-hint: "<task or failing acceptance criterion>"
---

# Ralph

Ralph is Bizar's persistent single-owner completion loop. Use it when a well-scoped objective needs repeated edit-test-review cycles, not when parallel ownership would be clearer.

> **No `bizar workflow` CLI exists.** All durable state lives in the
> OpenKan `.ok/` workspace; every read is `ok task show`/`ok plan show`
> and every mutation is `ok task update`/`ok task complete`/`ok task
> cancel`. The phased-run logic (research → consensus plan → edit/test
> → validate) is preserved by mapping each phase to a task under one
> Ralph-owned plan.

## State

Read status first. Resume an unfinished task/plan or start a default-profile plan:

```sh
ok task list --json
ok plan list --json
ok plan show "$ACTIVE_PLAN_ID" --json
# When no plan exists:
ok plan add "$ARGUMENTS" --summary "Ralph persistent loop" --json
ok task add "research/spec" --plan "$PLAN_ID" --priority p1 --json
```

At each phase boundary, re-read state and advance using the current task identity plus compact proving evidence:

```sh
ok task update "$TASK_ID" --status in_progress --json
ok task complete "$TASK_ID" --evidence "$BOUNDED_EVIDENCE" --json
ok task add "<next-stage>" --plan "$PLAN_ID" --priority p1 --json
```

## Loop

1. Research the failure and write a precise acceptance criterion.
2. Obtain a consensus plan when risk or scope is non-trivial.
3. Make the smallest behavior change, run the smallest proving check, and inspect its output.
4. During QA, repeat diagnose → edit → targeted test for at most ten iterations. Do not repeat the same failed action without new evidence.
5. Validate functional behavior, safety/policy boundaries, and code quality; then run required full gates.
6. Complete `validate` only on fresh evidence. If the objective cannot be achieved within the bound, invoke `ok task cancel <task-id> --reason "<bounded reason>"` and mark the owning plan `abandoned`.

External and version-sensitive integrations require current official documentation before editing. Ralph never auto-commits, pushes, publishes, releases, deploys, changes credentials/access, or performs destructive cleanup. It does not use a daemon, tmux, a wiki, or a general memory service.
