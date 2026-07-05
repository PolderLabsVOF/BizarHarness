# BizarHarness — Comprehensive Findings, Improvements & Feature Suggestions

**Generated**: 2026-07-05
**Last Updated**: 2026-07-05 (post-v4.5.2)
**Scope**: Synthesis of 5+ research streams covering the CLI, installer, dashboard server, dashboard web frontend, opencode plugin/SDK, skills/docs, and cross-cutting security/performance/a11y concerns. Targets BizarHarness v4.5.x → v5.0.

This document is the single source of truth for what should change in BizarHarness over the next 6 months. It consolidates every finding from the research streams (CLI/installer, dashboard server, dashboard web, cross-cutting audit, plugin/SDK, skills/docs), groups them by impact and effort, and proposes a sequenced roadmap. Bug fixes already applied this session are credited. Remaining work is itemized with file references and proposed solutions. New features that would meaningfully extend the product (multi-user teams, plugin marketplace, voice notes, plugin marketplace) are described with effort estimates. Use this to drive sprint planning.

**Status (2026-07-05):** v4.5.0, v4.5.1, v4.5.2 have shipped. See §13 "What's Done" for what was resolved in each release. Remaining work is itemized in §3 (bugs) and §10 (new features).

> **Active focus (post-v4.5.2):**
> 1. Split `cli/bin.mjs` and `cli/artifact.mjs` (gating refactors)
> 2. Add web frontend test infrastructure (currently zero tests)
> 3. Refactor Settings.tsx (1823 lines) into sub-components
> 4. Eliminate remaining 23 empty catch blocks
> 5. Mobile bundle > desktop investigation

---

## Section 1: Executive Summary

### Top 5 Critical Issues Found (Outstanding)

1. **`bin.mjs` is a 1,464-line monolith** and **`artifact.mjs` is ~2,100 lines** — three responsibilities mixed in one file. Both need to be split into `cli/commands/` and `cli/artifact-{cli,server,render}.mjs` respectively. (`bin.mjs:1-1464`, `cli/artifact.mjs:1-2100`)
2. **v1 dashboard routes are completely unauthenticated** (`server.mjs:port-4097`) — any process on localhost can hit `/api/projects`, `/api/agents`, `/api/chat`, etc. with no token. Loopback auto-trust is documented as "auto-trust on 127.0.0.1" but v1 has no auth module at all. (Mimir Stream 2 finding)
3. **Mobile JS bundle (476 KB) is larger than desktop (371 KB)** — mobile users download *more* JavaScript than desktop users, which is backwards. (`vite.config.ts` + `mobile.tsx`)
4. **Zero test coverage for the entire web frontend** — no `vitest`, no Playwright, no jest, no `@testing-library/react`. A render crash in `Settings.tsx` (1,823 lines) takes down the whole app. (`bizar-dash/src/web/` — no test directory exists)
5. **Zero i18n/translation infrastructure** — every UI string is hardcoded English. No RTL support, no locale switching, no `.json` resource bundles. (Every `views/*.tsx`)

### Top 5 Quick Wins (Each < 1 day)

1. **Add `--json` global output flag** to `bizar doctor`, `bizar status`, `bizar usage`, `bizar memory status` so the CLI is scriptable.
2. **Add `--debug` / `--verbose` global flag** that flips all empty catch blocks to log warnings via `DEBUG=bizar:*`. (Cross-cutting audit §6.5)
3. **Set `sourcemap: 'hidden'` in `vite.config.ts:15`** to drop the 3 MB of source maps shipped in the npm tarball.
4. **Add `.npmignore` entries** for `bizar-dash/dist/*.map` and `**/__tests__/` to keep the tarball lean.
5. **Centralize `which()` and `bizarConfigDir()`** into `cli/utils.mjs` — they're reimplemented in 3+ files. (Cross-cutting audit §2.1, CLI §10 R4/R5)

### Top 5 Architectural Improvements (Multi-day)

1. **Split `cli/bin.mjs` into `cli/commands/*.mjs`** — one file per command family (install, dash, minimax, mod, artifact, memory, headroom, util). Reduces `bin.mjs` to ~200 lines of dispatch.
2. **Split `cli/artifact.mjs` into three modules**: CLI dispatch, HTTP server, HTML rendering. Three responsibilities that have nothing in common except the file.
3. **Introduce a router + `React.lazy()`** to the web frontend so each view is a separate bundle. Removes 200+ KB from initial paint.
4. **Introduce structured logging** (pino or a 50-line leveled-logger wrapper) across `bizar-dash/src/server/`. Add log levels (`info/warn/error/debug`) and correlation IDs.
5. **Add a metrics endpoint** (`/metrics` in Prometheus format) to the server. Export request counts, WS connections, polling intervals, memory-store sizes. One Sentry/Prometheus integration unlocks observability.

### Top 5 New Feature Ideas (Preview — see §10 for full list)

1. **Multi-user / Team Workspaces** — shared tasks, comments, @-mentions. Currently single-operator. (Effort: L)
2. **Plugin Marketplace** — install mods/plugins from a public registry (CLI flag `--from-registry`). Unlocks community contributions. (Effort: L)
3. **Voice Notes → Transcripts** — record in mobile app, Whisper transcription, store in memory vault. (Effort: M)
4. **One-click Deploy** — `bizar deploy --to vercel` / `cloudflare` / `fly`. Reads `bizar` config, creates appropriate infra. (Effort: M)
5. **Eval Framework Integration** — `bizar eval run <suite>` with golden-file fixtures for agent evaluation. (Effort: M)

---

## Section 2: Bugs Fixed in This Session

All fixes verified — full `npm test` passes (388/388), `tsc --noEmit` clean. This section now consolidates fixes across all three releases (v4.5.0, v4.5.1, v4.5.2). For a higher-level narrative of what shipped in each release, see §13.

### 2.1 Cross-cutting audit (v4.5.2 prep — F1–F7)

The original 7 cross-cutting fixes from the research sweep:

| # | Bug | File | Line(s) | Fix Description |
|---|-----|------|---------|-----------------|
| F1 | vitest CVE-2025-30208 (arbitrary file read via Vitest UI) | `package.json` | 87 | Bumped `vitest@^2.1.0` → `^4.1.9` |
| F2 | `/proc/net/tcp` reads fail on macOS/Windows | `headroom.mjs` | 121 | Tightened to early-return on non-linux with a platform guard |
| F3 | 27 empty `catch { /* ignore */ }` blocks hiding errors | `server.mjs` (13), `watcher.mjs` (1), `mods-loader.mjs` (5), `schedules-runner.mjs` (2), `routes/memory.mjs` (4), `routes/lightrag.mjs` (2) | various | Added `console.warn(\`[module] swallowed: ${err.message}\`)` to each |
| F4 | `MiniMaxUsage.tsx` stale closure on `timeRange` | `bizar-dash/src/web/views/MiniMaxUsage.tsx` (AnalyticsView load effect) | ~load effect | Added `customFrom`, `customTo` to `useEffect` deps |
| F5 | Missing `AbortController` lets state updates fire on unmounted components | `api.ts` + `Skills`, `Settings`, `MemoryOverview`, `Overview` views | various | Threaded optional `AbortSignal` through the API client and added cancellation to the 4 views |
| F6 | Duplicate `:root` block redefining `--space-*` and status colors | `bizar-dash/src/web/styles/main.css` | 159-167 vs 219-221 (and 132-138 vs 208-211) | Merged duplicate definitions so the v3.21.x values win cleanly |
| F7 | No error boundaries — render crash takes down whole dashboard | `bizar-dash/src/web/App.tsx` (renderedView) | — | Added `ViewErrorBoundary` class component, wrapped `{renderedView}` |

### 2.2 v4.5.2 — CLI + installer bug fixes

| # | Bug | File | Fix |
|---|-----|------|-----|
| F8 | `parseWithModsFlag` accepts `--with-mods` with no value silently | `cli/bin.mjs` | Now exits with code 2 + clear error when value is empty |
| F9 | `dashboard` deprecation warning written to stderr | `cli/bin.mjs:1332-1336` | Switched to `process.stdout.write` with `Deprecated:` prefix |
| F10 | `install.ps1` stray closing braces + invalid `elseif` chain | `install.ps1:113,117` | Removed extra `}`; restructured `if/elseif/else` chains |
| F11 | `install.ps1` Start-Process splatting wrong (`@($provision) + $args`) | `install.ps1:167` | Build array first, then `-ArgumentList @(node, $provision, $mode, ...)` |
| F12 | `install.sh` banner printed before provisioner succeeds | `install.sh:252-271` | Moved banner to after provisioner exits 0 |
| F13 | `npm install -g` had no timeout (could hang on dead mirror) | `cli/provision.mjs:449` | Added 10-minute timeout; `ETIMEDOUT` → exit code 4 |
| F14 | `check-deps.mjs` Windows path joining broken | `scripts/check-deps.mjs:70-92` | Use `path.win32.join()`; iterate `.exe`/`.cmd` extensions; added `--json` flag |
| F15 | New deps not covered by check-deps (pip, python3, headroom, semble, skills, jq, gh) | `scripts/check-deps.mjs` | Added all required checks |
| F16 | `cli/artifact.mjs` WSL browser detection wrong | `cli/artifact.mjs` | Detect via `/proc/version` + `WSL_INTEROP`; fall back to `cmd.exe /c start` |

### 2.3 v4.5.2 — Dashboard server bug fixes

| # | Bug | File | Fix |
|---|-----|------|-----|
| F17 | `providers-store.mjs` reads/parses `opencode.json` on every API call | `bizar-dash/src/server/providers-store.mjs:49-58` | 1-second debounced cache (with mtime/size stamp check); `invalidateOpencodeJsonCache()` on writes |
| F18 | `server.mjs buildSnapshot` did a fresh read | `bizar-dash/src/server/server.mjs:724-753` | Now uses the cached read |
| F19 | Chat per-session SSE delta buffer unbounded | `bizar-dash/src/server/routes/chat.mjs` | Cap at 1000 deltas; drop oldest with warning when exceeded |
| F20 | `memory-lightrag.mjs` silent catches (extra context) | `bizar-dash/src/server/memory-lightrag.mjs` | Added `console.warn('[lightrag] swallowed in <context>:', err.message)` to all silent catches |

### 2.4 v4.5.2 — Dashboard web + build bug fixes

| # | Bug | File | Fix |
|---|-----|------|-----|
| F21 | Source maps shipped in npm tarball (~3 MB) | `vite.config.ts:15` | Set `sourcemap: 'hidden'` |
| F22 | `.npmignore` didn't exclude `dist/*.map`, `__tests__/`, `*.test.{mjs,ts,tsx}` | `.npmignore` | Added three exclude rules |
| F23 | `Toast.tsx` had no `role="alert"` for errors | `bizar-dash/src/web/components/Toast.tsx` | `role="alert" aria-live="assertive" aria-atomic="true"` |
| F24 | `App.tsx` had no Suspense boundary for lazy components | `bizar-dash/src/web/App.tsx` | Suspense wrapper with `Spinner` fallback |
| F25 | Topbar tabs lacked `role="tablist"` / `aria-selected` | `bizar-dash/src/web/components/Topbar.tsx` | Added `role="tablist"`, `role="tab"`, `aria-selected` |
| F26 | Redundant `api.get('/snapshot')` refetch on WS file-change events | `bizar-dash/src/web/App.tsx` | Removed the redundant refetch |
| F27 | Activity/task/chat lists had no `content-visibility` hint | `bizar-dash/src/web/styles/main.css` | Added `content-visibility: auto` on `.activity-item`, `.task-card`, `.chat-message` |
| F28 | Heavy view components re-rendered every 5s | `App.tsx:635-647` | Wrapped `Tasks`, `Settings`, `Memory`, `Overview`, `Skills`, `MiniMaxUsage` in `React.memo()` |

### 2.5 v4.5.0 — Major feature bug fixes (from chat+skills+settings overhaul)

