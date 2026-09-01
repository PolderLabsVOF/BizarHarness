---
description: Pick the cheapest Bizar tier that fits a task description; the same selection the @mike orchestrator makes.
allowed-tools: Read, Bash
---

# /tier — automatic task-based model selection

Routes a task description through the same Bizar tier resolver the `@mike`
orchestrator uses. Useful when you want to know which model an agent would
land on before launching a session.

```bash
# After `npm install -g @polderlabs/bizar` the script lives at:
bizar tier --agent mike "design a deterministic migration plan for X"
bizar tier --list
```

Selection rules:

1. The role default (`premium` / `high` / `mid-design` / `default` / `mid` /
   `budget`) comes from the global Bizar router under `BIZAR_HOME`.
2. Mike adjusts that default from the current task's risk and complexity. A
   role never carries fixed `model:` frontmatter.
3. If live model discovery reports a configured candidate for the chosen tier,
   Mike passes the first matching candidate on the Agent call.
4. If discovery is unavailable, stale, ambiguous, or has no matching candidate,
   Mike uses the closest enabled configured tier candidate and keeps `model` explicit.
5. A failed dispatch is not retried through aliases, providers, or tiers.

The orchestrator's decision can be logged to `~/.config/bizar/tier.log` with a
short rationale.
