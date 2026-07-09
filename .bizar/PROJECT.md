# BizarHarness

Norse-pantheon multi-agent system for cline. 12 agents across 4 cost tiers with cost-aware routing.

## Final Goal

> Bizar is a fully autonomous AI agent development platform for long-running, long-horizon tasks with human-in-the-loop elements.

See [`../FINAL_GOAL.md`](../FINAL_GOAL.md) for the full vision document. The goal decomposes into five pillars: **Loops** (iterative agents — recurring, refinement, exploration), **Multi-Agent Validation** (N independent agents, consensus drives action), **Agent Hierarchy** (Odin strategic → Tyr architectural → Thor modular → Heimdall mechanical, with Hermod for gitops and Forseti for audit), **Agent Council** (N-agent votes for high-stakes decisions, with size and rule varying by action class), and **Constant Self-Improvement** (closed-loop: outcomes → patterns → rules → applied rules → better outcomes). The execution plan is in [`../ROADMAP.md`](../ROADMAP.md); we are currently at L2-L3 on the autonomy scale and targeting L4 by v6.x and L5 by v7.x.

## Stack
- Config: YAML + Markdown agent definitions
- Models: DeepSeek V4 Flash Free, MiniMax-M2.7, MiniMax-M3, GPT-5.5
- Memory: Bizar Memory Service (local Markdown + Git-backed; `.bizar/memory.json`)
- Search: Semble MCP
- Skills: 5 bundled (BizarHarness, self-improvement, C++ coding standards, C++ testing, Embedded ESP-IDF)
- Diagrams: PlantUML ASCII art

## Architecture

- Single-package monorepo (root `package.json`). CLI: `cli/bin.mjs`. Dashboard: `bizar-dash/src/{server,web}/`. Plugin: `plugins/bizar/`. SDK: `packages/sdk/`.
- 13 agents across 4 cost tiers (Odin/Frigg/Vör/Mimir/Heimdall/Hermod/Thor/Baldr/Tyr/Vidarr/Forseti + 2 more in config).
- 36 `BIZAR_*` env vars control auth, bind, logging, Tailscale, etc.
- WebSocket is the central nervous system — every entity change pushes typed events.
- CSS is 100% vanilla — no Tailwind, no CSS-in-JS. ~8900 lines main.css plus scoped per-view styles.
- Tests split across bun (plugin), node --test (dashboard), vitest (SDK).

## Bundled Skills
- **BizarHarness** — task-planning and BizarHarness framework skill
- **Self-improvement** — AGENTS_SELF_IMPROVEMENT.md maintenance and lesson logging
- **C++ coding standards** — C++17/20 conventions, naming, header hygiene, const correctness
- **C++ testing** — Google Test/Google Mock patterns, embedded test fixtures, coverage
- **Embedded ESP-IDF** — ESP32/ESP-IDF build system, FreeRTOS, Kconfig, flash partitioning

## Conventions
- Agent files: YAML frontmatter + Markdown body in `config/agents/`
- Agent count: 12 (Odin, Vör, Frigg, Mimir, Heimdall, Hermod, Thor, Baldr, Tyr, Vidarr, Forseti, Quick)
- Every agent uses Hindsight memory with per-project banks (never default)
 - Project data lives in `.bizar/` folder (not at project root). See `.bizar/README.md` for the canonical subdirectory layout.
- Self-improvement entries appended at every task completion
- Memory setup: per-project Hindsight bank with `bank_id: "<project-name>"` — default bank reserved for general/system knowledge only
- MiniMax models require `interleaved: { field: "reasoning_details" }` and `reasoning: true` in cline.json provider config — without it, thinking tokens leak into visible output
- CLI structure: single `bizar` binary, no `bizar-dash` binary. Dashboard commands under `bizar dash <sub>`.
- In-process imports: cross-package integration uses named exports and direct imports, not subprocess spawn. See `bizar-dash/package.json#exports` for the `dash-cli` subpath.

## Entry Points
- Install: `./install.sh`
- Config: `~/.config/cline/`
- Repo: `github.com/DrB0rk/BizarHarness`

## Current Version

- v6.0.1 — Cline mistake-recovery + tool-discipline + 9router gateway + rules-sync
- v6.0.0-beta.1 — CURRENT_ISSUES sprint (Odin, /loop, slash commands, vault linking)
- v5.5.1 — Steering followup + UI overhaul + server log fixes + browser extension cleanup
- v5.5.0 — Background agents dashboard integration + memory system full integration + installer end-to-end overhaul.

## Recently Shipped (v4.5.0)