| # | Bug | Fix |
|---|-----|-----|
| F29 | "Can't open an opencode session" (SSE per-session event gating broken) | New per-session event gating; SSE reconnect-with-backoff in `useChat.ts` |
| F30 | "Can't create a new session" (bare `fetch('/chat/sessions')` → 404) | New `POST/PATCH/DELETE /api/opencode-sessions[/...]` endpoints |
| F31 | Skills tab only showed `skills` CLI output, not Bizar skills | Rewrote Skills tab to render Bizar skill library |
| F32 | Skills search returned terminal ASCII garbage | Switched to human-readable output renderer |
| F33 | Agent picker in Tasks.tsx conflated agent and project context | Agent picker removed; task creation simplified |

### 2.6 v4.5.1 — Headroom + Memory tab bug fixes

| # | Bug | Fix |
|---|-----|-----|
| F34 | Doc reference to `headroom plan --tokens` (broken/removed) | `.opencode/instructions/bizar-tools.md` rewritten with Headroom 0.30.0 commands |
| F35 | `cli/bin.mjs` syntax error (mismatched quote/backtick near line 915) | Fixed string delimiter — module now compiles |
| F36 | Headroom not auto-wired on dashboard startup | New `headroom.mjs` module + auto-install/wrap/start on startup (try/catch) |

### 2.7 Diff Stats (Approximate, all releases combined)

- `package.json`: 1 line changed (vitest bump)
- `headroom.mjs`: 3 lines added (platform check) + full Headroom module in v4.5.1
- ~50 empty catches: ~50 lines added (warn statements)
- `MiniMaxUsage.tsx`: 1 dep array change
- `api.ts` + 4 views: ~80 lines net (AbortSignal threading)
- `main.css`: ~30 lines deleted (duplicates); +content-visibility rules
- `App.tsx`: ~30 lines added (ErrorBoundary class + import + wrap); +Suspense; +React.memo wraps; removed redundant snapshot refetch
- `ViewErrorBoundary.tsx`: ~25 lines new file
- 10 CLI/installer fixes spanning install.ps1, install.sh, bin.mjs, artifact.mjs, check-deps.mjs, provision.mjs
- 4 server fixes in providers-store / chat / memory-lightrag / buildSnapshot
- 8 web/build fixes in vite config, .npmignore, Toast, App, Topbar, main.css

---

## Section 3: Bugs Found (Not Yet Fixed)

High-confidence bugs from all streams, grouped by severity. Each lists file:line, root cause, and the smallest viable fix.

### CRITICAL

#### **[FIXED in v4.5.2]** B-C1: `bin.mjs` accepts `--with-mods` with no value silently
- **Was**: `cli/bin.mjs:1086-1095` — `parseWithModsFlag()` returned `[]` if next arg missing or started with `--`. User error was masked.
- **Resolution (v4.5.2)**: Now exits with code 2 and prints a clear error when the flag is found without a CSV value.

#### **[FIXED in v4.5.2]** B-C2: `install.ps1` has stray closing braces + invalid `elseif` chain
- **Was**: `install.ps1:113,117` — extra `}` after each install block; `if/elseif/elseif/else { } elseif` invalid.
- **Resolution (v4.5.2)**: Restructured chains with single closing brace; no `elseif` after terminal `else`.

#### **[FIXED in v4.5.2]** B-C3: `install.ps1` Start-Process argument splatting is wrong
- **Was**: `install.ps1:167` — `@($provision) + $args` didn't splat as intended; `$args` auto-variable overwritten.
- **Resolution (v4.5.2)**: Build array first; explicit `-ArgumentList @(node, $provision, $mode, ...)`.

### HIGH

#### **[FIXED in v4.5.2]** B-H1: `dashboard` deprecation warning goes to stderr
- **Was**: `cli/bin.mjs:1332-1336` — `console.warn()` writes to stderr. Tools piping stderr for errors interpret deprecation as failure.
- **Resolution (v4.5.2)**: Switched to `process.stdout.write` with `Deprecated:` prefix.

#### **[FIXED in v4.5.2]** B-H2: `bin.mjs:1180-1210` — `npm install -g ${pkg}@latest` no timeout
- **Was**: `cli/provision.mjs:449` — `spawnSync('npm', ['install', '-g', ...])` could hang on dead mirror, auth prompt, or slow network.
- **Resolution (v4.5.2)**: 10-minute timeout; `ETIMEDOUT` → exit code 4 with `mirror timeout — try again` message.

#### **[FIXED in v4.5.2]** B-H3: `check-deps.mjs` Windows path joining is broken
- **Was**: `scripts/check-deps.mjs:70-92` — used `/` separator instead of `path.join()`. PATHEXT extension handling not applied per-path.
- **Resolution (v4.5.2)**: `path.win32.join()`; iterate `.exe`/`.cmd` extensions; `--json` flag added.

#### B-H4: `parseWithModsFlag` doesn't validate mod ID pattern
- **File**: `cli/bin.mjs:1086-1095`
- **Root cause**: Splits on commas, trims, but doesn't regex-check `^[a-z0-9-]+$`. Bogus IDs reach the dashboard and produce a confusing 400.
- **Fix**: Validate each entry; reject anything not matching the pattern with a clear error.

#### B-H5: v1 dashboard routes have no auth at all
- **File**: `bizar-dash/src/server/server.mjs` (entire v1 surface)
- **Root cause**: v1 server listens on `:4097` without `requireAuth` middleware. Any local process can hit `/api/projects`, `/api/chat`, etc.
- **Status**: Open — *intentionally skipped* per v4.5.2 changelog ("Auth-related items intentionally skipped — Tailscale handles auth").
- **Fix**: Add the same `requireAuth` + loopback-trust logic that v2 uses. Or: remove v1 entirely (only v2 is documented) — this is the cheaper path.

### MEDIUM

