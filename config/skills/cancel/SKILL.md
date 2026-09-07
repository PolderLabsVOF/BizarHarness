---
name: cancel
description: Cancel the active Bizar plan/task safely using the OpenKan CLI instead of deleting files or stopping unrelated work.
argument-hint: "[reason]"
---

# Cancel Active Plan

Cancel only the plan/task bound to the current project/session.

1. Read its identity and status:

   ```sh
   ok task list --json
   ok plan list --json
   ```

2. If no plan is active, report that fact and make no changes.
3. If a plan is active, cancel its in-flight tasks with the exact returned values:

   ```sh
   ok task cancel "$TASK_ID" --reason "$ARGUMENTS" --json
   ok plan update "$PLAN_ID" --status cancelled --json
   ```

4. Re-read state and confirm the terminal status. Leave worktree edits, task evidence, and logs intact so the user can inspect or recover them.

Do not kill unrelated agents, delete `.ok/` files, or reset worktrees. Never auto-commit, push, release, publish, deploy, or infer authority for destructive cleanup. Cancellation stops plan continuation; it does not authorize unrelated mutations.
