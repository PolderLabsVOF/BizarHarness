# Changelog

## v3.1.0 — 2026-06-19

### Added
- **Chat takes full viewport** — the chat tab is now edge-to-edge, flush against the viewport with no padding, max-width, or container borders. The header stays at the top but the sessions rail, message list, composer, and info sidebar all flow into the full window. CSS hook: `data-active-tab="chat"` on `.app` switches off the `.content` padding/max-width, and the Chat view root uses `.view-chat-fullscreen` (`position: fixed; inset: 0; z-index: 5`).
- **Plans canvas — full editor + floating controls**. Selecting a plan now opens a fullscreen canvas (similar to Chat) with a floating control bar at the top: `[< Back]  Plan: <title> [<status>]  [Element] [💬 Comment] [⚙ Configure] [⤢ Full] [🗑 Delete]`. Element types: `task`, `note`, `decision`, `question` (color-coded: blue / gray / purple / amber). Element cards can be moved by dragging, edited inline (double-click), right-click deleted, and connected via a context menu. Connections are drawn as labeled SVG lines with arrows. Pan with drag-empty, zoom with scroll, "Fit to view" button. Side panel for comments per element or canvas-level; "Add comment" composer at the bottom of the panel. Plan configuration modal: title, description (markdown), tags (comma-separated), status, default element type, template. Bulk position updates via `PUT /api/plans/:slug/position` for smooth drag-end.
- **Agents → tasks real-time tracking**. `agentsStore.updateStatus(name, status, currentTaskId?)` records `idle / working / error / stuck` plus `lastSeen`, `currentTaskStartedAt`, `heartbeat`, `lastError`, `lastTask`, and a running success-rate tally. Task changes broadcast `agent:status` over WebSocket; the Agents page reflects the active agent on the card with a pulsing `is-working` border, "Working on <taskId>" row, last-task row, and success-rate row. Tasks detail modal exposes "Mark as worked on by @<agent>" with Start/Complete/Stop.
- **Tasks — archive, bulk actions, filters, sort, recurring, comments**. New columns: `Blocked` (in addition to Queued/Doing/Done). New `archived` field on Task. New endpoints: `POST /api/tasks/:id/archive` and `/unarchive`, `POST /api/tasks/bulk` (actions: archive, unarchive, delete, move, priority, assign, tag), `POST /api/tasks/:id/timer/start` and `/timer/stop`. The Tasks view now supports: search, assignee filter, priority filter, tag filter, sort (priority / due / created / updated), "Show archived" toggle, bulk action bar with select-all, recurring field (daily / weekly / monthly / custom cron) on the edit modal, comment thread in the detail modal, due date, pulse animation on running timers.
- **Agents — tags + categories**. Each agent frontmatter now has `tags: [reasoning, code, planning]` and `category: reasoning` (one of: reasoning / code / design / planning / gitops / analysis). Agents page shows category badge, tag chips, and a category filter dropdown. New / Edit modal has Tags input and Category dropdown. `PUT /api/agents/:name` now accepts both fields.
- **New Skills page**. New view `src/web/views/Skills.tsx` with two sections — Installed (from `~/.config/opencode/skills/`, `.agents/skills/`, `agent/skills/`, and the global install) and Browse (search box wired to the `skills` CLI or a local fallback index). Each skill has: name, description, source, version, status (enabled/disabled), category, install command. New backend `src/server/skills-store.mjs` + routes: `GET /api/skills`, `GET /api/skills/search?q=…`, `POST /api/skills/install`, `POST /api/skills/:id/disable`, `POST /api/skills/:id/enable`. New "Skills" tab in the topbar with a `Sparkles` icon. Categories: All, Programming Languages, Frameworks, Tools, Testing, Design, Reasoning, Planning, GitOps, Docs.
- **Stuck agent detection + auto-restart**. The agents store now computes `isStuck` for any agent that has been `working` for more than 10 minutes (configurable) or has been in `error` for more than 10 minutes. New endpoints: `POST /api/agents/:name/restart` (resets runtime state, marks idle, clears current task), `GET /api/agents/stuck` (returns the list). New dashboard banner at the top of the app: "X agents are stuck: <names>" with a Review button that jumps to the Agents page. New WS event `agent:stuck` for real-time updates. Restart is currently a "reset to idle" — actual process restart is documented as v3.2.

### Fixed
- **Dashboard `GET /api/schedules` was broken** — handler was declared with `(_req, res)` but referenced `req`, returning `{ error: 'internal_error', message: 'req is not defined' }`. Now uses `req` correctly.

