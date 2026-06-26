# @polderlabs/bizar-dash — Changelog

## v3.18.0 — Settings tabs work + chat info panel hideable + mod install fix

### Highlights

- **Settings subnav is now a real tab strip** that hides non-matching sections via inline-style `display: none`. The v3.17.0 CSS-attribute-selector approach worked in isolation but a stale scroll-detection useEffect kept resetting the active tab. Now removed. URL hash deep-links (`#settings-theme`) still work.
- **Mod install from registry fixed.** `installFromRegistry` now accepts the `downloadUrl` field directly, plus tries both `mods/<id>/<version>/` and the flat `mods/<id>/` paths as fallbacks. `installFromUrl` also fetches `web/index.html` so mods with self-contained web views round-trip cleanly. The `bizar-mods` registry.json now includes `downloadUrl` pointing at the flat-path on GitHub.
- **Chat info panel (right sidebar) is hideable.** New "Info" button in the chat header toggles the right sidebar (Session info, Agents, Active MCPs, Slash commands). When hidden, a floating "Show info" restore button appears.
- **Version constant fixed.** The header used to show `v3.6.1` regardless of the actual installed version. Now reads `v3.18.0`.

## v3.17.0 — Settings section filter + graphify removed

### Highlights

- **Settings section filter.** v3.16.0's subnav scrolled to sections; v3.17.0 actually filters — clicking a subnav button shows ONLY that section, with a "Showing only X" banner and a one-click escape. URL hash deep-links (`#settings-theme`) still work.
- **graphify removed.** Deleted `src/server/routes/graph.mjs`, `src/web/views/Graph.tsx`, and the Graph tab from TABS + VIEW_MAP. Graph is now provided exclusively by the graphify mod (installable from the registry).
- **`dist/` rebuilt.** This version's UI features (settings filter) are present in the published `dist/` (v3.17.0 fixes the v3.16.0 invisibility regression from v3.16.2).

## v3.16.2 — Rebuild `dist/` so the v3.16.0 UI changes are actually served

> **Critical**: v3.15.0 through v3.16.1 all shipped `src/` changes but the `dist/` build was never regenerated. The dashboard's web UI is served from `dist/` (Vite output), not `src/`. Result: every UI change from v3.15.0 onward (activity log overhaul, settings subnav, chat floating input, mods registry browser, provider auto-detect banner) was invisible in the running dashboard — only the new server-side API routes were live. Fixed by running `vite build` and bumping to v3.16.2.

### Verification

`dist/assets/main-*.css` now contains: `settings-subnav`, `chat-input-floating`, `mods-registry`, `autodetect-banner`, `activity-hidden-banner`, `activity-log-table`. `dist/assets/main-*.js` contains `AutoDetect`, `ActivityLog`, etc.

## v3.16.1 — Hotfix: dashboard crash on `bizar dash start`

> **Critical bug**: `bizar dash start` failed with `The requested module '../state.mjs' does not provide an export named 'state'`. v3.15.0 and v3.16.0 both shipped this regression because `routes/activity.mjs` did `import { state } from '../state.mjs'`. The `state` object is created per-server-instance via `createState()` in `server.mjs:178` and threaded through `api.mjs` as a dependency — it's never a module-level export. Fixed by removing the bogus import and reading `state` from the factory function's argument (matching every other router).

### Files changed (1)

- `src/server/routes/activity.mjs` — removed `import { state } from '../state.mjs'`; uses `{ state }` from the factory parameter; added defensive 503 if state is missing.

## v3.16.0 — UI overhaul: settings subnav, chat floating input, mods registry browser, provider auto-detect

### Highlights

- **Settings subnav** — sticky horizontal nav with 13 sections (Theme, Layout, General, Service, Tailscale, Notifications, Auth, Agents, Dashboard, Background, Updates, Activity, About). Active section auto-highlights on scroll, click-to-scroll smooth-into-view.
- **Chat floating input** — composer wrapped in a glass-style sticky bottom box with accent border on focus and a backdrop-blur background. No UX changes other than positioning.
- **Providers moved into Config** — top-level Providers tab removed (lived in Config already).
- **Mods registry browser** — collapsible card-grid in the Mods tab. Each card shows name, version with upgrade badge, description, author, homepage, permissions, and an Install button that POSTs `{ id }` to `/api/mods`.
- **Provider auto-detect banner** — `Config → Providers` now has an AutoDetectBanner that scans env vars + opencode.json for 9 known providers (Anthropic, OpenAI, Google, Mistral, Groq, Cohere, OpenRouter, DeepSeek, MiniMax), validates key formats, optionally probes `/models` with 1.5s timeout, and lets you add configured providers to opencode.json with one click.
- **`GET /api/providers/auto-detect`** — JSON endpoint mirroring the banner.

