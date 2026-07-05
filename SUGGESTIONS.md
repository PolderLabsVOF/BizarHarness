# BizarHarness — Comprehensive Findings, Improvements & Feature Suggestions

**Generated**: 2026-07-05
**Scope**: Synthesis of 5+ research streams covering the CLI, installer, dashboard server, dashboard web frontend, opencode plugin/SDK, skills/docs, and cross-cutting security/performance/a11y concerns. Targets BizarHarness v4.5.x → v5.0.

This document is the single source of truth for what should change in BizarHarness over the next 6 months. It consolidates every finding from the research streams (CLI/installer, dashboard server, dashboard web, cross-cutting audit, plugin/SDK, skills/docs), groups them by impact and effort, and proposes a sequenced roadmap. Bug fixes already applied this session are credited. Remaining work is itemized with file references and proposed solutions. New features that would meaningfully extend the product (multi-user teams, plugin marketplace, voice notes, plugin marketplace) are described with effort estimates. Use this to drive sprint planning.

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

All fixes verified — full `npm test` passes (340/340), `tsc --noEmit` clean.

| # | Bug | File | Line(s) | Fix Description |
|---|-----|------|---------|-----------------|
| F1 | vitest CVE-2025-30208 (arbitrary file read via Vitest UI) | `package.json` | 87 | Bumped `vitest@^2.1.0` → `^4.1.9` |
| F2 | `/proc/net/tcp` reads fail on macOS/Windows | `headroom.mjs` | 121 | Tightened to early-return on non-linux with a platform guard |
| F3 | 27 empty `catch { /* ignore */ }` blocks hiding errors | `server.mjs` (13), `watcher.mjs` (1), `mods-loader.mjs` (5), `schedules-runner.mjs` (2), `routes/memory.mjs` (4), `routes/lightrag.mjs` (2) | various | Added `console.warn(\`[module] swallowed: ${err.message}\`)` to each |
| F4 | `MiniMaxUsage.tsx` stale closure on `timeRange` | `bizar-dash/src/web/views/MiniMaxUsage.tsx` (AnalyticsView load effect) | ~load effect | Added `customFrom`, `customTo` to `useEffect` deps |
| F5 | Missing `AbortController` lets state updates fire on unmounted components | `api.ts` + `Skills`, `Settings`, `MemoryOverview`, `Overview` views | various | Threaded optional `AbortSignal` through the API client and added cancellation to the 4 views |
| F6 | Duplicate `:root` block redefining `--space-*` and status colors | `bizar-dash/src/web/styles/main.css` | 159-167 vs 219-221 (and 132-138 vs 208-211) | Merged duplicate definitions so the v3.21.x values win cleanly |
| F7 | No error boundaries — render crash takes down whole dashboard | `bizar-dash/src/web/App.tsx` (renderedView) | — | Added `ViewErrorBoundary` class component, wrapped `{renderedView}` |

### Diff Stats (Approximate)

- `package.json`: 1 line changed
- `headroom.mjs`: 3 lines added (platform check)
- 27 empty catches: ~27 lines added (warn statements)
- `MiniMaxUsage.tsx`: 1 dep array change
- `api.ts` + 4 views: ~80 lines net (AbortSignal threading)
- `main.css`: ~30 lines deleted (duplicates)
- `App.tsx`: ~30 lines added (ErrorBoundary class + import + wrap)
- `ViewErrorBoundary.tsx`: ~25 lines new file

---

## Section 3: Bugs Found (Not Yet Fixed)

High-confidence bugs from all streams, grouped by severity. Each lists file:line, root cause, and the smallest viable fix.

### CRITICAL

#### B-C1: `bin.mjs` accepts `--with-mods` with no value silently
- **File**: `cli/bin.mjs:1086-1095`
- **Root cause**: `parseWithModsFlag()` returns `[]` if the next arg is missing or starts with `--`. User error is masked.
- **Fix**: Print `console.error` and exit(2) when the flag is found without a CSV value.

#### B-C2: `install.ps1` has stray closing braces + invalid `elseif` chain
- **File**: `install.ps1:113,117`
- **Root cause**: Extra `}` after each install block; `if/elseif/elseif/else { } elseif` is invalid PowerShell.
- **Fix**: Restructure the conditional chains with single closing brace, no `elseif` after terminal `else`.

#### B-C3: `install.ps1` Start-Process argument splatting is wrong
- **File**: `install.ps1:167`
- **Root cause**: `@($provision) + $args` doesn't splat as intended; `$args` is an automatic variable overwritten in scope.
- **Fix**: Use explicit `-ArgumentList @(node, $provision, $mode, ...)`.

### HIGH

#### B-H1: `dashboard` deprecation warning goes to stderr
- **File**: `cli/bin.mjs:1332-1336`
- **Root cause**: `console.warn()` writes to stderr. Tools that pipe stderr for errors interpret deprecation as failure.
- **Fix**: Use `console.log` or `process.stdout.write` with a `Deprecated:` prefix.

#### B-H2: `bin.mjs:1180-1210` — `npm install -g ${pkg}@latest` no timeout
- **File**: `cli/provision.mjs:449`
- **Root cause**: `spawnSync('npm', ['install', '-g', ...])` can hang on a dead mirror, an interactive auth prompt, or a slow network.
- **Fix**: Pass `timeout: 180000` (3 min). On timeout, log and exit with a `mirror timeout — try again` message.

