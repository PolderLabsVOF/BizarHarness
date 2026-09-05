---
name: ultrawork
description: Execute a researched plan through bounded parallel agent waves with disjoint ownership and leader-controlled integration.
argument-hint: "<task with independent work lanes>"
---

# Ultrawork

Use Ultrawork only when at least two implementation or verification scopes are independent. The office manager owns sequencing, shared files, state transitions, and the final completion claim.

## Durable run

Query and resume first; otherwise start a default-profile run:

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
# When no run exists:
bizar workflow start --profile default --goal "$ARGUMENTS" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

Advance only after re-reading status and collecting bounded evidence:

```sh
bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage "$CURRENT_STAGE" --evidence "$BOUNDED_EVIDENCE" --json
```

## Wave protocol

1. Complete research/spec and consensus planning before implementation fan-out.
2. Build a dependency graph. Give every edit path exactly one owner; root configuration and lockfiles have a single integration owner.
3. Claim durable OpenKan tasks with `ok task claim` for editing lanes and dispatch all ready, disjoint scopes in one Agent-tool block. Use worktree isolation when the project contract requires it.
4. Each worker returns changed files, targeted test output, blockers, and an integration handoff. Workers do not edit shared state, broaden scope silently, or overwrite sibling work.
5. Integrate completed waves serially, re-run impacted checks, then dispatch the next ready wave.
6. Run bounded QA/fix and independent functional, security, and quality validation before final gates.
7. Advance `validate` to complete only when the integrated tree—not isolated worktrees—has fresh proving evidence.

Use `bizar workflow fail` after a bounded unrecoverable failure and the `cancel` skill for user-requested cancellation. Never auto-commit, push, publish, release, deploy, change credentials/access, use daemon/tmux coordination, or create a memory/wiki subsystem.
