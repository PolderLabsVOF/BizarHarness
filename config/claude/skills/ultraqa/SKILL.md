---
name: ultraqa
description: Run a bounded reproduce-test-fix QA cycle and attach fresh evidence to the active Bizar workflow.
argument-hint: "[acceptance path or test scope]"
---

# UltraQA

UltraQA proves behavior; it does not declare success from code inspection alone.

## Enter QA

Read workflow state first:

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

Resume an existing run when present. If no run exists, start `plan-build-qa` with the requested acceptance path, then establish the research/spec, test plan, and baseline evidence before advancing sequentially into QA.

```sh
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
bizar workflow start --profile plan-build-qa --goal "$ARGUMENTS" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
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
bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage qa --evidence "$BOUNDED_EVIDENCE" --json
```

If the cycle limit is reached, run `bizar workflow fail --run "$RUN_ID" --revision "$REVISION" --stage qa --reason "$REASON" --json`. Never hide skipped checks or flaky results. After QA, functional, security/policy, and code-quality validation remain required. UltraQA never auto-commits, pushes, publishes, releases, deploys, changes credentials/access, or uses daemon/tmux or a general memory/wiki service.
