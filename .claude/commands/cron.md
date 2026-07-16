---
description: Manage scheduled cron tasks for autonomous agent runs.
allowed-tools: Read, Write, Bash, WebFetch
---

# /cron — Scheduled Autonomous Tasks

Manage cron tasks that run on a schedule using the Bizar SDK cron API.

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
import { addCronTask, listCronTasks, removeCronTask } from "@polderlabs/bizar-sdk/agent/cron";
```

- `addCronTask({ cron, prompt, recurring })` — add a task
- `listCronTasks()` — returns all tasks
- `removeCronTask(id)` — removes by id, returns true if found

Tasks are persisted to `.bizar/cron.json` in the project root.