### Changed
- **App.tsx** — added `data-active-tab` attribute on `.app` for CSS hooks. Added a stuck-agents banner component above `.layout-body`. Periodic 30-second poll of `/api/agents/stuck` with toast notification when agents go from "0 stuck" to ">0 stuck". WebSocket handlers for `agent:status`, `agent:restarted`, `agent:stuck`, and `plan:change`.
- **agents-store.mjs** — added `updateStatus`, `heartbeat`, `recordTaskResult`, `restart`, `stuck`, and a `isStuck` helper. `tags` and `category` parsed from frontmatter (array syntax `[a, b, c]` and bare string). The store now persists runtime status to `~/.config/bizar/agent-status.json` so it survives restarts.
- **tasks-store.mjs** — added `startTimer`, `stopTimer`, `archive`, `unarchive`, `bulk`, `setWorkedBy`, `spawnNextRecurrence`, plus a 3-arg `loadTasks(projectId, { includeArchived, onlyArchived })`. New `archived`, `workedBy`, `dueDate` fields. Status set now includes `blocked` and `archived`. Marking a recurring task done auto-creates the next occurrence and records `lastGenerated` on the original.
- **plans-store.mjs** — new file. Full plan CRUD + canvas operations: create / update meta / delete / getCanvas / saveCanvas / addElement / updateElement / deleteElement / updatePositions / addConnection / deleteConnection / addComment / deleteComment. Auto-migrates v1 mdx plans to the v2 canvas on first read. Sanitizes all incoming JSON to drop junk and enforce types.
- **skills-store.mjs** — new file. Wraps the `skills` CLI (installed via `npm i -g skills`) and falls back to a local mock catalog when the CLI is missing.
- **api.mjs** — added routes: `POST /api/agents/:name/status|heartbeat|restart`, `GET /api/agents/stuck`, `POST /api/tasks/:id/work|archive|unarchive|timer/start|timer/stop`, `POST /api/tasks/bulk`, `PATCH /api/tasks/:id/status` (now accepts `blocked` and `archived`), `POST /api/plans`, `PUT /api/plans/:slug`, `DELETE /api/plans/:slug`, `GET /api/plans/:slug/canvas`, `PUT /api/plans/:slug/canvas`, `POST/PUT/DELETE /api/plans/:slug/elements[/:id]`, `PUT /api/plans/:slug/position`, `POST/DELETE /api/plans/:slug/connections[/:id]`, `POST/DELETE /api/plans/:slug/(elements/:id/)?comments[/:cid]`, `GET /api/skills`, `GET /api/skills/search`, `POST /api/skills/install`, `POST /api/skills/:id/(enable|disable)`.
- **types.ts** — extended `Agent` with `tags`, `category`, `status`, `currentTaskId`, `lastSeen`, etc.; extended `Task` with `archived`, `workedBy`, `dueDate`, `blocked`; extended `CanvasElement` with optional `status`; extended `CanvasConnection` with optional `label`; extended `WsMessage` with `agent:status`, `agent:restarted`, `agent:stuck`, `plan:change`.
- **Plans.tsx** — completely rewritten. List view shows a 2-column grid of plan cards (with status badge, element/comment counts, edit time). Selecting a plan opens a fullscreen editor (`.view-plans-fullscreen`) with a floating control bar (`PlanEditorHeader`) and a `<CanvasViewport>` that handles pan/zoom, drag, double-click-to-edit, right-click-to-delete, SVG connections with labels, and a `<CommentsPanel>` for the selected element or the whole canvas. Add Element / Add Comment / Configure modals. `+ Element` modal supports type, title, content; `Configure` modal supports title, description, tags, status.
- **Tasks.tsx** — completely rewritten. New columns (Queued / Doing / Blocked / Done), status badges, sort + filter toolbar (assignee, priority, tag, sort by priority/due/created/updated, "Archived" toggle). Bulk action bar (select all, move, change priority, archive, delete). Card-level: archive button, comments badge, recurring badge, working-by-agent badge, due date. Detail modal has Mark as Worked On By, Start/Stop timer (live updated), Dependencies, Recurring, Comments, Activity.
- **Agents.tsx** — completely rewritten. Status dot, category badge, tag chips, activity row (Working on / Last task / Success rate), Restart button, expanded panel with status-set buttons. Tags filter row above the grid. Category dropdown. New / Edit modal has Tags + Category fields.
- **Skills.tsx** — new view. Skills list (category filter at top), search results, skill cards with name, source, version, tags, enable/disable/install actions. Per-skill detail modal.
- **Topbar.tsx** — added "Skills" tab (icon: `Sparkles`).
- **Button.tsx** — added `'success'` variant.
- **CSS** — new rules: `.view-chat-fullscreen`, `.view-plans-fullscreen`, `.view-skills-fullscreen`, `.stuck-banner`, `.task-bulk-bar`, `.agent-card-*`, `.plan-card`, `.plans-editor-bar`, `.plans-body`, `.plans-comments-panel`, `.canvas-element-*`, `.canvas-toolbar`, `.skill-card`, `.skills-categories`, `.is-working` / `.is-stuck` pulse animations. Reorganized so all the new v3.1.0 styles are grouped after the existing v3.0.0 sections.

### Notes
- The global install at `~/.local/npm/lib/node_modules/@polderlabs/bizar-dash` was synced in place (no publish).
- Real agent process restart is documented as v3.2. v3.1.0's "Restart" resets runtime state, it does not kill the opencode process.

## v3.0.4 — 2026-06-19

### Fixed
- **Auto-detect current directory as a project** on dashboard startup. The user's cwd is now registered in the projects registry if not already present, and set as active if no active project exists.
- **Chat sessions UX**: prominent "New session" button, better empty states ("Pick a project in Overview" when no project, "Create your first session" when no sessions).
- **Search now includes settings**: type `theme`, `accent`, `layout`, etc. to find settings. Settings results link to the Settings view and scroll/highlight the relevant setting.

