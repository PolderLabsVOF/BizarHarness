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
node "$(npm root -g)/@polderlabs/bizar/cli/commands/tier.mjs" \
  --agent mike "design a deterministic migration plan for X"
node "$(npm root -g)/@polderlabs/bizar/cli/commands/tier.mjs" --list
```

Selection rules:

1. The agent's tier (`premium` / `high` / `mid-design` / `default` / `mid` /
   `budget`) comes from `~/.claude/model-router.json` (synced at install).
2. If the task involves reasoning over multiple code paths, design
   trade-offs, or adversarial review, escalate one tier.
3. If the task is a single mechanical edit, deterministic transformation, or
   verification, demote to `budget`.
4. The chosen tier's exact model id is returned verbatim — no fallback, no
   silent downgrade. The model router refuses to assign a model that the
   configured gateway cannot serve.

The orchestrator's decision is logged to `~/.config/bizar/tier.log` with a
short rationale.