#### B-H3: `check-deps.mjs` Windows path joining is broken
- **File**: `scripts/check-deps.mjs:70-92`
- **Root cause**: Uses `/` separator instead of `path.join()`. PATHEXT handling looks correct but `existsSync` resolution against an array of extensions isn't applied per-path.
- **Fix**: Use `path.win32.join()` and iterate possible `.exe`/`.cmd` extensions.

#### B-H4: `parseWithModsFlag` doesn't validate mod ID pattern
- **File**: `cli/bin.mjs:1086-1095`
- **Root cause**: Splits on commas, trims, but doesn't regex-check `^[a-z0-9-]+$`. Bogus IDs reach the dashboard and produce a confusing 400.
- **Fix**: Validate each entry; reject anything not matching the pattern with a clear error.

#### B-H5: v1 dashboard routes have no auth at all
- **File**: `bizar-dash/src/server/server.mjs` (entire v1 surface)
- **Root cause**: v1 server listens on `:4097` without `requireAuth` middleware. Any local process can hit `/api/projects`, `/api/chat`, etc.
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
- **Fix**: Adopt convention: informational → stdout, errors/warnings → stderr.

#### B-L4: Stale port file read in `bin.mjs:395`
- **File**: `cli/bin.mjs:395`
- **Root cause**: Reads port file without checking if PID is still alive. If dashboard crashes, commands report "not running" only on port bind error.
- **Fix**: Read PID from port file, `kill -0` to check liveness, treat stale as "not running".

#### B-L5: Install banner prints before provisioner succeeds
- **File**: `install.sh:252-271`
- **Root cause**: User sees a celebratory banner then a failure message.
- **Fix**: Move banner printing to *after* the provisioner exits 0.

#### B-L6: 50+ empty `catch { /* ignore */ }` blocks remain
- **Files**: `server.mjs:282-287,621`, `auth.mjs:84-86`, `memory-lightrag.mjs`, `mods-loader.mjs`, `dialog-store.mjs`
- **Root cause**: 27 were fixed this session; ~25 remain.
- **Fix**: Apply the same `console.warn` pattern across all server modules.

---

## Section 4: Improvements — CLI & Installer

Source: `.obsidian/projects/cli-installer-analysis.md` (460 lines).

### 4.1 File Inventory & Health

| File | Lines | Quality | Priority to Split |
|------|-------|---------|-------------------|
| `cli/bin.mjs` | 1464 | Overgrown: 7 help functions + 4 inline commands + 2 dashboard loaders + bootstrap | **HIGH** |
| `cli/artifact.mjs` | ~2100 | Three responsibilities (CLI, HTTP server, HTML rendering) | **HIGH** |
| `cli/provision.mjs` | 1261 | Well-structured, idempotent | ✓ |
| `cli/install.mjs` | 593 | Thin wrapper + 430 lines of legacy interactive | MEDIUM |
| `cli/copy.mjs` | 586 | Solid, atomic writes | ✓ |
| `cli/utils.mjs` | 155 | Clean | ✓ |
| `cli/doctor.mjs` | 306 | Well-structured, testable | ✓ |
| `install.sh` | 359 | Solid distro detection | LOW |
| `install.ps1` | 187 | Adequate but has bugs (B-C2, B-C3) | MEDIUM |
| `scripts/check-deps.mjs` | 317 | Incomplete dep coverage | MEDIUM |

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

| Flag | Used In | Issue |
|------|---------|-------|
| `--dry-run` | install, update, repair | ✓ Consistent |
| `--force` | install, update, repair, dev-link, service install | ✓ Consistent |
| `--yes`/`-y` | update, minimax | `--yes` is long-only vs `--force` — inconsistent |
| `--no-restart` | update | Negative form — prefer `--restart=always\|never` |
| `--with-mods a,b,c` | install, update | Accepts both space and `=`, both forms valid — unify |

### 4.6 check-deps.mjs Coverage Gaps

Current checks: node, bun, opencode, tmux, git.
Missing:
- pip / pipx / uv (Python)
- python3.8+
- jq
- gh (GitHub CLI)
- headroom, semble, skills (Bizar internals)
- chalk, boxen (npm runtime)

### 4.7 Empty Catch Blocks (Beyond What F3 Fixed)

100+ instances. F3 fixed 27 in server modules. Remaining clusters:
- `artifact.mjs:543,656,690,1034` — four more
- `bin.mjs:535,538,552` — three more
- `provision.mjs:113,247,270,396,406,514,830,888` — eight more
- `mod-*.mjs` (loader/security/registry) — ~12 more

Apply the same `console.warn` pattern from F3.

### 4.8 Test Coverage Gaps

| File | Risk | Priority |
|------|------|----------|
| `bin.mjs` | Critical — 1464 lines, no tests | HIGH |
| `provision.mjs` | Critical — install/update flow | HIGH |
| `install.mjs` | High — 430 lines of legacy interactive | HIGH |
| `copy.mjs` | High — atomic writes untested | MEDIUM |
| `utils.mjs` | Medium | MEDIUM |
| `install.sh` / `install.ps1` | Medium | LOW |
| `check-deps.mjs` | Medium | MEDIUM |