### Changed
- Comprehensive UI consistency pass: spacing, focus rings, hover states, transitions, empty states, loading states.
- Settings rows tagged with `data-setting-id` so search can scroll to them.

## v3.0.3 — 2026-06-19

### Fixed
- **Dashboard — sidebar layout was completely broken in `topnav` / `sidebar` / `both` modes.** The previous CSS at `src/web/styles/main.css:3130-3144` set `.app[data-layout="sidebar"] { display: grid; grid-template-columns: 200px 1fr; }` and tried to hide the topbar `.tabs`, but there was no actual `<aside>` element — so the grid created a 200px gap with nothing in it, the topbar tabs were hidden (creating dead space), and the content area got squeezed or overlapped the topbar. Now there's a real `Sidebar` component (`src/web/components/Sidebar.tsx`) that renders when `layout !== 'topnav'`, and the topbar tabs row is conditionally rendered via a new `showTabs` prop (false in sidebar/both modes). The shell is now flex-based: `.app` → `.topbar` → `.layout-body` (flex row) → `[<Sidebar />] <main.content>`. Mobile (≤900px) collapses the sidebar to a fixed drawer.
- **Dashboard — chat composer was squished.** The `<textarea className="chat-input">` lived in a single `.chat-composer-row` that also held the agent selector, model input, attach button, and Send button — every item competed for horizontal space and the textarea was squeezed into a corner. The composer is now a proper floating chatbox at the bottom of `.chat-main`: a `.chat-composer-toolbar` row on top (agent select + model input + attach button + keyboard hint) and a `.chat-composer-input` row below (full-width `<textarea>` + square Send button). The textarea auto-grows up to 240px via `useLayoutEffect` and clamps with internal scroll.
- **Dashboard — Config page "Advanced" section was clipping/cramped.** The tabs (`OpenCode config · Providers · MCPs · Debug log`) didn't wrap, panels were tiny, and at narrow widths things overlapped. Now the section uses a proper collapsible header (chevron + title + description), the tabs wrap (`flex-wrap: wrap`), the body has `min-height: 320px`, and the JSON editor collapses to single column under 1100px. The editor panel was extracted into a `ConfigEditorPanel` component for cleaner structure.
- **Dashboard — comprehensive UI polish.** Consolidated duplicate `.chat-list` / `.chat-composer` / `.chat-input` CSS rules (legacy v2.6.0 block conflicted with the v3 floating-chat block); removed dead `.tabs` rules in favour of the new `.tabs-row` rendered by `Topbar.tsx`; added focus rings (`outline: 2px solid var(--accent)`) on the chat input, agent/model selects, and attach button; added smooth `120ms` transitions on hover/focus for color, background, and border; standardized the `.view` container to fill its parent's height (so the floating chat layout has space to fill).

### Changed
- `src/web/App.tsx` — restructured: `<div className="layout-body">` wraps `<Sidebar />` (conditional) + `<main className="content">`. `VERSION` constant bumped to `v3.0.3`.
- `src/web/components/Topbar.tsx` — refactored to use a two-row layout: `.topbar-row` (brand + project selector + search + ws status, fixed 56px) + optional `.tabs-row` (when `showTabs` is true). New `showTabs?: boolean` prop (default `true`).
- `src/web/components/Sidebar.tsx` — **new file**. Renders the vertical nav rail: `<aside className="sidebar">` with `<nav className="sidebar-nav">` and one `button.sidebar-tab` per tab. Includes active-state styling, hover transitions, and proper `role="tablist"` / `role="tab"` for a11y.
- `src/web/views/Chat.tsx` — composer restructured (toolbar + input row, full-width textarea, square send button, auto-grow). Removed unused `CornerDownLeft` and `FileText` imports. `Wrench` icon now unused (cleanup). Attachment remove uses `<X size={10} />` icon instead of `×` literal.
- `src/web/views/Config.tsx` — Advanced section is now a proper collapsible card with icon + title + description + chevron. `ConfigEditorPanel` extracted. Tabs are real `role="tab"` buttons. Imported `Sliders` icon.
- `src/web/styles/main.css` — major pass:
  - Layout shell: replaced broken 200px grid (`app[data-layout="sidebar"] { grid-template-columns: 200px 1fr }`) with proper flex layout (`.layout-body` is `display: flex` with `flex: 1`).
  - New `.sidebar` / `.sidebar-nav` / `.sidebar-tab` / `.sidebar-tab-active` styles.
  - New `.topbar-row` / `.tabs-row` for the slim two-row topbar.
  - New `.chat-composer-toolbar` / `.chat-composer-input` / `.send-btn` / `.attach-btn` / `.toolbar-spacer` / `.hint` for the floating composer.
  - Replaced dual `.chat-list` / `.chat-composer` / `.chat-input` definitions with single consolidated rules.
  - `.config-advanced` / `.config-advanced-head` / `.config-advanced-body` / `.config-advanced-tabs` / `.config-advanced-panel` for the collapsible advanced section.
  - `.view-chat` and `.view-config` now have `height: 100%; min-height: 0` so the floating chat layout fills the available space.
  - Chat layout collapses to single column under 1200px (sessions + info panels hide).
  - Sidebar collapses to fixed drawer under 900px (mobile).
