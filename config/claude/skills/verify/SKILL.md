---
name: verify
description: Independently validate functional behavior, security and approval policy, and code quality before an OpenKan plan may complete.
argument-hint: "[change or acceptance criteria]"
---

# Verify

Verification proves the integrated result against explicit acceptance criteria.

> **No `bizar workflow` CLI exists.** Verification binds to the active
> OpenKan plan/task; the final advance is `ok task complete
> <validate-task-id> --evidence "..."` and the plan closes when every
> remaining task reports `done`.

## Bind to state

```sh
ok task list --json
ok plan list --json
```

Resume an active plan before validating. When no plan exists, perform a standalone verification report; do not fabricate phase history solely to obtain a completed state.

```sh
ok plan show "$ACTIVE_PLAN_ID" --json
ok task list --plan "$ACTIVE_PLAN_ID" --json
```

## Independent validation lanes

Run these in parallel when they do not share mutable files:

1. **Functional** — exercise the real user/API path, regression tests, and relevant integration/E2E checks.
2. **Security and policy** — review trust boundaries, credential/secret handling, dangerous operations, human-approval gates, and removed-surface constraints.
3. **Quality** — review maintainability, architecture boundaries, type/lint/static gates, documentation, and feature/progress accuracy.

Reconcile all findings in the integrated workspace. A claim is not proven by an agent summary: read the actual command output and artifacts. Run the repository's required final gates in their mandated order. Evidence must be fresh, bounded, and name the command/result or artifact; record gaps explicitly.

For an active plan at the `validate` stage, re-read state and complete via the final advance:

```sh
ok task update "$TASK_ID" --status review --json
ok task complete "$TASK_ID" --evidence "$BOUNDED_EVIDENCE" --json
```

If required evidence fails and cannot be repaired within the agreed bound, use `ok task cancel <task-id> --reason "<bounded reason>"` and mark the owning plan `abandoned`. Never auto-commit, push, publish, release, deploy, change credentials/access, or use daemon/tmux or a general memory/wiki subsystem.
