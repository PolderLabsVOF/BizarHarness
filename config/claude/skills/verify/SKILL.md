---
name: verify
description: Independently validate functional behavior, security and approval policy, and code quality before a Bizar workflow may complete.
argument-hint: "[change or acceptance criteria]"
---

# Verify

Verification proves the integrated result against explicit acceptance criteria.

## Bind to state

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

Resume an active run before validating. When no run exists, perform a standalone verification report; do not fabricate phase history solely to obtain a completed state.

```sh
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

## Independent validation lanes

Run these in parallel when they do not share mutable files:

1. **Functional** — exercise the real user/API path, regression tests, and relevant integration/E2E checks.
2. **Security and policy** — review trust boundaries, credential/secret handling, dangerous operations, human-approval gates, and removed-surface constraints.
3. **Quality** — review maintainability, architecture boundaries, type/lint/static gates, documentation, and feature/progress accuracy.

Reconcile all findings in the integrated workspace. A claim is not proven by an agent summary: read the actual command output and artifacts. Run the repository's required final gates in their mandated order. Evidence must be fresh, bounded, and name the command/result or artifact; record gaps explicitly.

For an active workflow at `validate`, re-read status and complete via the final advance:

```sh
bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage validate --evidence "$BOUNDED_EVIDENCE" --json
```

If required evidence fails and cannot be repaired within the agreed bound, use `bizar workflow fail --run "$RUN_ID" --revision "$REVISION" --stage validate --reason "$REASON" --json`. Never auto-commit, push, publish, release, deploy, change credentials/access, or use daemon/tmux or a general memory/wiki subsystem.
