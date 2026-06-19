# @polderlabs/bizar-dash — Changelog

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
