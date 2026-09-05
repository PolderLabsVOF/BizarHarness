---
name: goal-bootstrap
description: Retired compatibility skill. Use OpenKan PRDs for Bizar's durable goals and planning progression.
argument-hint: "[list | add <title> | show <id>]"
---

# OpenKan goals

OpenKan PRDs replace Bizar’s retired feature-list / ultragoal bootstrap. SessionStart reads `.ok/prds/` and reports active goals without creating parallel goal artifacts.

```sh
ok prd list
ok prd add "Outcome title"
ok prd show <prd-id>
ok prd update <prd-id> --status active
```

Use a PRD for durable outcomes, link plans and tasks through canonical OpenKan fields, and keep task evidence current. `bizar goal-bootstrap` is only a compatibility alias; new automation must use `ok prd`.