- `src/server/api.mjs` and `src/server/diagnostics-store.mjs` — version bumped from `3.0.0` to `3.0.3` in the default settings + diagnostics responses.
- `src/web/views/Settings.tsx` — fallback `about.version` bumped from `3.0.0` to `3.0.3`.

### Verified
- `npx tsc --noEmit` — no errors.
- `npm run build` — builds cleanly: 52.7 kB CSS (gzip 9.4 kB), 437 kB JS (gzip 129 kB).
- Dashboard smoke test (`node src/cli.mjs start` + curl) — serves HTML 200, JS+CSS assets serve 200, new classes (`sidebar-tab`, `tabs-row`, `chat-composer-toolbar`, `send-btn`, `config-advanced-head-title`) present in the bundles.
- Existing test suite (`node --test cli/plan.test.mjs`) — 140/140 pass.

## v3.0.2 — 2026-06-19

### Fixed
- **Documentation: removed incorrect "build the dashboard" instructions.** The `@polderlabs/bizar-dash` package ships a prebuilt `dist/` and does not require a build step on install. Updated README, server fallback page, and GitHub release notes.
- **`bizar-dash` server fallback page**: improved error message when `dist/index.html` is missing — points users at `npm install -g @polderlabs/bizar-dash --force` instead of telling them to run `npm run build` (which requires dev dependencies not installed for global users).

## v3.0.1 — 2026-06-19

### Fixed
- Removed spurious `@polderlabs/bizar-dash` self-reference from `bizar-dash/package.json#peerDependenciesMeta`. The package was referring to itself as an optional peer, which is invalid. Only `@polderlabs/bizar` should be there.

## v3.0.0 — 2026-06-19

### BREAKING — Package split
- **The dashboard is now a separate npm package: `@polderlabs/bizar-dash`**.
  - `@polderlabs/bizar` (this package) is the core runtime — CLI,
    installer, audit, init, export, plan, update, **service**, and the
    dashboard-launcher that delegates to `@polderlabs/bizar-dash`.
  - `@polderlabs/bizar-dash` is the optional web + TUI dashboard. It
    ships its own `bizar-dash` bin that mirrors the previous
    `bizar dashboard` / `bizar --web*` commands.
  - The peer dependency is **optional** — `bizar` continues to work
    without the dashboard, and prints an install hint when you try to
    launch the web UI.
  - The dashboard now lives at `<repo>/bizar-dash/`. The root `src/`,
    `dist/`, `cli/dashboard*` files are removed.

### Added — Mods system
- **Mods are now a first-class concept** in the Bizar platform.
- Storage: `~/.config/bizar/mods/<mod-id>/`. Each mod is a folder
  with a `mod.json` manifest.
- Manifest schema: `id`, `name`, `version`, `author`, `description`,
  `bizar` (compat), `type` (`agent` / `command` / `view` / `route` /
  `tui` / `full`), `enabled`, `permissions[]`, `entry{}`.
- Folder layout: `agents/`, `commands/`, `routes/`, `views/`,
  `web/`, `tui/`, `hooks/`.
- Mod loader scans the mods dir on dashboard start. Custom agents
  appear in the Agents view; custom commands appear in the chat
  slash-command helper.
- New Mods view in the dashboard — list, install, enable / disable,
  uninstall, view file tree + manifest.
- REST surface: `GET /api/mods`, `POST /api/mods` (install from path),
  `PUT /api/mods/:id` (toggle enabled), `DELETE /api/mods/:id`,
  `GET/PUT /api/mods/:id/files/*`.
- **Sample mod**: `bizar-dash/templates/mod/hello-mod/` ships a
  working example (greeter agent + `/hello` command + sample
  route + sample view).

### Added — Project selector + per-project data
- **All dashboard data is now project-scoped**, except the dashboard
  view itself (which is the project picker).
- Project registry: `~/.config/opencode/projects.json` with
  `projects[]` and `active` id.
- Per-project data: `~/.config/opencode/projects/<id>/` containing
  `tasks.json`, `plans.json` (future), `schedules.json`, `state.json`,
  `sessions/`, `activity.log`.
- Project id is the path basename (e.g. `/home/user/myapp` → `myapp`).
- Topbar project selector: dropdown of all known projects with
  current active highlighted, `+` to add current cwd, refresh button.
- Overview view: card grid of all projects, with status
  (active / inactive / error), last-accessed time, task counts
  (queued / doing / done), and recent activity.
- REST surface: `GET /api/projects`, `POST /api/projects`,
  `POST /api/projects/:id/activate`, `DELETE /api/projects/:id`,
  `GET /api/projects/active/{tasks,schedules,mods,state}`.
- WebSocket broadcasts `project:change` so the dashboard re-fetches
  on activation.

