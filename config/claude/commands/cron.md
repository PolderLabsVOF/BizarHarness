---
description: Manage the local schedule registry used by explicit Claude Code or external scheduler workflows.
allowed-tools: Read, Write, Bash, WebFetch
---

# /cron — Scheduled Autonomous Tasks

Manage schedule records with the Bizar SDK cron API.

## Usage

```
/cron add <cron-expression> <prompt>  — Schedule a recurring task (e.g. "/cron add 0 * * * * Check email")
/cron add-once <cron-expression> <prompt>  — Schedule a one-time task
/cron list                            — List all scheduled tasks
/cron remove <id>                     — Remove a task by its ID
```

## Routing

- If the user wants to add a task → `/cron add <cron> <prompt>` or `/cron add-once <cron> <prompt>`
- If the user wants to list tasks → `/cron list`
- If the user wants to remove a task → `/cron remove <id>`

## Implementation Notes

Use the SDK cron API:
```
import { addCronTask, listCronTasks, removeCronTask } from "@polderlabs/bizar-sdk";
```

- `addCronTask({ cron, prompt, recurring })` — add a task
- `listCronTasks()` — returns all tasks
- `removeCronTask(id)` — removes by id, returns true if found

Tasks are persisted to `.bizar/cron.json` in the project root.

Bizar does not run a persistent scheduler daemon. Adding a record does not
execute it by itself; connect the registry to an explicitly configured Claude
Code workflow or operating-system scheduler.