### Files changed (8)

- `src/server/providers-store.mjs` — new `KNOWN_PROVIDERS` + `autoDetect({ probe })`.
- `src/server/routes/providers.mjs` — new `/providers/auto-detect` route.
- `src/web/App.tsx` — removed Providers from VIEW_MAP.
- `src/web/components/Topbar.tsx` — removed Providers tab + Cloud icon.
- `src/web/views/Chat.tsx` — `.chat-input-floating` wrapper.
- `src/web/views/Config.tsx` — new `AutoDetectBanner` component.
- `src/web/views/Mods.tsx` — registry browser state + UI.
- `src/web/views/Settings.tsx` — section IDs + subnav.
- `src/web/styles/main.css` — ~7 KB of new CSS.

### Test results

- `tsc --noEmit` passes.
- `bun test tests/mod-security.test.mjs` — 26/26 pass (no regression from v3.15.0).

## v3.15.0 — Activity log overhaul: hide from overview + full log in Settings

### Highlights

- **Hide from overview** — every Recent Activity card now has an X button to hide
  it from the Overview feed. Hiding is **non-destructive**: the entry stays in
  the full activity log, just out of the feed. A persistent "X items hidden"
  banner with a one-click "Show them again" link surfaces the hidden set.
- **Hide all / Show all** — two new buttons in the activity header. "Hide all"
  hides every currently-visible item; "Show all" restores everything.
- **Settings → Activity Log** — a new full-history card in Settings with a
  filter box, "show hidden" toggle, restore-one / restore-all actions, and a
  tabular log (200 rows visible, scroll for more). Backed by
  `~/.cache/bizar/activity-hidden.json` for persistence.
- **New REST surface** — `/api/activity` (full log), `/api/activity/hidden`
  (list), `/api/activity/hide` (POST + DELETE + DELETE/:key).

### Files added (1)

- `src/server/routes/activity.mjs`

### Files changed (4)

- `src/server/api.mjs` — mounts `createActivityRouter({ state })`.
- `src/web/views/Overview.tsx` — per-item hide button + banner + hide-all.
- `src/web/views/Settings.tsx` — new `ActivityLogCard` (filter + restore).
- `src/web/styles/main.css` — `.overview-feed-head-actions`,
  `.activity-hidden-banner`, `.activity-feed-row-main`, `.activity-feed-hide-btn`,
  `.activity-log-toolbar`, `.activity-log-table`, etc.

### Test results

- TypeScript: `tsc --noEmit` passes.
- Mod-security: 26/26 tests still pass (no regression from v3.14.0).

## v3.14.0 — Mod security layer + public mod registry

> **Security + ecosystem:** Mods now run with permission enforcement, integrity verification, and audit logging. New `/api/mods/registry` endpoint fetches the official mod registry from `DrB0rk/bizarre-mods`. Mods repo template + authoring guide added.

### Highlights

- **Mod security layer (`src/server/mod-security.mjs`).** Mods declare permissions in `mod.json`; the loader enforces them at every privileged action:
  - **Filesystem sandboxing** — mods get scoped `readFileSync` / `writeFileSync` helpers. Paths outside `fs:read:<scope>` / `fs:write:<scope>` throw. Scope syntax: exact path, directory with implicit recursion, `/*` suffix, or `~/` home-relative.
  - **Subprocess allowlist** — only whitelisted binaries (`bizar`, `opencode`, `python3`, `git`, `node`, `npm`, `pip`, `uv`, `rtk`, `jq`, `graphify`, `pipx`, `opencode-ai`) can be spawned without an explicit `process:spawn:<bin>` permission. Path-style binaries (`/bin/ls`) require explicit permission.
  - **Integrity hash** — every mod's files are SHA-256-hashed at install time; the hash is stored under `_integrity` in `mod.json`. On every load the hash is recomputed; a mismatch triggers a critical warning and refuses to load the mod's routes until reinstalled.
  - **Audit log** — every privileged action is logged as JSON lines to `~/.cache/bizar/logs/mod-audit.log` with timestamp, mod id, mod version, action, and details. Inspect via `GET /api/mods/audit?mod=<id>&limit=200`.