### Added — Background service daemon + scheduled tasks
- **`bizar service`** manages a long-running background daemon.
  - `bizar service start` — spawn detached.
  - `bizar service stop` — kill via PID file.
  - `bizar service status` — running / stopped.
  - `bizar service logs` — tail `~/.config/bizar/service.log`.
- The service:
  - Watches per-project schedules and fires them at the right time.
  - Ticks every 5 seconds; idle when no schedules are due.
  - Writes PID to `~/.config/bizar/service.pid`.
  - Logs every tick + every run to `~/.config/bizar/service.log`.
- Schedule types: `interval` ("30m", "2h", "1d"), `cron`
  ("0 9 * * *"), and `once` (ISO timestamp).
- Schedule action types: `command` (spawn shell), `agent` (deferred
  to v3.1+), `webhook` (POST JSON).
- Schedules view: list, create, edit, delete, **Run now**, view
  history of past runs (last 50).
- REST surface: full CRUD on `/api/schedules` plus
  `POST /api/schedules/:id/run` for immediate execution.
- New schedule cron parser supports `*`, `*/N`, integers, lists, and
  ranges.

### Added — Floating chat with right info sidebar
- The chat view was squished in v2.7.0; v3.0.0 fixes that.
- Layout: `Sessions` rail (left, ~200px) + `Messages` (centre, full
  height) + `Info sidebar` (right, ~280px).
- Floating chatbox anchored to the bottom of the chat column,
  ~80 px tall, with: textarea, **agent selector**, **model override**,
  **attach files** button, Send button (Enter or ⌘/Ctrl+Enter).
- Slash-command autocomplete appears above the input as you type
  `/` — includes built-in commands **and** mod-supplied commands.
- Right sidebar shows: active session info (id, message count,
  pinned count, current agent + model), agents in the project, active
  MCPs with on/off status, recent slash commands, project
  references.
- Per-message actions: copy, regenerate, pin, delete.
- Pin messages to keep them at the top of the session.

### Added — Config editor (Advanced section) + Diagnostics
- Config view now lives behind a collapsible **Advanced** section
  (default collapsed). The Diagnostics card is always visible above
  it.
- Diagnostics card shows: version, uptime, node version, platform,
  heap + RSS memory, service running state with PID, active project,
  counts (agents / projects / mods / schedules / tasks / providers /
  mcps), and the **last 10 errors** from the service log.
- "Run diagnostics" and "Download diagnostics bundle" buttons
  generate a JSON snapshot for support.
- Advanced section has 4 sub-tabs:
  - **OpenCode config** — JSON tree + raw editor + diff (kept from
    v2.x, polished).
  - **Providers** — add / remove AI providers (name, base URL, API
    key — masked, models list).
  - **MCPs** — add / remove MCP servers (command, args, env).
  - **Debug log** — recent log entries.
- All sub-sections write to `~/.config/opencode/opencode.json` under
  the `provider` and `mcp` keys.
- REST surface: full CRUD on `/api/config/providers` and
  `/api/config/mcps`.

### Added — Theme colors + Theme settings
- Settings schema now includes a rich `theme` block:
  - `mode`: `dark` / `light` / `system` (kept from v2.x).
  - `accent`, `success`, `warning`, `error`, `info`: hex colors.
  - `fontFamily`: dropdown (Inter, system-ui, Segoe UI, Roboto, JetBrains Mono, …).
  - `fontSize`: 12–20 px slider.
  - `compactMode`: denser UI.
  - `animations`: enable / disable motion.
- Live preview: the moment you tweak a color picker, the entire
  dashboard updates via CSS custom properties on `<html>`.
- "Reset to defaults" button on the settings page.
- Settings card in the new UI: Theme, **UI layout** (topnav /
  sidebar / both), default tab, status bar toggle.

### Added — UI customization
- New `ui` block in settings: `layout` (`topnav` / `sidebar` / `both`),
  `showHeader`, `showStatusBar`, `defaultTab`, `accentColor`.
- Layout applies a grid that switches between topnav, sidebar, and
  both. The change is live.

### Added — Tailscale serve config
- New Tailscale card in the Settings view.
- Reads `tailscale` CLI status: installed, version, authenticated,
  backend, hostname.
- Enable / disable Tailscale serve for the dashboard port via
  `tailscale serve --bg https <port>`.
- REST surface: `GET /api/tailscale/status`, `POST /api/tailscale/enable`,
  `POST /api/tailscale/disable`.

### Added — Fuzzy search across everything
- New search bar in the topbar. Press `/` or **⌘ / Ctrl + K** to
  open the search modal.
- Searches: tasks, plans, agents, projects, mods, schedules, slash
  commands.
- Results are grouped by type. ↑/↓ to navigate, ↵ to open, Esc to
  close.
- REST surface: `GET /api/search?q=<query>&scope=<type>`.

### Added — Editable agents
- Every agent card now has **Edit** + **Delete** buttons.
- **New agent** wizard with name, description, model dropdown, mode
  (primary / subagent / all), color, tools checkboxes, and a system
  prompt textarea.
- Edits write to `~/.config/opencode/agents/<name>.md` and update
  the frontmatter + body in place.
