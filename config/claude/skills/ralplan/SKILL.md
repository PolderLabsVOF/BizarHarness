---
name: ralplan
description: Produce a research-grounded implementation plan through separate planner and adversarial reviewer passes, persisted in the Bizar workflow.
argument-hint: "<task to research and plan>"
---

# Ralplan

Ralplan is the consensus-planning entry point. It may prepare an execution-ready run, but it does not implement when the user asked for planning only.

## State and research

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
# When no run exists:
bizar workflow start --profile default --goal "$ARGUMENTS" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

Ground the specification in repository evidence. For external APIs, frameworks, CLI behavior, configuration formats, or version-sensitive dependencies, WebSearch current official documentation and WebFetch the exact page. State acceptance criteria, exclusions, risks, approval boundaries, and stop condition. Re-read status and advance `research` with bounded evidence.

## Consensus gate

1. A planner drafts ordered steps, file ownership, dependency edges, rollback, and targeted/full verification.
2. A separate QA reviewer challenges assumptions, race/interference risks, failure recovery, approval boundaries, and test adequacy.
3. Resolve every material finding. Shared root files have one owner; independent scopes are explicitly parallel; dependent work is serialized.
4. Persist the accepted plan in the repository's normal planning/state files, not in a note vault or wiki.
5. Re-read workflow status, then mark planning complete:

   ```sh
   bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage plan --evidence "$BOUNDED_EVIDENCE" --json
   ```

The resulting workflow is ready at execution. If the user requested plan-only work, stop there and report the resumable run identity. Do not auto-commit, push, publish, release, deploy, change credentials/access, perform destructive work, or launch a daemon/tmux controller.