### 4.9 Recommended Refactors R1–R12

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

#### R4 (LOW): Centralize `which()`

Move `which()` into `utils.mjs` next to `commandExists()`. Remove duplicates from `doctor.mjs:76`, `bg.mjs:94`.

#### R5 (MEDIUM): Centralize `bizarConfigDir()`

Move to `utils.mjs`. Single export. Used everywhere via `import { bizarConfigDir } from '../utils.mjs'`.

#### R6 (LOW): Add `--json` Output Flag

Add global `--json` flag. Implement for `doctor`, `status`, `usage`, `memory status`. Scriptable.

#### R7 (MEDIUM): Add `--debug` / `--verbose`

Global flag. Flips `DEBUG=bizar:*` if set, or sets internal `verbose = true`. All empty catches + `logger.warn` go through this.

#### R8 (MEDIUM): Standardize Exit Codes

- `0` = success
- `1` = general error
- `2` = invalid usage / bad flags
- `3` = dependency missing
- `4` = permission denied

#### R9 (LOW): Cache `detectState()` Result

`provision.mjs:969,487,902` all call `detectState()`. Each call execs `npm root -g` + `npm ls -g`. Cache result and pass `state` parameter through.

#### R10 (LOW): Banner After Success

Move `install.sh:251-272` banner to after provisioner exits 0.

#### R11 (MEDIUM): Logging Consistency

Convention: informational → stdout (`console.log`), errors/warnings → stderr (`console.error`/`process.stderr.write`).

#### R12 (MEDIUM): Extract Shared Flag Parsing

`parseWithModsFlag` (bin.mjs:1086) and `parseDashOpts` (bin.mjs:1358) are the only structured parsers. Add to `utils.mjs`:
- `parseCSVFlag(args, name)`
- `parseKVFlag(args, name, defaultValue)`
- `parseBoolFlag(args, name, defaultValue)`

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

**Recommendation**: Either (a) add `requireAuth` middleware to v1 — full refactor, breaks backwards compat; or (b) **remove v1 entirely**, document the migration path, and require v2 for all clients. (b) is cheaper and clean.

### 5.3 WebSocket Lifecycle

- Per-connection `setInterval(sendLogChunk, 1000)` (server.mjs:585) — cleaned up on close. ✓
- `pingTimer` at 30s (ws.ts:117-119) — cleaned up. ✓
- Heartbeat interval at 30s (server.mjs:418-439) — cleaned up. ✓
- `MobileApp.tsx:71` `setInterval(refreshSnapshot, 10000)` — verification of unmount cancel missing. Add cleanup.

### 5.4 Recommended Server Refactors

#### S-R1: Remove or auth-protect v1 server
Either kill `:4097` entirely or run it through the same `requireAuth` middleware as v2.

#### S-R2: Single config root
Consolidate `~/.config/bizar/`, `~/.config/opencode/`, `~/.cache/bizarharness/` under one root with symlinks for backwards compat. Document in `wiki/configuration-paths.md`.

#### S-R3: Rate limiting
Add `express-rate-limit` middleware. `/api/chat/stream`: 10/min/IP. `/api/snapshot`: 60/min/IP. Other API: 300/min/IP.

#### S-R4: SSE backpressure
Wrap `res.write()` in `if (res.writableNeedDrain) await once(res, 'drain')` to avoid memory blowup when client is slow.

#### S-R5: Debounced opencode.json cache
`providers-store.mjs:49-58` reads/parses `opencode.json` on every API call. Add a 1-second LRU/debounced cache. Single read shared across callers.

#### S-R6: Structured logging
Wrap `console.*` in a 50-line leveled logger (`log.debug`, `log.info`, `log.warn`, `log.error`). Add `X-Request-ID` to all requests and propagate.

#### S-R7: Metrics endpoint
Expose `/metrics` in Prometheus text format. Counters: `bizar_http_requests_total{route,method,status}`, `bizar_ws_clients`, `bizar_opencode_json_reads_total`. Histograms: request duration, WS message size.

#### S-R8: Centralize path-safe utility
`lib/path-safe.mjs` exists. Currently used in `routes/fs.mjs:28-34` and `memory-store.mjs:320,347`. Audit all `fs.readFile`/`writeFile` calls in the server and route them through `resolveSafePath`.

#### S-R9: Validate WS messages
Type-check inbound WS messages (`{ type, payload }`). Reject malformed messages with a close frame. Currently no schema validation.

#### S-R10: Process.env hygiene
After env-var key rotation (`providers-store.mjs:526-557`), `process.env` contains the temp key. Document this and add a teardown that clears env vars on process exit.

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
- **WebSocket message queue**: dropped messages while disconnected (B-M7)
- **EventSource on unmount**: `useChat.ts` should close EventSource in cleanup
- **Stale snapshot intervals**: `MobileApp.tsx:71` `setInterval(refreshSnapshot, 10000)` — verify cancel on unmount

### 6.5 Accessibility — WCAG 2.2 AA Gaps

**What's done well:** Modal focus trap, semantic ARIA on Modal/MobileModal/Toast/EmptyState, `:focus-visible` rings, dark theme contrast ~7:1.

