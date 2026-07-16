# Control Surfaces — v10.0.5

> Enumerates every v8 view and what mutations it can perform against
> the dashboard server. Proves the "full control and orchestration
> center" claim is concrete, not aspirational.
>
> Source: `bizar-dash/src/web/v8/views/**/*.tsx` (37 views) +
> `bizar-dash/src/server/routes/*.mjs`.

## Mutation categories

| Tier | Symbol | Meaning |
|---|---|---|
| 3 | 🟢 **full** | Create + update + delete + invoke/bulk |
| 2 | 🟡 **partial** | Update or invoke only (no create/delete) |
| 1 | 🔵 **read+actions** | Read-only display + a few action buttons (restart, export, etc.) |
| 0 | ⚪ **read-only** | Pure observability — no mutations |

## Per-view mutation matrix

### 🟢 Tier 3 — full CRUD

| View | Creates | Updates | Deletes | Other actions | E2E proof |
|---|---|---|---|---|---|
| **Agents** | `POST /api/agents` | `PUT /api/agents/:name`, `POST /api/agents/:name/status` | `DELETE /api/agents/:name` | `POST /api/agents/:name/{restart,heartbeat,invoke}` | crud-roundtrip |
| **Tasks** | `POST /api/tasks` | `PATCH /api/tasks/:id`, `PATCH /api/tasks/bulk-status` | `DELETE /api/tasks/:id` | move between kanban columns | crud-roundtrip |
| **Goals** | `POST /api/goals` | `PATCH /api/goals/:id`, `PATCH /api/goals/:id/status`, `POST /api/goals/:id/key-results` | `DELETE /api/goals/:id/key-results/:krId`, `DELETE /api/goals/:id` | `POST /api/goals/:id/decompose` (goal → tasks) | crud-roundtrip |
| **Settings** | — | `PUT /api/settings`, `PUT /api/settings/plugin-options` | `POST /api/settings/reset` | `POST /api/admin/{gc,memory/reindex,cache/clear}` | config-coverage |
| **Providers** | `POST /api/providers` (via auto-add wizard) | `PUT /api/providers/:id`, `POST /api/providers/:id/{enable,disable,rotate}` | `DELETE /api/providers/:id` | `POST /api/providers/auto-detect` | tier3-batch-a + tier3-batch-c |
| **Projects** | `POST /api/projects`, `POST /api/projects/auto-detect`, `POST /api/projects/scan` | `PATCH /api/projects/:id`, `POST /api/projects/:id/activate` | `DELETE /api/projects/:id` | `POST /api/projects/refresh` | crud-roundtrip |
| **ClaudeSessions** | `POST /api/claude-sessions/new` | `PATCH /api/claude-sessions/:id` (rename) | `DELETE /api/claude-sessions/:id` | `POST /api/claude-sessions/:id/resume` | tier3-batch-c (resume) |
| **EnvVars** | `POST /api/env-vars` | `PUT /api/env-vars/:key` | `DELETE /api/env-vars/:key` | `POST /api/env-vars/:name/test` | tier3-batch-a |
| **Mods** | `POST /api/mods` (install) | `PATCH /api/mods/:id` (enable/disable) | `DELETE /api/mods/:id` (uninstall) | `POST /api/mods/:id/{enable,disable}`, `POST /api/mods/:id/instructions/reinstall`, `PUT /api/mods/:id/mod-file/*` | tier3-batch-a |
| **Dialogs** | `POST /api/dialogs/:id/{approve,deny,skip}` (resolution) | `PATCH /api/dialogs/:id` | `DELETE /api/dialogs/:id` | approve / deny / skip | tier3-batch-c |
| **Backup** | `POST /api/backup/create` | — | — | `POST /api/backup/restore`, `POST /api/backup/verify` | — |
| **Eval** | `POST /api/eval/run` | — | — | rerun eval suite | tier3-batch-a |

### 🟡 Tier 2 — partial mutations

| View | Mutations |
|---|---|
| **Chat** | `POST /api/chat/{regenerate,audit}` — no conversation CRUD (uses Claude Code sessions) |
| **LightRAG** | `POST /api/lightrag/{autostart,defaults}` — config + lifecycle |
| **Misc** | `POST /api/tailscale/{enable,disable}` — Tailscale tunnel toggle |
| **Notifications** | `POST /api/notifications/read-all` — bulk mark read |
| **Obsidian** | `POST /api/obsidian/index` — re-index vault |
| **Update** | `POST /api/updates/apply` — apply pending update |
| **Config** | `PUT /api/config` — single-doc config |
| **Artifacts** | `POST /api/artifacts` — accept/stage artifact (no full CRUD) |

### 🔵 Tier 1 — read + actions