- REST surface: `GET /api/agents`, `GET /api/agents/:name`,
  `POST /api/agents`, `PUT /api/agents/:name`,
  `DELETE /api/agents/:name`.

### Added — Extended tasks
- Tasks now have: `assignee`, `parent` (subtasks), `dependencies`,
  `timeSpent`, `recurring` (cron), `attachments`, `comments[]`,
  `activity[]`.
- Task detail modal: timer (start / stop), add / remove dependencies,
  set / clear recurring, post comments, view activity timeline.
- Bulk-action "Assign to me" on each card.
- Activity log records `created`, `status` changes, `completed`,
  `timer-start`, `timer-stop`, `comment` events.

### Added — OpenCode config UI
- Providers and MCPs are now first-class in the dashboard, with
  add / remove cards. Provider API keys are masked in responses and
  round-trip through the unmask sentinel (`***…***`) so the user
  can save without re-typing the key.

### Added — Diagnostics
- New `/api/diagnostics` endpoint returns version, uptime, memory,
  service status, all counts, and the last 10 errors from the
  service log. Surfaced in the Config view's always-visible
  diagnostics card.

### Changed
- `bizar` no longer ships dashboard source code. The dashboard is
  installed separately as `@polderlabs/bizar-dash`.
- The default `bizar` invocation now checks whether
  `@polderlabs/bizar-dash` is installed. If it is, it delegates to
  the dashboard's TUI; if not, it prints an install hint.
- Tasks endpoint now scopes to a project. The legacy global file
  (`~/.config/bizar/tasks.json`) is the fallback when no project is
  active.
- `~/.config/bizar/settings.json` now contains a nested `theme{}`,
  `ui{}`, and `service{}` block. Existing v2.7.0 settings are deep-
  merged forward, so old user state still works.

### Migration notes
- The dashboard moves to its own package. Install with:
  `npm install -g @polderlabs/bizar-dash`.
- The dashboard reads the same opencode config and the same
  per-project data dirs as v2.7.0, so existing agents / commands /
  plans / projects continue to work.
- Tasks created with v2.7.0 are read from the legacy
  `~/.config/bizar/tasks.json` until you add a project and create a
  new one — at which point everything new lives in
  `~/.config/opencode/projects/<id>/tasks.json`.

## v2.7.0 — 2026-06-19

### Added
- **TUI dashboard** — `cli/dashboard-tui.mjs` is a full terminal dashboard
  built on `blessed`. It launches when you run `bizar` with no arguments and
  replaces the previous default of opening the browser. Eight tabs:
  - **Overview** — counts (agents / plans / projects / sessions), versions,
    last 15 activity events.
  - **Chat** — last 20 messages; press `c` to compose (POSTs to `/api/chat`).
  - **Agents** — two-column card grid parsed from
    `~/.config/opencode/agents/*.md`.
  - **Plans** — list of worktree + global plans; press `n` to create one.
  - **Projects** — list of projects discovered via `.bizar/PROJECT.md` markers
    and `~/Projects/*`.
  - **Tasks** — three-column kanban (queued / doing / done); press `n` to add.
  - **Config** — pretty-printed JSON of `opencode.json` with syntax colors.
  - **Settings** — current settings (theme, agent, model, notifications,
    `dashboard.autoLaunchWeb`, about); press `t` to toggle autoLaunchWeb.
  Keyboard: `1`–`8` jump tabs, `Tab` / `Shift-Tab` cycle, `r` reload,
  `c` compose chat, `n` new item, `t` toggle web auto-launch, `?` help,
  `q` / `Ctrl-C` quit. Connects to the same Express + WebSocket server the
  web UI uses, with auto-reconnect on server restarts.
- **Configurable web UI launch** — `bizar` honours a new
  `dashboard.autoLaunchWeb` setting (default `true`). When true, `bizar`
  starts the TUI **and** opens your browser; when false, it starts the TUI
  only. Visible as a checkbox on the Settings view in both the web UI
  (Settings card "Dashboard → Auto-launch web UI alongside TUI") and the
  TUI (press `t`).
- **Background launch mode** — new `bizar --bg` (alias `--detach`) flag
  spawns the web dashboard as a detached child process and returns to the
  shell immediately. Writes the same `~/.config/bizar/dashboard.{port,pid}`
  files the foreground launcher does, so `bizar dashboard status` and
  `bizar dashboard stop` work the same way.

### Changed
- **`bizar` (no args) now launches the TUI** in your current terminal.
  The browser is opened as well unless `--no-web` is passed or
  `dashboard.autoLaunchWeb` is `false`. Previously this command opened the
  web UI in your browser; that behaviour is now available via `bizar --bg`
  (background) or `bizar --web-only` (foreground, no TUI).
- **`cli/dashboard/state.mjs#getSettings`** now deep-merges nested objects
  (`notifications`, `dashboard`, `about`) instead of shallow-merging only the
  top level. Adding a new setting field no longer overwrites the user's
  existing nested preferences.

### CLI flags (added)
| Flag             | Effect                                                  |
| ---------------- | ------------------------------------------------------- |
| `bizar --web`    | Force-launch the browser alongside the TUI              |
| `bizar --no-web` | TUI only (no browser); overrides `autoLaunchWeb=true`   |
| `bizar --web-only` | Foreground web dashboard only (no TUI)                |
| `bizar --bg`     | Spawn web dashboard detached, return to shell           |
| `bizar --detach` | Alias for `--bg`                                        |