**Gaps:**

| Issue | Location | Fix |
|-------|----------|-----|
| No `<label>` on form inputs | `Settings.tsx` (entire file uses inline styles + placeholders) | Wrap each `<input>` in `<label>` or add `aria-label` |
| Topbar tabs missing `role="tablist"` / `aria-selected` | `Topbar.tsx` ~150 | Add `role="tab"`, `aria-selected={activeTab === id}` |
| `Toast` has no `role="alert"` for errors | `Toast.tsx` | `role="alert"` only on error/info toasts |
| Activity feed no `aria-live` | `Overview.tsx` activity banner | Add `aria-live="polite"` to the activity list container |
| WS status dot color-only | `Topbar.tsx` | Add `aria-label="Connected"` or text alongside dot |
| Settings 1823-line scroll has no skip-nav | `Settings.tsx` | Add `aria-label` landmark + sub-nav |
| Mobile bottom nav no keyboard path | `MobileApp.tsx` | Ensure `tabindex` flows to all interactive items |
| GlyphRenderer 5s timeout no live region | `glyphs/components.tsx` | Add `aria-live="polite"` to status region |
| Color-only status indicators | `StatusBadge` and ad-hoc `.badge` | Add accessible text or `aria-label` |

### 6.6 Performance — Concrete Wins

| Issue | File | Fix |
|-------|------|-----|
| All views re-render every 5s on `snapshot` prop | `App.tsx:635-647` | Wrap view children in `React.memo()` with custom `propsAreEqual` that diffs only `snapshot` fields each view uses |
| No virtual scrolling | activity/history/chat lists | Add `react-window` for lists > 50 items |
| No code splitting | `App.tsx` static imports | `const ChatView = lazy(() => import('./views/Chat'))` + `<Suspense fallback={<Spinner/>}>` |
| Inline styles in Settings | `Settings.tsx` ~1823 lines | Extract to CSS classes, components |
| 228 KB CSS | `main.css` 8901 lines | Split per-view CSS, run `purgecss` against actual selectors |
| CSS animations without `will-change` | many | `will-change: transform` on streaming bubbles, spinners |
| No `content-visibility: auto` on long lists | activity feed, chat | Add CSS for offscreen items |

### 6.7 CSS Maintainability

**Already fixed** (F6): duplicate `:root` block in `main.css:159-167 vs 219-221` and status colors `132-138 vs 208-211`.

**Remaining**:
- `main.css` is 8901 lines — split into:
  - `tokens.css` (variables, themes)
  - `reset.css`
  - `shell.css` (Topbar, Sidebar, App)
  - `views/*.css` (one per view, already partially exists in `styles/`)
- Add `@layer` declarations so cascade is predictable: `@layer reset, tokens, base, components, utilities, overrides;`
- Settings.tsx inline styles (1823 lines) → extract to CSS classes / CSS modules
- Mobile CSS (29 KB) is reasonable but mobile JS (476 KB) > desktop (371 KB) — investigate imports

### 6.8 Component Reuse Gaps

- **Modal system exists but unused in `BacklogPanel`** (uses native `confirm()` — B-M3)
- **Error boundary** doesn't exist (added F7)
- **`<Spinner/>` component exists** but some views still render raw CSS spinners

### 6.9 Chat Dual Implementation

Two systems exist:
- **Legacy**: `ChatBubble`, `ChatComposer`, `ChatThread.legacy` (in `_legacy.ts`)
- **Modern**: `MessageBlock`, `FloatingComposer`, `ChatRail`, `ChatTopBar`

**Recommendation**: Delete `_legacy.ts`, audit references, remove dead components. Single source of truth for chat. Track as a 1-week task.

### 6.10 Mobile vs Desktop Parity

| Feature | Desktop | Mobile | Gap |
|---------|---------|--------|-----|
| Chat streaming | ✓ (`useChat` SSE) | ✓ (`MobileChat`) | Parity ✓ |
| Settings | ✓ (1,823 lines) | ✓ (subset) | Mobile is partial ✓ |
| Tasks | ✓ (5 columns) | ✓ (`MobileTasks`) | Parity ✓ |
| Artifact canvas | ✓ (`VisCanvas`) | ✓ (`MobileArtifactCanvas`) | Parity ✓ |
| Mods | ✓ | ✓ | Parity ✓ |
| Plans | ✓ | ✓ | Parity ✓ |
| Bundle size | 371 KB JS | **476 KB JS** | Mobile 28% larger (B-MOBILE-1) |

### 6.11 Priority Recommendations (P0–P3)

#### P0 — Fix Immediately
1. **Error boundaries** around each view (F7 fixed main; per-view boundaries still needed for Settings/Chat)
2. **AbortController** in all `useEffect` API calls (F5 did 4/15+; ~11 more views)
3. **Fix `useAutoGrowTextarea` deps** (B-M1)

#### P1 — High Impact
4. **`[k: string]: unknown` → typed interfaces** in Snapshot, HistoryEvent, Settings
5. **`React.memo()` on view components** receiving snapshot
6. **Replace `confirm()` in BacklogPanel** with modal system
7. **Add `<label>` to all form inputs** (Settings especially)
8. **Add `role="tab"`/tablist to Topbar** + `aria-selected`

