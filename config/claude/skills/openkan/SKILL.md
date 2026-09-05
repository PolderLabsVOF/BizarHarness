---
name: openkan
summary: Use Bizar's bundled OpenKan workspace for all durable planning, progression, task ownership, and PRD goals.
---

# OpenKan-first Bizar work

OpenKan is the default Bizar control plane. Bizar orchestrates Claude Code agents; OpenKan owns durable project state under `.ok/`. Do not create or update `PROGRESS.md`, `feature_list.json`, or Bizar's retired SQLite task ledger for new work.

## Start work

```sh
ok init              # only when .ok/ is absent
ok task list
ok prd list
ok task claim <task-id> --owner <agent>
```

Use `ok task add` for bounded deliverables, `ok plan add` for staged implementation, and `ok prd add` for a PRD-level outcome. Attach scopes, dependencies, and verification evidence through the canonical OpenKan CLI arguments.

## During work

- Keep the claimed task’s status truthful: `pending`, `in_progress`, `review`, `done`, or `cancelled`.
- Record meaningful state transitions and evidence with `ok task update` or `ok task complete`.
- Use `ok task heartbeat` for long-running claimed work and `ok task release` only when returning it to the pool.
- Read `.ok/` or use the native `ok` / `openkan` commands; do not use Bizar planning aliases, import, fork, or manually mutate OpenKan storage formats.

## Finish

```sh
ok task complete <task-id> --owner <agent> --evidence "targeted test + required gates"
```

Completion requires fresh verification evidence. Bizar session hooks use `.ok/` to resume active tasks and PRDs automatically.