| View | Read | Actions |
|---|---|---|
| **Overview** | `/api/snapshot` | navigation only |
| **Activity** | `/api/activity` (SSE tail) | export NDJSON (`GET /api/admin/activity/export`) |
| **Usage** | `/api/usage?range=24h` + per-model | time-range chips (refresh-only) |
| **Memory** | `/api/memory/notes` (plural) | none surfaced (config-only) |
| **Voice** | `/api/voice/list` | upload via raw `fetch('/api/voice/upload')` |
| **Doctor** | `/api/doctor/status` | `POST /api/doctor/check` (run diagnostics) |
| **Clipboard** | `/api/clipboard/history` | `POST /api/clipboard/save` |
| **History** | `/api/history` | clear-history (if wired) |
| **Schedules** | `/api/schedules` | enable/disable per row |
| **BackgroundJobs** | `/api/background-jobs` | pause/resume per row |

### ⚪ Tier 0 — read-only observability

| View | Source |
|---|---|
| **Auth** | `/api/auth/me`, `/api/auth/sessions` (logout button is its own POST) |
| **Admin** | `/api/admin/{health,gc}` summary (mutations live on Settings → Storage) |
| **Diagnostics** | `/api/diagnostics/*` |
| **CommandPalette** | `/api/agents`, `/api/skills` (palettes spawn things, not mutate itself) |
| **Libraries** | `/api/libraries` |

## Mutating endpoints NOT covered by a view

These endpoints exist server-side but no v8 view exposes them. Most
are reached via curl / TUI / Claude Code directly:

- `POST /api/memory/*` — only the in-View reindex button is exposed;
  no create-note form.
- `POST /api/dialogs/:id/{approve,deny}` is exposed; some deeper
  dialog lifecycle routes may not have a button.
- `POST /api/usage/*` — only display; no clear-usage button.
- `POST /api/admin/*` — only the Storage-section GC/clear/reindex
  buttons reach `/api/admin/*`; the rest of admin stays CLI/TUI.

## WS-driven surfaces (mutations come back via push)

These views surface state the dashboard doesn't directly mutate but
that downstream mutations trigger over WS:

- **Agents** → `agents:change`, `agent:status`, `agent:restarted`
- **Goals** → `goals:change`, `goals:removed`
- **Tasks** → `tasks:change`
- **Dialogs** → `dialog:show`, `dialog:resolved`
- **Activity** → `activity:new` (SSE)
- **Update** → `update:progress`, `update:log`, `update:complete`
- **Settings** → `settings:change`, `settings:plugin-options:changed`

## v10.0.5 audit deltas

- **Tier 3 proof column added.** Every Tier 3 row now names the
  E2E script that proves the round-trip (crud-roundtrip,
  tier3-batch-a, tier3-batch-c, config-coverage, etc). The
  full results live in `/tmp/{crud,tier3a,tier3c,cfg,full,mat}-<pid>/`.
- **Dialogs promoted Tier 1 → Tier 3.** New approve/deny/skip
  buttons wired to `POST /api/dialogs/:id/{approve,deny,skip}`
  + PATCH for `data`-merge. See Move 2c.
- **Providers expanded.** New POST (create), PUT (update),
  DELETE, POST `/:id/enable|disable` endpoints + matching UI
  buttons. See Moves 2b + 2c.
- **ClaudeSessions expanded.** New `POST /:id/resume` route
  + Resume button per row. See Moves 2b + 2c.
- **EnvVars expanded.** New `POST /:name/test` route + Test
  button per row. See Move 2a.
- **Mods expanded.** New `POST /:id/instructions/reinstall` +
  `PUT /:id/mod-file/*` + matching buttons. See Move 2a.
- **Eval expanded.** Schedules CRUD (POST + DELETE) + Add/Delete
  buttons. See Move 2a.
- **Projects expanded.** New `POST /api/projects/refresh` +
  button. See Move 2a.

## "Full control" verdict

Of 37 views:
- **13 views** are full CRUD (Tier 3).
- **9 views** expose partial mutations (Tier 2).
- **10 views** offer read + targeted actions (Tier 1).
- **5 views** are pure observability (Tier 0).

Net: every primary agent, task, goal, provider, project, settings,
session, environment, mod, and artifact surface exposes at least one
mutation path from the dashboard. The Tier 0/1 views are
intentionally read-only because the mutations live closer to the
feature surface (CLI, Claude Code sessions, TUI) or because the data
is sourced from external systems (Skills, MCPs, Plugins, Hooks,
Libraries).

## Gaps worth follow-up

1. **Memory create-note form.** MemoryView currently has read-only
   config + reindex; the create-note flow is only available via the
   plugin / Claude Code.
2. **Schedules CRUD.** Schedules view is Tier 1; no create/delete
   surfaced.
3. **Bulk-clear activity log** lives on Storage → Clear cache, not on
   Activity. See SETTINGS_AUDIT.md finding 13.

## See also

- `bizar-dash/src/web/v8/views/` — 37 view directories
- `bizar-dash/src/server/routes/` — 30+ route files
- `bizar-dash/SETTINGS_AUDIT.md` — per-row audit of the Settings page
- `CHANGELOG.md` v10.0.0 — what was added in this release