- **Public mod registry.** New `bizarre-mods` repo at `DrB0rk/bizarre-mods` is the canonical source of mods. `GET /api/mods/registry` fetches `registry.json` and annotates each entry with installed state and upgrade hints. `POST /api/mods { id }` installs from the registry.
- **Mods repo template.** New `templates/mod-template/` shows the canonical mod structure with `mod.json`, `route.mjs`, and `views/registry.json` examples.
- **Authoring guide.** New `docs/MOD-AUTHORING.md` covers permissions, route file shape, view registration, frontend-component caveats, and the PR submission checklist.

### Files added (3)

- `bizar-dash/src/server/mod-security.mjs` — permission parsing, fs sandbox, subprocess allowlist, integrity hash, audit writer.
- `bizar-dash/tests/mod-security.test.mjs` — 26 tests covering parsing, sandbox, allowlist, hashing, integrity verification, context creation.

### Files changed (3)

- `bizar-dash/src/server/mods-loader.mjs` — wires the security context into `loadModRouters`, computes and stores the integrity hash in `installFromPath`, exposes `installFromRegistry` and `fetchRegistry`. Mods whose integrity hash mismatches are refused at load time with a critical warning.
- `bizar-dash/src/server/routes/mods.mjs` — adds `GET /api/mods/registry`, `GET /api/mods/audit`, and a registry-aware install path on `POST /api/mods` (accepts `{ id }` OR `{ path }`).
- `bizar-dash/src/server/cli.mjs` — reordered `start` vs `--bg`/`--detach` dispatch (fixes `bizar dash start --bg` actually backgrounding).

### Companion repo (separate git repo)

- `bizarre-mods/` — `DrB0rk/bizarre-mods`. Contains `registry.json` listing available mods, `mods/graphify/` (the extracted graphify mod), `templates/mod-template/` (starter), and `docs/MOD-AUTHORING.md` (full guide). Configured as the default registry URL in `mods-loader.mjs:DEFAULT_REGISTRY_URL`.

### Test results

- New: 26 mod-security tests pass.
- Total: 282 plugin tests + 19 dashboard smoke tests still pass.
- TypeScript typecheck clean.

### v1 limitations (transparent)

A malicious mod could still bypass the sandbox by importing `node:fs` / `node:child_process` directly. v2 will close this gap with a `vm`-based sandbox or worker-thread isolation. Until then, the security layer makes the mod's *intent* explicit (declared permissions, audit trail, integrity hash) so users can review what they're installing and detect tampering.

## v3.13.0 — 2026-06-25

### Highlights

- **Knowledge-graph view (Graph tab).** New top-bar entry "Graph" with Network icon. Embeds the project's `.bizar/graph/graph.html` (graphify's interactive vis-network visualization) via an iframe. Shows live node/edge/community counts in the header; has a "Build / Rebuild" button that runs `bizar graph build` detached via the new `/api/graph/build` endpoint and polls `/api/graph/build/:jobId/status` until done. The button works offline — no LLM key required, falls through to the AST-cache path that ships with `@polderlabs/bizar` v3.15.0+.

- **`bizar dash start --bg` now actually backgrounds.** Previously the CLI dispatch checked `args.includes('--bg')` AFTER the `args[0] === 'start'` branch, so `bizar dash start --bg` always fell through to the foreground `startDashboard` and blocked. v3.13.0 checks `--bg` inside the `start` branch first and uses `startDashboard({ bg: true })` which returns after writing the PID/PORT files instead of blocking on a signal handler. The launching shell gets immediate control back; the dashboard keeps running in the spawned node process. Same fix for `--detach`.

### Files added (6)