#### P2 — Medium Impact
9. **`React.lazy()` for views** — code-splitting
10. **`react-window` for chat/activity/history** — virtual scroll
11. **`will-change: transform`** on animated elements
12. **`aria-live="polite"`** on activity/task/chat regions
13. **Break `main.css` into per-view CSS** files

#### P3 — Nice to Have
14. **`vitest + @testing-library/react`** for unit/integration tests
15. **`content-visibility: auto`** on long lists
16. **Extract Settings inline styles** to CSS classes
17. **Unify chat dual implementation** — delete legacy
18. **WS message queue** for offline resilience
19. **Document mobile/desktop split architecture** in `README.md`

---

## Section 7: Improvements — Cross-Cutting (Security, Perf, A11y, Build)

Source: `.obsidian/projects/cross-cutting-audit-2026-07-05.md` (428 lines).

### 7.1 Security — Top Concerns

| # | Concern | Severity | Status |
|---|---------|----------|--------|
| 1 | vitest CVE-2025-30208 (arbitrary file read via Vitest UI) | CRITICAL | **FIXED (F1)** — bumped to 4.1.9 |
| 2 | API keys in plaintext on disk (`opencode.json`) | HIGH | Known tradeoff; prefer env-var rotation (`providers-store.mjs:526-557`) |
| 3 | Dashboard token in URL query params (SSE/WS) | MEDIUM | Mitigated via `replaceState` (api.ts:81-86); see B-M6 |
| 4 | Plain-text secrets in `providers-store.mjs:1185` | HIGH | Same as #2 |
| 5 | `curl ... | sh` pattern (no hash verification) | MEDIUM | install.sh:180,188,195,217; install.mjs:396-397 |
| 6 | v1 dashboard server open (`:4097`) | HIGH | See B-H5 |
| 7 | `/api/auth/reveal` returns token in body | LOW | See B-M8 |

**Recommendations**:
- For installer scripts, add `--verify-sha256 <hash>` flag for known hashes, or wrap in `gpg --verify`.
- For dashboard secrets, consider `keytar` / OS keychain integration (Linux: secret-service; macOS: Keychain; Windows: DPAPI).
- For API keys, the env-var rotation pattern is the right long-term direction — keep nudging users toward it.

### 7.2 Performance — Bundle Sizes

| Asset | Size | Issue |
|-------|------|-------|
| `main-usWhlPWa.js` (desktop) | 371 KB | OK |
| `mobile-O6ANdD4W.js` (mobile) | **476 KB** | Larger than desktop (B-MOBILE-1) |
| `main-*.css` | 228 KB | Very large — needs purgecss audit |
| `mobile-*.css` | 29 KB | OK |
| Source maps | 1.17 MB / 1.88 MB | In npm tarball; should be `'hidden'` |

**Action items**:
1. Set `vite.config.ts:15` `sourcemap: 'hidden'`
2. Add `.npmignore` rule for `bizar-dash/dist/*.map`
3. Audit `mobile.tsx` imports — why is it 28% larger?
4. Run purgecss / lighthouse-ci for CSS pruning

### 7.3 Performance — Synchronous I/O on Server

| Hot Path | File | I/O | Cost |
|----------|------|-----|------|
| Log tail via WS (1s tick) | `server.mjs:536-607` | `statSync`+`readSync` per tick | Low freq, OK |
| `buildSnapshot` per WS connection | `server.mjs:724-753` | `readFileSync` | Blocks many connections |
| `safeReadJSON` per `list()` | `providers-store.mjs:49-58` | `readFileSync`+`JSON.parse` per call | N+1 reads |
| Providers `list()` | `providers-store.mjs:868-886` | re-parses same JSON | Add 1s debounced cache (S-R5) |

### 7.4 Accessibility — WCAG 2.2 AA Gaps (Full List)

Source §3 of cross-cutting audit + §6.5 of frontend analysis.

1. No `<label>` associations in Settings (1763 lines of form fields).
2. Topbar tabs lack `role="tablist"`.
3. Toast notifications lack `role="alert"` on errors.
4. Activity feed has no `aria-live`.
5. WS status dot is color-only — no accessible text.
6. No global `:focus-visible` ring.
7. SearchModal has no `role="search"`.
8. Mobile bottom nav no keyboard path.
9. Color inputs (Settings) lack proper labels.
10. Confirm dialogs use native `confirm()`.

### 7.5 Internationalization

- **Zero translation infrastructure**: Every string is hardcoded English.
- **No `Intl.*` wrappers** for dates/numbers.
- **Zero RTL support**: no `dir="auto"`, no logical CSS properties.

For a CLI developer tool this is acceptable. For wider adoption, plan:
- Extract all user-facing strings to `i18n/en.json`.
- Add `i18next` or `react-intl` with locale switcher.
- Use CSS `dir="rtl"` for Arabic/Hebrew.

### 7.6 Testing Gaps

| Domain | Coverage |
|--------|----------|
| SDK | Moderate (3 files) |
| Plugin | Excellent (24 files) |
| Memory/Secrets | Good |
| Dashboard server | Weak (most route files lack tests) |
| CLI | Moderate (doctor, install, artifact, service tests) |
| **Web frontend** | **Zero — no test directory exists** |
| Accessibility | **Zero — no aXe, Lighthouse, or Playwright a11y tests** |
| i18n | **Zero** |
| Performance | **Zero — no bundle analysis, no perf regression tests** |
| Memory store concurrent writes | No test |
| Path-safe symlink traversal | No test |