- Settings page merged with Config; EnvVarManager + SettingsSearch components
- Bizar env vars at `~/.config/bizar/env.json` (mode 0600), managed via dashboard
- Provider catalog with 13 entries, backup keys with auto-rotation, auto-add wizard
- LightRAG defaults to free Cline Zen models
- Memory settings tab (LightRAG + Obsidian + git repo config)
- Usage monitoring: JSONL store, SVG charts, time-range picker, per-model table, agent awareness
- Chat overhaul: cline session fix (open + create), SSE reconnect-with-backoff, source-aware UI
- Tasks.tsx: agent picker removed, kanban board with backlog/todo/in-progress/done/failed
- Skills tab: shipped/user/project tabs, fuzzy search (no ASCII garbage), 11 shipped skills
- Update flow: `--check`, `--channel`, `--no-restart` flags + `/api/updates/*` endpoints with WS progress
- UI consistency: `--spacing-xs/-sm/-md/-lg/-xl` tokens + compact-mode overrides

## Recently Shipped (v4.5.1)

- **Headroom full integration.** Core module at `bizar-dash/src/server/headroom.mjs` with `getHeadroomStatus`, `getHeadroomStats`, `installHeadroom`, `wrapOpencode`, `unwrapOpencode`, `startProxy`, `stopProxy`, `headroomStartupHook`. REST endpoints at `/api/headroom/*`. Settings → Headroom section with all toggles + install/wrap/start/stop buttons. Auto-install/wrap/start on dashboard startup. CLI: `bizar headroom status|stats|install|wrap|unwrap|start|stop|doctor`. Skills: `bizar-dash/skills/headroom/SKILL.md` + section in canonical `bizar` skill.
- **Full Memory tab.** Dedicated tab in sidebar (between Skills and Settings). 5 panels: Overview (composite health), LightRAG (start/stop/reindex/rebuild + stats + quick search), Obsidian Vault (tree + note list + edit modal + backlinks), Git Sync (pull/push/commit/fetch + diff), Semantic Search (cross-source LightRAG + Obsidian), Config. Overview tab gets a `<MemoryStatusCard>`. 11 new endpoints in `routes/memory.mjs`. Obsidian façade at `bizar-dash/src/server/memory-obsidian.mjs`.
- **Tasks added.** Two tasks in the Bizar task store (`~/.config/cline/projects/BizarHarness/tasks.json`): `tsk_b1c8add787` (Headroom full integration) and `tsk_abb21919a5` (Full Memory tab).
- **Fix.** `cli/bin.mjs` syntax error — single quote opened a string but backtick closed it on line 915. Now compiles.
- **Doc fix.** `.cline/instructions/bizar-tools.md` — replaced broken `headroom plan --tokens` reference with accurate Headroom 0.30.0 commands (proxy, wrap, doctor, perf, savings, memory, dashboard).

### Tests (v4.5.1)
- 24 Headroom tests (status, install, settings)
- 40 Memory tests (tab + lightrag-extended + obsidian)
- 56 new tests, all passing
- Total `npm test`: 340 pass, 0 fail

## Recently Shipped (v4.5.2)

- **Bug-fix sweep.** Six parallel research streams scanned the entire codebase for issues. Three fix streams resolved 16 high-confidence bugs across CLI (`cli/bin.mjs`, `cli/provision.mjs`, `cli/doctor.mjs`, `cli/memory.mjs`, `cli/artifact.mjs`), installer (`install.sh`, `install.ps1`, `scripts/check-deps.mjs`), server (`providers-store`, `server`, `routes/chat`, `memory-lightrag`), frontend (`App.tsx`, `Topbar.tsx`, `Toast.tsx`, 5 views), and build (`vite.config.ts`, `.npmignore`).
- **Auth confirmed unnecessary.** Tailscale handles network-level auth. No auth layer added.
- **Pattern established.** Research-first sweep methodology: 6 parallel research → synthesis → 3 parallel fix streams → test gate → release.

## Recently Shipped (v5.0.0)

- **Web Clipper.** Browser extension (Manifest V3) at `browser-extensions/bizar-clipper/` with context menus (save page/selection), floating save button on text select, popup config UI, and placeholder PNG icons. Bookmarklet fallback at `bookmarklet/bizar-clipper.js` (minified single-line). Backend `POST /api/clipboard/save` saves to `.obsidian/clips/<slug>.md` with YAML frontmatter. CLI `bizar clip list|delete|configure`.
- **Screenshot OCR.** `ScreenshotCapture.tsx` uses `getDisplayMedia()` for screen capture, uploads to `POST /api/ocr/process` which uses Tesseract.js for text extraction. `ScreenshotOCR.tsx` combines capture + result display. `FromScreenshotPanel.tsx` + `VaultFromClipboardPanel.tsx` in Memory tab. CLI `bizar ocr list|process|configure`. `tesseract.js` dependency added.
- **Memory tab extended.** Two new panels: "Web Clip" (direct paste to vault) and "Screenshot OCR" (capture → OCR → save).
- **11 new tests.** 5 node:test for clipboard, 1 node:test for OCR routes, 5 vitest for screenshot-ocr components.

## Recently Shipped (v4.7.0)