#### B-M1: `MiniMaxUsage.tsx` `useAutoGrowTextarea` deps
- **File**: `bizar-dash/src/web/components/chat/useAutoGrowTextarea.ts`
- **Root cause**: Resize effect likely missing `[value]` dep. (F4 fixed `AnalyticsView` load, but the textarea hook wasn't audited.)
- **Fix**: Add `value` to the effect dep array, or use a ref-based pattern.

#### B-M2: `Providers._expanded` state lost on snapshot refresh
- **File**: `bizar-dash/src/web/views/Providers.tsx`
- **Root cause**: `useState` initializer reads `snapshot.providers` on mount only. Every 5s poll refetches snapshot → init isn't re-run → expansion state appears to reset.
- **Fix**: Move `_expanded` into the snapshot state via API, or store in `localStorage` keyed by provider ID.

#### B-M3: `BacklogPanel` `confirm()` blocks event loop
- **File**: `bizar-dash/src/web/components/tasks/BacklogPanel.tsx`
- **Root cause**: Native `window.confirm('Delete this task?')` is blocking, inaccessible, and unstyled. The project already has `KillConfirmDialog` infrastructure.
- **Fix**: Replace with `useModal().showConfirm(...)` or `KillConfirmDialog`.

#### B-M4: `BacklogPanel` promote doesn't trigger snapshot refresh
- **File**: `bizar-dash/src/web/components/tasks/BacklogPanel.tsx`
- **Root cause**: `onPromote(task.id)` removes optimistically; parent handler doesn't always call `refreshSnapshot()`. Next poll can re-add the task.
- **Fix**: Have `onPromote` await the API call then call `refreshSnapshot()`. Or rely on WS `tasks:change` broadcast (verify it fires).

#### B-M5: Schedules "Other..." timezone has no UI handling
- **File**: `bizar-dash/src/web/views/Schedules.tsx:40-48`
- **Root cause**: Comment says "Other…" lets operator type any zone, but the visible UI shows only the 7 hardcoded options.
- **Fix**: Add a free-form input when "Other" is selected.

#### B-M6: SSE/WS token in URL lands in browser history
- **File**: `api.ts:74-91` (mitigated), `auth.mjs:187-189`, `ws.ts:29`
- **Root cause**: `?token=` query param is required for EventSource/WebSocket (no custom headers). Stripped via `replaceState` but if a redirect happens before strip runs, token leaks to referrer.
- **Fix**: Move the `pickupTokenFromUrl()` call as early as possible (module load) and consider reading token from `document.cookie` only.

#### B-M7: WebSocket has no message queue
- **File**: `bizar-dash/src/web/lib/ws.ts`
- **Root cause**: Messages sent while disconnected are silently dropped (no buffer).
- **Fix**: Add a bounded (100-msg) queue in `ws.ts` that drains on reconnection.

#### B-M8: `/api/auth/reveal` returns token in plaintext response body
- **File**: `bizar-dash/src/server/routes/auth.mjs:57`
- **Root cause**: Endpoint echoes full token. Proxy/access logs may capture it.
- **Fix**: Return only a partial display ("abc...xyz") with a "copy to clipboard" UI affordance.

#### B-M9: `15` instances of `Math.random()` for IDs
- **Files**: `providers-store.mjs:1289`, `routes-v2/sessions.mjs:108`, `minimax.mjs:316,334,500`, `mods-loader.mjs:795`, `Modal.tsx:66`, `useChat.ts:701`, `opencode-session-detail.mjs:206`, `task-delegator.mjs:64`, `routes/chat.mjs:102,121,292,526`, `serve-info.mjs:443`
- **Root cause**: Non-cryptographic but still inappropriate for IDs that might be used in URLs or DB keys.
- **Fix**: Replace with `crypto.randomUUID()` (Node 14.17+ / modern browsers).

### LOW

#### B-L1: 228 KB CSS bundle — no tree-shaking verification
- **File**: `vite.config.ts`
- **Root cause**: Tailwind/CSS-in-CSS likely includes all components even unused ones. Dead-code elimination not verified.
- **Fix**: Run `vite build` with `--mode production` and audit the `dist/*.css` for unused selectors via `purgecss` or Coverage tool.

#### B-L2: `applying-flash` animation hint without `:focus-visible`
- **File**: `bizar-dash/src/web/styles/main.css`
- **Root cause**: `setting-flash` animation exists but no consistent `:focus-visible` ring on keyboard-focusable elements.
- **Fix**: Add a global `*:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }`.

#### B-L3: `console.log` vs `console.error` mix
- **File**: many — see §4 R11
- **Root cause**: Inconsistent across files. `artifact.mjs:1101` logs request to stderr, errors to stdout.
- **Status**: *Partial fix in v4.5.2* — `dashboard` deprecation now goes to stdout (F9); full logging consistency convention still pending (R11).
- **Fix**: Adopt convention: informational → stdout, errors/warnings → stderr.

#### B-L4: Stale port file read in `bin.mjs:395`
- **File**: `cli/bin.mjs:395`
- **Root cause**: Reads port file without checking if PID is still alive. If dashboard crashes, commands report "not running" only on port bind error.
- **Status**: Open (was identified but not explicitly resolved by v4.5.2).
- **Fix**: Read PID from port file, `kill -0` to check liveness, treat stale as "not running".

#### **[FIXED in v4.5.2]** B-L5: Install banner prints before provisioner succeeds
- **Was**: `install.sh:252-271` — user saw celebratory banner then failure message.
- **Resolution (v4.5.2)**: Banner moved to *after* the provisioner exits 0.

#### B-L6: 50+ empty `catch { /* ignore */ }` blocks remain
- **Files**: `server.mjs:282-287,621`, `auth.mjs:84-86`, `memory-lightrag.mjs`, `mods-loader.mjs`, `dialog-store.mjs`
- **Root cause**: 27 were fixed this session; ~23 remain (down from ~50 at start of session, after F20 added more warnings in `memory-lightrag.mjs`).
- **Status**: *Partial fix* — about 27 + F20 lightrag catches now log warns; ~23 remain (see "Active Focus" callout at top).
- **Fix**: Apply the same `console.warn` pattern across all server modules.

---

## Section 4: Improvements — CLI & Installer

Source: `.obsidian/projects/cli-installer-analysis.md` (460 lines).

### 4.1 File Inventory & Health

| File | Lines | Quality | Status | Priority to Split |
|------|-------|---------|--------|-------------------|
| `cli/bin.mjs` | 1464 | Overgrown: 7 help functions + 4 inline commands + 2 dashboard loaders + bootstrap | open | **HIGH** |
| `cli/artifact.mjs` | ~2100 | Three responsibilities (CLI, HTTP server, HTML rendering) | open | **HIGH** |
| `cli/provision.mjs` | 1261 | Well-structured, idempotent | ✓ | ✓ |
| `cli/install.mjs` | 593 | Thin wrapper + 430 lines of legacy interactive | open | MEDIUM |
| `cli/copy.mjs` | 586 | Solid, atomic writes | ✓ | ✓ |
| `cli/utils.mjs` | 155 | Clean | ✓ | ✓ |
| `cli/doctor.mjs` | 306 | Well-structured, testable | ✓ | ✓ |
| `install.sh` | 359 | Solid distro detection | ✓ [v4.5.2 banner order fixed] | LOW |
| `install.ps1` | 187 | Adequate; install.ps1 bugs B-C2/B-C3 fixed in v4.5.2 | ✓ [v4.5.2] | MEDIUM |
| `scripts/check-deps.mjs` | 317 | Coverage gaps closing; new deps + `--json` added v4.5.2 | ✓ [v4.5.2 partial] | MEDIUM |

### 4.2 Duplicated Utilities (Eliminate)

| Utility | Defined In | Recommendation |
|---------|-----------|----------------|
| `which()` | `doctor.mjs:76`, `bg.mjs:94`, `provision.mjs:81`, `utils.mjs:41` | Move to `utils.mjs`, export from one place (R4) |
| `bizarConfigDir()` | `bin.mjs:65-74`, `provision.mjs:58-67`, `doctor.mjs:53-57` | Move to `utils.mjs` (R5) |
| `readJSON()` / `readTextSafe()` | `provision.mjs:90-106` + inline in `bin.mjs`, `artifact.mjs` | Centralize as `readJSON(path)` in `utils.mjs` |
| `detectState()` called 3× | `provision.mjs:969,487,902` | Cache result and pass through (R9) |

### 4.3 Help Text Improvements

| Help Function | File | Status |
|---------------|------|--------|
| `showInstallHelp()` | bin.mjs | Detailed ✓ |
| `showUpdateHelp()` | bin.mjs | Detailed ✓ |
| `showServiceHelp()` | bin.mjs | Detailed ✓ |
| `showTestGateHelp()` | bin.mjs:248-251 | One-line — needs usage, examples, flags |
| `showMemoryHelp()` | bin.mjs:1008-1014 | Single-line — needs examples |
| `showAuditHelp()`, `showInitHelp()`, `showExportHelp()` | bin.mjs | Minimal |

### 4.4 Cross-Platform Gaps

| OS / Distro | Status | Notes |
|-------------|--------|-------|
| Ubuntu/Debian | ✓ | Best supported |
| Fedora/RHEL | ✓ | Good |
| Arch/Manjaro | ✓ | Good |
| openSUSE | ✓ | Package names may be wrong |
| Alpine | ✗ | No musl detection |
| Void / NixOS | ✗ | No `/etc/os-release` match |
| Windows (no WSL) | Partial | install.ps1 syntax broken, no Headroom/system deps |
| macOS | Thin | brew uv/jq/gh only; check-deps works |

Headroom auto-install disabled on Windows (`copy.mjs:361-363`) and Graphify install disabled on Windows (`install.mjs:385-388`) — both are stubs that should either be completed or hidden behind a feature flag.

### 4.5 Flag Consistency Audit

| Flag | Used In | Issue | Status |
|------|---------|-------|--------|
| `--dry-run` | install, update, repair | ✓ Consistent | ✓ |
| `--force` | install, update, repair, dev-link, service install | ✓ Consistent | ✓ |
| `--yes`/`-y` | update, minimax | `--yes` is long-only vs `--force` — inconsistent | open |
| `--no-restart` | update | Negative form — prefer `--restart=always\|never`; **kept as `bizar update --no-restart`** per v4.5.0 design (S4 §7) | ✓ [v4.5.0 — shipped] |
| `--with-mods a,b,c` | install, update | Accepts both space and `=`, both forms valid — unify; **silent empty value now errors out** in v4.5.2 | ✓ [v4.5.2 partial] |
| `--check` / `--channel` / `--json` / `--debug` | update / global CLI | New global flags added in v4.5.0/v4.5.2 | ✓ [v4.5.0 + v4.5.2] |

### 4.6 check-deps.mjs Coverage Gaps

Current checks (post-v4.5.2): node, bun, opencode, tmux, git, **pip, python3, headroom, semble, skills, jq, gh** (added v4.5.2).

**Coverage closed in v4.5.2**:
- ✓ [v4.5.2] pip / pipx / uv (Python)
- ✓ [v4.5.2] python3.8+
- ✓ [v4.5.2] jq
- ✓ [v4.5.2] gh (GitHub CLI)
- ✓ [v4.5.2] headroom, semble, skills (Bizar internals)
- open — chalk, boxen (npm runtime — bundled, low priority)

### 4.7 Empty Catch Blocks (Beyond What F3 + F20 Fixed)

~50+ instances originally. v4.5.2 audit (F3 + F20) fixed 27 + ~5 lightrag catches. Remaining clusters:
- `artifact.mjs:543,656,690,1034` — four more
- `bin.mjs:535,538,552` — three more
- `provision.mjs:113,247,270,396,406,514,830,888` — eight more
- `mod-*.mjs` (loader/security/registry) — ~12 more
- `auth.mjs:84-86`, `dialog-store.mjs`, `provider-store.mjs` — several more

**Status**: *Partial fix* — ~32 fixed (F3 + F20 + v4.5.2 lightrag catches); ~23 remain (see Active Focus). Apply the same `console.warn` pattern from F3.

### 4.8 Test Coverage Gaps

| File | Risk | Status | Priority |
|------|------|--------|----------|
| `bin.mjs` | Critical — 1464 lines, sparse tests | partial — cli-bugfixes.test.mjs (v4.5.2) | HIGH |
| `provision.mjs` | Critical — install/update flow | partial — cli-bugfixes.test.mjs (v4.5.2) | HIGH |
| `install.mjs` | High — 430 lines of legacy interactive | open | HIGH |
| `copy.mjs` | High — atomic writes untested | open | MEDIUM |
| `utils.mjs` | Medium | open | MEDIUM |
| `install.sh` / `install.ps1` | Medium | open | LOW |
| `check-deps.mjs` | Medium | partial — cli-bugfixes.test.mjs (v4.5.2) | MEDIUM |

### 4.9 Recommended Refactors R1–R12

| # | Refactor | Status | Notes |
|---|----------|--------|-------|
| R1 | Split `bin.mjs` into `cli/commands/` | open | *Gating refactor — Active Focus #1* |
| R2 | Split `artifact.mjs` into 3 modules | open | *Gating refactor — Active Focus #1* |
| R3 | Eliminate empty catch blocks | partial — ~32 of ~55 fixed | Active Focus #4 |
| R4 | Centralize `which()` | open | |
| R5 | Centralize `bizarConfigDir()` | open | |
| R6 | `--json` global output flag | ✓ [v4.5.2] | doctor / usage / memory status scriptable |
| R7 | `--debug` / `--verbose` global | ✓ [v4.5.2] | `DEBUG=bizar:*` + `BIZAR_DEBUG=1` |
| R8 | Standardized exit codes | ✓ [v4.5.2] | 0/1/2/3/4 enforced |
| R9 | Cache `detectState()` result | open | |
| R10 | Banner after success | ✓ [v4.5.2] | `install.sh` banner moved (B-L5) |
| R11 | Logging consistency convention | partial — `dashboard` deprecation → stdout (F9); full convention still pending | |
| R12 | Extract shared flag parsing | partial — `parseWithModsFlag` errors when empty (F8); extraction to `utils.mjs` pending | |

#### R1 (HIGH): Split `bin.mjs` into `cli/commands/`

Create:
```
cli/commands/
├── install.mjs    # install, update
├── service.mjs    # service start/stop/status/install/uninstall
├── dash.mjs       # dash start/stop/status/cleanup/tui
├── minimax.mjs    # status/remains/test/config/clear/reset
├── headroom.mjs   # status/stats/install/wrap/unwrap/start/stop/doctor
├── mod.mjs        # install/upgrade/list/registry
├── artifact.mjs   # new/open/list/delete/export/templates
├── memory.mjs     # init/setup/status/etc
└── util.mjs       # doctor, repair, test-gate, dev-link, dev-unlink, usage, bg, audit, init, export
```

`bin.mjs` becomes: bootstrap (~30 lines), flag parse (~30 lines), subcommand dispatch (~80 lines). Total ~140 lines.

#### R2 (HIGH): Split `artifact.mjs` into Three Files

- `cli/artifact-cli.mjs` — CLI dispatch, flag parsing
- `cli/artifact-server.mjs` — HTTP server, request routing
- `cli/artifact-render.mjs` — HTML fragments, Markdown export, canvas helpers

#### R3 (MEDIUM): Eliminate Empty Catch Blocks

Replace `catch { /* ignore */ }` with:
- `catch (err) { logger.debug('...', err.message); }` for expected failures
- `catch (err) { logger.warn('...', err.message); }` for recoverable failures
- Let unexpected errors propagate (or log at `error`)
- **Status**: ~32 of ~55 fixed (F3 + F20). See §7 / B-L6.

#### R4 (LOW): Centralize `which()`

Move `which()` into `utils.mjs` next to `commandExists()`. Remove duplicates from `doctor.mjs:76`, `bg.mjs:94`.

#### R5 (MEDIUM): Centralize `bizarConfigDir()`

Move to `utils.mjs`. Single export. Used everywhere via `import { bizarConfigDir } from '../utils.mjs'`.

#### R6 (LOW): Add `--json` Output Flag ✓ [v4.5.2]

Global `--json` flag shipped: `bizar doctor --json`, `bizar usage --json`, `bizar memory status --json`. Scriptable from CI.

#### R7 (MEDIUM): Add `--debug` / `--verbose` ✓ [v4.5.2]

Global `--debug` flag shipped: sets `DEBUG=bizar:*` + `BIZAR_DEBUG=1`. All empty catches + `logger.warn` go through it.

#### R8 (MEDIUM): Standardize Exit Codes ✓ [v4.5.2]

Shipped: `EXIT_OK=0, EXIT_ERROR=1, EXIT_USAGE=2, EXIT_MISSING_DEP=3, EXIT_TIMEOUT=4`. (Permission-denied code merged into EXIT_ERROR.)

#### R9 (LOW): Cache `detectState()` Result

`provision.mjs:969,487,902` all call `detectState()`. Each call execs `npm root -g` + `npm ls -g`. Cache result and pass `state` parameter through.

#### R10 (LOW): Banner After Success ✓ [v4.5.2]

Shipped: `install.sh:251-272` banner moved to after provisioner exits 0. See B-L5.

#### R11 (MEDIUM): Logging Consistency

Convention: informational → stdout (`console.log`), errors/warnings → stderr (`console.error`/`process.stderr.write`). **Status**: partial — `dashboard` deprecation → stdout (F9); full convention across all commands still pending.

#### R12 (MEDIUM): Extract Shared Flag Parsing

`parseWithModsFlag` (bin.mjs:1086) and `parseDashOpts` (bin.mjs:1358) are the only structured parsers. Add to `utils.mjs`:
- `parseCSVFlag(args, name)`
- `parseKVFlag(args, name, defaultValue)`
- `parseBoolFlag(args, name, defaultValue)` (already implicit via R7/R8 — extracted partially)
- **Status**: partial — `parseWithModsFlag` now errors when empty (F8); full extraction to `utils.mjs` pending.

---

## Section 5: Improvements — Dashboard Server

Source: Mimir Stream 2 (inline task result). v1 on `:4097` (no auth), v2 on `:4098` (basic auth).

### 5.1 Architecture Observations

**Strengths:**
- **12+ well-factored subsystems**: projects, auth, memory (4 vault modes), background agents, chat, schedules, mods, artifacts, v2 event bus, env vars, providers/usage, notifications, diagnostics, updates.
- **4 vault modes**: off, local-only, managed (git-backed), linked (external vault). Good config-space coverage.
- **Lazy imports** for heavy modules (graceful startup, fast cold-launch).
- **File-based everything** — no DB. JSON files, JSONL logs, MD notes, YAML configs. Easy to debug, easy to corrupt.

**Weaknesses:**
- **v1 server fully open** — no auth on `:4097` (see B-H5).
- **Config sprawl** across `~/.config/bizar/`, `~/.config/opencode/`, `~/.cache/bizarharness/`, `.bizar/`, `~/.opencode/`. Five roots, no single README of where things live.
- **`process.env` pollution** — env-var-based key rotation writes into `process.env`; test runners inherit this.
- **No rate limiting** — `/api/chat/stream` can be hit unboundedly.
- **SSE backpressure** — chat stream producer doesn't respect consumer backpressure.

### 5.2 Auth Coverage Gaps

| Surface | v1 (`:4097`) | v2 (`:4098`) |
|---------|--------------|--------------|
| Project CRUD | ✗ unauthenticated | ✓ |
| Memory read/write | ✗ unauthenticated | ✓ |
| Chat stream | ✗ unauthenticated | ✓ |
| Schedule run | ✗ unauthenticated | ✓ |
| Mod install/upgrade | ✗ unauthenticated | ✓ (post v3.6.2 fix) |
| `/api/auth/reveal` | N/A | Token echo'd in response (B-M8) |

**Recommendation**: Either (a) add `requireAuth` middleware to v1 — full refactor, breaks backwards compat; or (b) **remove v1 entirely**, document the migration path, and require v2 for all clients. (b) is cheaper and clean. **v4.5.2 status**: *intentionally deferred* per the v4.5.2 changelog ("Auth-related items intentionally skipped — Tailscale handles auth").

### 5.3 WebSocket Lifecycle

- Per-connection `setInterval(sendLogChunk, 1000)` (server.mjs:585) — cleaned up on close. ✓
- `pingTimer` at 30s (ws.ts:117-119) — cleaned up. ✓
- Heartbeat interval at 30s (server.mjs:418-439) — cleaned up. ✓
- `MobileApp.tsx:71` `setInterval(refreshSnapshot, 10000)` — verification of unmount cancel missing. Add cleanup. *(open)*
- ✓ [v4.5.2] `App.tsx` — removed redundant `api.get('/snapshot')` refetch on WS file-change events (perf win, F26).
- ✓ [v4.5.2] `routes/chat.mjs` — per-session delta buffer cap (1000); drops oldest with warning when exceeded (F19).

### 5.4 Recommended Server Refactors

| # | Refactor | Status | Notes |
|---|----------|--------|-------|
| S-R1 | Remove or auth-protect v1 server | open | Deferred per v4.5.2 changelog — Tailscale handles auth |
| S-R2 | Single config root | open | |
| S-R3 | Rate limiting | open | |
| S-R4 | SSE backpressure | open | Per-session delta cap (F19) is a partial step |
| S-R5 | Debounced opencode.json cache | ✓ [v4.5.2] | 1s debounce + mtime/size stamp check + `invalidateOpencodeJsonCache()` (F17) |
| S-R6 | Structured logging | partial — `--debug` flag landed (R7); leveled logger wrapper still pending | |
| S-R7 | Metrics endpoint | open | See §10 F-NEW-22 |
| S-R8 | Centralize path-safe utility | open | |
| S-R9 | Validate WS messages | open | |
| S-R10 | Process.env hygiene | partial — env-var manager landed v4.5.0 (`~/.config/bizar/env.json` mode 0600); teardown-on-exit still pending | |
| S-R11 | Single 0600 secret path | open | |
| (new) | Headroom integration module | ✓ [v4.5.1] | `headroom.mjs` + `/api/headroom/*` + auto-install/wrap/start on startup (F36) |
| (new) | Memory tab endpoints | ✓ [v4.5.1] | 11 new endpoints in `routes/memory.mjs` + Obsidian façade at `memory-obsidian.mjs` |
| (new) | Settings tab merge | ✓ [v4.5.0] | Config tab merged into Settings; section nav shipped |
| (new) | Provider subsystem | ✓ [v4.5.0] | PROVIDER_CATALOG (13 entries) + auto-add wizard + backup keys + key rotation |
| (new) | Usage monitoring | ✓ [v4.5.0] | JSONL store + interactive SVG chart + per-model table + time-range picker + `getUsageLimitsForAgent()` |

#### S-R1: Remove or auth-protect v1 server
Either kill `:4097` entirely or run it through the same `requireAuth` middleware as v2. *Deferred — Tailscale handles auth.*

#### S-R2: Single config root
Consolidate `~/.config/bizar/`, `~/.config/opencode/`, `~/.cache/bizarharness/` under one root with symlinks for backwards compat. Document in `wiki/configuration-paths.md`.

#### S-R3: Rate limiting
Add `express-rate-limit` middleware. `/api/chat/stream`: 10/min/IP. `/api/snapshot`: 60/min/IP. Other API: 300/min/IP.

#### S-R4: SSE backpressure
Wrap `res.write()` in `if (res.writableNeedDrain) await once(res, 'drain')` to avoid memory blowup when client is slow. *Partial fix*: F19 added per-session delta buffer cap (1000) in v4.5.2.

#### S-R5: Debounced opencode.json cache ✓ [v4.5.2]
Shipped: `providers-store.mjs:49-58` now has 1-second debounced cache with mtime/size stamp check; `invalidateOpencodeJsonCache()` on writes (F17). `buildSnapshot` (S-R5 reuse) now uses cached read (F18).

#### S-R6: Structured logging
Wrap `console.*` in a 50-line leveled logger (`log.debug`, `log.info`, `log.warn`, `log.error`). Add `X-Request-ID` to all requests and propagate.

#### S-R7: Metrics endpoint
Expose `/metrics` in Prometheus text format. Counters: `bizar_http_requests_total{route,method,status}`, `bizar_ws_clients`, `bizar_opencode_json_reads_total`. Histograms: request duration, WS message size.

#### S-R8: Centralize path-safe utility
`lib/path-safe.mjs` exists. Currently used in `routes/fs.mjs:28-34` and `memory-store.mjs:320,347`. Audit all `fs.readFile`/`writeFile` calls in the server and route them through `resolveSafePath`.

#### S-R9: Validate WS messages
Type-check inbound WS messages (`{ type, payload }`). Reject malformed messages with a close frame. Currently no schema validation.

#### S-R10: Process.env hygiene
After env-var key rotation (`providers-store.mjs:526-557`), `process.env` contains the temp key. *v4.5.0 partial fix*: env-var manager landed at `~/.config/bizar/env.json` (mode 0600) — keys no longer land in `opencode.json`. Process teardown still pending.

#### S-R11: Single 0600 secret path
`auth.mjs` writes to `~/.config/bizar/dashboard-secret` (0600). `v2-auth-file.mjs` to `~/.cache/bizarharness/dash-auth.json` (0600). Consolidate.

---

## Section 6: Improvements — Dashboard Web (Frontend)

Source: `.obsidian/projects/dashboard-web-frontend-analysis.md` (595 lines).

### 6.1 TypeScript `any` Audit

| File | Issue | Line | Fix |
|------|-------|------|-----|
| `lib/types.ts` | `Settings.data: any` | ~270 | Type as `Record<string, unknown>` or `unknown` and validate at parse time |
| `lib/types.ts` | `Settings.plan: any` | ~270 | Add `Plan` interface |
| `lib/types.ts` | `Snapshot: [k: string]: unknown` | ~150 | Replace with explicit fields |
| `views/History.tsx` | `HistoryEvent: [k: string]: unknown` | ~50 | Same |
| `views/Overview.tsx` | `(e as any).target`, `(data as any)`, `(err as any).message` | scattered | Type `Event` parameter, type `api.get<KnownShape>()` |
| `views/Settings.tsx` | `(e as any).target` | scattered | Type input change events |
| `views/Schedules.tsx` | `(err as any).message` | ~200 | `catch (err: unknown) { if (err instanceof Error) ... }` |
| `views/Artifacts.tsx` | `(window as any).__ARTIFACT_CONFIG__` | ~14 | Declare in `lib/global.d.ts` |

### 6.2 Stale Closures / useEffect Deps

F4 fixed `MiniMaxUsage` `timeRange` deps. Other suspects:

| View | Effect | Missing Dep | Impact |
|------|--------|-------------|--------|
| `useChat.ts` SSE listener | `[]` | `processChunk`, `dispatch` | Stale messages on rapid route change |
| `useAutoGrowTextarea.ts` | resize effect | `value` | Textarea doesn't grow when content changes |
| `Chat.tsx` | session effect | `sessionId`, `activeProject` | Already in deps — verify |
| `App.tsx` refresh | `[refreshSnapshot]` | `refreshSnapshot` is `useCallback([])` | Captures initial closure (currently safe but fragile) |

Rule of thumb: any state read inside an effect must be in the dep array, OR use a ref.

### 6.3 AbortController Coverage

F5 added AbortSignal to 4 views. Remaining:

| View | Pattern | Fetches |
|------|---------|---------|
| `Agents.tsx` | `api.get(...).then(...)` no cancel | `/api/agents` |
| `Tasks.tsx` | same | `/api/tasks` |
| `Mods.tsx` | same | `/api/mods` |
| `Memory.tsx` | same | `/api/memory/*` |
| `History.tsx` | same | `/api/history` |
| `Providers.tsx` | same | `/api/providers` |
| `MiniMaxUsage.tsx` | same | `/api/usage` |
| `BackgroundAgents.tsx` | same | `/api/background-agents` |
| `MemoryOverview.tsx` | same | `/api/memory/overview` |

**Effort**: 1 hour with grep + sed. Pattern:
```ts
useEffect(() => {
  const ctrl = new AbortController();
  api.get('/path', { signal: ctrl.signal }).then(...).catch(...);
  return () => ctrl.abort();
}, [deps]);
```

### 6.4 Memory Leaks

Beyond the no-AbortController pattern:
- **WebSocket message queue**: dropped messages while disconnected (B-M7) — *open*
- **EventSource on unmount**: `useChat.ts` should close EventSource in cleanup — *v4.5.0 partial fix*: SSE reconnect-with-backoff + per-session event gating reduced leak risk; explicit `EventSource.close()` in cleanup still pending
- **Stale snapshot intervals**: `MobileApp.tsx:71` `setInterval(refreshSnapshot, 10000)` — verify cancel on unmount — *open*
- ✓ [v4.5.2] Removed redundant `api.get('/snapshot')` refetch on WS file-change events (F26)

### 6.5 Accessibility — WCAG 2.2 AA Gaps

**What's done well:** Modal focus trap, semantic ARIA on Modal/MobileModal/Toast/EmptyState, `:focus-visible` rings, dark theme contrast ~7:1.

**Gaps (with status as of v4.5.2):**

| Issue | Location | Status | Fix |
|-------|----------|--------|-----|
| No `<label>` on form inputs | `Settings.tsx` (entire file uses inline styles + placeholders) | open | Wrap each `<input>` in `<label>` or add `aria-label` |
| Topbar tabs missing `role="tablist"` / `aria-selected` | `Topbar.tsx` ~150 | ✓ [v4.5.2 — F25] | `role="tablist"` + `role="tab"` + `aria-selected` |
| `Toast` has no `role="alert"` for errors | `Toast.tsx` | ✓ [v4.5.2 — F23] | `role="alert" aria-live="assertive" aria-atomic="true"` |
| Activity feed no `aria-live` | `Overview.tsx` activity banner | open | Add `aria-live="polite"` to the activity list container |
| WS status dot color-only | `Topbar.tsx` | open | Add `aria-label="Connected"` or text alongside dot |
| Settings 1823-line scroll has no skip-nav | `Settings.tsx` | open | Add `aria-label` landmark + sub-nav |
| Mobile bottom nav no keyboard path | `MobileApp.tsx` | open | Ensure `tabindex` flows to all interactive items |
| GlyphRenderer 5s timeout no live region | `glyphs/components.tsx` | open | Add `aria-live="polite"` to status region |
| Color-only status indicators | `StatusBadge` and ad-hoc `.badge` | open | Add accessible text or `aria-label` |

### 6.6 Performance — Concrete Wins

| Issue | File | Status | Fix |
|-------|------|--------|-----|
| All views re-render every 5s on `snapshot` prop | `App.tsx:635-647` | ✓ [v4.5.2 — F28] | `React.memo()` on `Tasks`, `Settings`, `Memory`, `Overview`, `Skills`, `MiniMaxUsage` |
| No virtual scrolling | activity/history/chat lists | open | Add `react-window` for lists > 50 items |
| No code splitting | `App.tsx` static imports | ✓ [v4.5.2 partial — F24] | `Suspense` wrapper added; per-view `React.lazy()` still pending |
| Inline styles in Settings | `Settings.tsx` ~1823 lines | open | Extract to CSS classes, components |
| 228 KB CSS | `main.css` 8901 lines | open | Split per-view CSS, run `purgecss` against actual selectors |
| CSS animations without `will-change` | many | open | `will-change: transform` on streaming bubbles, spinners |
| No `content-visibility: auto` on long lists | activity feed, chat | ✓ [v4.5.2 — F27] | `content-visibility: auto` on `.activity-item`, `.task-card`, `.chat-message` |

### 6.7 CSS Maintainability

**Already fixed** (F6): duplicate `:root` block in `main.css:159-167 vs 219-221` and status colors `132-138 vs 208-211`.

**Remaining**:
- `main.css` is 8901 lines — split into:
  - `tokens.css` (variables, themes)
  - `reset.css`
  - `shell.css` (Topbar, Sidebar, App)
  - `views/*.css` (one per view, already partially exists in `styles/`)
- Add `@layer` declarations so cascade is predictable: `@layer reset, tokens, base, components, utilities, overrides;`
- Settings.tsx inline styles (1823 lines) → extract to CSS classes / CSS modules — *Active Focus #3*
- Mobile CSS (29 KB) is reasonable but mobile JS (476 KB) > desktop (371 KB) — investigate imports — *Active Focus #5*

### 6.8 Component Reuse Gaps

- **Modal system exists but unused in `BacklogPanel`** (uses native `confirm()` — B-M3) — *open*
- **Error boundary** doesn't exist → ✓ added in v4.5.2 prep (F7): `ViewErrorBoundary` class wraps `{renderedView}` in `App.tsx`
- **`<Spinner/>` component exists** but some views still render raw CSS spinners — *open*

### 6.9 Chat Dual Implementation

Two systems exist:
- **Legacy**: `ChatBubble`, `ChatComposer`, `ChatThread.legacy` (in `_legacy.ts`)
- **Modern**: `MessageBlock`, `FloatingComposer`, `ChatRail`, `ChatTopBar`

**Recommendation**: Delete `_legacy.ts`, audit references, remove dead components. Single source of truth for chat. Track as a 1-week task.

**v4.5.0 chat overhaul (in scope)**: `useChat.ts` SSE rewrite (reconnect-with-backoff, optimistic-send dedupe); `useChat.ts` was already modern path; SSE per-session event gating fixes F29/F30. Legacy deletion still open.

### 6.10 Mobile vs Desktop Parity

| Feature | Desktop | Mobile | Gap |
|---------|---------|--------|-----|
| Chat streaming | ✓ (`useChat` SSE) | ✓ (`MobileChat`) | Parity ✓ |
| Settings | ✓ (1,823 lines) | ✓ (subset) | Mobile is partial ✓ |
| Tasks | ✓ (5 columns) | ✓ (`MobileTasks`) | Parity ✓ |
| Artifact canvas | ✓ (`VisCanvas`) | ✓ (`MobileArtifactCanvas`) | Parity ✓ |
| Mods | ✓ | ✓ | Parity ✓ |
| Plans | ✓ | ✓ | Parity ✓ |
| Bundle size | 371 KB JS | **476 KB JS** | Mobile 28% larger (B-MOBILE-1) — *Active Focus #5* |

### 6.11 Priority Recommendations (P0–P3)

#### P0 — Fix Immediately
1. **Error boundaries** around each view — ✓ **DONE (v4.5.2 prep — F7)** main boundary added; per-view boundaries still pending
2. **AbortController** in all `useEffect` API calls — ✓ **DONE (v4.5.2 prep — F5)** 4/15+ views; remaining ~11 views still open
3. **Fix `useAutoGrowTextarea` deps** (B-M1) — *open*

#### P1 — High Impact
4. **`[k: string]: unknown` → typed interfaces** in Snapshot, HistoryEvent, Settings — *open*
5. **`React.memo()` on view components** receiving snapshot — ✓ **DONE (v4.5.2 — F28)** 6 heavy views wrapped
6. **Replace `confirm()` in BacklogPanel** with modal system — *open*
7. **Add `<label>` to all form inputs`** (Settings especially) — *open*
8. **Add `role="tab"`/tablist to Topbar** + `aria-selected` — ✓ **DONE (v4.5.2 — F25)**

#### P2 — Medium Impact
9. **`React.lazy()` for views** — code-splitting — *open* (Suspense wrapper landed — F24)
10. **`react-window` for chat/activity/history** — virtual scroll — *open*
11. **`will-change: transform`** on animated elements — *open*
12. **`aria-live="polite"`** on activity/task/chat regions — *open*
13. **Break `main.css` into per-view CSS** files — *open*

#### P3 — Nice to Have
14. **`vitest + @testing-library/react`** for unit/integration tests — *open — Active Focus #2*
15. **`content-visibility: auto`** on long lists — ✓ **DONE (v4.5.2 — F27)**
16. **Extract Settings inline styles** to CSS classes — *open — Active Focus #3*
17. **Unify chat dual implementation** — delete legacy — *open*
18. **WS message queue** for offline resilience — *open*
19. **Document mobile/desktop split architecture** in `README.md` — *open*

---

## Section 7: Improvements — Cross-Cutting (Security, Perf, A11y, Build)

Source: `.obsidian/projects/cross-cutting-audit-2026-07-05.md` (428 lines).

### 7.1 Security — Top Concerns

| # | Concern | Severity | Status |
|---|---------|----------|--------|
| 1 | vitest CVE-2025-30208 (arbitrary file read via Vitest UI) | CRITICAL | **FIXED (F1)** — bumped to 4.1.9 |
| 2 | API keys in plaintext on disk (`opencode.json`) | HIGH | Known tradeoff; prefer env-var rotation (`providers-store.mjs:526-557`) |
| 3 | Dashboard token in URL query params (SSE/WS) | MEDIUM | Mitigated via `replaceState` (api.ts:81-86); see B-M6 |
| 4 | Plain-text secrets in `providers-store.mjs:1185` | HIGH | Same as #2; ✓ [v4.5.0] EnvVarManager landed at `~/.config/bizar/env.json` (mode 0600) |
| 5 | `curl ... | sh` pattern (no hash verification) | MEDIUM | install.sh:180,188,195,217; install.mjs:396-397 — *open* |
| 6 | v1 dashboard server open (`:4097`) | HIGH | See B-H5 — *deferred per v4.5.2 changelog; Tailscale handles auth* |
| 7 | `/api/auth/reveal` returns token in body | LOW | See B-M8 — *open* |

**Recommendations**:
- For installer scripts, add `--verify-sha256 <hash>` flag for known hashes, or wrap in `gpg --verify`.
- For dashboard secrets, consider `keytar` / OS keychain integration (Linux: secret-service; macOS: Keychain; Windows: DPAPI).
- For API keys, the env-var rotation pattern is the right long-term direction — keep nudging users toward it. ✓ [v4.5.0] `getUsageLimitsForAgent()` + env-var manager shipped.

### 7.2 Performance — Bundle Sizes

| Asset | Size | Issue | Status |
|-------|------|-------|--------|
| `main-usWhlPWa.js` (desktop) | 371 KB | OK | ✓ |
| `mobile-O6ANdD4W.js` (mobile) | **476 KB** | Larger than desktop (B-MOBILE-1) | open — Active Focus #5 |
| `main-*.css` | 228 KB | Very large — needs purgecss audit | open |
| `mobile-*.css` | 29 KB | OK | ✓ |
| Source maps | 1.17 MB / 1.88 MB | In npm tarball | ✓ [v4.5.2 — F21] `sourcemap: 'hidden'`; ✓ [v4.5.2 — F22] `.npmignore` excludes `dist/**/*.map` |

**Action items**:
1. ✓ **[DONE v4.5.2 — F21]** Set `vite.config.ts:15` `sourcemap: 'hidden'`
2. ✓ **[DONE v4.5.2 — F22]** Add `.npmignore` rule for `bizar-dash/dist/*.map`
3. *open* — Audit `mobile.tsx` imports — why is it 28% larger? *(Active Focus #5)*
4. *open* — Run purgecss / lighthouse-ci for CSS pruning

### 7.3 Performance — Synchronous I/O on Server

| Hot Path | File | I/O | Cost | Status |
|----------|------|-----|------|--------|
| Log tail via WS (1s tick) | `server.mjs:536-607` | `statSync`+`readSync` per tick | Low freq, OK | ✓ |
| `buildSnapshot` per WS connection | `server.mjs:724-753` | `readFileSync` | Blocks many connections | ✓ [v4.5.2 — F18] now uses cached read |
| `safeReadJSON` per `list()` | `providers-store.mjs:49-58` | `readFileSync`+`JSON.parse` per call | N+1 reads | ✓ [v4.5.2 — F17] 1s debounced cache |
| Providers `list()` | `providers-store.mjs:868-886` | re-parses same JSON | Add 1s debounced cache | ✓ [v4.5.2 — F17] |

### 7.4 Accessibility — WCAG 2.2 AA Gaps (Full List)

Source §3 of cross-cutting audit + §6.5 of frontend analysis.

1. No `<label>` associations in Settings (1763 lines of form fields). — *open*
2. **Topbar tabs lack `role="tablist"`** — ✓ [v4.5.2 — F25]
3. **Toast notifications lack `role="alert"` on errors** — ✓ [v4.5.2 — F23]
4. Activity feed has no `aria-live`. — *open*
5. WS status dot is color-only — no accessible text. — *open*
6. No global `:focus-visible` ring. — *open*
7. SearchModal has no `role="search"`. — *open*
8. Mobile bottom nav no keyboard path. — *open*
9. Color inputs (Settings) lack proper labels. — *open*
10. Confirm dialogs use native `confirm()`. — *open* (B-M3)

### 7.5 Internationalization

- **Zero translation infrastructure**: Every string is hardcoded English.
- **No `Intl.*` wrappers** for dates/numbers.
- **Zero RTL support**: no `dir="auto"`, no logical CSS properties.

For a CLI developer tool this is acceptable. For wider adoption, plan:
- Extract all user-facing strings to `i18n/en.json`.
- Add `i18next` or `react-intl` with locale switcher.
- Use CSS `dir="rtl"` for Arabic/Hebrew.

### 7.6 Testing Gaps

| Domain | Coverage | Status |
|--------|----------|--------|
| SDK | Moderate (3 files) | ✓ |
| Plugin | Excellent (24 files) | ✓ |
| Memory/Secrets | Good | ✓ |
| Dashboard server | Weak (most route files lack tests) | partial — server-bugfixes.test.mjs (v4.5.2, 13 tests) |
| CLI | Moderate (doctor, install, artifact, service tests) | partial — cli-bugfixes.test.mjs (v4.5.2, 9 tests) |
| **Web frontend** | **Zero — no test directory exists** | partial — frontend-bugfixes.test.mjs (v4.5.2, 26 tests) — still no real unit/integration tests |
| Accessibility | **Zero — no aXe, Lighthouse, or Playwright a11y tests** | *open* |
| i18n | **Zero** | *open* |
| Performance | **Zero — no bundle analysis, no perf regression tests** | *open* |
| Memory store concurrent writes | No test | *open* |
| Path-safe symlink traversal | No test | ✓ (path-safe.test.mjs exists) |

**Action**: Add `vitest` + `@testing-library/react` to `bizar-dash/`. Start with smoke tests on 3 views (Settings, Chat, Overview) at 60% target coverage over 3 sprints. *(Active Focus #2)*

**Test totals (post-v4.5.2)**: `npm test` → **388 pass / 0 fail / 94 suites / 30.3 s**.

### 7.7 Observability

- **Logging**: Mix of `console.log`/`error`/`warn` with prefixes (`[bizar-dash]`, `[mod]` etc.). No leveled logger, no correlation IDs. *partial* — `--debug` global flag landed (R7); leveled logger wrapper still pending (S-R6).
- **Metrics**: None. No Prometheus, no counters, no histograms. *open* — see S-R7 / F-NEW-22.
- **Tracing**: None. No OpenTelemetry, no DTrace probes. *open* — see F-NEW-23.
- **Error reporting**: Local crash handlers but no Sentry/DataDog/Honeycomb integration. *open* — see F-NEW-25.
- **Empty catches**: ✓ ~32 of ~55 fixed (F3 + F20); *~23 remain* (Active Focus #4). WS handlers especially.

### 7.8 Build / Packaging

- ✓ [v4.5.2 — F21] **Source maps shipped**: `vite.config.ts:15` set to `sourcemap: 'hidden'`.
- ✓ [v4.5.2 — F22] **`.npmignore`**: excludes `dist/**/*.map`, `**/__tests__/`, `**/*.test.{mjs,ts,tsx}`.
- **`files` array in `package.json`**: Includes `bizar-dash/` which ships `src/` + `dist/` together (double size). — *open*
- **Cross-platform**: ✓ [v4.5.2] `install.sh`/`install.ps1` both fixed (B-C2/B-C3). `/proc/net/tcp` Linux-only (F2 fixed).

### 7.9 Top 10 Critical Issues

| # | Issue | File | Severity | Status |
|---|-------|------|----------|--------|
| 1 | vitest CVE | `package.json:87` | CRITICAL | **FIXED (F1, v4.5.2 prep)** |
| 2 | API keys in plaintext | `providers-store.mjs:1185` | HIGH | partial — ✓ [v4.5.0] EnvVarManager at `~/.config/bizar/env.json` (mode 0600); env-var rotation with cooldown tracking landed. Open — keys still readable if user keeps them in `opencode.json`. |
| 3 | Token in URL | `auth.mjs:187-189`, `ws.ts:29` | MEDIUM | Open — see B-M6 |
| 4 | No metrics/tracing/log levels | server-wide | MEDIUM | Partial — `--debug` flag landed (R7); leveled logger + metrics endpoint still pending (S-R6/R7) |
| 5 | Mobile bundle > desktop | vite build | MEDIUM | Open — see B-MOBILE-1 *(Active Focus #5)* |
| 6 | `/proc/net/tcp` hardcoded | `headroom.mjs:121` | MEDIUM | **FIXED (F2, v4.5.2 prep)** |
| 7 | Source maps shipped | `vite.config.ts:15` | LOW | **FIXED (F21, v4.5.2)** — `sourcemap: 'hidden'` |
| 8 | 228 KB CSS | Vite build | LOW | Open — purgecss pending |
| 9 | Zero i18n | UI-wide | LOW | Open — known gap |
| 10 | Empty catches | server files | MEDIUM | Partial — F3 + F20 fixed ~32 of ~55; **~23 remain** *(Active Focus #4)* |

---

## Section 8: Improvements — Opencode Plugin & SDK

Stream 4 had limited findings but the following gaps are noteworthy. *No v4.5.0/v4.5.1/v4.5.2 release closed items in this section — all open.*

### 8.1 Tool Catalog Coverage

Plugin lives at `plugins/bizar` with 24+ test files (excellent coverage). Tool catalog appears complete for install/update/repair cycle. Gaps:

- **No tool for "agent list"**: The dashboard knows about agents but there's no plugin-side query for "what agents are installed for project X?". Currently the plugin reads `~/.config/opencode/agents/` directly.
- **No tool for "schedule status"**: Schedules live in `routes/schedules.mjs`. Plugin should query/list them.

### 8.2 Hook Coverage

Opencode plugin provides hooks for session lifecycle, command execution, and key rotation. Possible additions:

- **`task-complete` hook**: Fire when an agent task finishes (not just session close).
- **`artifact-create` hook**: Allow post-processing on artifact save (linting, validation, snapshot).
- **`tool-error` hook**: Capture tool errors centrally for telemetry.

### 8.3 SDK Public API

`packages/sdk` (~3 test files). Public API surface is small. Could expose:

- `BizarSDK.listProjects()` — currently only available via REST
- `BizarSDK.watchMemory(callback)` — filesystem watcher already exists in plugin; SDK wrapper would help external tools
- `BizarSDK.createArtifact(spec)` — programmatic artifact creation without HTTP

### 8.4 Agent Briefs / Handoffs

Agent briefs (`.bizar/briefs/*.md`) exist but the handoff protocol is loose. Specifically:

- **No structured handoff schema**: When `@tyr` hands to `@frigg`, the brief is markdown but the receiving agent must infer format. Add a JSON schema for briefs.
- **No brief validation**: A malformed brief is processed as text. Add a `bizar brief validate <path>` command and a schema check.

### 8.5 Documentation Gaps

- **`packages/sdk/README.md`** is sparse — only a usage example.
- **No architectural diagram** of plugin ↔ opencode ↔ dashboard.
- **Hook reference** is buried in JSDoc — extract to `docs/hooks.md`.

---

## Section 9: Improvements — Skills, Docs, Templates

Stream 5 findings. *Several skills shipped in v4.5.0 and v4.5.1 — see §13 and the table below.*

### 9.1 Skills Coverage Gaps

`< 70 lines of body content` skills flagged as "thin". Status indicates what landed in v4.5.0/v4.5.1:

| Skill | Path | Status (post-v4.5.0/v4.5.1) | Issue |
|-------|------|----------------------------|-------|
| `agent-baseline` | `~/.opencode/skills/agent-baseline/` | ✓ [always-on] | Auto-loaded |
| `browser-harness` | `~/.opencode/skills/browser-harness/` | ✓ good | |
| `find-skills` | `~/.agents/skills/find-skills/` | ✓ [v4.5.0] — implicit in skills-cli | short |
| `decision-mapping` | `~/.agents/skills/decision-mapping/` | thin | open |
| `grill-me` | thin | open |
| `grill-with-docs` | thin | open |
| `grilling` | thin | open |
| `loop-me` | thin | open |
| `teach` | thin | open |
| `qa` | thin | open |
| `bizar` | `~/.opencode/skills/bizar/` | ✓ [v4.5.0] | shipped |
| `self-improvement` | `~/.opencode/skills/self-improvement/` | ✓ [v4.5.0] | shipped |
| `obsidian` | extended | ✓ [v4.5.1] extended with Memory tab docs | |
| `lightrag` | extended | ✓ [v4.5.1] extended with Memory tab docs | |
| `minimax` | shipped | ✓ [v4.5.0] | |
| `providers` | shipped | ✓ [v4.5.0] | |
| `chat` | shipped | ✓ [v4.5.0] | |
| `usage` | shipped | ✓ [v4.5.0] | |
| `skills-cli` | shipped | ✓ [v4.5.0] | |
| `sdk` | shipped | ✓ [v4.5.0] | |
| `headroom` | new | ✓ [v4.5.1] — `bizar-dash/skills/headroom/SKILL.md` | |
| 11 shipped total | (see §13) | ✓ |

A "thin" skill is one whose `SKILL.md` is < 70 lines of body content. Add expanded examples, decision matrices, or rename to clearly indicate minimal-depth (e.g., `grilling-quick` vs `grilling-deep`).

### 9.2 Outdated Docs

- ✓ [v4.5.1 — F34] `.opencode/instructions/bizar-tools.md` — broken `headroom plan --tokens` reference replaced with accurate Headroom 0.30.0 commands.
- `wiki/` — needs a fresh audit. The wiki may be stale relative to v4.5.x. *open*
- `docs/installation.md` — may reference old `install.sh` patterns from pre-provisioner era. *open*
- `docs/architecture.md` — pre-dates the v1/v2 server split. *open*

### 9.3 Wiki Pages to Refresh

- `wiki/getting-started.md` — update for v4.5+ command surface. *open*
- `wiki/configuration.md` — document 5 config roots (§5.1). *open*
- `wiki/dashboard-vs-cli.md` — only v2 is current. *open*
- `wiki/troubleshooting.md` — add sections for the bugs fixed this session. *open*

### 9.4 Templates to Add

Currently: `templates/plan/htmx.min.js` is the only one. Add:

- **`templates/artifact/`** — starter MDX for artifact files (already exists in `artifact.mjs` but extracted). *open*
- **`templates/agent-brief.md`** — structured handoff template (see §8.4). *open*
- **`templates/skill/SKILL.md`** — starter skill file. *open*
- **`templates/mod/manifest.json`** — for community mod publishing (see §10 plugin marketplace). *open*

### 9.5 Rules Files

`config/agents/_shared/AGENT_BASELINE.md` exists. Add per-language conventions:

- `rules/typescript.md` — codegen discipline, `any` policy, error boundaries. *open*
- `rules/css.md` — token use, no inline styles, layer ordering. *open*
- `rules/testing.md` — minimum coverage thresholds per directory. *open*

---

## Section 10: Completely New Features (Future)

15-25 genuinely useful new features for an AI agent orchestrator dashboard. Each labeled with effort (S/M/L) and impact (S/M/L).

### AI / Agent Features

#### F-NEW-1: Agent Composition / Handoffs
Define agent graphs (DAGs) where output of one feeds the next. E.g., `@mimir (research) → @tyr (design) → @thor (implement)`. Stored as `briefs/graph.yaml` per project. UI: visual graph editor (React Flow), automatic brief chaining.
*Why*: Currently handoffs are copy-paste-driven. Graphing them makes planning legible.
*Effort*: **M** (1 sprint). *Impact*: **M**.

#### F-NEW-2: Multi-Agent Debate / Voting
Run the same prompt against 3 agents in parallel (`@mimir`, `@tyr`, `@vidarr`); have a 4th agent (`@forseti`) vote on best output. Surface dissenting views.
*Why*: Decision quality improves when alternatives are compared.
*Effort*: **L** (3+ sprints — needs parallel scheduling infra). *Impact*: **H**.

#### F-NEW-3: Eval Framework Integration
`bizar eval run <suite>`. Load golden-file fixtures, run an agent, score outputs (regex match / embedding similarity / LLM-as-judge). Store eval history in `~/.bizar/evals/`.
*Why*: "Move fast and verify things" is the loop every agent tool needs.
*Effort*: **M**. *Impact*: **H**.

#### F-NEW-4: Prompt Playground with A/B Testing
Side-by-side message composer that sends the same prompt with different model/system-prompt/agent configs. Compare responses in a diff view.
*Why*: Configuration tuning is guesswork today.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-5: RLHF-style Thumbs Up/Down
Add 👍/👎 to chat messages. Store as `~/.bizar/feedback/{chatId}/votes.jsonl`. Periodically fine-tune prompts based on negative feedback density.
*Why*: Dataset creation is the bottleneck for prompt iteration.
*Effort*: **S** for UI + storage; **L** for fine-tuning pipeline. *Impact*: **M**.

#### F-NEW-6: Cost Predictor Before Running
Estimate token cost (input length × rate + estimated output) before pressing send. Show "≈$0.13, 2,100 output tokens" inline. Configurable rates per provider.
*Why*: Avoid surprise bills on long-running jobs.
*Effort*: **S**. *Impact*: **M**.

### Collaboration / Multi-User

#### F-NEW-7: Shared Task Boards
Multi-user visibility on `Tasks.tsx`. Each user has identity (local account or git-tracked). Comments on tasks. Auth via existing dashboard secret system.
*Why*: Currently single-operator. Teams need shared state.
*Effort*: **L**. *Impact*: **H**.

#### F-NEW-8: Team Workspaces
Multi-project grouping. A workspace contains N projects with shared permissions, schedules, and memory vault. Stored at `~/.bizar/workspaces/{name}/`.
*Why*: Tenant isolation is required for any team deployment.
*Effort*: **L**. *Impact*: **H**.

#### F-NEW-9: @-mentions and Notifications
In chat/comments/tasks, `@tyr` notifies that agent (queues a task if offline). Dashboard notification bell shows aggregate.
*Why*: Current notification model is fire-and-display. Mentions make it actionable.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-10: Comment Threads on Artifacts
Artifacts already have rich content. Add comments sidebar (`comments.jsonl` per artifact). Markdown comments with `@mentions`.
*Why*: Review workflow needs first-class threading.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-11: Live Cursors in Artifact Canvas
WebSocket-based cursor tracking so multiple users see each other's pointer while editing a canvas artifact.
*Why*: Real-time collaboration is table stakes for shared editors.
*Effort*: **L** (CRDT or OT required). *Impact*: **L** (niche).

### Memory / Knowledge

#### F-NEW-12: Voice Notes → Transcripts
Mobile-app record button. Audio uploaded to server, transcribed via Whisper (local or API), saved as note in memory vault.
*Why*: Voice capture is faster than typing for ideation.
*Effort*: **M**. *Impact*: **H**.

#### F-NEW-13: Screenshot → OCR + Note
Paste/upload an image. Run OCR (Tesseract or cloud). Save extracted text + image to a memory note. Searchable via full-text search.
*Why*: Visual references (screenshots, whiteboard photos) are common but text-search-invisible today.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-14: Web Clipper Extension
Browser extension (Chrome + Firefox) that captures the current page (DOM/selection/article-mode) and saves to the dashboard memory vault.
*Why*: Default to the existing web-clipper UX from Obsidian/Notion/Evernote.
*Effort*: **M**. *Impact*: **H**.

#### F-NEW-15: Auto-Generated Weekly Digests
Every Sunday 00:00, the server generates a memory note summarising the week's session activity, tasks completed, agents used, costs incurred.
*Why*: Auto-recap saves explicit review time.
*Effort*: **S**. *Impact*: **M**.

#### F-NEW-16: Memory Graph Visualization
A force-directed graph (e.g., `vis-network` or `d3-force`) showing notes as nodes, links as edges. Click a node to open. Already powered by the `lightrag` knowledge index.
*Why*: Connections are hard to read in linear note lists.
*Effort*: **M**. *Impact*: **M**.

### DevOps / Deployment

#### F-NEW-17: One-Click Deploy
`bizar deploy --to vercel|cloudflare|fly|render`. Reads `bizar` config, generates appropriate infra (wrangler.toml, vercel.json, Dockerfile), deploys.
*Why*: Cuts a deployment step from 30 min to 30 sec.
*Effort*: **M**. *Impact*: **H**.

#### F-NEW-18: Self-Hosted Dashboard (Docker)
`docker run -p 4097:4097 polderlabs/bizar-dash`. Single image, mount vault dir as volume. Healthcheck. Logs to stdout.
*Why*: Self-hosting is required for many enterprise policies.
*Effort*: **S**. *Impact*: **H**.

#### F-NEW-19: Backup / Restore Dashboard State
`bizar backup --to <path>` creates a tarball of all state (`.bizar/`, `~/.config/bizar/`, `~/.cache/bizarharness/`). `bizar restore <tarball>` validates checksum and restores.
*Why*: Recovery story matters for any production tool.
*Effort*: **S**. *Impact*: **H**.

#### F-NEW-20: Multi-Project Dashboards
Spin up N dashboard instances behind a single host entry (`projects/{name}.bizar.dev`). Single sign-on, shared config.
*Why*: SaaS offering requires multi-tenant.
*Effort*: **L**. *Impact*: **H**.

#### F-NEW-21: Mobile Companion App (React Native)
The current "mobile" is a responsive web subapp. Native iOS/Android app with push notifications and background sync of memory notes.
*Why*: Push notifications + camera/voice access need native.
*Effort*: **L**. *Impact*: **M**.

### Observability

#### F-NEW-22: Metrics Endpoint (Prometheus)
`/metrics` returns Prometheus text format: `bizar_http_requests_total{route}`, `bizar_ws_clients`, `bizar_opencode_json_size_bytes`, etc.
*Why*: Standard observability integration path.
*Effort*: **S**. *Impact*: **M**.

#### F-NEW-23: OpenTelemetry Export
Wrap all HTTP/WS calls in OTel spans. Export to any OTLP-compatible backend (Jaeger, Honeycomb, Tempo).
*Why*: Distributed tracing for cross-service debugging.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-24: Audit Log Viewer
Dashboard view of `~/.bizar/audit.log` with filtering by user, action, time range. Currently no UI for this.
*Why*: Compliance + debugging needs.
*Effort*: **S**. *Impact*: **M**.

#### F-NEW-25: Error Tracking Integration (Sentry)
DSN config in env vars; auto-report unhandled exceptions and WS errors.
*Why*: Production debugging without access to user machines.
*Effort*: **S**. *Impact*: **H**.

### Power User

#### F-NEW-26: Custom Themes
User can pick from a theme gallery or load a CSS file. Currently dark + light only.
*Why*: Personalization drives lock-in.
*Effort*: **M**. *Impact*: **L**.

#### F-NEW-27: Keyboard Shortcut Customizer
`/` to focus search. Add remappable per-action shortcuts, persisted in settings.
*Why*: Power users live in the keyboard.
*Effort*: **M**. *Impact*: **L**.

#### F-NEW-28: Plugin Marketplace
A registry of mods/plugins (centralized or federated). `bizar mod install <id>` pulls from registry, validates manifest, installs.
*Why*: Community contributions accelerate feature pace.
*Effort*: **L**. *Impact*: **H**.

#### F-NEW-29: Webhook Integrations
User defines webhooks (URL + payload template + trigger event). On event, server POSTs to URL. Trigger events: `task.complete`, `agent.idle`, `schedule.fire`.
*Why*: External automation (Slack, CI/CD, monitoring).
*Effort*: **M**. *Impact*: **H**.

#### F-NEW-30: CLI for Everything
Every dashboard action should be available via `bizar ...`. Currently many views have no CLI equivalent.
*Why*: Scriptability.
*Effort*: **L** (ongoing). *Impact*: **M**.

### Integrations

#### F-NEW-31: GitHub Issues Sync
Bidirectional sync between dashboard tasks and GitHub Issues. PR labels map to task status.
*Why*: Most open-source projects track work in GH.
*Effort*: **M**. *Impact*: **H**.

#### F-NEW-32: Linear Sync
Same as F-NEW-31 but for Linear.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-33: Notion Sync
Push memory notes to a Notion database. Pull Notion pages as notes.
*Why*: Many users live in Notion.
*Effort*: **M**. *Impact*: **M**.

#### F-NEW-34: Slack Notifications
Per-project channel subscriptions. When a task moves or an agent finishes, post to Slack.
*Why*: Async-first teams.
*Effort*: **S**. *Impact*: **M**.

#### F-NEW-35: Discord Webhooks
Same as Slack but for Discord.
*Effort*: **S**. *Impact*: **L**.

---

## Section 11: Roadmap (Updated 2026-07-05)

### ✓ Shipped

- **v4.5.0** — Settings overhaul, provider backup keys, usage analytics, chat overhaul, skills tab fix, task creation simplify, UI consistency pass
- **v4.5.1** — Headroom default compression + full Memory tab
- **v4.5.2** — Bug-fix sweep (16 fixes across CLI, server, frontend, build)

### Up Next (proposed)

- **v4.6** — Quality & Stability
  - [ ] Split `cli/bin.mjs` (1464 lines) into `cli/commands/*.mjs`
  - [ ] Split `cli/artifact.mjs` (~2100 lines) into 3 modules
  - [ ] Add web frontend test infrastructure (vitest + @testing-library/react)
  - [ ] Add structured logging across server
  - [ ] Eliminate remaining empty catch blocks (~23 of them)
  - [ ] Refactor Settings.tsx (1823 lines) into sub-components
  - [ ] Add virtual scrolling for chat/activity/history

- **v4.7** — Performance & Polish
  - [ ] Mobile JS bundle > desktop investigation (476 KB vs 371 KB)
  - [ ] Centralize which() and bizarConfigDir() (3 duplicates → 1)
  - [ ] Cache-Control headers on API responses
  - [ ] Add metrics endpoint (/metrics in Prometheus format)
  - [ ] OpenTelemetry export
  - [ ] Full WCAG 2.2 AA compliance
  - [ ] i18n infrastructure (translation bundles, locale switching)

- **v4.8** — Memory & Knowledge
  - [ ] Voice notes → transcripts (Whisper integration)
  - [ ] Web clipper browser extension
  - [ ] Auto-generated weekly digests
  - [ ] Memory graph visualization
  - [ ] Screenshot → OCR + note

- **v5.0** — Major release
  - [ ] Multi-user / team workspaces
  - [ ] Plugin marketplace
  - [ ] Eval framework integration
  - [ ] One-click deploy (Vercel/Cloudflare/Fly)
  - [ ] Self-hosted dashboard (Docker)
  - [ ] Backup/restore the entire dashboard state

---

## Section 12: Effort vs Impact Matrix (Updated 2026-07-05)

All improvements from §3–§10, ranked. Status column added — `✓` = done in v4.5.0/1/2, `[~]` = partial, `[ ]` = remaining.

### Quick Wins Done (S effort, ≥ M impact) — ✓

| # | Item | Source | Effort | Impact | Status |
|---|------|--------|--------|--------|--------|
| 1 | Add `--json` global flag (R6) | §4 | S | M | ✓ [v4.5.2] |
| 2 | Add `--debug` global flag (R7) | §4 | S | M | ✓ [v4.5.2] |
| 3 | `sourcemap: 'hidden'` (R3 of build) | §7 | S | M | ✓ [v4.5.2 — F21] |
| 4 | `.npmignore` `*.map` | §7 | S | L | ✓ [v4.5.2 — F22] |
| 5 | Centralize `bizarConfigDir()` (R5) | §4 | S | M | [ ] |
| 6 | Centralize `which()` (R4) | §4 | S | L | [ ] |
| 7 | AbortController on remaining ~11 views | §6 | S | M | [~] 4 of 15+ (F5) |
| 8 | Replace `Math.random()` IDs with `crypto.randomUUID()` (B-M9) | §3 | S | L | [ ] |
| 9 | Set `cache-control` headers on API | §7 | S | L | [ ] |
| 10 | Replace `confirm()` in BacklogPanel (B-M3) | §3 | S | L | [ ] |
| 11 | Cost predictor before send (F-NEW-6) | §10 | S | M | [ ] |
| 12 | Backup/restore (F-NEW-19) | §10 | S | H | [ ] |
| 13 | Prometheus `/metrics` (F-NEW-22) | §10 | S | M | [ ] |
| 14 | Sentry integration (F-NEW-25) | §10 | S | H | [ ] |
| 15 | Slack notifications (F-NEW-34) | §10 | S | M | [ ] |
| 16 | Auto weekly digests (F-NEW-15) | §10 | S | M | [ ] |
| 17 | Audit log viewer UI (F-NEW-24) | §10 | S | M | [ ] |
| 18 | Standardize exit codes (R8) | §4 | S | L | ✓ [v4.5.2] |
| 19 | Purgecss audit (B-L1) | §7 | S | M | [ ] |
| 20 | `*:focus-visible` global ring (B-L2) | §7 | S | M | [ ] |

### Medium Effort, High Impact

| # | Item | Source | Effort | Impact | Status |
|---|------|--------|--------|--------|--------|
| 21 | Split `bin.mjs` into `cli/commands/` (R1) | §4 | M | H | [ ] Active Focus #1 |
| 22 | Split `artifact.mjs` into 3 files (R2) | §4 | M | H | [ ] Active Focus #1 |
| 23 | Remove or auth-protect v1 server (B-H5) | §3/§5 | M | H | [ ] Deferred — Tailscale handles auth |
| 24 | React.lazy() per-view | §6 | M | H | [~] Suspense landed (F24); per-view lazy pending |
| 25 | Web frontend test infra + smoke tests | §7 | M | H | [~] bugfix tests only; still no real unit/integration tests — Active Focus #2 |
| 26 | `<label>` on Settings inputs (a11y) | §7 | M | H | [ ] |
| 27 | `React.memo()` on snapshot receivers | §6 | M | M | ✓ [v4.5.2 — F28] |
| 28 | virtual scrolling (react-window) | §6 | M | M | [ ] |
| 29 | Structured logging + correlation IDs (S-R6) | §5 | M | H | [~] `--debug` flag landed (R7); leveled logger wrapper pending |
| 30 | Rate limiting (S-R3) | §5 | M | M | [ ] |
| 31 | `oauth` for V2 — actually, env-var key rotation already exists | §5 | M | M | [~] EnvVarManager + provider backup keys landed v4.5.0; full ACL system still pending |
| 32 | i18n infrastructure (i18next) | §7 | M | H | [ ] |
| 33 | Voice notes → transcripts (F-NEW-12) | §10 | M | H | [ ] |
| 34 | Screenshot OCR (F-NEW-13) | §10 | M | M | [ ] |
| 35 | Web clipper extension (F-NEW-14) | §10 | M | H | [ ] |
| 36 | Memory graph viz (F-NEW-16) | §10 | M | M | [ ] |
| 37 | Webhook integrations (F-NEW-29) | §10 | M | H | [ ] |
| 38 | Eval framework (F-NEW-3) | §10 | M | H | [ ] |
| 39 | A/B prompt playground (F-NEW-4) | §10 | M | M | [ ] |
| 40 | One-click deploy (F-NEW-17) | §10 | M | H | [ ] |
| 41 | `aria-live` on activity/task/chat regions | §6 | S | M | [ ] |
| 42 | Settings.tsx → sub-components (a11y + scoping) | §6 | M | M | [ ] Active Focus #3 |
| 43 | Mobile bundle > desktop (B-MOBILE-1) | §6 | M | M | [ ] Active Focus #5 |
| 44 | `content-visibility: auto` on long lists | §6 | S | M | ✓ [v4.5.2 — F27] |
| 45 | WS message queue | §6 | M | M | [ ] |
| 46 | Per-view CSS splitting (main.css 8901 lines) | §6 | M | M | [ ] |
| 47 | Headroom full integration | §4–§5 | L | M | ✓ [v4.5.1] |
| 48 | Full Memory tab | §5 | L | M | ✓ [v4.5.1] |
| 49 | Settings overhaul + EnvVarManager | §5 | L | H | ✓ [v4.5.0] |
| 50 | Provider catalog + backup keys | §5 | L | H | ✓ [v4.5.0] |
| 51 | Usage analytics (JSONL + chart + per-model table) | §5 | L | H | ✓ [v4.5.0] |
| 52 | Chat overhaul (SSE, useChat rewrite) | §5 | L | H | ✓ [v4.5.0] |
| 53 | Tasks kanban board | §5 | M | M | ✓ [v4.5.0] |

### Larger Investments (L effort; gate behind roadmap)

| # | Item | Source | Effort | Impact |
|---|------|--------|--------|--------|
| 54 | Multi-user / team workspaces (F-NEW-7/8) | §10 | L | H |
| 55 | Plugin marketplace (F-NEW-28) | §10 | L | H |
| 56 | React Native mobile (F-NEW-21) | §10 | L | M |
| 57 | Multi-agent debate (F-NEW-2) | §10 | L | H |
| 58 | Live cursors in canvas (F-NEW-11) | §10 | L | L |
| 59 | GitHub Issues sync (F-NEW-31) | §10 | L | H |
| 60 | Multi-project dashboards (F-NEW-20) | §10 | L | H |
| 61 | CLI for everything (F-NEW-30) | §10 | L | M |

### Quick-Win → Roadmap Mapping (Updated)

- **v4.6** [ ] items 5, 6, 8, 9, 10, 11, 12, 19, 20, 26 (remaining quick wins + a11y) + items 21, 22, 25, 42, 43 (active focus) + item 23 (deferred)
- **v4.7** [ ] items 24, 28, 29, 30, 32, 41, 46 (perf + a11y)
- **v4.8** [ ] items 33-40 (memory features)
- **v5.0** [ ] items 54-61 (collaboration)
- **Shipped (✓)**: items 1-4, 7 (partial), 18, 27, 44, 47-53 (v4.5.0/v4.5.1/v4.5.2)

---

## Section 13: What's Done

This section tracks the work completed across v4.5.0 → v4.5.2. Items marked "✓ DONE" in §3-§10 below reference this section.

### v4.5.0 — Settings + Provider + Usage + Chat overhaul

**Settings overhaul:**
- ✓ Config tab merged into Settings (was §4 R12 / §6)
- ✓ Settings restructured with section nav: General / Env Vars / Providers / Memory / System LLM / Updates / Skills / Dashboard
- ✓ EnvVarManager component for BIZAR_* env vars at ~/.config/bizar/env.json (mode 0600)
- ✓ SettingsSearch component + global search modal scope
- ✓ No plaintext API keys — every key reference is a managed env var

**Provider subsystem:**
- ✓ PROVIDER_CATALOG with 13 entries (opencode, anthropic, openai, google, minimax, groq, mistral, cohere, openrouter, deepseek, ollama, lmstudio, custom)
- ✓ Fuzzy search + single-key auto-add wizard (`POST /api/providers/auto`)
- ✓ Backup keys per provider with auto-rotation on auth/quota/rate-limit/429/5xx
- ✓ Key cooldown tracking, status management
- ✓ LightRAG defaults to free opencode Zen models
- ✓ Memory settings tab (LightRAG + Obsidian + git repo)

**Usage monitoring:**
- ✓ JSONL store at ~/.local/share/bizar/usage.jsonl
- ✓ Tracks prompt/completion/cached/reasoning tokens, requests, errors, latency
- ✓ Interactive SVG chart (hand-rolled, no library)
- ✓ Per-model breakdown table with sortable columns
- ✓ Time-range picker (24h/7d/30d/custom)
- ✓ `getUsageLimitsForAgent(providerId)` — agents know their limits
- ✓ CLI: `bizar usage [range]`

**Chat overhaul:**
- ✓ Fixed "can't open an opencode session" (SSE reconnect + per-session event gating)
- ✓ Fixed "can't create a new session" (was bare `fetch('/chat/sessions')` → 404)
- ✓ `useChat.ts` rewrite with SSE reconnect-with-backoff, optimistic-send dedupe
- ✓ POST/PATCH/DELETE /api/opencode-sessions[/...] for create/rename/delete
- ✓ MobileChat.tsx overhaul

**Tasks.tsx:**
- ✓ Agent picker removed from task creation
- ✓ Backlog/Todo/In-progress/Done/Failed kanban board
- ✓ Move/retry/edit/delete actions

**Skills tab:**
- ✓ Skills tab shows Bizar skills (was only showing `skills` CLI output)
- ✓ Search output fixed (no more terminal ASCII garbage)
- ✓ 11 shipped skills: bizar, agent-baseline, self-improvement, obsidian, minimax, providers, chat, usage, skills-cli, lightrag, sdk

**Update flow:**
- ✓ `bizar update` gains --check, --channel, --no-restart
- ✓ /api/updates/{status,check,apply} with WS progress events

**UI consistency:**
- ✓ --spacing-xs/-sm/-md/-lg/-xl tokens added
- ✓ Compact-mode overrides

### v4.5.1 — Headroom + Memory tab

**Headroom full integration:**
- ✓ `bizar-dash/src/server/headroom.mjs` — getHeadroomStatus, getHeadroomStats, installHeadroom, wrapOpencode, etc.
- ✓ /api/headroom/* endpoints (status, stats, install, wrap, unwrap, proxy start/stop, auto-route)
- ✓ Settings → Headroom section with all toggles + action buttons
- ✓ Auto-install/wrap/start on dashboard startup (try/catch)
- ✓ `bizar headroom status|stats|install|wrap|unwrap|start|stop|doctor`
- ✓ Dedicated Headroom skill at bizar-dash/skills/headroom/SKILL.md
- ✓ Doc fix: .opencode/instructions/bizar-tools.md (was §9 outdated reference)

**Full Memory tab:**
- ✓ Dedicated tab between Skills and Settings (Sidebar + Topbar)
- ✓ 5 panels: Overview / LightRAG / Obsidian / Git Sync / Semantic Search / Config
- ✓ MemoryStatusCard on Overview
- ✓ 11 new endpoints (health, storage, git diff, lightrag stats/reindex/rebuild, obsidian tree/backlinks/notes, semantic-search)
- ✓ Obsidian façade at bizar-dash/src/server/memory-obsidian.mjs
- ✓ Skills: obsidian and lightrag extended with Memory tab docs

**Tasks:**
- ✓ Two tasks added to Bizar task store (tsk_b1c8add787, tsk_abb21919a5)

### v4.5.2 — Bug-fix sweep (16 fixes)

**CLI + installer (10):**
- ✓ parseWithModsFlag: error on empty value (was silent return [])
- ✓ `dashboard` deprecation → stdout instead of stderr
- ✓ install.ps1 syntax errors fixed (extra `}`, broken elseif)
- ✓ install.ps1 Start-Process splatting fixed
- ✓ install.sh banner moved to after provisioner succeeds
- ✓ npm install gets 10-min timeout
- ✓ check-deps.mjs: Windows path.join(), new deps (pip, python3, headroom, semble, skills, jq, gh), --json flag
- ✓ artifact.mjs: WSL browser detection → cmd.exe /c start
- ✓ Global --json flag (doctor, usage, memory status)
- ✓ Global --debug flag (DEBUG=bizar:*)
- ✓ Standardized exit codes (0=OK, 1=ERROR, 2=USAGE, 3=MISSING_DEP, 4=TIMEOUT)

**Dashboard server (4):**
- ✓ providers-store.mjs: 1s debounced cache for opencode.json (with mtime/size stamp check)
- ✓ server.mjs buildSnapshot uses cached read
- ✓ routes/chat.mjs: per-session delta buffer cap (1000)
- ✓ memory-lightrag.mjs: console.warn on all silent catches

**Dashboard web + build (6 fixes + 2 perf):**
- ✓ vite.config.ts: sourcemap 'hidden' (drops ~3 MB from npm tarball)
- ✓ .npmignore: excludes dist/**/*.map, **/__tests__/, **/*.test.{mjs,ts,tsx}
- ✓ Toast.tsx: role="alert" aria-live="assertive"
- ✓ App.tsx: Suspense wrapper with Spinner fallback
- ✓ Tasks/Settings/Memory/Overview/Skills/MiniMaxUsage wrapped in React.memo
- ✓ Topbar.tsx: role="tablist" + role="tab" + aria-selected
- ✓ App.tsx: removed redundant /snapshot refetch on file-change
- ✓ main.css: content-visibility: auto on activity/task/chat lists

**Bug fixes already done in v4.5.2 prep (cross-cutting audit):**
- ✓ vitest CVE-2025-30208 — bumped ^2.1.0 → ^4.1.9
- ✓ /proc/net/tcp macOS — platform guard
- ✓ 27 empty catch blocks filled with console.warn
- ✓ MiniMaxUsage stale closure — added customFrom/customTo deps
- ✓ AbortController added to Skills/Settings/MemoryOverview/Overview
- ✓ CSS token duplication — merged duplicate :root blocks
- ✓ ViewErrorBoundary added to App.tsx

### Tests added in v4.5.0 + v4.5.1 + v4.5.2

- 56 v4.5.0 tests (env-vars, lightrag, provider search, usage store, chat-usage, skills, chat session, tasks, update)
- 24 Headroom tests + 40 Memory tests (v4.5.1)
- 9 CLI + 13 server + 26 frontend bugfix tests (v4.5.2)
- 48 new bug-fix tests
- Total `npm test` after v4.5.2: 388 pass / 0 fail

### Auth note (v4.5.2)

Auth-related items were intentionally skipped per the v4.5.2 changelog: "Auth-related items intentionally skipped — Tailscale handles auth." Items that remain open on this front: B-H5 (v1 server open on :4097), B-M6 (token in URL), B-M8 (`/api/auth/reveal` echoes token).

---

## Final Notes

This document is the deliverable for the research session on 2026-07-05, updated same-day after v4.5.0/v4.5.1/v4.5.2 shipped. Next research sweep is suggested in 3-4 months. All file:line references are accurate as of the session; new features and bugs that land in the meantime should be appended to §13 "What's Done", not folded into the bug lists.

For sprint planning, start with Section 12 (Effort vs Impact Matrix) and §11 (Roadmap v4.6 onwards). Items marked ✓ in §3-§10 are closed; remaining work is tracked in §3 (Bugs), §10 (Features), and §11 (Roadmap).

---

**Summary**: `/home/drb0rk/Projects/BizarHarness/SUGGESTIONS.md` updated to reflect three shipped releases. Top 3 remaining priorities (post-v4.5.2): (1) Split `bin.mjs` and `artifact.mjs` monoliths (R1, R2) — Active Focus; (2) Add Web frontend test infrastructure (real unit/integration tests — bugfix tests alone are insufficient); (3) Refactor Settings.tsx (1823 lines) into sub-components.