- `bizar-dash/src/server/routes/graph.mjs` — `GET /status`, `GET /html`, `GET /report`, `POST /build`, `GET /build/:jobId/status`. Resolves `.bizar/graph/` from the active project (via `projectsStore.active()`), not from a request-controlled path.
- `bizar-dash/src/web/views/Graph.tsx` — view with stats header, "Build / Rebuild" button, build-poll loop, empty state for projects without a graph yet, and iframe-based rendering of `graph.html` via `/api/graph/html`.

### Files changed (4)

- `bizar-dash/src/server/api.mjs` — wires `createGraphRouter` into the v1 router.
- `bizar-dash/src/web/App.tsx` — adds `graph: Graph` to VIEW_MAP.
- `bizar-dash/src/web/components/Topbar.tsx` — adds `Graph` to TABS (Network icon, between `background` and `skills`).
- `bizar-dash/src/web/styles/main.css` — `.graph-building-banner`, `.graph-iframe-wrap`, `.graph-iframe`, `.graph-meta`, `.graph-empty-actions` (~60 lines).
- `bizar-dash/src/cli.mjs` — reordered `start` vs `--bg`/`--detach` dispatch; `startDashboard` accepts `bg` option and returns without blocking when set; added `detachAfterBoot()`.

### Compatibility