### Plugin
- No changes — the TUI is purely a CLI addition; the opencode plugin is
  untouched.

### Files
- `package.json` — `blessed@^0.1.81` added (hoisted to top-level
  `node_modules` for both the source tree and the global install).
- `cli/dashboard-tui.mjs` — new (~700 LOC).
- `cli/bin.mjs` — dispatch + flags + help text rewritten.
- `cli/dashboard/state.mjs` — `dashboard.autoLaunchWeb` default + deep merge.
- `src/lib/types.ts` — `Settings.dashboard` field added.
- `src/views/Settings.tsx` — new "Dashboard" card with autoLaunchWeb checkbox.

## v2.6.2 — 2026-06-19

### Changed
- **`bizar` (no args) now launches the dashboard** instead of running the interactive installer. The dashboard is the day-to-day command — installer should be explicit.
- **`install` is now its own command** that runs the interactive installer. Previously this was triggered by running `bizar` with no arguments.
- `bizar install` still works as an alias for `install`.

### Migration
- Old: `bizar` → ran installer
- New: `install` → runs installer; `bizar` → launches dashboard
- All other subcommands (`bizar audit`, `bizar plan`, etc.) are unchanged.

## v2.6.1 — 2026-06-19

### Fixed
- **`bizar` install hangs** after completing all work. The `installPluginBizar()` function started a spinner but returned early (without stopping it) when the local `plugins/bizar/` directory didn't exist. The dangling spinner kept an interval alive, preventing the process from exiting. Now stops the spinner cleanly in the early-return path.

## v2.6.0 — 2026-06-19

### Changed
- **Dashboard rewritten in React 18 + TypeScript + Vite** — the vanilla-JS SPA (`dashboard/`) is gone. The new SPA lives in `src/`, builds with Vite into `dist/`, and the dashboard server now serves `dist/` (with SPA fallback + graceful "not built" page when the bundle is missing).
- **New build pipeline** — `npm run dev` for HMR, `npm run build` for production, `npm run typecheck` for the compiler. Hashed assets under `dist/assets/` are served with `Cache-Control: public, max-age=1y, immutable`; `index.html` is served `no-cache` so deploys roll out cleanly.
- **`package.json#files`** now ships `dist/` (Vite output) plus `src/`, `vite.config.ts`, and `tsconfig.json` for reproducible rebuilds. `dashboard/` is removed.

### Added
- **`GET /api/snapshot`** — returns the full dashboard payload (overview + agents + plans + projects + config + settings + tasks) in one round-trip. The React SPA uses this for its initial load; existing individual endpoints are untouched.
- **Polished UI** — Inter typography (CDN), 8pt spacing scale, CSS variables for dark/light themes, subtle shadows and borders, focus rings on every interactive element, smooth tab transitions, card hover lifts, toast slide-in animations, modal fade-in + backdrop blur, skeleton loading states, friendly empty states.
- **Lucide icons throughout** — every action, tab, stat card, and badge uses `lucide-react` for a consistent, modern look. Only the 🪩 logo remains as an emoji.
- **`react-markdown` + `remark-gfm`** for chat message rendering — full Markdown + GitHub-flavored Markdown support (tables, task lists, strikethrough).
- **Theme picker with preview swatches** — Dark / Light / System with theme cards showing what each looks like. System mode follows the OS preference live.
- **Toast context** — toast notifications now use a proper React context (`useToast()`) with auto-dismiss timers, dismiss buttons, and four variants (info/success/error/warning).
- **Modal context** — modal dialogs use a React context (`useModal()`) with portal rendering, ESC to close, click-outside dismiss, and stackable depth.
- **Type-safe API + WebSocket** — full TypeScript types mirror the JSON contract from `cli/dashboard/api.mjs`. The WebSocket layer has typed message variants and proper status propagation.
- **Drag-and-drop in Tasks kanban** — HTML5 drag API, drop highlight, optimistic update with revert on failure. Existing keyboard shortcuts (n, 1-3, e, Del) preserved.
- **Canvas pan/zoom refactor** — Plans canvas now uses a proper world-space coordinate system; SVG connection lines are positioned correctly regardless of pan/zoom offset.

### Plugin
- No changes — the React dashboard is purely a server-rendered SPA replacement.

### Behavior changes
- The dashboard now requires `npm run build` once after install/publish. The dashboard server prints a friendly "Dashboard not built — run `npm run build`" page if `dist/` is missing instead of returning 404.

## v2.5.1 — 2026-06-19

### Added
- **Tasks Kanban board (8th dashboard tab)** — personal kanban with three columns (Queued, Doing, Done). Supports full CRUD, per-task priority (low/normal/high) with colored indicators, tags, inline edit, keyboard shortcuts (n=new, 1/2/3=column jump, e=edit, Delete=remove), search/filter, and smooth move animations.
- **Tasks REST API** — `GET /api/tasks`, `POST /api/tasks`, `PUT /api/tasks/:id`, `PATCH /api/tasks/:id/status`, `DELETE /api/tasks/:id` — all with WebSocket broadcast on mutation.
- **Tasks storage** — `~/.config/bizar/tasks.json`, auto-created with recursive mkdir. In-process mutex for read-modify-write safety. IDs via `tsk_<8 hex chars>`.

