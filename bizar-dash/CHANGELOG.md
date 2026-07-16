# @polderlabs/bizar-dash — Changelog

## v10.0.7 — 2026-07-16

### Highlights

Activity page rebuilt as swimlanes (inspired by
[patoles/agent-flow](https://github.com/patoles/agent-flow)) plus a
route contract fix that was previously hiding every event.

- **Activity lanes**: vertical swimlanes per agent/actor, newest-first,
  320px columns with horizontal scroll, click-through on every event
  row to the underlying entity (task / goal / agent / artifact) via a
  new `useViewNavigate` hook.
- **New primitives**: `ActivityLane` (one lane) + `ActivityLanes`
  (horizontal scroller) — re-exported from `ui/index.ts`.
- **Route contract**: `/api/activity` now returns `{ items, total,
  limit, since }` (was leaking `events`); honors `?limit=N` (default
  200, hard cap 1000) and accepts `?since=ISO` for windowed polling.
- **Documentation**: per-actor lane behaviour, click-through targets,
  and E2E script `tests/e2e/dashboard-activity-lanes.mjs` (6/6 PASS).

### Files

- `bizar-dash/src/server/routes/activity.mjs` — contract fix
- `bizar-dash/src/web/v8/ui/activity/ActivityLane.tsx` — NEW primitive
- `bizar-dash/src/web/v8/ui/activity/ActivityLanes.tsx` — NEW scroller
- `bizar-dash/src/web/v8/ui/index.ts` — barrel re-exports
- `bizar-dash/src/web/v8/data/useViewNavigate.ts` — NEW: cross-tree
  `bizar:navigate` CustomEvent hook
- `bizar-dash/src/web/v8/App.tsx` — listens for `bizar:navigate`
- `bizar-dash/src/web/v8/views/Activity/ActivityView.tsx` — rewritten
  as swimlanes
- `tests/e2e/dashboard-activity-lanes.mjs` — NEW E2E (6 checks)
- `package.json` — `test:e2e:activity-lanes` script

### Skipped (deliberate)

- **`?actor=` filter** on the route — currently the client groups by
  whatever `state.recentActivity` already partitions. Ponytail: add
  when the activity store grows large enough that the client grouping
  becomes expensive.
- **Lane drag-to-reorder** — lane order is currently count-desc, no
  user override. ponytail: persist `localStorage['bizar:lane:order']`
  when there's user demand.
- **Horizontal time axis zoom** — patoles/agent-flow's timeline zoom
  interaction, skipped because `ts` density is too spiky to make a
  zoom useful without smoothing windows.

## v10.0.6 — 2026-07-16

### Highlights

Integrates the kanban overhaul (PR #14) plus five targeted UX bug
fixes from the user-feedback round:

- **Tasks board**: 6-column layout with Backlog, search + filter
  chips, full multi-select toolbar (bulk move / archive / delete),
  Esc-to-clear selection, dedicated detail dialog, per-card progress
  bar + badges (recurring / subtasks / deps / tags / branch).
- **Topbar project selector**: now a real button with a Radix Popover
  listing every registered project — calls
  `POST /api/projects/:id/activate` and refetches the active state.
- **CC roster**: `/tmp` scratch sessions are filtered out of both the
  live CLI roster and the disk fallback. Opt-out via
  `BIZAR_CC_INCLUDE_TMP=1` for debug.
- **Sidebar**: every section header is collapsible (click to toggle);
  state persisted under `bizar:sidebar:section:collapsed:<id>` so the
  23-item System section can fold away.
- **Artifacts**: server-side auto-mint on `goal-finished` and
  `dialog-needs-input` transitions. Sidebar already shows Artifacts;
  it now actually populates without manual intervention.
- **Libraries**: `/api/skills?kind=skills|mcps|hooks` is honoured,
  the scanner stamps `kind` on every entry, and the three sidebar
  counts diverge instead of all reading the same 49.

### Per-move detail

- **Move 1 (TasksView)**: replaced v10.0.5's flat 5-column board with
  PR #14's 6-column layout, added 6 new primitives
  (`KanbanToolbar`, `KanbanDetailDialog`, `KanbanCardBadges`,
  `KanbanProgress`, `KanbanEmptyColumn`, `useKanbanSelection`).
  Extended `Task` type with `tags / subtasks / dependencies /
  recurring / activity / timerStart`. Wired toolbar + selection into
  the existing `TaskDetail` Sheet so the create / edit flows are
  unchanged. PR #14's bare-array `useFetch<Task[]>` was a regression
  vs the v10.0.5 `{ tasks, count }` envelope — kept the wrapper shape.

- **Move 2 (Topbar)**: replaced inert `<Box>{label} ▾</Box>` with a
  Radix `Popover` anchored on a `<button>` trigger. Each menu item is
  `<button role="menuitem">` (focus / arrow / Esc honoured natively),
  shows a `●` indicator on the active project, and emits
  `POST /api/projects/:id/activate` on click with per-item busy state.

- **Move 3 (CC roster)**: introduced `shouldIncludeAgent()` in
  `routes/agents-cc.mjs`, applied to the live CLI roster
  (`r.agents.map(enrichSession)`) and the disk-fallback loop.
  Skips agents whose `cwd` is `os.tmpdir()` or under it.

- **Move 4 (Sidebar)**: per-section collapse + chevron + localStorage
  persistence. New testids: `data-sidebar-section`, `sidebar-section-
  toggle-<id>`, `sidebar-section-chevron-<id>` for E2E.

- **Move 5 (Artifacts auto-mint)**: new `server/artifact-mint.mjs`
  helper centralises slugification + idempotency (swallows 409 from
  `artifactsStore.create`). Goals route mints on transition
  `* → done`; dialogs route mints on `needsUserInput: false → true`.

- **Move 6 (Libraries)**: skills route filters by `?kind=`; scanner
  annotates `kind: 'skills'` + stable `id` per entry. Sidebar counts
  surface distinct numbers (e.g. 18 / 0 / 0).

### Skipped (deliberate)

- MCP / hook file scanner: no scanner exists yet, so `?kind=mcps` and
  `?kind=hooks` return empty lists. ponytail: ship a real MCP/hook
  scanner when the surface is wired.
- MDX body content for goal-finished artifacts: frontmatter + KR
  checklist only; no rendered prose yet.
- `theme.css` rebuild: visuals already match the PR's CSS, but a fresh
  build:dash run isn't gated by the E2E.

## v10.0.5 — 2026-07-16

### Highlights

Four atomic moves close the umbrella brief end-to-end:
**37/37 surfaces reachable**, **16 Tier-3 mutations proven
with E2E**, **8 silent-failure views now surface a
recoverable error**, and **9 views gained a data-driven
list header** (count + sparkline + filter chips).

### Move 1 — Sidebar reachability

- `App.tsx` sections array grew from 12 hard-coded items to
  24, wiring every section already declared in
  `Sidebar.tsx:DEFAULT_SECTIONS`.
- 17 view files got a `<view>-view` testid on their root
  container.
- `tests/e2e/dashboard-full-surfaces.mjs` walks all 37 Router
  cases, clicks each sidebar item, and asserts the `<view>-view`
  root testid appears. **37/37 PASS.**

### Move 2 — Tier-3 mutation coverage

16 atomic mutations across 8 endpoints, all proven with E2E.

- **Move 2a — 8 missing UI buttons** wired against existing
  server endpoints: Projects refresh, EnvVars test, Eval
  schedule add/delete, Mods reinstall-instructions + edit,
  Providers add-key, ClaudeSessions send.
- **Move 2b — 8 new server endpoints**: `POST/PATCH/DELETE`
  on dialogs (`/:id/approve|deny|skip` + `/:id`), providers
  (`POST /`, `PUT /:id`, `DELETE /:id`,
  `POST /:id/enable|disable`), claude-sessions
  (`POST /:id/resume`). `dialog-store.mjs` grew `decide()`
  (sidecar decision file + unlink queue) and `patch()`
  (merge data).
- **Move 2c — UI buttons for new routes**: DialogsView
  (Approve/Skip/Deny/Dismiss), ProvidersView (New + per-row
  Edit/Enable/Disable/Delete), ClaudeSessionsView (Resume).

### Move 3 — ErrorState polish

New shared `<ErrorState>` in
`bizar-dash/src/web/v8/ui/feedback/ErrorState.tsx` with two
modes — inline (Alert tone=danger banner with optional
retry) and block (centered icon + title + message + retry,
mirrors EmptyState).

8 silent-failure views now surface a recoverable error
before falling through to the empty state: History, Goals,
Activity, Usage, Agents, Libraries (skill/mcp/hook),
Doctor, Dialogs. Each wires `onRetry={() => fetch.refetch()}`
so a 500 / network blip is one click away from recovery.

### Move 4 — ListHeader polish

New shared `<ListHeader>` in
`bizar-dash/src/web/v8/ui/data/ListHeader.tsx` — title +
count badge + optional Sparkline + optional filter chips +
right-aligned actions. Wired into 9 views:

- **High-traffic (sparkline):** Activity (per-day bucket
  counts).
- **High-traffic (count + chips):** Goals (status filter
  chips migrated under ListHeader.filters).
- **High-traffic (count only):** Agents.
- **Count-only:** Projects, Providers, Mods, Dialogs,
  EnvVars, Backup.

Skipped: Tasks (Kanban already counts), History (custom
FilterChip interleaves kinds + projects).

### Bug fix landed in Move 1

DoctorView.tsx called `checks.map` on `snap.data.checks`,
but the server returns `checks` as
`{ system, config, services }` (a grouped object), not an
array. The view crashed on first render and unmounted the
entire React tree (no ErrorBoundary). Flatten the groups
into a typed `CheckResult[]` and filter to entries with
valid name/status/message.

### E2E proof

- `dashboard-full-surfaces.mjs` — **37/37 PASS**
- `dashboard-tier3-batch-a.mjs` — **7/7 PASS**
- `dashboard-tier3-batch-c.mjs` — **14/14 PASS**
- `dashboard-surfaces-matrix.mjs` — **13/13 PASS**
- `dashboard-crud-roundtrip.mjs` — **17/17 PASS**

## v10.0.4 — 2026-07-15

### Highlights

Three atomic commits close the three remaining umbrella-brief gaps
the v10.0.3 stop-hook flagged: live CC roster from disk + correct
enrichSession path, full `/goal` slash command E2E coverage, and
full configuration coverage (Settings Reset + plugin-options UI,
plus E2E proof for providers/projects/mods + the new testids).

### Fixed

- **`enrichSession` path** (`agents-cc.mjs:73`). The function read
  `~/.claude/sessions/<sessionId>/messages.jsonl`, but real CC logs
  live at `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`. The
  path always 404'd, so `lastMessageAt`, `messageCount`, and
  `lastMessageSnippet` never populated. v10.0.4 routes through the
  existing `resolveSessionLog()` which already encodes `cwd`
  correctly.
- **BIZAR_CC_HOME redirect** (`agents-cc.mjs`). All CC session
  paths now resolve via `ccHome()` which honours `BIZAR_CC_HOME` so
  the test suite can sandbox `$HOME/.claude` into a tmp directory.

### Added

- **`listAgentsFromDisk()` fallback** (`agents-cc.mjs`). Enumerates
  `$HOME/.claude/sessions/*.json` to mint a CC roster when the
  `claude agents --json` CLI is absent (ENOENT, exit ≠ 0, or timeout).
  When the CLI is present the two rosters are merged by sessionId
  with disk-only fields (`lastMessageAt`/`messageCount`/`lastMessageSnippet`)
  filling in any gaps the CLI left behind.
- **`extractLastSnippet()` helper** (`agents-cc.mjs`). Pulled the
  assistant-text-block extraction out of `enrichSession` so the live
  CLI roster and the disk fallback share the exact same snippet
  shape.
- **SettingsView — Configuration section** (`SettingsView.tsx`).
  Adds a "Reset to defaults" button (`POST /api/settings/reset`)
  with confirm gate + busy state, and a "Plugin options" JSON
  textarea editor that PUTs to `/api/settings/plugin-options`.
  Both expose `data-testid` for E2E.
- **`tests/e2e/dashboard-cc-disk-fallback.mjs`** (Move 1). 5 checks
  proving the disk fallback path end-to-end against a tmp HOME.
- **`tests/e2e/dashboard-cc-goal-slash.mjs`** (Move 2). 6 checks
  proving the full `/goal` slash command path: port resolution from
  `dash-auth.json`, POST/PATCH/KR cycle round-trip, UI render, and
  the file-watcher fallback when CC writes PROGRESS.md directly.
- **`tests/e2e/dashboard-config-coverage.mjs`** (Move 3). 7 checks
  covering `POST /api/settings/reset`, `PUT /api/settings/plugin-options`,
  `GET /api/providers/auto-detect`, `POST /api/projects/scan`,
  `GET /api/mods`, and the two new SettingsView testids.

### npm scripts

- `test:e2e:cc-disk` — Move 1
- `test:e2e:goal-slash` — Move 2
- `test:e2e:cfg` — Move 3

## v10.0.3 — 2026-07-15

### Highlights

Six atomic commits close every umbrella-brief criterion the v10.0.2
stop-hook flagged as unevidenced: per-agent status grid, CC session
merge + CC `/goal` slash command, full CRUD surface, data-driven
dashboard surfaces, and a single end-to-end surfaces matrix. Two
real bugs surfaced and fixed in the process — TaskDetail PATCH
mismatch and TasksView bulk-status 404.

### Fixed

- **`PATCH /api/tasks/:id`** (`tasks.mjs`). TaskDetail.tsx:81 sent
  `PATCH` but the server only exposed `PUT` — every task edit
  404'd. New PATCH handler mirrors PUT body and broadcasts
  `tasks:change`. Unit-tested in `tasks-patch-routes.test.mjs`.
- **`PATCH /api/tasks/bulk-status`** (`tasks.mjs`). TasksView.tsx:142
  sent `PATCH /api/tasks/bulk-status` but the server only had
  `POST /api/tasks/bulk` — the bulk-action bar never moved tasks.
  New PATCH handler accepts `{ids, status}`, returns per-row
  failures, validates status against the allow-list. Registered
  before `/tasks/:id` so the literal `bulk-status` segment isn't
  captured by Express's :id param.

### Added

- **`tests/e2e/dashboard-coverage-proof.mjs`** (Move 2). 8 Bizar
  agents with diverse statuses (working/idle/paused/error/stuck),
  6 goals across 4 status tones, 7 days of usage JSONL. Asserts
  AgentsView renders ≥8 `.v8-agent-card` nodes spanning ≥4
  distinct status classes, GoalsView renders ≥6 `[data-testid^=goal-card-]`
  nodes, OverviewView renders `[data-testid=overview-tokens-sparkline]`.
- **`tests/e2e/dashboard-cc-bridge.mjs`** (Move 3). 7 checks: Bizar
  source discriminator, CC route mounted, Claude Code chip
  clickable in UI, `.claude/commands/goal.md` references
  /api/goals + POST + "Do not edit PROGRESS.md directly", dash
  auth resolves port, POST /api/goals round-trip, new goal
  appears as `goal-card-X` in GoalsView.
- **`tests/e2e/dashboard-crud-roundtrip.mjs`** (Move 4). 16
  mutations across all 4 primary stores (agents/tasks/goals
  /schedules), each proving on-disk persistence AND round-trip
  through the GET endpoint. 17 checks total.
- **`tests/e2e/dashboard-data-driven.mjs`** (Move 5). 6 checks:
  /api/usage returns ≥7 daily buckets (7d seed), AgentsView
  renders ≥5 metric tile rows, GoalsView main innerText
  contains ≥4 of 5 status tones, OverviewView sparkline renders.
- **`tests/e2e/dashboard-surfaces-matrix.mjs`** (Move 6). 12-row
  surfaces matrix walks every primary sidebar item (overview,
  agents, goals, tasks, settings, memory, activity, schedules,
  background, skills, mcps, hooks) past the auth gate. Drops
  `chat` — the router case exists but App.tsx's sidebar
  sections (workspace/operations/libraries/system) don't
  surface it; honest matrix only includes reachability.
- **OverviewView range fix.** `/api/usage?range=24h` only ever
  returns 1 daily bucket so the Sparkline never renders in
  practice; switched to `range=7d` so the trend tile has
  ≥2 points even on freshly-seeded servers. Unit test updated.

### Wiring

5 new npm scripts: `test:e2e:coverage`, `test:e2e:cc`,
`test:e2e:crud`, `test:e2e:data`, `test:e2e:matrix`. Each runs
in a sandboxed `$HOME` so they don't pollute the user's real
store.

## v10.0.0 — 2026-07-13

### Highlights

The dashboard graduates from "dashboard over your data" to **orchestration center**.
v10 closes the three audit gaps that stop-hook reviews flagged across
v9.x: dead-sparkline code, hierarchy endpoints with no consumer, and a goals
parser that broke the cross-boundary CC/`/goal` round-trip. v10 also adds a
real restart lifecycle for stuck agents and per-day usage trendlines, plus a
cross-boundary E2E suite that boots a real server, writes fixture project
files, and asserts what the API returns and what it persists to disk.

### Added

- **Agent hierarchy view** (`AgentHierarchy`). New Roster|Hierarchy chip
  toggle on AgentsView. Consumes `/api/agents/hierarchy`, renders a
  collapsible parent/child tree, WS-subscribes to `agents:change`, falls
  back to `EmptyState` when no parent links exist. Sprint S45.
- **Stuck agents banner becomes actionable.** Each stuck row now exposes
  Pause/Resume + Restart buttons. Banner header gains a "Pause all" bulk
  action. Sprint S49 + v10-S1 (Pause/Resume/bulk, status widened to
  include `paused`).
- **Agent detail → tasks drilldown.** `AgentDetail` now fetches
  `/api/tasks` once opened and renders the tasks assigned to this agent
  (matched by `workedBy` OR `metadata.agent`) as Card rows inside the
  panel. Empty-state Card when none. Sprint S49.
- **GoalsView cross-boundary CC-shape round-trip.** Goals route now
  resolves `.bizar/PROGRESS.md` against `projectsStore.active().path`
  (was `.cwd`), so the dashboard reads the *active* project's file
  instead of silently falling back to `$HOME/.bizar/PROGRESS.md`.
  `serializeProgress` strips carried-over `Goal is **status**` lines
  from goal descriptions before re-emitting, so PATCH /status mutations
  actually persist (previously the second status line won on re-parse).
  v10-S3.
- **OverviewView token-usage sparkline trend.** Tokens StatTile shows a
  SVG sparkline of the last 24h daily series returned by `/api/usage`.
  Fits inside the existing `sparkline` slot on `StatTile`. Falls back
  gracefully when fewer than 2 daily points are available. v10-S2.
- **Cross-boundary E2E suite:**
  - `tests/e2e/goals-cc-roundtrip.mjs` (8 steps) — boots server against
    a tmp project, writes a CC-shape PROGRESS.md fixture, GETs /api/goals
    + PATCHes status + re-reads + asserts file-watcher broadcast.
  - `tests/e2e/agent-restart-roundtrip.mjs` (6 steps) — fixture agent
    .md + status file marked error, GETs /restart pre-state, POSTs
    /restart, asserts WS `agent:restarted` broadcast, asserts the
    on-disk `~/.config/bizar/agent-status.json` actually moved to idle,
    and GETs the post-state. Restores user's real $HOME files in
    `finally`.

### Fixed

- **v10-S3** `serializeProgress` dropped the original `Goal is **<old>**`
  line onto the page right under the freshly-emitted status line. Parser
  saw both lines and the second match won (its overwrite guard
  `'if status === on-track'` never fired because the default WAS
  on-track and the new status was also on-track). Net: dashboard
  `PATCH /status` returned 200 but the visible state didn't change.
  Stripped at serialize time.
- **v10-S4** `readAgent` read the in-memory `_status` Map without
  calling `loadStatus()` first, so any agent never touched post-boot
  silently fell back to the idle default even when its on-disk status
  was error/stuck. E2E caught it. Fixed: `loadStatus()` at the top of
  `readAgent` (idempotent).
- **v10-S3** `progressPath()` read `active.cwd` (undefined) while
  `projectsStore` actually stores under `.path`. Dashboard always
  fell back to `$HOME/.bizar/PROGRESS.md`. Fixed: `active.path`.
- **v9.4.0 / S45** Dead-sparkline code on `AgentCard`. `mapBizar`/`mapCC`
  always passed a single-element `tpmHistory`, the `length > 1` guard
  blocked the chart from ever rendering. Replaced with real
  `tasksSucceeded / tasksTotal` + `successRate` + `lastSeenMs` rows.
- **v9.5.0 / S47** `UpdateView` had pre-existing `TS2783` errors on
  `WebSocket` message narrowing (discriminator duplication in spread
  overload). Reordered to spread-then-narrow so the union collapses
  cleanly.
- **v9.5.0 / S47** `BizarAgent.status` union widened to include
  `'paused'` so the stuck-banner Pause control's `s.status === 'paused'`
  comparison typechecks. Server route valid set widened to match
  (`['idle','working','error','stuck','paused']`).

### Tests

- vitest: 363 → 388 cases (+25); 49 → 51 test files (+2).
- 2 new cross-boundary E2E tests (14 steps total) — both green.
- `bunx tsc --noEmit` at repo root: 0 errors.
- `npx tsc -p tsconfig.json` inside `bizar-dash/`: 0 errors in
  `src/`. Pre-existing `toBeInTheDocument` jest-dom typing gaps in
  `__tests__` files are unchanged baseline.

### Files

- `bizar-dash/src/server/routes/goals.mjs` — `progressPath()` fix +
  comments pointing at the cross-boundary audit trail.
- `bizar-dash/src/server/progress-parser.mjs` — `serializeProgress`
  strips prior `Goal is **...**` lines.
- `bizar-dash/src/server/progress-parser.test.mjs` — v10-S3 regression:
  parse → mutate → serialise → re-parse → status preserved.
- `bizar-dash/src/server/agents-store.mjs` — `readAgent` now
  `loadStatus()` first.
- `bizar-dash/src/web/v8/views/Agents/AgentsView.tsx` —
  Roster|Hierarchy toggle + stuck banner Pause/Resume/bulk.
- `bizar-dash/src/web/v8/views/Agents/AgentHierarchy.tsx` (NEW) —
  collapsible tree.
- `bizar-dash/src/web/v8/ui/agents/AgentCard.tsx` — dead sparkline
  replaced with real task-count/success-rate/last-seen rows.
- `bizar-dash/src/web/v8/ui/agents/AgentDetail.tsx` — tasks drilldown.
- `bizar-dash/src/web/v8/views/Overview/OverviewView.tsx` — token
  sparkline trendline on Tokens StatTile.
- `bizar-dash/src/web/v8/views/Update/UpdateView.tsx` — TS2783 fix.
- `bizar-dash/src/web/v8/data/types.ts` — `BizarAgent.status`
  includes `'paused'`.
- `bizar-dash/src/web/v8/__tests__/{agents-stuck-banner,agent-detail-tasks,overview-trends,goals-cc-roundtrip,agent-hierarchy,agent-card-metrics}.test.tsx` (new + extended).
- `tests/e2e/{goals-cc-roundtrip,agent-restart-roundtrip}.mjs` (NEW).

### Sprints covered

- v9.4.0 — S45 (hierarchy + stuck banner + dead-sparkline), S46 (docs).
- v9.5.0 — S47 (UpdateView typecheck), S48 (stuck Restart),
  S49 (agent↔task drilldown), S50 (paperwork).
- v10.0.0 — S1 (Pause/Resume/bulk), S2 (Overview Sparkline),
  S3 (GoalsView CC round-trip + E2E + 2-bug-fix), S4 (cross-boundary
  agent restart E2E + readAgent-bug fix), S5 (this paperwork).

## v10.0.2 — 2026-07-15

### Highlights

Closes the integration-breadth and "control and configure
everything" gaps from the v10.0.1 stop-hook. The walkthrough now
exercises **all 12 reachable sidebar views** with seeded Bizar
agents, tasks across all 4 columns, a CC session stub for the
Source-filter chip, and 3 PROGRESS.md goals spanning status tones
(15/15 checks pass). A new mutation round-trip test proves the
dashboard's 4 primary mutations (Settings PUT, Agent POST, Task
POST, CC-style goal append) actually land on disk **and** round-trip
back through the same API the views consume (4/4 checks pass).
Also fixes a latent bug: `GET /api/tasks` returned a bare array
while the v8 UI expected `{ tasks, count }` — TasksView rendered 0
tasks even when `tasks.json` had data.

### Fixed

- **`GET /api/tasks` returned a bare array.** The v8 UI
  (`App.tsx:87` and several views) consumes `{ tasks, count }`,
  so the bare array shape made TasksView render 0 tasks even when
  the underlying `tasks.json` had data. Now returns the envelope
  shape, matching what the audit-fixes + views tests already
  mocked. Sprint v10-S11.

### Added

- **`tests/e2e/dashboard-auth-walkthrough.mjs` (v2)** — Full-scope
  sidebar walkthrough. Boots `createServer()` with
  `HOME=/tmp/bh-walk-home-<pid>` so all backend stores redirect
  to a tmp directory (no pollution of the user's real `$HOME`).
  Seeds 3 Bizar agents (odin/thor/frigg), 4 tasks across the
  queued/doing/done/blocked columns, a CC session stub at
  `~/.config/bizar/agent-status.json`, and 3 goals
  (G-001 on-track, G-002 at-risk, G-003 at-risk) in
  `projectRoot/.bizar/PROGRESS.md`. Drives `agent-browser` through
  the v8 sidebar (state-based router) and asserts each view's
  main region renders view-specific content. **15/15 PASS** —
  all 12 reachable sidebar views (overview/tasks/goals/agents/
  activity/memory/schedules/background/skills/mcps/hooks/settings)
  plus the 3 API-level seeds (agents, tasks, goals).
- **`tests/e2e/dashboard-mutation-roundtrip.mjs`** — Mutation
  round-trip test. Same boot pattern. Each of the 4 mutations
  proves on-disk persistence **and** round-trips back through the
  same API the view consumes:
  - `PUT /api/settings` → `~/.config/bizar/settings.json`
    (verified by reading the file + GET /api/settings envelope)
  - `POST /api/agents` → `~/.config/cline/agents/<name>.md`
    (verified by reading the file + GET /api/agents listing)
  - `POST /api/tasks` → `~/.config/cline/projects/<id>/tasks.json`
    (verified by reading the file + GET /api/tasks envelope)
  - `POST /api/goals` → `projectRoot/.bizar/PROGRESS.md`
    (verified by reading the file + GET /api/goals listing)
  Each result row writes its on-disk evidence (path + last 280
  bytes) to `results.json`. **4/4 PASS**.

### Changed

- **`bizar-dash/BROWSER_VERIFICATION.md`** — Updated to v10.0.2.
  Added full-scope walkthrough section (15/15) + mutation
  round-trip section (4/4). Recorded PIDs for the v10.0.2 runs.
  Documented that the v8 sidebar has 12 reachable items (ChatView
  exists but is excluded from the sidebar — only reachable via
  command palette).

## v10.0.1 — 2026-07-14

### Highlights

Closes the three remaining v10.0.0 stop-hook gaps with real
verifications, not paperwork. The cold-boot event-loop starvation
that froze the dashboard for 3-5s is now fixed (async `execFile`
in `memory-lightrag.mjs` + `BIZAR_HEADROOM_AUTOSTART=0` env gate in
`server.mjs`), and the unauthenticated browser smoke is upgraded to
an authenticated 8-view per-view walkthrough that proves
AgentsView / GoalsView / TasksView / SettingsView / Memory /
Activity render real data past the auth gate.

### Fixed

- **Cold-boot event-loop starvation** (`memory-lightrag.mjs:344`,
  `server.mjs:439`). LightRAG's `findLightragBinary()` ran
  `execFileSync('command', …)` synchronously with a 3s timeout on
  every cold start. Converted to async `execFile` wrapped in a
  Promise; the 3 call sites (`isInstalled`, two `startServer`
  checks) now `await` it. The headroom startup hook (`npm install`
  as a child process) is now opt-out via
  `BIZAR_HEADROOM_AUTOSTART=0`, mirroring the existing lightrag
  pattern. Default behaviour unchanged. Sprint S9.

### Added

- **`tests/e2e/cold-boot-perf.mjs`** — Regression test for the cold-
  boot freeze. Boots `createServer()` with both opt-outs set,
  asserts `listen → first-fetch < 2s`. Closes the v10-S7
  "documented, not fixed" caveat. **2/2 PASS** (`bootMs=42,
  firstFetchMs=21`).
- **`tests/e2e/dashboard-auth-walkthrough.mjs`** — Authenticated
  per-view walkthrough. Boots `createServer()` against a tmp
  project, drives `agent-browser` through real sidebar clicks
  (the v8 router is state-based, not hash-based), screenshots
  each view, asserts the active sidebar item matches and the main
  region renders view-specific content. **8/8 PASS** across
  Overview (303 bytes), Agents (1000), Goals (805), Tasks (129),
  Settings (6556), Memory (247), Activity (321) — all past the
  auth gate. Closes the v10-S7 per-view-verification gap.

### Changed

- **`bizar-dash/BROWSER_VERIFICATION.md`** — Updated to v10.0.1.
  Removed the "documented, not fixed" caveat for the cold-boot
  freeze (it's now fixed). Added the cold-boot regression and
  per-view walkthrough sections with PID + PASS count evidence.
  Documented the loopback-auto-trust auth model that explains why
  the browser walkthrough doesn't need to pass a bearer token.

## v4.5.0 — 2026-07-05

### Highlights

- **Settings page is now the single home for all configuration.** Config tab merged into Settings; restructured with section nav (General, Env Vars, Providers, Memory, System LLM, Updates, Skills, Dashboard). Add a settings search that finds individual settings by name/value and scrolls to them.
- **Bizar env-var manager.** First-class UI for managing `BIZAR_*` env vars at `~/.config/bizar/env.json` (mode 0600). When configuring any provider or LLM, the user can pick an existing env var OR create a new one — never paste plaintext keys.
- **Provider subsystem overhaul.** New `PROVIDER_CATALOG` with 13 well-known providers, fuzzy search, single-key auto-add wizard (`POST /api/providers/auto` probes `/v1/models` and fills in baseURL/models/pattern). Backup keys per provider with automatic rotation on auth/quota/rate-limit/429/5xx errors. Key cooldown tracking, status management (active|standby|disabled|cooldown).
- **LightRAG defaults to free OpenCode Zen models** (`opencode/gpt-5-nano` for LLM, `opencode/text-embedding-3-small` for embeddings). Configurable via `BIZAR_LIGHTRAG_LLM` / `BIZAR_LIGHTRAG_EMBEDDING` env vars.
- **Memory settings in Settings → Memory.** LightRAG URL, Obsidian vault path, git repo config, sync interval. New `/api/memory/config/global` endpoint persists to `~/.config/bizar/memory-config.json`. `/api/memory/test-git` validates the configured repo.
- **Usage monitoring and analytics.** New JSONL usage store at `~/.local/share/bizar/usage.jsonl`. Tracks prompt/completion/cached/reasoning tokens, requests, errors, latency per call. New `GET /api/usage?range=24h|7d|30d|custom` returns totals + per-day + per-model + per-key + error breakdowns. MiniMax Usage view rewritten with hand-rolled SVG chart, sortable per-model table, time-range chips, recent-activity feed.
- **Agents know their limits.** New `getUsageLimitsForAgent(providerId)` returns last-5min + last-24h request/token counts, percent used, time-until-reset. Wired into opencode plugin's prompt context so agents stay aware of quota while working.
- **Chat overhaul + opencode session fixes.** Fixed "can't open an opencode session" (SSE reconnect + per-session event gating) and "can't create a new session" (Chat.tsx used bare `fetch('/chat/sessions')` which 404'd; now uses `POST /api/opencode-sessions/new`). New `useChat.ts` with SSE reconnect-with-backoff, optimistic-send dedupe, clean unmount lifecycle. `POST/PATCH/DELETE /api/opencode-sessions[/...]` for create/rename/delete. MobileChat.tsx overhaul at mobile size.
- **Tasks.tsx simplified.** Agent picker removed from task creation; user just types title + description, Odin decides routing and priority. Backlog / Todo / In progress / Done / Failed board with move/retry/edit/delete actions. Submit-to-Odin re-delegates.
- **Skills tab + toolset refresh.** Skills tab shows Bizar skills (the old code only queried the `skills` CLI which ignored local SKILL.md files). Search output fixed (no more terminal ASCII garbage in titles — old code fell back to text-mode parsing). 11 shipped skills under `bizar-dash/skills/`: bizar, agent-baseline, self-improvement, obsidian, minimax, providers, chat, usage, skills-cli, lightrag, sdk.
- **Update flow overhaul.** New `/api/updates/{status,check,apply}` endpoints with WS `update:progress` events. `bizar update` gains `--check`, `--channel=stable|beta`, `--no-restart`. Settings → Updates section wired end-to-end.
- **UI consistency pass.** Standardized spacing tokens (`--spacing-xs/-sm/-md/-lg/-xl`) added to main.css with compact-mode overrides.
- **CLI.** New `bizar usage [range]` subcommand proxies `/api/usage`.

### Files

- `bizar-dash/src/web/views/Settings.tsx` — full rewrite
- `bizar-dash/src/web/views/Config.tsx` — collapsed (Settings is canonical)
- `bizar-dash/src/web/views/MiniMaxUsage.tsx` — full rewrite (interactive SVG chart, sortable table)
- `bizar-dash/src/web/views/Chat.tsx` + `MobileChat.tsx` + `hooks/useChat.ts` — overhaul
- `bizar-dash/src/web/views/Tasks.tsx` — agent picker removed, kanban board
- `bizar-dash/src/web/views/Skills.tsx` — full rewrite (source tabs, fuzzy search)
- `bizar-dash/src/server/providers-store.mjs` — backup keys, catalog, rotation
- `bizar-dash/src/server/routes/{providers,env-vars,usage,update,memory,lightrag,opencode-sessions,opencode-session-detail,config,skills}.mjs` — new + extended endpoints
- `bizar-dash/src/server/minimax.mjs` — `chatCompletion` records usage
- `bizar-dash/src/server/minimax-usage-store.mjs` (NEW) — JSONL store
- `bizar-dash/src/server/skills-store.mjs` — scans local SKILL.md directly
- `bizar-dash/src/server/serve-info.mjs` — session rename/delete helpers
- `bizar-dash/src/web/components/{EnvVarManager,SettingsSearch,UsageChart,UsageTable}.tsx` (NEW)
- `bizar-dash/src/web/styles/{settings,skills,tasks,chat,minimax-usage}.css` — scoped styles
- `bizar-dash/skills/{bizar,agent-baseline,self-improvement,obsidian,minimax,providers,chat,usage,skills-cli,lightrag,sdk}/SKILL.md` — 11 shipped skills
- `cli/bin.mjs`, `cli/provision.mjs` — `bizar update` flags + `bizar usage`
- `config/agents/_shared/SKILLS.md` — skills reference doc
- `~/.opencode/skills/bizar/` — copy of canonical bizar skill

### Tests

All 200+ tests pass; `npx tsc --noEmit` reports 0 errors in scope.

## v3.19.0 — Obsidian vault + browser-harness agent + Plans→Artifacts rename

## v3.5.4 — 2026-06-19

### Changed
- **Activity page fully overhauled — now a live timeline.** The v3.5.2 graph-of-all-agents view has been replaced with a Gantt-style time-axis timeline:
  - X-axis is time (1m / 5m / 30m / 1h zoom levels); Y-axis is lanes (one per BG instance + tasks assigned greedily)
  - Tasks rendered as bars: pulsing border for `doing`, translucent dashed for `queued`, faded for `done`
  - Vertical red "now" line updates every second and re-anchors when it nears the right edge
  - Live event stream (left column) and detail panel (right column when a bar is clicked) are now proper sibling grid columns — no more absolute-positioned overlays obscuring the canvas
  - Mobile: stream collapses to a toggleable drawer; detail panel slides up from the bottom
  - Polling cadence: `/background` + `/activity` every 3s; now-line redraw every 1s

### Fixed
- **Plans canvas appeared blank when opening a plan.** Root cause: `.plans-canvas-wrap` had no `flex: 1` or `height: 100%`, so its absolutely-positioned `.canvas-root` child had nothing to anchor to and collapsed to toolbar height. Fixed by adding `flex: 1; height: 100%` to `.plans-canvas-wrap`, making `.plan-canvas-wrapper` a proper flex column, and changing `.canvas-root` from `position: absolute; inset: 0` to `position: relative; flex: 1; min-height: 0` so it claims remaining flex space.

### Cleanup
- Removed 121 lines of dead duplicate Activity CSS at `main.css:3499-3619` (the v3.3.2 absolute-positioned block that conflicted with the v3.3.1 flex version at line 4751+). The v3.5.4 rewrite uses entirely new class names (`.tl-*` prefix) so the old `.activity-canvas-*` and `.activity-timeline-*` rules are no longer referenced anywhere.

### Files
- `bizar-dash/src/web/views/Activity.tsx` — full rewrite (761 → 1155 lines)
- `bizar-dash/src/web/styles/main.css` — appended `/* v3.5.4 Activity timeline view */` block (lines 5819-6356); removed dead v3.3.2 Activity block (lines 3499-3619)

## v3.4.0 — 2026-06-19

### Fixed
- **Pervasive theme bug — all colors + shadows now respond to theme change**. Audit of every hardcoded `rgba(...)` in `main.css`. Replaced with theme-aware CSS variables: `--accent-glow`, `--accent-soft`, `--success-soft`, `--error-soft`, `--warning-soft`, `--overlay-bg`, `--shadow-color-strong`. Sidebar text, drop shadows, modal backdrops, status pills, badge borders, focus rings all switch correctly between dark/light.

### Added
- **Config page rewrite — sidebar nav + fully editable Providers/MCPs**: two-column layout with left nav (OpenCode / Providers / MCPs / Diagnostics / Export). Add, edit, delete, toggle for both providers and MCPs through proper modal forms.
- **MCP store — supports new opencode.json format**: handles `command: [...]` array, `type: "remote"` with `url`/`headers`/`oauth`, and the legacy `command: "string"` + `args: [...]` shape.
- **Tasks horizontal kanban**: 4 columns side-by-side with horizontal scroll fallback on narrow viewports.
- **Tasks compact toolbar**: single-row layout with grouped Search / Filter / Sort labels + actions on the right.
- **Activity visual timeline canvas**: new "Timeline" mode (alongside Graph view). X-axis = time, Y-axis = lane per agent. Event kind filter, zoom controls, hover tooltips, click-to-detail.
- **Overview — big no-frame hero**: 48px gradient title, 160px min-height textarea, glow focus ring, quick-action chips.
- **History view (new tab)**: cross-project history with time range filter, per-project expandable timelines, JSON export.
- **New `/api/history` endpoint** with `?since=` + `?limit=` query params.

### Changed
- `about.version` → `3.4.0` in `api.mjs`; `VERSION` → `v3.4.0` in `App.tsx`; diagnostics-store `version` → `3.4.0`.

### Verified
- TypeScript: 0 errors.
- Vite build: success (537 KB JS, 85 KB CSS).
- Existing test suite: 140/140 pass.

## v3.3.0 — 2026-06-19

### Fixed
- **Mods page broken**: Mods view always loaded stale snapshot data. Now fetches fresh from `/api/mods` on mount so newly installed mods appear immediately without a full page refresh.
- **Chat redirect after actions**: "Submit to Odin" modal now calls `preventDefault()`/`stopPropagation()` on the submit handler to prevent a stray click/key-repeat from triggering digit-key tab switches after modal close. App keyboard handler also gates digit shortcuts with a 250ms `safeUntil` window after any click.

### Added
- **Notifications system** (`notifications-store.mjs` + `/api/notifications*`): Per-user append-only notification stream at `~/.config/bizar/notifications.jsonl`. Endpoints: `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `DELETE /notifications/:id`. Task completion and blocking automatically fire notifications. Bell icon component (`Notifications.tsx`) with severity icons, unread badge, mark-read, mark-all, and dismiss.
- **`POST /api/tasks/:id/progress`**: Agents can push `{ progress, step, agent }` updates to paint live progress bars in the Tasks view via WebSocket `task:progress` events.
- **`GET /api/activity/session`**: Activity events scoped to the last hour (or `?since=<iso>`), with a list of agent names that participated in the session. Powers the Activity canvas session-filtering (UI pending).
- **Custom themes API** (`state.mjs` + `/api/themes*`): `GET /api/themes` lists saved themes; `POST /api/themes` saves a named theme; `DELETE /api/themes/:name` removes one. Themes stored at `~/.config/bizar/themes.json`.
- **Skills collapsible categories** (`Skills.tsx`): Category filter buttons above the skills grid. `GET /api/skills?category=foo` filters server-side. Category list loaded from `skillsStore.CATEGORIES`.
- **`POST /api/plans/:slug/questions/:qid/respond`**: Records a user's choice on a canvas question element, marks it resolved, drops a notification for the agent, and broadcasts `plan:change`.
- **Task notifications on completion/block**: `PATCH /api/tasks/:id/status` now fires a `success` notification when status→`done` and a `warning` notification when status→`blocked`.
- **`CrossViewState` type + `crossState` prop** in App shell: Scratch state channel for cross-view handoffs (e.g. "Open in chat" from Agents tab) without URL state.

### Changed
- `about.version` → `3.3.0` in `api.mjs`; `VERSION` → `v3.3.0` in `App.tsx`; diagnostics-store `version` → `3.3.0`.
- `DEFAULT_SETTINGS.theme` gains `animations` and `compactMode` fields.
- `Task` type gains `progress`, `currentStep`, `progressAgent`, `progressHistory` fields surfaced from `metadata`.

### Verified
- TypeScript: 0 errors.
- Build: passes.
- API smoke test: `/api/health`, `/api/notifications`, `/api/projects`, `/api/agents` all return 2xx.
- `cli/plan.test.mjs`: 140 tests, all pass.

## v3.2.2 — 2026-06-19

### Fixed
- **npm install no longer requires allow-scripts approval** for the parent `@polderlabs/bizar` package. Setup now self-bootstraps on first bin invocation.

## v3.2.1 — 2026-06-19

### Added
- **Install prompts**: `npm install -g @polderlabs/bizar` now prompts to install `@polderlabs/bizar-plugin` (required for /bizar in opencode) and `@polderlabs/bizar-dash` (optional web/TUI dashboard). Defaults to yes. Set `BIZAR_SKIP_OPTIONAL_INSTALLS=1` to skip. Non-TTY environments skip prompts automatically.

## v3.2.0 — 2026-06-19

### Fixed
- **Redirect-to-home on click**: digit-key shortcuts (`1`, `2`, …) firing inside any form control / dialog / contenteditable region. Shell's `App.tsx` keyboard handler now bails out on focusable elements (`<input>`, `<textarea>`, `<select>`, `<button>`, `<option>`, `<label>`, `[contenteditable]`) and on targets inside `<form>`, `[role="dialog"]`, `[contenteditable]`, `[data-no-key]`. Also short-circuits when `Shift` is held.
- **`/api/agents/hierarchy` returned 404**. Route was declared *after* `/agents/:name`, so Express matched it as an agent name. Reordered so `/agents/stuck` and `/agents/hierarchy` are mounted before the `:name` catch-all.

### Added
- **Task delegation** (`task-delegator.mjs`): `POST /api/tasks/submit` accepts `{ title, description, priority, tags }` from the Tasks view's "Submit to Odin" modal. Splits into ≤5 subtasks using heuristic keywords (`implement / test / docs / design / research / refactor`), assigns each to the best-fit agent via rule-of-thumb matching, and best-effort dispatches via the plugin CLI to the bg infrastructure.
- **Background agents via tmux** (`background-store.mjs`): `GET /api/background`, `GET /api/background/:id`, `GET /api/background/:id/output?lines=`, `POST /api/background/:id/message`, `DELETE /api/background/:id`. Walks `~/.cache/bizar/bg/`, `~/.config/opencode/bg/`, `~/.bizar/bg/` for instance state files; enriches with live tmux session info.
- **Agent hierarchy**: `GET /api/agents/hierarchy` returns a tree. 13 agents mapped to levels 0–3. New `level` / `parent` / `role` fields on `Agent` type and on every snapshot.
- **Activity canvas + detail panel**: new `src/web/views/Activity.tsx` (690 LoC). Pan/zoom SVG, three node kinds (agent / task / bg) with status-tinted borders, three edge kinds (hierarchy / assignment / subtask), grid background, zoom controls, legend, and a 360px right-side detail panel with meta + (for bg) live output + send/kill + (for all) per-node activity log + comment thread + create-follow-up-task form.
- **Activity log + comments**: `activity-log.mjs` writes a JSONL append-only log at `~/.config/opencode/activity.jsonl` (auto-rotates at 5MB). `GET /api/activity[?nodeId|kind]`, `POST /api/activity`, `POST /api/comments` (node-scoped), `POST /api/nodes/:nodeId/tasks` (creates a task tagged with the node id).
- **`data-task-parent` attribute** on task cards, for cross-references in the canvas / parent relationships in the future.

### Changed
- `api.mjs` — `about.version` → `3.2.0`; all new routes added; route order fixed.
- `App.tsx` — imports + mounts `Activity`; broader digit-key guard; `VERSION` → `v3.2.0`.
- `Topbar.tsx` — adds the Activity tab.
- `types.ts` — `Agent` gains `level` / `parent` / `role`; `Task` gains `subtasks` (string[]) and `metadata` (Record).
- `agents-store.mjs` — `HIERARCHY` map + `buildHierarchyTree(agents)` helper.
- `tasks-store.mjs` — `subtasks` and `metadata` on create; metadata merges on update.
- `diagnostics-store.mjs` — `version` → `3.2.0`.
- `main.css` — +340 lines for `.view-activity` / `.activity-canvas` / `.activity-detail` / zoom controls / legend / per-node panel.

### Verified
- Type-check: 0 errors.
- Build: passes.
- Smoke tests: `/api/health`, `/api/tasks/submit`, `/api/agents/hierarchy`, `/api/background`, `/api/activity`, `/api/agents`, `/api/projects`, `/api/search`, `/api/diagnostics`, `/api/comments` all return 2xx.
- The global install at `~/.local/npm/lib/node_modules/@polderlabs/bizar-dash` was synced in place (no publish).

## v3.1.1 — 2026-06-19

### Fixed
- **Sidebar (and topbar) disappeared on chat/plans/skills tabs.** The "fullscreen" CSS used `position: fixed; inset: 0; z-index: 5` which covered the entire viewport including the sidebar. Now these views fill the content area (`flex: 1`) while the sidebar and topbar stay visible above.

## v3.0.3 — 2026-06-19

### Fixed
- **Sidebar layout broken in `topnav` / `sidebar` / `both` modes.** The CSS at `src/web/styles/main.css:3130-3144` set `.app[data-layout="sidebar"] { display: grid; grid-template-columns: 200px 1fr; }` and tried to hide the topbar `.tabs`, but there was no actual `<aside>` element — the grid created a 200px gap with nothing in it, the topbar tabs were hidden, and the content area was squeezed or overlapped the topbar. Now there's a real `Sidebar` component (`src/web/components/Sidebar.tsx`) that renders when `layout !== 'topnav'`. The shell is now flex-based: `.app` → `.topbar` → `.layout-body` (flex row) → `[<Sidebar />] <main.content>`. The topbar tabs row is conditionally rendered via a new `showTabs` prop (false in sidebar/both modes). Mobile (≤900px) collapses the sidebar to a fixed drawer.
- **Chat composer squished.** The `<textarea className="chat-input">` lived in a single `.chat-composer-row` with the agent selector, model input, attach button, and Send button all competing for horizontal space. The composer is now a proper floating chatbox at the bottom of `.chat-main`: a `.chat-composer-toolbar` row on top (agent + model + attach + keyboard hint) and a `.chat-composer-input` row below (full-width `<textarea>` + square Send button). The textarea auto-grows up to 240px via `useLayoutEffect`.
- **Config "Advanced" section clipping.** Tabs didn't wrap, panels were tiny, at narrow widths things overlapped. Now the section uses a proper collapsible header (chevron + title + description), the tabs wrap (`flex-wrap: wrap`), the body has `min-height: 320px`, and the JSON editor collapses to single column under 1100px. The editor panel was extracted into a `ConfigEditorPanel` component.
- **Comprehensive UI polish.** Consolidated duplicate `.chat-list` / `.chat-composer` / `.chat-input` CSS rules; removed dead `.tabs` rules in favour of `.tabs-row`; added focus rings on chat input/selects/attach button; added smooth 120ms transitions on hover/focus; `.view-chat` and `.view-config` now fill their parent's height so the floating chat layout has space to fill.

### Added
- `src/web/components/Sidebar.tsx` — new vertical nav rail component with proper `role="tablist"` / `role="tab"` semantics, hover/active transitions, ellipsised labels.

### Changed
- `src/web/App.tsx` — restructured with `<div className="layout-body">` wrapping `<Sidebar />` (conditional) + `<main className="content">`. `VERSION` constant bumped to `v3.0.3`.
- `src/web/components/Topbar.tsx` — two-row layout: `.topbar-row` (56px fixed: brand + project selector + search + ws status) + optional `.tabs-row`. New `showTabs?: boolean` prop (default `true`).
- `src/web/views/Chat.tsx` — composer restructured (toolbar + input row, full-width textarea, square send button, auto-grow).
- `src/web/views/Config.tsx` — Advanced section is a proper collapsible card with icon + title + description + chevron. `ConfigEditorPanel` extracted.
- `src/web/styles/main.css` — major pass:
  - Replaced broken 200px grid with proper flex layout (`.layout-body`).
  - Added `.sidebar` / `.sidebar-nav` / `.sidebar-tab` / `.sidebar-tab-active` styles.
  - Added `.topbar-row` / `.tabs-row` for the slim two-row topbar.
  - Added `.chat-composer-toolbar` / `.chat-composer-input` / `.send-btn` / `.attach-btn` / `.toolbar-spacer` / `.hint` for the floating composer.
  - Consolidated `.chat-list` / `.chat-composer` / `.chat-input` definitions (removed legacy v2.6.0 duplicates).
  - Added `.config-advanced` / `.config-advanced-head` / `.config-advanced-body` / `.config-advanced-tabs` / `.config-advanced-panel` for the collapsible advanced section.
  - Chat layout collapses to single column under 1200px.
  - Sidebar collapses to fixed drawer under 900px (mobile).
- `src/server/api.mjs` and `src/server/diagnostics-store.mjs` — version bumped from `3.0.0` to `3.0.3`.
- `src/web/views/Settings.tsx` — fallback `about.version` bumped to `3.0.3`.

### Verified
- `npx tsc --noEmit` — no errors.
- `npm run build` — builds cleanly: 52.7 kB CSS, 437 kB JS.
- Dashboard smoke test (`node src/cli.mjs start` + curl) — HTML 200, assets serve 200, new classes (`sidebar-tab`, `tabs-row`, `chat-composer-toolbar`, `send-btn`, `config-advanced-head-title`) present in bundles.
- Existing test suite (`node --test cli/plan.test.mjs`) — 140/140 pass.

## v3.0.0 — 2026-06-19

Initial release as a separate package.

### Highlights
- Web + TUI dashboard for the Bizar agent platform.
- 10 tabs: Overview, Chat, Agents, Plans, Tasks, Mods, Schedules,
  Config, Settings.
- Floating chat with sessions rail + right info sidebar.
- Mods system: install, enable / disable, view files.
- Schedules view with cron / interval / once support.
- Project selector in the topbar; per-project tasks / plans /
  schedules / sessions.
- Diagnostics card + collapsible Advanced config editor.
- Theme colors + UI layout customization.
- Tailscale serve config in Settings.
- Fuzzy search (⌘/Ctrl+K) across tasks, plans, agents, projects,
  mods, schedules, commands.
- Editable agents (CRUD on `~/.config/opencode/agents/*.md`).
- Tasks: subtasks, dependencies, time tracking, recurring, comments,
  activity log.
- OpenCode providers + MCPs management.
- 100% backwards compatible with v2.7.0's opencode.json format.

### Install
```bash
npm install -g @polderlabs/bizar          # core runtime (peer)
npm install -g @polderlabs/bizar-dash     # this package
```

### Run
```bash
bizar-dash start                # foreground
bizar-dash start --bg           # detached
bizar-dash tui --no-web         # terminal dashboard
bizar-dash stop                 # kill it
bizar-dash status               # port + URL
```
