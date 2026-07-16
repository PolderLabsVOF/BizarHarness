---
description: Add or update a long-horizon goal in .bizar/PROGRESS.md — same source-of-truth as the v8 dashboard Goals view.
---

# Goal — Track a Long-Horizon Commitment

You are in `/goal` mode. The user has invoked this command to add or
update a **goal** in `.bizar/PROGRESS.md`. This file is the single
source of truth for goals — both the dashboard's Goals view and
Claude Code's `/goal` slash command read from and write to it.

## Contract

- **Goals live in `.bizar/PROGRESS.md`** in the active project root.
  Parse the current file first so you don't clobber existing goals.
- **Round-trip via the dashboard API.** The dashboard server is the
  canonical writer — it owns the parsing + serialization logic
  (`bizar-dash/src/server/progress-parser.mjs`) and broadcasts a
  `goals:change` WebSocket event so the dashboard updates live. **Do
  not edit PROGRESS.md directly** unless the dashboard is down.
- **Use the dashboard's HTTP API by default.** Resolve the dashboard
  port from `${BIZAR_HOME}/dashboard.port` (default
  `~/.config/bizar/dashboard.port` per `cli/install/paths.mjs:49`),
  then POST/PATCH. This keeps goals in lock-step with whatever the
  dashboard user is looking at.

## API surface (S10/S12)

```
GET    /api/goals                        # list all parsed goals
POST   /api/goals    { title, owner?, due? }   # create
GET    /api/goals/:id                    # single goal
PATCH  /api/goals/:id { title?, owner?, due? } # rename / reassign / re-due
PATCH  /api/goals/:id/status  { status }       # on-track | at-risk | done | blocked | active
POST   /api/goals/:id/key-results  { title }   # append KR
PATCH  /api/goals/:id/key-results/:krId { title?, done? }  # toggle / rename
DELETE /api/goals/:id/key-results/:krId         # remove KR
```

## Examples

### Add a goal

```bash
PORT=$(jq -r .port ~/.cache/bizarharness/dash-auth.json)
curl -s -X POST http://127.0.0.1:$PORT/api/goals \
  -H "Content-Type: application/json" \
  -d '{"title":"Ship current dashboard","owner":"sam","due":"2026-09-30"}'
```

### Change a goal's status to at-risk

```bash
curl -s -X PATCH http://127.0.0.1:$PORT/api/goals/G-abc123/status \
  -H "Content-Type: application/json" \
  -d '{"status":"at-risk"}'
```

### Add a key result

```bash
curl -s -X POST http://127.0.0.1:$PORT/api/goals/G-abc123/key-results \
  -H "Content-Type: application/json" \
  -d '{"title":"Cut S9 polish time in half"}'
```

### Mark a key result done

```bash
curl -s -X PATCH http://127.0.0.1:$PORT/api/goals/G-abc123/key-results/KR-xyz \
  -H "Content-Type: application/json" \
  -d '{"done":true}'
```

## When the dashboard is unreachable

Fallback path: write directly to `<active-project>/.bizar/PROGRESS.md`
using the format the parser understands:

```markdown
## G-<id> — <Title>
Owner: <name> · Due: <YYYY-MM-DD>
Goal is **<status>**.

- [ ] <key-result title>
- [x] <done key-result title>
```

Then when the dashboard comes back up, `GET /api/goals` re-parses the
file and broadcasts a `goals:change` event to refresh the UI.

## Background: why this exists

`/goal` was added in S12 of the dashboard rewrite. Before this,
goals lived only in the user's head and `FINAL_GOAL.md` (which is the
user's own planning doc, not the harness's tracker). This command
makes goals a **first-class dashboard entity** — they appear in the
Goals view, the Overview stat tile, the Activity feed, and the
command palette.