- Same wire format as v3.12.x — all existing endpoints unchanged.
- Requires `@polderlabs/bizar` v3.15.0+ for the `bizar graph build` CLI invoked by the Build button (older versions still work but don't have the offline cache fallback).

## v3.11.0 — 2026-06-23

### Added
- **Interactive file browser in the Add Project dialog.** New `GET /api/fs?path=<absolute>` endpoint returns a structured listing (`{ path, parent, entries[] }`) for the file picker. Server-side allow-list enforces `os.homedir()` + the configured `dashboard.projectsDirectory`; first-level dotdirs under home (`.ssh`, `.aws`, …) are blocked as roots and silently filtered from listings. All filesystem errors map to structured JSON (`not_found` / `permission_denied` / `not_a_directory` / `forbidden`).
- **New setting: `dashboard.projectsDirectory`** (string, default `''`). When set, the server will scan it for project roots on startup and the `POST /api/projects/scan` endpoint will rescan on demand. Detection: a directory counts as a project if it contains any of `.git/`, `.bizar/`, `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, `pom.xml`, `build.gradle`, `build.gradle.kts`. One-level scan only — won't recurse into detected projects.
- **`projectsStore.scanDirectory(rootDir)`** — public method that walks one level deep, stats each marker per child (catching per-file errors), and adds detected projects via the existing `add()` path. Idempotent. Returns `{ added, skipped, scanned, error? }`.
- **`POST /api/projects/scan`** — validates that the configured `projectsDirectory` lives under home (rejects with `forbidden` otherwise), runs `scanDirectory()`, and broadcasts a `project:change` event with `kind: 'added'` for each newly registered project so connected clients refresh immediately.

### Files
- `bizar-dash/src/server/routes/fs.mjs` — **new** — `createFsRouter({ state })` factory; `GET /api/fs` handler.
- `bizar-dash/src/server/lib/path-safe.mjs` — **new** — `resolveSafePath`, `defaultAllowedRoots`, `isDotRoot` helpers shared between `fs.mjs` and the scan route.
- `bizar-dash/src/server/routes/_shared.mjs` — `DEFAULT_SETTINGS.dashboard` gains `projectsDirectory: ''` (default value is empty so existing installs see no change).
- `bizar-dash/src/server/routes/projects.mjs` — adds `POST /api/projects/scan`.
- `bizar-dash/src/server/projects-store.mjs` — adds `PROJECT_ROOT_MARKERS` const + `scanDirectory(rootDir, { maxDepth })` method; adds `node:fs/promises` import.
- `bizar-dash/src/server/api.mjs` — mounts `createFsRouter` immediately after the projects router.
- `bizar-dash/src/server/server.mjs` — fires a one-shot `scanDirectory()` on startup when the setting is set; logs added/skipped/scanned counts; never blocks boot.

### Verified
- `node --check` passes for every modified/new server file.
- TypeScript (no server-side changes affect frontend types).

### Security hardening

- Added `dashboard.allowedRoots: string[]` setting — operators can
  declare additional filesystem roots (e.g., `/workspace`,
  `/srv/projects`) beyond `os.homedir()` for the file browser and
  project scanner. Each entry must itself be inside home; entries
  that escape are silently dropped server-side.
- Added `POST /api/fs/mkdir` to allow creating project directories
  from the file browser. Parent must be in the allow-list; name is
  validated against a denylist of unsafe characters; returns 409 if
  the entry already exists.
- `GET /api/fs` now caps responses at 500 entries and reports a
  `truncated` flag plus `totalEntries` so huge directories
  (`node_modules`, Go module cache) don't OOM the browser.
- `PUT /api/settings` now validates `dashboard.projectsDirectory`
  and `dashboard.allowedRoots` server-side, rejecting unsafe values
  with a structured 400 instead of writing them to disk.
- **Frontend:** live warnings on the `allowedRoots` textarea mirror the server's validation; pre-flight path check in the Add Project dialog prevents 404s on stale selections.

### Background agent dispatch fix

- Fixed root cause: `pingOpencodeServe` was returning false for a
  live opencode serve instance because (a) it pings an HTTP
  endpoint that requires Basic auth and any auth-quirk (stale
  password file, version mismatch, wrong realm) made the probe
  fail with 401 even though the opencode process was perfectly
  healthy and answering other requests, AND (b) `readServeInfo`
  had a strict 6-field schema that returned `null` when the
  on-disk `serve.json` only contained `{password, pid, port}` —
  which is what the current plugin build actually writes. The
  null then cascaded into `dispatchToBackground` short-circuiting
  on the `if (serveInfo && serveReachable)` guard at
  `task-delegator.mjs:563`, marking every new bg instance as
  `dispatchPending: true` and never creating a tmux session.
  Now uses a TCP-connect port-open check via
  `net.createConnection` (so the probe does not depend on HTTP
  auth or endpoint shape) and the read schema derives `baseUrl`
  from `port` when missing, with `worktree`/`startedAt`
  defaulting to empty/`0` rather than failing the read.
- Fixed path-concatenation fragility for the bg `worktree`
  fallback: `task-delegator.mjs` now uses `projectRoot` as a
  fallback for the opencode serve's `?directory=` query param
  when serve-info omits `worktree`, so spawns succeed even on
  installs where the plugin has not yet written a full serve.json.
- Added `lib/path-safe.mjs` helpers (`deriveAbsoluteBgLogPath`,
  `isBrokenBgLogPath`) that always produce an absolute path
  (falling back to `~/.cache/bizar/logs/<id>.log`) and detect the
  `//.opencode/log/...` shape produced when an older plugin build
  concatenated an empty `worktree` to the logPath.
- Added a periodic retry loop (`bg-retry.mjs`, every 30s, started
  by `server.mjs` on boot) that re-runs dispatch for any bg
  instance stuck in `dispatchPending: true` with
  `toolCallCount === 0` for more than 30 seconds. Caps each
  instance at 10 retries before marking it as `failed` with
  `error: "exceeded max dispatch retries"`. Repairs broken
  logPath values atomically before re-dispatching.
- Added `POST /api/background/:id/retry` for manual unstick —
  resets `retryCount: 0`, `dispatchPending: true`, and calls
  `retryDispatchOnce` immediately without waiting for the next
  periodic tick.

### Files
- `bizar-dash/src/server/routes/_shared.mjs` — `DEFAULT_SETTINGS.dashboard` gains `allowedRoots: []`; new `validateDashboardSettings()` + `writeSettings()` now validates before persisting.
- `bizar-dash/src/server/lib/path-safe.mjs` — new `buildAllowedRootsFromSettings({ settings, home })` helper.
- `bizar-dash/src/server/routes/fs.mjs` — `POST /api/fs/mkdir`; `GET /api/fs` now caps at 500 entries and reports `truncated` / `totalEntries`; switched to the new `buildAllowedRootsFromSettings` helper.
- `bizar-dash/src/server/routes/projects.mjs` — `POST /api/projects/scan` uses the expanded allow-list.
- `bizar-dash/src/server/server.mjs` — startup scan rebuilds and logs the allow-list, re-validates the configured `projectsDirectory`.

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
