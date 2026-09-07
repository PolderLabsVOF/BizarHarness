---
description: Bizplan tier heavy — architectural, multi-lane, worktree split.
argument-hint: "<goal>"
---

# `/bizplan-heavy` — tier: heavy

Architectural change / multi-lane / worktree split → pre-mortem → architect → critic → lane-split → plan-final → one executor task per lane persisted under `.ok/tasks/`.

Auto-forced when deep-interview ambiguity > 0.20. Plan carries `lanes[]` and `worktreeStrategy: "split"`.
