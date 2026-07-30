# DEC-013: Collision-free parallel agent execution

**Status:** Accepted
**Date:** 2026-07-30

## Context

Bizar's team protocol assigned disjoint scopes by prompt, but ordinary editing
agents still shared a checkout. Feature claims were atomic but did not model
general dependencies, workspaces, path ownership, lease expiry, or serialized
integration. Adding direct agent messaging alone would not prevent filesystem
collisions or concurrent merges.

The retained architecture must remain Claude Code-native and service-free.
Commit, merge, push, and publication operations must continue through existing
human approval boundaries.

## Decision

1. Every ordinary code-writing subagent declares `isolation: worktree`.
2. Worktrees branch from the current local `HEAD`; mutable source, build output,
   and runtime state remain isolated. Only installed dependencies may be linked
   from the main checkout.
3. A SQLite task ledger lives under Git's common directory so all worktrees
   share one dependency, ownership, and lease state without a daemon.
4. Task claims atomically check dependencies and conservative repository-relative
   path scopes. A PreToolUse hook enforces those scopes at edit time.
5. Completed task commits enter a FIFO integration queue. SQLite permits one
   active integrator, success marks the task integrated, and failure returns the
   task to its original owner with a bounded repair lease.
6. The queue is a coordination and evidence boundary. It does not automatically
   execute merge, rebase, push, deployment, or publication actions.

## Consequences

- Parallel editing cannot overwrite a sibling checkout.
- Scope conflicts are detected both when work is claimed and when files are
  edited.
- Task and integration claims are safe across processes and linked worktrees.
- Stale editing leases are recoverable.
- One designated integrator serializes completed work.
- Agents must create and claim task records before editing in coordinated team
  workflows.
- A stuck active integration item requires an explicit pass/fail decision; a
  future supervisor may add bounded stale-integration recovery.
- Remote or WebSocket transport remains optional future work and must use this
  task model rather than replace it.
