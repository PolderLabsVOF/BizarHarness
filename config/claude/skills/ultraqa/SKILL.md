---
name: ultraqa
description: Run a bounded reproduce-test-fix QA cycle and attach fresh evidence to the active OpenKan plan/task.
argument-hint: "[acceptance path or test scope]"
---

# UltraQA

UltraQA proves behavior; it does not declare success from code inspection alone.

> **No `bizar workflow` CLI exists.** All durable state lives in the
> OpenKan `.ok/` workspace. UltraQA advances a single QA task under the
> active plan; the evidence field carries the bounded command/result
> record.

## Enter QA

Read plan/task state first:

```sh
ok task list --json
ok plan list --json
```

Resume an existing plan when present. If no plan exists, create a `plan-build-qa` plan with the requested acceptance path, then establish the research/spec, test plan, and baseline evidence before advancing sequentially into QA.

```sh
ok plan show "$ACTIVE_PLAN_ID" --json
ok plan add "$ARGUMENTS" --summary "UltraQA plan-build-qa run" --json
ok task add "qa" --plan "$PLAN_ID" --priority p1 --json
```

## Bounded cycle

For at most five cycles:

1. Reproduce the user-visible or API-visible behavior.
2. Run the smallest relevant test, then inspect the complete failure.
3. Identify the root cause; do not patch symptoms repeatedly.
4. Apply one scoped fix and rerun the reproducer plus regression test.
5. Record the command, exit result, and artifact path as bounded evidence.

When QA is green, re-read state and advance:

```sh
ok task update "$TASK_ID" --status review --json
ok task complete "$TASK_ID" --evidence "$BOUNDED_EVIDENCE" --json
ok task add "validate" --plan "$PLAN_ID" --priority p1 --json
```

If the cycle limit is reached, run `ok task cancel "$TASK_ID" --reason "$REASON" --json` and mark the owning plan `abandoned`. Never hide skipped checks or flaky results. After QA, functional, security/policy, and code-quality validation remain required. UltraQA never auto-commits, pushes, publishes, releases, deploys, changes credentials/access, or uses daemon/tmux or a general memory/wiki service.