## v2.5.0 — 2026-06-19

### Added
- **`bizar dashboard [start|stop|status]` CLI subcommand** — launches a local Express + WebSocket server on `127.0.0.1` (preferred port 4321, walks upward if taken), opens the user's browser, and writes `~/.config/bizar/dashboard.{pid,port}` so `stop` / `status` can find the running instance. The server binds loopback only.
- **`/bizar` now launches the dashboard** — the opencode plugin's `chat.message` hook recognizes `/bizar` (no args) as a new `launch_dashboard` side-effect, spawns `bizar dashboard start` detached, and surfaces the live URL in its response. With args, `/bizar` still routes via the menu command file (`config/commands/bizar.md`).
- **Seven-tab web dashboard** — Overview (counts + recent activity + quick actions), Chat (history + send box with slash-command suggestions), Agents (grid + invoke modal), Plans (list + create + view), Projects (discover + activate), Config (live `opencode.json` editor with JSON validation and diff), Settings (theme + notifications + about).
- **Real-time updates via WebSocket** — on connect, the server sends a snapshot of every panel. Subsequent file changes broadcast `{type: 'change', event, path}` to all clients, which surface a toast and re-render the affected panel.
- **Live file watcher** — `chokidar` watches `opencode.json`, `agents/`, `commands-bizar/`, `~/.config/opencode/plans/`, `.bizar/`, and the worktree `plans/` directory. Changes propagate to the dashboard immediately.
- **Self-contained frontend** — no build step. Vanilla ESM JavaScript, hand-rolled markdown rendering, dark theme by default with a light variant. The HTML, CSS, and JS are all under `dashboard/` and shipped via the npm `files` array.
- **JSON error envelope on the API** — every error (parse, validation, not-found) returns `{ error, message }` with the appropriate HTTP status. `PUT /api/config` with malformed JSON returns `400 entity.parse.failed` (not Express's default HTML page).
- **Activity feed** — every API mutation (`config.update`, `plan.create`, `agent.invoke`, `chat.message`, `project.activate`, `settings.update`, `config.reload`) appends a record to `.bizar/activity.log`. The Overview panel tails the last 30 events.
- **New dependencies** — `express ^4.19`, `ws ^8.18`, `chokidar ^3.6`.

### Changed
- **`config/commands/bizar.md`** — the menu file now describes the dashboard launch as the primary action and lists the routing rules for `/bizar <args>` (explain / plan / audit / review / learn / init). The "Never make changes to the codebase" guidance is preserved.
- **`package.json#files`** — now ships `dashboard/` in the published tarball.

### Plugin
- **`parseSlashCommand`** — new `case "bizar"` adds the `launch_dashboard` side-effect. The parser remains pure (no I/O).
- **`executeSideEffect`** — new `executeLaunchDashboard()` spawns `bizar dashboard start` detached, polls `~/.config/bizar/dashboard.port` for up to 3s, and appends the live URL to the response. If a dashboard is already running, it just reports the existing URL.

### Behavior changes
- The dashboard server replaces the prior MVP URL stub: `/bizar` used to print "v0.5.0 MVP — server startup is a future enhancement" (per `plugins/bizar/src/commands.ts`); v2.5.0 actually launches it.

## v2.4.0 — 2026-06-19

### Fixed
- **Install pipeline now produces a complete, working opencode.json** with all 13 agents and 9 commands registered. Previously the template was missing `agent` and `command` blocks, causing slash commands to silently disappear from the TUI.
- **Silent bail on fresh installs** when `~/.config/opencode` didn't exist — the postinstall now creates the directory and bootstraps opencode.json from the package template.
- **False-positive "Bizar plugin source not found" warning** removed (plugin lives in a separate npm package; the global install path is canonical).
- **Stale `config/opencode.json.template`** deleted (it was a duplicate of `opencode.json`).
- **TDZ bug in `runPostInstall()`** — an inner `join` import shadowed the module-level one, causing a ReferenceError on first run.

### Added
- **`installCommandsBizar()`** — symlink-safe install of Bizar commands to `commands-bizar/` (separate from ECC's `commands/` symlink target, so it doesn't collide).
- **`/bizar` menu slash command** — routes to @odin with a routing help file that lists all available Bizar actions and dispatches based on user intent. New TUI entry: type `/bizar what you want to do` and Odin routes.
- **`/plan` and `/visual-plan` TUI commands** — these plugin-handled slash commands now appear in autocomplete (previously only worked when typed in chat).
- **Missing command files** — `config/commands/plan.md` and `config/commands/visual-plan.md` added to match the 9-command template.

### Behavior changes
- Commands now install to `~/.config/opencode/commands-bizar/` instead of `~/.config/opencode/commands/` (the latter is a symlink to ECC's commands on this user's machine). The template paths in opencode.json were updated to match.