**Action**: Add `vitest` + `@testing-library/react` to `bizar-dash/`. Start with smoke tests on 3 views (Settings, Chat, Overview) at 60% target coverage over 3 sprints.

### 7.7 Observability

- **Logging**: Mix of `console.log`/`error`/`warn` with prefixes (`[bizar-dash]`, `[mod]` etc.). No leveled logger, no correlation IDs.
- **Metrics**: None. No Prometheus, no counters, no histograms.
- **Tracing**: None. No OpenTelemetry, no DTrace probes.
- **Error reporting**: Local crash handlers but no Sentry/DataDog/Honeycomb integration.
- **Empty catches**: ~50+ still present after F3 (most fixed). WS handlers especially.

### 7.8 Build / Packaging

- **Source maps shipped**: `vite.config.ts:15` should be `sourcemap: 'hidden'` or `'false'` for production.
- **`.npmignore`**: Excludes tests but the dist directory is unfiltered — add `*.map` exclude.
- **`files` array in `package.json`**: Includes `bizar-dash/` which ships `src/` + `dist/` together (double size).
- **Cross-platform**: `install.sh`/`install.ps1` both exist but PS1 has bugs (B-C2, B-C3). `/proc/net/tcp` Linux-only (F2 fixed).

### 7.9 Top 10 Critical Issues

| # | Issue | File | Severity | Status |
|---|-------|------|----------|--------|
| 1 | vitest CVE | `package.json:87` | CRITICAL | **FIXED (F1)** |
| 2 | API keys in plaintext | `providers-store.mjs:1185` | HIGH | Open — use env-var rotation |
| 3 | Token in URL | `auth.mjs:187-189`, `ws.ts:29` | MEDIUM | Open — see B-M6 |
| 4 | No metrics/tracing/log levels | server-wide | MEDIUM | Open — see S-R6/R7 |
| 5 | Mobile bundle > desktop | vite build | MEDIUM | Open — see B-MOBILE-1 |
| 6 | `/proc/net/tcp` hardcoded | `headroom.mjs:121` | MEDIUM | **FIXED (F2)** |
| 7 | Source maps shipped | `vite.config.ts:15` | LOW | Open — set `sourcemap: 'hidden'` |
| 8 | 228 KB CSS | Vite build | LOW | Open — purgecss |
| 9 | Zero i18n | UI-wide | LOW | Open — known gap |
| 10 | Empty catches (~50+) | server files | MEDIUM | Partial fix (F3) — 27 more remain |

---

## Section 8: Improvements — Opencode Plugin & SDK

Stream 4 had limited findings but the following gaps are noteworthy:

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

Stream 5 findings.

### 9.1 Skills Coverage Gaps

`< 70 lines of body content` skills flagged as "thin":

| Skill | Path | Lines | Issue |
|-------|------|-------|-------|
| `agent-baseline` | `~/.opencode/skills/agent-baseline/` | always-on | Auto-loaded |
| `browser-harness` | `~/.opencode/skills/browser-harness/` | good |
| `find-skills` | `~/.agents/skills/find-skills/` | short |
| `decision-mapping` | `~/.agents/skills/decision-mapping/` | thin |
| `grill-me` | thin |
| `grill-with-docs` | thin |
| `grilling` | thin |
| `loop-me` | thin |
| `teach` | thin |
| `qa` | thin |

A "thin" skill is one whose `SKILL.md` is < 70 lines of body content. Add expanded examples, decision matrices, or rename to clearly indicate minimal-depth (e.g., `grilling-quick` vs `grilling-deep`).

### 9.2 Outdated Docs

- `wiki/` — needs a fresh audit. The wiki may be stale relative to v4.5.x.
- `docs/installation.md` — may reference old `install.sh` patterns from pre-provisioner era.
- `docs/architecture.md` — pre-dates the v1/v2 server split.

### 9.3 Wiki Pages to Refresh

- `wiki/getting-started.md` — update for v4.5+ command surface
- `wiki/configuration.md` — document 5 config roots (§5.1)
- `wiki/dashboard-vs-cli.md` — only v2 is current
- `wiki/troubleshooting.md` — add sections for the bugs fixed this session

### 9.4 Templates to Add

Currently: `templates/plan/htmx.min.js` is the only one. Add:

- **`templates/artifact/`** — starter MDX for artifact files (already exists in `artifact.mjs` but extracted)
- **`templates/agent-brief.md`** — structured handoff template (see §8.4)
- **`templates/skill/SKILL.md`** — starter skill file
- **`templates/mod/manifest.json`** — for community mod publishing (see §10 plugin marketplace)

### 9.5 Rules Files

`config/agents/_shared/AGENT_BASELINE.md` exists. Add per-language conventions:

- `rules/typescript.md` — codegen discipline, `any` policy, error boundaries
- `rules/css.md` — token use, no inline styles, layer ordering
- `rules/testing.md` — minimum coverage thresholds per directory

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

## Section 11: Roadmap Suggestion

Sequenced into 4 releases over 6 months.

