# Changelog

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
