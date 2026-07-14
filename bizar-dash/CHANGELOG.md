# @polderlabs/bizar-dash — Changelog

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
