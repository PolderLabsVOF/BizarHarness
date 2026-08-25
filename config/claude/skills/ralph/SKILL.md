---
name: ralph
description: Persistently iterate on one scoped objective until fresh evidence proves completion or a bounded failure is recorded.
argument-hint: "<task or failing acceptance criterion>"
---

# Ralph

Ralph is Bizar's persistent single-owner completion loop. Use it when a well-scoped objective needs repeated edit-test-review cycles, not when parallel ownership would be clearer.

## State

Read status first. Resume an unfinished run or start a default-profile run:

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
# When no run exists:
bizar workflow start --profile default --goal "$ARGUMENTS" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

At each phase boundary, re-read status and advance using the current identity plus compact proving evidence:

```sh
bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage "$CURRENT_STAGE" --evidence "$BOUNDED_EVIDENCE" --json
```

## Loop

1. Research the failure and write a precise acceptance criterion.
2. Obtain a consensus plan when risk or scope is non-trivial.
3. Make the smallest behavior change, run the smallest proving check, and inspect its output.
4. During QA, repeat diagnose → edit → targeted test for at most ten iterations. Do not repeat the same failed action without new evidence.
5. Validate functional behavior, safety/policy boundaries, and code quality; then run required full gates.
6. Advance `validate` only on fresh evidence. If the objective cannot be achieved within the bound, invoke `bizar workflow fail --run "$RUN_ID" --revision "$REVISION" --stage "$CURRENT_STAGE" --reason "$REASON" --json`.

External and version-sensitive integrations require current official documentation before editing. Ralph never auto-commits, pushes, publishes, releases, deploys, changes credentials/access, or performs destructive cleanup. It does not use a daemon, tmux, a wiki, or a general memory service.
