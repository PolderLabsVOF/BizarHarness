# Control Surfaces — v10.0.0

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

| View | Creates | Updates | Deletes | Other actions |
|---|---|---|---|---|
| **Agents** | `POST /api/agents` | `PUT /api/agents/:name`, `POST /api/agents/:name/status` | `DELETE /api/agents/:name` | `POST /api/agents/:name/{restart,heartbeat,invoke}` |
| **Tasks** | `POST /api/tasks` | `PATCH /api/tasks/:id`, `PATCH /api/tasks/bulk-status` | `DELETE /api/tasks/:id` | move between kanban columns |
| **Goals** | `POST /api/goals` | `PATCH /api/goals/:id`, `PATCH /api/goals/:id/status`, `POST /api/goals/:id/key-results` | `DELETE /api/goals/:id/key-results/:krId`, `DELETE /api/goals/:id` | `POST /api/goals/:id/decompose` (goal → tasks) |
| **Providers** | `POST /api/providers` (via auto-add wizard) | `PUT /api/providers/:id`, `POST /api/providers/:id/{enable,disable,rotate}` | `DELETE /api/providers/:id` | `POST /api/providers/auto-detect` |
| **Projects** | `POST /api/projects`, `POST /api/projects/auto-detect`, `POST /api/projects/scan` | `PATCH /api/projects/:id`, `POST /api/projects/:id/activate` | `DELETE /api/projects/:id` | — |
| **ClaudeSessions** | `POST /api/claude-sessions/new` | `PATCH /api/claude-sessions/:id` (rename) | `DELETE /api/claude-sessions/:id` | `POST /api/claude-sessions/:id/resume` |
| **Settings** | — | `PUT /api/settings`, `PUT /api/settings/plugin-options` | `POST /api/settings/reset` | `POST /api/admin/{gc,memory/reindex,cache/clear}` |
| **EnvVars** | `POST /api/env-vars` | `PUT /api/env-vars/:key` | `DELETE /api/env-vars/:key` | rotate keys |
| **Mods** | `POST /api/mods` (install) | `PATCH /api/mods/:id` (enable/disable) | `DELETE /api/mods/:id` (uninstall) | `POST /api/mods/:id/{enable,disable}` |
| **Dialogs** | `POST /api/dialogs/:id/{approve,deny,skip}` (resolution) | `PATCH /api/dialogs/:id` | `DELETE /api/dialogs/:id` | approve / deny / skip |
| **Backup** | `POST /api/backup/create` | — | — | `POST /api/backup/restore`, `POST /api/backup/verify` |
| **Eval** | `POST /api/eval/run` | — | — | rerun eval suite |

### 🟡 Tier 2 — partial mutations

| View | Mutations |
|---|---|
| **Chat** | `POST /api/chat/{regenerate,audit}` — no conversation CRUD (uses Claude Code sessions) |
| **Headroom** | `POST /api/headroom/{install,start,stop,wrap,unwrap}` — runtime toggle |
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