- **CLI refactor.** bin.mjs 1498→275 lines; artifact.mjs 2121→63 lines (now a re-export); 10 new command modules under cli/commands/; 3 new artifact modules.
- **Structured logging + metrics.** JSON logger with levels + child(); Prometheus-style metrics; /metrics endpoint; http_requests_total + ws_clients gauges; Cache-Control headers on /api/settings and /api/snapshot.
- **Web frontend test infrastructure.** vitest + jsdom + RTL setup; 75 component/hook/lib tests; npm run test:web script.
- **Virtual scrolling.** Hand-rolled VirtualList component (no deps); 4 views use it (ChatThread, Overview, Activity, History).
- **i18n infrastructure.** Translation system with locale switching; 30 foundation strings in locales/en.json.
- **A11y polish.** SearchModal role=search; Settings color inputs labeled; Toast role=alert.

## Recently Shipped (v5.0.1)

- **Settings redesign.** New persistent sidebar nav (`<SettingsNav>`) with 4 collapsible groups (General, Core, Experience, Data). Settings mode toggles to show all sections; exit returns to normal sidebar. Selected section persists across navigation.
- **Doctor page.** Full-page Doctor view at `/api/doctor` with 5 panels (System Health, Services, Counts, Recent Errors, Actions). Reusable `<DoctorPanel>` component. 30s auto-refresh via cheap `/api/doctor/health` poll. `<StatusBadge>` extended with `ok`/`warn`/`fail` variants. New sidebar entry between Overview and Settings.
- **Settings auto-save.** `useAutosave` hook with debounced save + flush on unmount. `<AutosaveField>` generic wrapper with status indicator (subtle pulse on save, fade on saved). Text inputs 800ms debounce + blur immediate save; textareas 1500ms. Wired into GeneralSection and AgentSection.
- **Cline chat error handling.** Proper 503 (plugin_offline / directory_unknown) and 502 (cline_error) responses with structured `cause` field identifying network/timeout/HTTP errors. `resolveSessionDirectory()` falls back across worktrees. Frontend shows structured error with Retry button.
- **Default memory vault location.** `DEFAULT_MEMORY_VAULT = ~/.local/share/bizar/memory` (mode 0700). Auto-creates and git-inits vault on first server start. ConfigPanel + MemorySection simplified — only git remote URL is editable.
- **Removed "Coming soon" placeholders.** Deleted 5 placeholder section files (BackupSection, EnvVarsSection, ProvidersSection, SkillsSection, MemorySection) and removed 5 entries from Settings.tsx section list.
- **Replaced free models with MiniMax.** 6 agent files updated from `cline/deepseek-v4-flash-free` → `minimax/MiniMax-M2.7`. `quick.md` uses `MiniMax-M2.7-Flash` (simple tasks); `tyr`/`odin`/`forseti`/`vidarr` use `MiniMax-M3` (complex). `PROVIDER_CATALOG` has MiniMax with 4 models. Settings default model updated.
- **Layout/padding fix.** `.view` / `.page` containers get 32px top padding; card gaps increased to 16–20px; view header gets 24px bottom margin + bottom border. All pages audited.
- **Compaction at 50% context.** New `plugins/bizar/src/compaction.mjs` built from scratch. `shouldCompact()` returns true at 50% usage. `setCompactionThreshold()` configurable 0.1–1.0. `maybeCompactSession()` triggers compaction with `preserve_recent=10`. `config/cline.json` has `compaction.threshold = 0.5`.

### Tests (v5.0.1)
- 388 npm tests pass
- 178 vitest tests pass
- TypeScript: 0 errors
- Build succeeds

## Architecture

- Single-package monorepo (root `package.json`). CLI: `cli/bin.mjs`. Dashboard: `bizar-dash/src/{server,web}/`. Plugin: `plugins/bizar/`. SDK: `packages/sdk/`.
- 13 agents across 4 cost tiers (Odin/Frigg/Vör/Mimir/Heimdall/Hermod/Thor/Baldr/Tyr/Vidarr/Forseti + 2 more in config).
- 36 `BIZAR_*` env vars control auth, bind, logging, Tailscale, etc.
- WebSocket is the central nervous system — every entity change pushes typed events.
- CSS is 100% vanilla — no Tailwind, no CSS-in-JS. ~8900 lines main.css plus scoped per-view styles.
- Tests split across bun (plugin), node --test (dashboard), vitest (SDK).

## Memory

- Backend: Bizar Memory Service (local Obsidian-compatible Markdown + Git-shared sync)
- Default mode: `local-only` (vault at `.obsidian/`); opt into `managed` for cross-project sharing
- Shared memory repo: `~/.local/share/bizar/memory/bizar-memory/` with namespaces `projects/<id>/`, `global/bizar/`, `users/<id>/`
- Canonical truth: Markdown. LightRAG is a derived index (rebuildable from Markdown). Git is the collaboration layer. Phase 2 (v4.1.0) adds a LightRAG scaffold for semantic search — disabled by default, opt-in via `.bizar/memory.json`.
- Hindsight MCP is disabled by default. The Bizar Memory Service replaces it.
- Agents use the dashboard REST API at `/api/memory/*` (canonical) or `/api/obsidian/*` (back-compat).
