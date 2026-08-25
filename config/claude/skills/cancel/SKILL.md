---
name: cancel
description: Cancel the active Bizar workflow safely using compare-before-write state instead of deleting files or stopping unrelated work.
argument-hint: "[reason]"
---

# Cancel Workflow

Cancel only the workflow bound to the current project/session.

1. Read its identity and stage:

   ```sh
   bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
   ```

2. If no workflow is active, report that fact and make no changes.
3. If a run is active, cancel with the exact returned values:

   ```sh
   bizar workflow cancel --run "$RUN_ID" --revision "$REVISION" --stage "$CURRENT_STAGE" --reason "$ARGUMENTS" --json
   ```

4. Re-read status and confirm the terminal state. Leave worktree edits, task evidence, and logs intact so the user can inspect or recover them.

Do not kill unrelated agents, delete state files, or reset worktrees. Never auto-commit, push, release, publish, deploy, or infer authority for destructive cleanup. Cancellation stops workflow continuation; it does not authorize unrelated mutations.