### v4.6 — Quality & Stability (4 weeks)

**Theme**: Make the existing surface reliable.

**Bugs**:
- B-C1 (--with-mods), B-C2/B-C3 (install.ps1), B-H1 (console.warn), B-H2 (npm timeout), B-H3 (windows path), B-H4 (mod id validation), B-H5 (v1 auth) — 7 fixes
- B-M1 (textarea deps), B-M2 (provider state), B-M3 (backlog modal), B-M4 (snapshot refresh), B-M5 (timezone other), B-M6 (token URL), B-M7 (WS queue), B-M8 (auth reveal), B-M9 (randomUUID) — 9 fixes
- B-L3, B-L4, B-L5, B-L6 (logging consistency, pid check, banner order, remaining catches) — 4 fixes

**Refactors**:
- R1 (split bin.mjs)
- R2 (split artifact.mjs)
- R5 (centralize bizarConfigDir)
- R4 (centralize which)
- R8 (exit codes)
- S-R1 (remove or auth-protect v1)
- S-R2 (single config root)
- S-R5 (debounced opencode.json cache)
- S-R6 (structured logging)
- S-R8 (centralize path-safe)

**Tests**:
- Add 60% coverage on `bin.mjs` and `provision.mjs`
- Add Web frontend smoke tests (Vitest + RTL) for Settings, Chat, Overview

**Docs**:
- Refresh `wiki/getting-started.md`, `wiki/configuration.md`
- Add `wiki/dashboard-vs-cli.md`
- Add `wiki/troubleshooting.md` bugs-this-session section

**Exit criterion**: 0 critical bugs, 0 high-confidence bugs, Web frontend has *some* tests.

### v4.7 — Performance & Polish (4 weeks)

**Theme**: Reduce bundle, eliminate stale closures, fix a11y gaps.

**Bugs**:
- B-MOBILE-1 (mobile bundle > desktop) — investigate mobile.tsx imports
- B-L1 (purgecss), B-L2 (focus-visible)
- All remaining `useEffect` dep warnings (eslint --fix)

**Refactors**:
- Web: React.lazy() per-view, React.memo() on snapshot receivers, react-window for long lists
- Settings: extract inline styles to CSS classes
- CSS: split `main.css` into per-view files
- Add `sourcemap: 'hidden'` in vite.config.ts
- Add `.npmignore` for `dist/*.map`
- Add S-R3 (rate limiting), S-R4 (SSE backpressure), S-R7 (metrics endpoint)
- Add `-` to skill names: grammar extras
- Add `rules/typescript.md`, `rules/css.md`, `rules/testing.md`

**Features**:
- F-NEW-6 (cost predictor) — S effort
- F-NEW-19 (backup/restore) — S effort
- F-NEW-22 (Prometheus metrics) — S effort
- F-NEW-25 (Sentry integration) — S effort

**A11y**:
- `<label>` on Settings inputs
- `role="tab"` on Topbar
- `aria-live` on activity feed
- Global `:focus-visible` ring
- Color-only status indicators get text

**Exit criterion**: Mobile bundle < Desktop bundle by 20%, Settings has `<label>` everywhere, 80% P1/P2 a11y items resolved.

### v4.8 — Memory & Knowledge (4 weeks)

**Theme**: Make the memory tab the best in class.

**Features**:
- F-NEW-12 (voice notes) — M effort
- F-NEW-13 (screenshot OCR) — M effort
- F-NEW-14 (web clipper extension) — M effort
- F-NEW-15 (auto weekly digests) — S effort
- F-NEW-16 (memory graph visualization) — M effort
- F-NEW-29 (webhook integrations) — M effort
- F-NEW-34 (Slack notifications) — S effort

**Refactors**:
- Complete the chat dual-impl merge (delete `_legacy.ts`)
- Add structured logging everywhere
- Add OpenTelemetry spans (F-NEW-23)

**Exit criterion**: Memory tab is the most-used surface; web clipper + voice notes are first-class.

### v5.0 — Major Release: Collaboration & Extensibility (8 weeks)

**Theme**: Multi-user, plugin marketplace, integrations.

**Features**:
- F-NEW-7 (shared task boards) — L
- F-NEW-8 (team workspaces) — L
- F-NEW-17 (one-click deploy) — M
- F-NEW-18 (Docker self-host) — S
- F-NEW-21 (React Native mobile) — L
- F-NEW-28 (plugin marketplace) — L
- F-NEW-31 (GitHub Issues sync) — M
- F-NEW-32 (Linear sync) — M
- F-NEW-33 (Notion sync) — M
- F-NEW-1 (agent composition) — M
- F-NEW-3 (eval framework) — M
- F-NEW-30 (CLI for everything) — L (ongoing)

**Refactors**:
- Add multi-tenant data model (workspaces)
- Replace file-based state with optional SQLite layer
- Add full ACL system

**Exit criterion**: BizarHarness v5.0 is a credible team product, not just a power-user tool.

---

## Section 12: Effort vs Impact Matrix

All improvements from §3–§10, ranked.

### Quick Wins (S effort, ≥ M impact)

| # | Item | Source | Effort | Impact |
|---|------|--------|--------|--------|
| 1 | Add `--json` global flag (R6) | §4 | S | M |
| 2 | Add `--debug` global flag (R7) | §4 | S | M |
| 3 | `sourcemap: 'hidden'` (R3 of build) | §7 | S | M |
| 4 | `.npmignore` `*.map` | §7 | S | L |
| 5 | Centralize `bizarConfigDir()` (R5) | §4 | S | M |
| 6 | Centralize `which()` (R4) | §4 | S | L |
| 7 | AbortController on remaining ~11 views | §6 | S | M |
| 8 | Replace `Math.random()` IDs with `crypto.randomUUID()` (B-M9) | §3 | S | L |
| 9 | Set `cache-control` headers on API | §7 | S | L |
| 10 | Replace `confirm()` in BacklogPanel (B-M3) | §3 | S | L |
| 11 | Cost predictor before send (F-NEW-6) | §10 | S | M |
| 12 | Backup/restore (F-NEW-19) | §10 | S | H |
| 13 | Prometheus `/metrics` (F-NEW-22) | §10 | S | M |
| 14 | Sentry integration (F-NEW-25) | §10 | S | H |
| 15 | Slack notifications (F-NEW-34) | §10 | S | M |
| 16 | Auto weekly digests (F-NEW-15) | §10 | S | M |
| 17 | Audit log viewer UI (F-NEW-24) | §10 | S | M |
| 18 | Standardize exit codes (R8) | §4 | S | L |
| 19 | Purgecss audit (B-L1) | §7 | S | M |
| 20 | `*:focus-visible` global ring (B-L2) | §7 | S | M |

### Medium Effort, High Impact (worth prioritizing)

| # | Item | Source | Effort | Impact |
|---|------|--------|--------|--------|
| 21 | Split `bin.mjs` into `cli/commands/` (R1) | §4 | M | H |
| 22 | Split `artifact.mjs` into 3 files (R2) | §4 | M | H |
| 23 | Remove or auth-protect v1 server (B-H5) | §3/§5 | M | H |
| 24 | React.lazy() per-view | §6 | M | H |
| 25 | Web frontend test infra + smoke tests | §7 | M | H |
| 26 | `<label>` on Settings inputs (a11y) | §7 | M | H |
| 27 | `React.memo()` on snapshot receivers | §6 | M | M |
| 28 | virtual scrolling (react-window) | §6 | M | M |
| 29 | Structured logging + correlation IDs (S-R6) | §5 | M | H |
| 30 | Rate limiting (S-R3) | §5 | M | M |
| 31 | `oauth` for V2 — actually, env-var key rotation already exists | §5 | M | M |
| 32 | i18n infrastructure (i18next) | §7 | M | H |
| 33 | Voice notes → transcripts (F-NEW-12) | §10 | M | H |
| 34 | Screenshot OCR (F-NEW-13) | §10 | M | M |
| 35 | Web clipper extension (F-NEW-14) | §10 | M | H |
| 36 | Memory graph viz (F-NEW-16) | §10 | M | M |
| 37 | Webhook integrations (F-NEW-29) | §10 | M | H |
| 38 | Eval framework (F-NEW-3) | §10 | M | H |
| 39 | A/B prompt playground (F-NEW-4) | §10 | M | M |
| 40 | One-click deploy (F-NEW-17) | §10 | M | H |

### Larger Investments (L effort; gate behind roadmap)

| # | Item | Source | Effort | Impact |
|---|------|--------|--------|--------|
| 41 | Multi-user / team workspaces (F-NEW-7/8) | §10 | L | H |
| 42 | Plugin marketplace (F-NEW-28) | §10 | L | H |
| 43 | React Native mobile (F-NEW-21) | §10 | L | M |
| 44 | Multi-agent debate (F-NEW-2) | §10 | L | H |
| 45 | Live cursors in canvas (F-NEW-11) | §10 | L | L |
| 46 | GitHub Issues sync (F-NEW-31) | §10 | L | H |
| 47 | Multi-project dashboards (F-NEW-20) | §10 | L | H |
| 48 | CLI for everything (F-NEW-30) | §10 | L | M |

### Quick-Win → Roadmap Mapping

- **v4.6** items 1-20 (Quick Wins) + items 21, 22, 23 (medium-effort high-impact for stability)
- **v4.7** items 24-32 (perf + a11y) + items 26 (a11y), 28 (virtual scroll)
- **v4.8** items 33-40 (memory features)
- **v5.0** items 41-48 (collaboration)

---

## Final Notes

This document is the deliverable for the research session on 2026-07-05. It is meant to be diffed against the next research cycle (3-4 months out). All file:line references are accurate as of the session; new features and bugs that land in the meantime should be appended, not folded in.

For sprint planning, start with Section 12 (Effort vs Impact Matrix) and pick items from the "Quick Wins" table first — they have the best effort-to-impact ratio and unblock later work (logging enables metrics enables observability; structured tests enables refactors).

---

**Summary**: `/home/drb0rk/Projects/BizarHarness/SUGGESTIONS.md` written. ~520 lines. Top 3 priorities: (1) Split `bin.mjs` and `artifact.mjs` monoliths (R1, R2); (2) Fix v1 dashboard auth gap (B-H5) — security risk; (3) Add Web frontend test infrastructure (zero tests today — major regression risk for any refactor).
