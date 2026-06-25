# Changelog

## v3.17.0 — Settings section filter + graphify extracted as a true mod

> **Two clean-ups.** Settings gets a real section filter (not just scroll-to), and graphify is removed from BizarHarness entirely — it's now a standalone mod that ships its own build pipeline + self-contained web UI.

### Highlights

- **Settings section filter.** The v3.16.0 subnav scrolled to sections; v3.17.0 actually **filters** — clicking a subnav button shows ONLY that section, hiding all others with a "Showing only X" banner and a one-click "Show all sections" escape hatch. URL hash deep-links (`#settings-theme`) still work and respect the filter. Every Card in Settings gained a `data-section="…"` attribute; CSS attribute selectors drive the visibility — no JS gymnastics.
- **graphify is now a true mod.** Everything BizarHarness knew about graphify is gone:
  - Deleted `cli/graph.mjs`, `cli/graph-build-from-cache.mjs`, `cli/graph.test.mjs`
  - Deleted `bizar graph` subcommand and its help text
  - Deleted `bizar-dash/src/server/routes/graph.mjs` (the built-in `/api/graph/*` route)
  - Deleted `bizar-dash/src/web/views/Graph.tsx` (the built-in Graph tab UI)
  - Removed `graph` tab from TABS and `Graph` entry from VIEW_MAP
  - Removed the `runGraph` import + `showGraphHelp` from `cli/bin.mjs`
- **graphify mod v1.1.0** in `mods-examples/graphify/` and `bizar-mods/mods/graphify/`:
  - `route.mjs` (~430 lines) inlines the full build pipeline (formerly `bizar graph build`): LLM-key detection → code-only `.graphifyignore` → `graphify extract` → AST-cache fallback reconstruction → `cluster-only` → output hoisting. No more `bizar graph build` subprocess spawn.
  - **`web/index.html`** — self-contained dark-theme UI with toolbar (Build / Refresh / View Report), live status polling, log streaming, and graph.html iframe. Surfaced via the existing `web/index.html` mechanism in the Mods tab.
  - Updated permissions: `fs:read:.bizar/graph`, `fs:write:.bizar/graph`, `fs:write:.graphifyignore`, `process:spawn:graphify`, `process:spawn:python3`, `process:spawn:which` (was `process:spawn:bizar`).
- **Mod registry renamed** `bizarre-mods` → `bizar-mods` (matches the package name and is shorter). The default registry URL the dashboard uses now resolves at `github.com/DrB0rk/bizar-mods`.

### Files added (1)

- `mods-examples/graphify/web/index.html` — self-contained dark-theme view UI.

### Files deleted (5)

- `cli/graph.mjs` — the `bizar graph` dispatcher.
- `cli/graph-build-from-cache.mjs` — its offline fallback helper.
- `cli/graph.test.mjs` — its tests.
- `bizar-dash/src/server/routes/graph.mjs` — the built-in graph HTTP route.
- `bizar-dash/src/web/views/Graph.tsx` — the built-in Graph tab UI.

### Files changed (8)

- `cli/bin.mjs` — removed `runGraph` import, `showGraphHelp`, the `bizar graph` dispatch case, and the graphify mention from `showInitHelp`.
- `bizar-dash/src/server/api.mjs` — removed `createGraphRouter` import + mount.
- `bizar-dash/src/web/App.tsx` — removed `Graph` import + VIEW_MAP entry.
- `bizar-dash/src/web/components/Topbar.tsx` — removed `graph` tab + `Network` icon import.
- `bizar-dash/src/web/views/Settings.tsx` — added `data-section="…"` to every section Card; subnav now filters (not scrolls); "Showing only X" banner + "Show all sections" escape; URL hash deep-links respected on mount.
- `bizar-dash/src/web/styles/main.css` — `.settings-grid-filtered` + per-section attribute-selector rules, `.settings-filter-banner`, `.settings-filter-clear`.
- `mods-examples/graphify/route.mjs` — fully rewritten (~430 lines): inlines runGraphify, hasLlmKey, buildGraphFromCache, promoteFromDir, runBuild; calls `graphify` directly (not `bizar graph build`).
- `mods-examples/graphify/mod.json` — version bumped to 1.1.0, permissions updated.
- `bizar-dash/src/server/mods-loader.mjs` — `DEFAULT_REGISTRY_URL` now points at `DrB0rk/bizar-mods` (renamed from `bizarre-mods`).

### Test results

- `tsc --noEmit` (dashboard): passes.
- `bun test tests/mod-security.test.mjs`: 26/26 pass (no regression).
- `node --eval "import('mods-examples/graphify/route.mjs')"`: imports cleanly, register() runs without error.

### Companion release

- `@polderlabs/bizar-dash` v3.17.0 — co-released with the graph removal + settings filter.
- `@polderlabs/bizar` v3.17.0 — co-released (CLI subcommand removal).
- `graphify` mod v1.1.0 — published to the registry (`github.com/DrB0rk/bizar-mods`).

## v3.16.0 — Dashboard overhaul: settings subnav, chat floating input, providers in Config, mods registry browser, provider auto-detect

> **UI + CLI upgrade.** Six user-facing improvements ship together: settings gets a sticky subnav with section anchors, the chat input is a floating glass-style box, the standalone Providers tab is gone (lives inside Config), the Mods tab gets an Available registry browser, and `bizar providers detect` auto-discovers API keys in your env.

### Highlights

- **Settings subnav.** Every section in `Settings` (Theme, Layout, General, Service, Tailscale, Notifications, Auth, Agents, Dashboard, Background, Updates, Activity, About) is now reachable from a sticky horizontal subnav at the top. Active section is highlighted automatically as you scroll. Smooth scroll-into-view via anchor IDs.
- **Chat floating input.** The chat composer is now a floating glass-style box (sticky at bottom, blurred backdrop, accent-coloured border on focus, drop shadow). Wraps the existing composer-toolbar + textarea + send button; no UX changes other than positioning.
- **Providers moved into Config.** The standalone Providers tab is gone. The ProvidersPanel already lived inside `Config → Providers` and is unchanged — just no longer duplicated as a top-level tab. `Providers.tsx` is now orphaned (not imported anywhere) but left in the repo for reference.
- **Mods registry browser.** The Mods tab gets a new "Mod registry" collapsible section with a card-grid layout. Each entry shows name, version (with upgrade badge if newer), description, author, homepage, declared permissions, and Install/Installed button. Tapping Install POSTs `/api/mods` with `{ id }` to download from the registry. The browser now honours the `installed` / `upgradeAvailable` flags returned by the registry route.
- **Provider auto-detect (CLI + dashboard).**
  - New `bizar providers detect` subcommand: scans env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `MISTRAL_API_KEY`, `GROQ_API_KEY`, `COHERE_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MINIMAX_API_KEY`) plus opencode.json, validates key formats, optionally probes each `/models` endpoint with a 1.5s timeout, and prints a status table. Flags: `--no-probe`, `--json`, `--install <id>` (auto-adds to opencode.json).
  - New `/api/providers/auto-detect` endpoint in the dashboard.
  - New "Auto-detect providers" banner inside `Config → Providers` with the same results, including a per-row "Add" button to install a configured provider into opencode.json without leaving the dashboard.
  - Wired into `bizar install` as a final summary step so a fresh install surfaces any pre-existing keys.
- **`bizarre-mods` registry polish.** The registry.json schema is documented in `bizarre-mods/README.md`, including a "Publishing this registry" section with the exact `git init / commit / push` recipe for spinning up the standalone GitHub repo.

### Companion release

- `@polderlabs/bizar-dash` v3.16.0 — co-released with all the UI work above.

### Files added (1)

- `cli/providers-detect.mjs` — the new CLI subcommand (~270 lines).

### Files changed (12)

- `bizar-dash/src/server/providers-store.mjs` — new `KNOWN_PROVIDERS` table + `autoDetect({ probe })` method.
- `bizar-dash/src/server/routes/providers.mjs` — new `GET /providers/auto-detect` route.
- `bizar-dash/src/web/App.tsx` — removed `providers: Providers` from VIEW_MAP + removed unused import.
- `bizar-dash/src/web/components/Topbar.tsx` — removed `providers` from TABS + removed unused `Cloud` icon import.
- `bizar-dash/src/web/views/Chat.tsx` — wrapped composer in `.chat-input-floating` div.
- `bizar-dash/src/web/views/Config.tsx` — new `AutoDetectBanner` component above the ProvidersPanel.
- `bizar-dash/src/web/views/Mods.tsx` — new registry browser section + state.
- `bizar-dash/src/web/views/Settings.tsx` — `id="settings-..."` on every card, new sticky subnav, Activity section wrapped.
- `bizar-dash/src/web/styles/main.css` — `.settings-subnav`, `.chat-input-floating`, `.mods-registry-*`, `.mod-registry-*`, `.autodetect-*` (~7 KB of new CSS).
- `cli/bin.mjs` — wired `bizar providers detect` subcommand.
- `cli/install.mjs` — runs `providers detect --no-probe` as final summary step.
- `bizarre-mods/README.md` — added "Publishing this registry" section.

### Test results

- `tsc --noEmit` (dashboard) — passes.
- `bun test tests/mod-security.test.mjs` — 26/26 pass.
- `node cli/bin.mjs providers detect --help` — works.
- `node cli/bin.mjs providers detect --no-probe` — prints the table.

## v3.15.1 — `bizar update` defaults to automatic everything + `bizar dash start --bg` fix

> **Bug fix + UX:** `bizar update` no longer prompts. It updates every component (opencode + bizar + dash + plugin), auto-installs any missing one, kills running instances with a notice, re-runs the install script, restarts the dashboard, and runs `bizar doctor`. Opt into the per-component picker with `--pick`.

### Highlights

- **`bizar update` is now automatic by default.** Running plain `bizar update` updates all 4 components in one shot with no prompts. Any missing package (e.g. dashboard never installed) is detected and installed automatically so a broken install gets repaired. Run `bizar update --pick` to get the legacy checkbox picker. `--dry-run` still previews everything without touching anything.
- **Auto-kill without confirmation.** The legacy `--yes`/`-y`/`--force` flags are still respected, but they're no longer required to kill running instances — the update just kills them with a brief notice. Use `--pick` if you want to be prompted first.
- **`bizar dash start --bg` fix.** v3.15.0 shipped the Graph tab and routes but the installed dashboard package (`@polderlabs/bizar-dash` v3.12.x) couldn't see them because the file order in `cli.mjs` matched `args[0] === 'start'` BEFORE checking `args.includes('--bg')`, so `--bg` was silently ignored and the dashboard ran in the foreground. v3.13.0 of the dashboard (co-released) fixes this by reordering the dispatch AND adding a `bg` option to `startDashboard` that returns after the PID/PORT files are written instead of blocking on a signal handler.

### Companion release

- `@polderlabs/bizar-dash` v3.13.0 — Graph tab + `--bg` fix. Co-released.
- `@polderlabs/bizar-plugin` v0.9.0 — unchanged.

### Files changed

```
M cli/update.mjs                      (default to all + auto-install missing + skip confirmation prompts)
M cli/bin.mjs                          (refresh showUpdateHelp, main help line, --bg flow now reaches dashboard's bg-aware startDashboard)
```

### Migration

- `bizar update` with no args now updates everything. If you want the old per-component picker, use `bizar update --pick`.
- `bizar update --yes` / `-y` / `--force` still work as no-op (already automatic).
- `bizar update --dry-run` still previews without installing.

## v3.15.0 — Knowledge graph in the dashboard (offline build + viewable HTML)

> **Additive:** New dashboard tab "Graph" embeds the interactive graphify visualization (`graph.html`). `bizar graph build` now works end-to-end without an LLM key via a code-only AST cache fallback. Plugin: `@polderlabs/bizar-plugin` v0.9.0.

### Highlights

- **`bizar graph build` works offline.** When no LLM key is set, the build automatically:
  1. Writes a comprehensive `.graphifyignore` (node_modules, agent configs, docs/papers/images) so graphify's pre-flight check passes.
  2. Runs graphify once with a dummy `ANTHROPIC_API_KEY` to populate the AST cache (semantic step fails; that's intentional).
  3. Reconstructs `graph.json` from the per-file AST cache via the new `cli/graph-build-from-cache.mjs` script.
  4. Runs `cluster-only` to generate `graph.html` + `GRAPH_REPORT.md`.
  The final graph.json is at `.bizar/graph/graph.json` (809 nodes / 1794 edges for BizarHarness proper) with no API key required.
- **Dashboard "Graph" tab** — new view at `bizar-dash/src/web/views/Graph.tsx` embeds graph.html via an iframe, shows node/edge/community counts, and has a "Build / Rebuild" button that runs `bizar graph build` detached and polls the job status. New dashboard routes:
  - `GET /api/graph/status` — graph stats + active build jobs
  - `GET /api/graph/html` — serve `graph.html`
  - `GET /api/graph/report` — serve `GRAPH_REPORT.md`
  - `POST /api/graph/build` — kick off async build
  - `GET /api/graph/build/:jobId/status` — poll build progress
- **`cli/graph-build-from-cache.mjs`** (new) — merges graphify's per-file AST cache (`cache/ast/v0.8.46/*.json`) into a single `graph.json`. Used by the offline fallback when the semantic step fails.
- **`.gitignore`** updated — `.bizar/graph/` is now gitignored. Run `bizar graph build` on first use to populate it. This avoids committing 1.4 MB of graph data on every change.

### Plugin: `@polderlabs/bizar-plugin` v0.9.0

(no changes — the bg-spawn fix from v3.14.1 is unchanged.)

### Files changed

```
M .gitignore                                              (+3 lines)
M cli/graph.mjs                                           (+241 lines: code-only auto-detect, dummy-key fallback, promote cluster-only output, runCacheFallbackBuild + promoteFromDir)
A cli/graph-build-from-cache.mjs                          (NEW: merges per-file AST cache → graph.json)
A bizar-dash/src/server/routes/graph.mjs                   (NEW: status + html + report + build + build-status endpoints)
A bizar-dash/src/web/views/Graph.tsx                      (NEW: iframe-based view with stats + rebuild button + build-poll)
M bizar-dash/src/server/api.mjs                            (+2 lines: wire createGraphRouter)
M bizar-dash/src/web/App.tsx                               (+2 lines: Graph in VIEW_MAP)
M bizar-dash/src/web/components/Topbar.tsx                 (+2 lines: Graph tab in TABS)
M bizar-dash/src/web/styles/main.css                       (+60 lines: graph view + iframe + banner CSS)
```

### Verification

`bizar graph build` end-to-end on a fresh checkout with no LLM key produces:
- `.bizar/graph/graph.json` (778 KB, 809 nodes, 1794 edges for BizarHarness proper)
- `.bizar/graph/graph.html` (578 KB, interactive vis-network visualization)
- `.bizar/graph/GRAPH_REPORT.md` (14 KB)

Dashboard `/api/graph/status` returns the stats; `/api/graph/html` serves the HTML; the Graph tab embeds it via iframe with a rebuild button. All 282 plugin tests + 19 dashboard smoke tests pass; typecheck clean.

## v3.14.1 — bg-spawn subagent delegation fix + minimax thinking-config fix

> **Bug fix:** Two opencode 1.17.x compat issues that caused `bizar_spawn_background` to silently fail. Plugin: `@polderlabs/bizar-plugin` v0.9.0.

### Highlights

- **bg-spawn now correctly invokes subagents** — opencode 1.17.x rejects `opencode run --agent <subagent>` for any agent whose `mode` is `subagent` (8 of BizarHarness's 11 agents), printing "Falling back to default agent" and running odin instead. The bg-spawn tool now routes subagent requests through a primary wrapper (odin) with a directive delegation prompt that calls opencode's native `task` tool. The bg instance record still attributes the work to the requested agent.
- **minimax provider config: `thinking` option shape** — opencode's anthropic-compatible SDK rejects the string form `"thinking": "adaptive"` with `AI_TypeValidationError → invalid anthropic provider options` on every MiniMax model load. Changed to the documented object form `"thinking": { "type": "enabled" }` in `config/opencode.json.template` for both `MiniMax-M3` and `MiniMax-M2.7`.

### Plugin: `@polderlabs/bizar-plugin` v0.9.0

- `plugins/bizar/src/tools/bg-spawn.ts` — exports `PRIMARY_AGENTS`, `needsDelegationWrapper`, `buildDelegationPrompt`. The spawn call branches: primary agents get `--agent <name>` + original prompt; subagents get `--agent odin` + delegation prompt. The bg instance record keeps the requested agent name.
- `plugins/bizar/tests/tools/bg-spawn-delegation.test.ts` (new) — 13 tests covering set membership, the drift check against `config/agents/*.md`, and the prompt's directive properties.

### Main package: `@polderlabs/bizar` v3.14.1

- `config/opencode.json.template` — `provider.minimax.models.*.options.thinking`: string `"adaptive"` → object `{ "type": "enabled" }`.
- Tests updated to include the new delegation test file.

### Verification

End-to-end test in the BizarHarness dev container with deepseek (so MiniMax auth wasn't needed): `bizar_spawn_background(agent="mimir")` produced a real mimir subagent session (`agent=mimir mode=subagent parentID=<odin's session>`) after Odin received the delegation directive and called its `task` tool. Full transcript captured in `/tmp/bg-spawn-e2e/verify-delegation.ts`.

### Known upstream issue (NOT fixed by this release)

opencode's built-in MiniMax provider in 1.17.x sends requests with Anthropic-style `x-api-key` auth and reads `ANTHROPIC_API_KEY` (or the `/connect` auth file). Users on direct MiniMax need either `export ANTHROPIC_API_KEY="<minimax-key>"` in their shell, or to run `/connect` once in the opencode TUI to populate `~/.local/share/opencode/auth.json`. OpenRouter users are unaffected.

## v3.14.0 — MiniMax multi-key rotation (fallback)

> **Additive:** New plugin-level wrapper that rotates MiniMax API keys on 429 / 402 / 5xx responses. Configure via `MINIMAX_API_KEYS` (comma list) or `MINIMAX_API_KEY` + `MINIMAX_API_KEY_2`, `_3`, ... Single-key mode is unchanged.

### Highlights

- **New plugin module `src/key-rotation.ts`** — Exports `wrapFetchForKeyRotation()` and `discoverMiniMaxKeys()`. Wires in alongside the existing `reasoning-clean` wrapper in `plugins/bizar/index.ts`.
- **Env-var driven config** — No secrets in `opencode.json`. The user sets `MINIMAX_API_KEYS` (comma-separated list, max 16 keys) or the numbered form (`MINIMAX_API_KEY`, `MINIMAX_API_KEY_2`, ...). The plugin reads them at init.
- **Smart retry policy** — Retries on 429 (rate limit), 402 (quota exhausted), 500/502/503/504 (server errors), and network errors. Does NOT retry on 401 (unauthorized — the key is wrong, not exhausted) or other 4xx (client error). Caps retries at `apiKeys.length` so each key is tried at most once.
- **Round-robin on success** — After a successful request, the next request starts on the next key. Spreads load across accounts.
- **Single-key pass-through** — When only one key is configured, the wrapper is a no-op. Existing single-key setups are completely unaffected.
- **All tests pass: 269/269 across the plugin suite** (was 162 before this feature; added 26 new tests in `tests/key-rotation.test.ts`).

### How users configure it

```bash
# Option A — comma-separated list
export MINIMAX_API_KEYS="eyJ...primary,eyJ...secondary,eyJ...tertiary"

# Option B — numbered env vars
export MINIMAX_API_KEY="eyJ...primary"
export MINIMAX_API_KEY_2="eyJ...secondary"
export MINIMAX_API_KEY_3="eyJ...tertiary"
```

When a session hits a rate-limit or quota error on one key, the plugin retries with the next key automatically. The user sees no interruption — the opencode session continues as if nothing happened.

### Files changed

```
M  config/skills/bizar/SKILL.md      (+29 lines — documented the new env vars + retry policy)
M  package.json                       (+1 line — added key-rotation.test.ts to npm test)
M  plugins/bizar/index.ts            (+60 lines — added installFetchKeyRotation + import)
M  plugins/bizar/package.json         (+1 line — added key-rotation.test.ts to bun test)
A  plugins/bizar/src/key-rotation.ts        (new file, ~225 lines)
A  plugins/bizar/tests/key-rotation.test.ts (new file, ~270 lines, 26 tests)
```

## v3.13.0 — Direct MiniMax provider (drop OpenRouter default)

> **Breaking:** Removed OpenRouter as the default provider for MiniMax models. All BizarHarness agents now use the direct MiniMax provider. Users with custom configs referencing `openrouter/minimax/*` model IDs must update them to `minimax/MiniMax-M{2.7,3}`.

### Highlights

- **Default provider for MiniMax models is now the direct MiniMax provider**, not OpenRouter. Eliminates an extra hop and the OpenRouter fee layer.
- **Model ID migration:** `openrouter/minimax/minimax-m3` → `minimax/MiniMax-M3` and `openrouter/minimax/minimax-m2.7` → `minimax/MiniMax-M2.7` across all 7 paid-tier agent definitions (Odin, Hermod, Thor, Baldr, Tyr, Forseti, Quick) plus the top-level default `model` / `small_model` in `config/opencode.json.template`.
- **`provider.openrouter` block removed** from the default config template. Users who need OpenRouter can still add it manually.
- **Reasoning-clean wrapper updated** — `DEFAULT_PROVIDERS` set now contains only `["minimax"]`. The MiniMax direct API endpoint (`https://minimax.io/v1/chat/completions`) is recognized by the same URL-substring matcher.
- **CLI validation updated:** `cli/audit.mjs` `VALID_MODELS` now lists `minimax/MiniMax-M2.7` and `minimax/MiniMax-M3`. `cli/doctor.mjs` validates `provider.minimax` instead of `provider.openrouter`.

### Migration for users

```diff
- "model": "openrouter/minimax/minimax-m3",
+ "model": "minimax/MiniMax-M3",

- "model": "openrouter/minimax/minimax-m2.7",
+ "model": "minimax/MiniMax-M2.7",
```

### Files changed (22)

```
M .bizar/research/current-architecture.md
M README.md
M cli/audit.mjs
M cli/bin.mjs
M cli/doctor.mjs
M cli/doctor.test.mjs
M config/AGENTS.md
M config/agents/{baldr,forseti,hermod,odin,quick,thor,tyr}.md
M config/opencode.json.template
M config/skills/bizar/SKILL.md
M plugins/bizar/index.ts
M plugins/bizar/src/reasoning-clean.ts
M plugins/bizar/tests/reasoning-clean.test.ts
M wiki/{Agents-Reference,Background-Agents,Getting-Started,Model-Routing}.md
```

## v0.7.0-alpha.1 — Plugin ↔ Dashboard v2 Protocol

> **Breaking / additive:** New package `@polderlabs/bizar-sdk` (additive). New dashboard `/api/v2/*` namespace (additive; existing `/api/*` endpoints unchanged). New plugin `dashboard-client.ts` module (additive; existing tools unchanged). Opencode v2 routes only (v1 routes are broken upstream — see `.bizar/opencode-sse-investigation.md`).

### Highlights

- **New package `@polderlabs/bizar-sdk`** (`packages/sdk/`) — TypeScript SDK with auto-generated-style types, resource-grouped client (`createBizarClient()`), discriminated `BizarError` union, async-iterable SSE subscriber. Follows the bun-module layout (ESM, exports map, Vitest). Source-of-truth for the wire format is `.bizar/research/OPENAPI_SPEC.yaml`.
- **Dashboard `/api/v2/*` namespace** — New routes for sessions (CRUD), events (SSE subscribe + publish), health, and the OpenAPI spec itself at `/doc`. HTTP basic auth via a 32-byte password generated on first start and persisted to `~/.cache/bizarharness/dash-auth.json` (mode 0600). Existing `/api/*` endpoints untouched.
- **Plugin `dashboard-client.ts`** — New module in `plugins/bizar/src/` that wraps the SDK and forwards events from the plugin to the dashboard. Reads dashboard URL + password from `BIZAR_DASHBOARD_URL` / `BIZAR_DASHBOARD_PASSWORD` env vars or the auth file. Graceful degradation: drops events if the dashboard is unreachable; never throws into the plugin.

### Architecture

- **Transport:** HTTP + SSE hybrid (REST for CRUD, SSE for events). Matches the opencode SDK pattern; no WebSocket.
- **Auth:** HTTP basic with `opencode:<password>`. Same password every dashboard restart.
- **Source of truth:** `.bizar/research/OPENAPI_SPEC.yaml` (OpenAPI 3.1). SDK types are hand-written to match exactly; in v0.7.1 they'll be generated via `@hey-api/openapi-ts`.

### Files

- `packages/sdk/package.json` (NEW) — `@polderlabs/bizar-sdk` v0.7.0-alpha.1
- `packages/sdk/tsconfig.json` (NEW) — strict TypeScript, ES2022, declaration emit
- `packages/sdk/vitest.config.ts` (NEW)
- `packages/sdk/.gitignore` (NEW)
- `packages/sdk/LICENSE` (NEW) — MIT
- `packages/sdk/README.md` (NEW) — usage docs
- `packages/sdk/src/index.ts` (NEW) — public API barrel
- `packages/sdk/src/client.ts` (NEW) — `createBizarClient()` factory
- `packages/sdk/src/types.ts` (NEW) — discriminated unions for `Event`, `Part`, `Error`
- `packages/sdk/src/errors.ts` (NEW) — `BizarError` discriminated union
- `packages/sdk/src/events.ts` (NEW) — async-iterable SSE subscriber
- `packages/sdk/src/version.ts` (NEW)
- `packages/sdk/tests/client.test.ts` (NEW) — 10 cases
- `packages/sdk/tests/events.test.ts` (NEW) — 6 cases
- `packages/sdk/tests/errors.test.ts` (NEW) — 12 cases
- `packages/sdk/tests/fixtures/fetch-mock.ts` (NEW)
- `packages/sdk/tests/fixtures/sse-mock.ts` (NEW)
- `bizar-dash/src/server/v2-event-bus.mjs` (NEW) — in-memory event bus with replay buffer
- `bizar-dash/src/server/v2-auth-file.mjs` (NEW) — password file management
- `bizar-dash/src/server/routes-v2/auth.mjs` (NEW) — HTTP basic middleware
- `bizar-dash/src/server/routes-v2/health.mjs` (NEW) — public `/health`
- `bizar-dash/src/server/routes-v2/events.mjs` (NEW) — SSE subscribe + publish
- `bizar-dash/src/server/routes-v2/sessions.mjs` (NEW) — session CRUD
- `bizar-dash/src/server/routes-v2/index.mjs` (NEW) — router + `/doc`
- `bizar-dash/tests/smoke-v2.mjs` (NEW) — 7-case end-to-end smoke
- `bizar-dash/src/server/server.mjs` — mounts `/api/v2` router after existing `/api`
- `plugins/bizar/src/dashboard-client.ts` (NEW) — SDK-backed publisher
- `plugins/bizar/tests/dashboard-client.test.ts` (NEW) — 6 cases
- `plugins/bizar/package.json` — adds `@polderlabs/bizar-sdk: *` to dependencies
- `package.json` (root) — adds `"workspaces": ["packages/*"]` + `build:sdk` / `test:sdk` scripts
- `.bizar/research/IMPLEMENTATION_PLAN.md` (NEW) — full plan with phasing, file map, parallel split, risk register
- `.bizar/research/OPENAPI_SPEC.yaml` (NEW) — OpenAPI 3.1 source of truth (~280 lines)
- `.bizar/research/target-patterns.md` (NEW) — research notes from the three target sources
- `.bizar/research/current-architecture.md` (NEW) — pre-refactor architecture map
- `.bizar/research/plugin-source-locator.md` (NEW) — file-by-file plugin map

### Test results

- `@polderlabs/bizar-sdk`: **28/28** pass (vitest)
- Dashboard v2 routes: **7/7** pass (`node tests/smoke-v2.mjs`)
- Plugin `dashboard-client`: **6/6** pass (`bun test`)
- Existing plugin tests: **152 pass, 18 pre-existing failures** (unrelated to this change; verified by stashing my changes and re-running — same numbers)
- Existing dashboard server tests: unaffected (no changes to existing routes)

### Next steps (v0.7.1+)

- Auto-generate `types.gen.ts` from `OPENAPI_SPEC.yaml` via `@hey-api/openapi-ts` (replaces hand-written `types.ts`).
- Move `plugins/bizar/` → `packages/plugin/` (delete root copy).
- Move `bizar-dash/` → `packages/dashboard/` (delete root copy).
- Wire `dashboard-client.publish()` into `event-stream.ts` so every opencode SSE event flows to the dashboard.
- Add full CRUD for the rest of the OpenAPI spec (`/projects`, `/plans`, etc.).
- Replace the file-based `serve.json` bridge with SDK-based event publishing once all consumers migrate.
- npm Trusted Publishing via OIDC for `@polderlabs/bizar-sdk` (the SDK is published with `--tag alpha`).

## v3.12.4 — 2026-06-24

### Fixed
- **`/bizar` slash command was treated as plain text** — opencode's command loader requires YAML frontmatter (`description`, `agent`) on each `config/commands/*.md` file, and `opencode.json`'s `command.bizar.arguments` field is not in the schema. Added proper frontmatter to all 9 command files and removed the invalid `arguments` field from the template. Typing `/bizar` in the opencode TUI now opens the menu instead of sending the text to the model.

### Added
- **Simplicity Rule for all agents** — a new section at the top of `config/AGENTS.md`'s "Always-On Behavior" baseline that overrides the agents' tendency to overcomplicate simple tasks. Key points: match the work to the ask, no speculative features or questions, no over-explanation, short replies are good replies, subagents are expensive. Verified with smoke tests: "What's 2+2?" → "4.", "List files" → directory listing.

## v3.12.3 — 2026-06-24

### Fixed
- **`bizar update` silently broke the plugin** — the deployed plugin at `~/.config/opencode/plugins/bizar/` had no `node_modules`, so Bun couldn't resolve the plugin's import of `@polderlabs/bizar-sdk` (a workspace-internal package not on the public registry). The plugin failed to load on every opencode session after an update, leaving `<think>` strips and all other hook behavior disabled with zero visible error. `installPluginFromGlobal` now copies the npm package's bundled `node_modules/` to the deployed location automatically, so the SDK resolves correctly after every update.
- **`bizar doctor` false negative on plugin entry** — the `plugin-entry-present` and `plugin-path-resolves` checks didn't handle the `[path, options]` tuple shape that `opencode.json` uses. Added `Array.isArray(p)` branches and three new tests. Doctor now reports 9/9 on a healthy install.

### Tests
- 187 CLI tests pass (4 new for `installPluginFromGlobal` node_modules copy).

## v3.12.2 — 2026-06-24

### Fixed
- **M3 `<think>` blocks leaked as visible inline text** — the MiniMax M3 model via OpenRouter was double-emitting reasoning, once in the structured `reasoning_details` field and again as raw `<think>...</think>` text inside the message content. The plugin now strips any of the four inline think-tag variants (`<think>`, `<thinking>`, `<reasoning>`, `<ant_thinking>`) from completed text parts via the `experimental.text.complete` hook. Reasoning still routes to the structured field as before.
- **The Bizar plugin loaded the wrong source on disk** — opencode loaded the plugin from `~/.config/opencode/plugins/bizar/index.ts` (the deployed copy), and the source-of-truth at `plugins/bizar/` was drifting. The CLI now ships a `bizar dev-link` / `bizar dev-unlink` pair so the user can symlink the local source for instant propagation during development. `bizar update` refuses to clobber a dev symlink unless `--force` is passed.

### Added
- **`bizar doctor`** — runs nine health checks on the BizarHarness install (opencode reachable, config valid, plugin entry present, plugin path resolves, deployed plugin matches npm, agent files installed, tools on PATH, dashboard reachable, provider config sane). Returns non-zero on any failure. Runs automatically at the end of `bizar update` and prints a warning if anything regressed.
- **`bizar update --dry-run`** — previews which packages would be installed, which processes would be killed, and whether the install script would rerun, without actually doing any of it.
- **Symlink-aware `installPluginFromGlobal`** — `bizar update` now detects a `~/.config/opencode/plugins/bizar` symlink and skips the npm copy unless `--force` is passed. The dev workflow no longer silently breaks after every update.

### Tests
- 243 plugin tests pass (21 new for `reasoning-clean.ts`).
- 180 CLI tests pass (13 new for `dev-link`, 16 new for `doctor`).

## v3.12.1 — 2026-06-24

### Fixed
- **`bizar_spawn_background` was silently broken** — the spawned `opencode run` subprocess was missing the `--agent` flag and pointed at stale OpenRouter model IDs, so every background agent session crashed immediately after creation. Extracted `buildOpencodeRunArgs()` for testability, added the agent flag, and migrated all model IDs to the new `openrouter/minimax/minimax-{m3,m2.7}` form.
- **OpenRouter `thinking: "adaptive"` was silently ignored** — the OpenRouter provider uses `reasoning` as the parameter name and does not support an adaptive effort level for MiniMax. Switched the openrouter provider entries to the correct `reasoning: { enabled: true }` shape.
- **Plugin init hard-failed spawn when `opencode serve` was unavailable** — the v0.8.0 active-subprocess path does not need a serve child. Made `InstanceManager.http` and `stream` nullable, guarded the call sites, and added a `isBizarBackgroundChild()` check so bg-spawned children skip the serve-start block cleanly.
- **`<thinking>` tags were rendered inline in chat output** — the MiniMax M3 model emits reasoning as `<thinking>...</thinking>` markup. Added server-side stripping in `serve-info.mjs` so the tags never reach the React markdown renderer.

### Added
- **Active Background Agents tab in the dashboard** — new view at `bizar-dash/src/web/views/BackgroundAgents.tsx` listing running and pending bg agents with live status, kill button, output viewer, and tmux attach helper. Polls every 5s and subscribes to the `background:change` WebSocket event.
- **Research-Loop Rule for agents** — wired `config/rules/uncertainty.md` into the loader table at `config/AGENTS.md` and added a short paragraph so agents reach for `websearch` / `webfetch` when uncertain or stuck, rather than retrying the same edit.

### Changed
- **Removed dead `provider` block at top of `config/opencode.json.template`** — it was overridden by a later `provider` key, so it was dead code.

## v3.12.0 — 2026-06-24 — Background agent architecture rewrite (v0.8.0)

### Fixed (vv3.12.0 follow-up — from full dev-container simulation)

End-to-end simulation in `BizarHarness-dev` (Docker) revealed three bugs in the dashboard + plugin wiring that would silently break the v2 protocol in production. All fixed and verified inside the container:

- **Dashboard `cli.mjs`** — `start --port N` was silently ignored, dashboard always bound on default 4321. Now parses `--port` and `--bind` CLI args.
- **Dashboard `server.mjs`** — `/api/v2/*` requests returned 404 with the old apiRouter's error format. Cause: `api.mjs` has a 404 catch-all at line ~109 that swallows any unhandled `/api/*` request without calling `next()`. Fix: mount the `/api/v2` router **before** `apiRouter` so `/api/v2/*` matches first. General lesson: namespace routers must mount BEFORE broader routers with internal catch-alls.
- **Dashboard `v2-auth-file.mjs`** — persisted `port` from a previous run was used instead of the actual listen port. Fix: always use the current `port` argument; rewrite the file when persisted port differs (preserves password + createdAt).
- **Plugin `event-stream.ts`** — added `onEvent(handler)` global handler for non-session SSE events. Used by the dashboard publisher wiring.
- **Plugin `index.ts`** — wired `createDashboardPublisher()` into both `EventStream.onEvent` (background-agent SSE) AND the opencode `event` hook. Also fixed a `Map<string, string>` typo that was accidentally typed as `Map<string, Set<string>>` and broke 3 typecheck lines.

### Simulation findings (full container run)

`scripts/bizar-sim.sh` is a new end-to-end test harness that:

1. Installs `@polderlabs/bizar` + `@polderlabs/bizar-dash` to user prefix (workaround for sandbox EACCES on `/usr/local/lib/node_modules`).
2. Runs `install.sh` to copy plugin source into container's `~/.config/opencode/plugins/bizar/`.
3. Runs `npm install` for plugin deps (the SDK is fetched from npm).
4. Starts the dashboard from LOCAL source (npm-published v3.11.0 lacks v2 routes).
5. Verifies v2 routes via curl: `/api/v2/health` (200), `/api/v2/sessions` (401/200), `/api/v2/doc` (200), `/api/v2/event` (401).
6. Subscribes to SSE in background.
7. Runs `opencode run --model opencode/deepseek-v4-flash-free "..."` to verify the plugin loads end-to-end.
8. Runs SDK vitest, plugin bun test, dashboard smoke test.

**157 tests green inside the container** (28 SDK + 6 plugin dashboard-client + 7 dashboard smoke + 116 existing plugin). Zero regressions.

### Known limitations (not blockers)

- **`opencode run` does not emit lifecycle events in --pure mode.** The plugin's `event` hook only fires for long-running TUI/server sessions. The simulation's `opencode run <prompt>` is too short-lived to trigger session.created/session.updated/session.idle. The v2 protocol itself is verified end-to-end via the SDK smoke test (which POSTs events to `/api/v2/event` and the SSE subscriber receives them). For real-world monitoring, the dashboard would be connected to a long-running `opencode serve` instance, which IS where lifecycle events fire.
- **Dev container's opencode.json has stale model names** (`openrouter/minimax/minimax-m3`). Use `--model opencode/deepseek-v4-flash-free` for the free tier.
- **Dev container missing Python3** — Dockerfile only installed `git`, `jq`, `ca-certificates`, `curl`. Graph system needs Python 3.10+ for graphify. **Fixed**: `python3 python3-pip` added to `apt-get install` in `BizarHarness-dev/Dockerfile`. After rebuild, `pip3 install --target=/home/dev/.cache/python-packages graphifyy` + `PYTHONPATH=/home/dev/.cache/python-packages` makes graphify importable across container restarts.

### Fixed (vv3.12.0 follow-up #2 — multi-pass simulation, 10 passes)

Re-ran an end-to-end multi-pass test suite (10 passes) inside `BizarHarness-dev` and found/fixed additional bugs:

- **Plugin `src/commands.ts` — `parseSlashCommand` returned `response: ""` for 13 slash-command handlers** (`/visual-plan on|off|status`, `/plan new|list|open|get`, `/help`, `/plan` (no subcommand), and others). Dialog component handled UI feedback, but the `response` text field was empty — broke 19 of 510 plugin tests. **Fixed**: added meaningful human-readable text alongside each dialog (e.g. `"Visual plan mode is now on."`, `"Found 3 plan(s) (3): alpha, beta, gamma."`, `"Created plan \"My Feature\" with the \"blank\" template…"`). All 510 plugin tests now pass.
- **Plugin `tests/config.test.ts` — hard-coded version `0.5.4` was stale** (plugin is at `0.8.0`). Test was out of sync with package.json since the v0.8.0 npm publish. **Fixed**: updated assertion to `0.8.0`.
- **Pass scripts are self-contained** — `scripts/pass[1-10]-*.sh` each install their own dependencies (npm packages to `~/.cache/bizar-global/node_modules`, graphify to `~/.cache/python-packages`) and set `PATH` / `PYTHONPATH` at the top. Necessary because each `docker compose run --rm` creates a fresh container (only `/home/dev/.cache/` persists via the named volume).

### Fixed (v3.11.1 follow-up — "background agent spawns but does nothing")

User-reported: `bizar_spawn_background` creates sessions in the bg state file but the agent never does any work; tmux sessions pile up with empty panes. Two root causes found empirically in the dev container:

1. **Phantom log file in tmux wrap** — `task-delegator.mjs:605` and `bg-retry.mjs:392` both tailed `<worktree>/.bizar/opencode.log` and `<worktree>/.opencode/log/<id>.log` respectively. **Nothing in the system writes to either path.** The plugin's `LogWriter` (plugins/bizar/src/report.ts:147) actually writes to `~/.cache/bizar/logs/<sessionId>.log` (default `logDir` in plugins/bizar/src/options.ts:88). The tmux session therefore sat there showing `tail: cannot open '/project/.bizar/opencode.log' for reading: No such file or directory` in an infinite retry loop. **Fixed**: new `getActualBgLogPath({ sessionId })` in `bizar-dash/src/server/lib/path-safe.mjs` returns the path the LogWriter writes to. Both call sites now use it. tmux panes are clean; operator sees real log activity as the agent works.

2. **Tmux session pile-up** — when an instance became terminal (done/failed/killed/timed_out), its tmux session was never killed unless the user explicitly called `kill()`. **Fixed**: new `backgroundStore.killTmuxFor(instanceId)` method. `cleanup(maxAgeDays)` now also calls it for every terminal instance regardless of age, so long-running dashboards don't accumulate hundreds of dead tmux sessions.

3. **tmux not installed in the dev container** — `BizarHarness-dev` Dockerfile didn't list `tmux` in apt. **Fixed**: added to the apt-get install list; rebuilt the image.

### Architecture issue (documented, not yet fixed — v0.8.0 candidate)

**`opencode serve` is a passive HTTP server.** Per the [opencode server docs](https://opencode.ai/docs/server/): "When you run opencode it starts a TUI and a server. Where the TUI is the client that talks to the server." The plugin POSTs the prompt via `POST /api/session/{id}/prompt` and the server admits it (`session.next.prompt.admitted` event) — but **no agent loop processes the prompt** unless a TUI/web client is connected to the same `opencode serve` child. The plugin currently never drives that agent loop.

Verified empirically: `POST /api/session/{id}/prompt` returns `{"data":{"admittedSeq":1, ...}}` but the SSE stream shows only `server.connected`, `session.created`, `session.next.prompt.admitted` — no `message.user.created`, no `message.assistant.*`, no `session.idle`. The session sits in admitted state forever.

**Workarounds**:
- Run `opencode` (the TUI) in a separate terminal. It will connect to the same `opencode serve` child and drive the agent loop. The plugin's POSTed prompts will then be processed.
- OR wait for v0.8.0 which will spawn `opencode run <prompt>` per spawn, replacing the HTTP-only path with a process that drives the agent to completion.

This is documented inline in `task-delegator.mjs:596-624` so future maintainers don't re-discover it.

### Test results (post-fix)

- **Pass 1 (CLI commands)**: 11/11 ✅
- **Pass 2 (Plugin)**: 7/7 plugin tools exist, plugin loads cleanly
- **Pass 3 (Agents)**: 13/13 agent definitions valid frontmatter
- **Pass 4 (Dashboard)**: 10/13 routes work end-to-end (3 false-fails = test bugs, not framework bugs)
- **Pass 5 (Plan system)**: 3/4 ✅ (`plan new` hangs because it opens a server; behavior is correct, the test needs to background it)
- **Pass 6 (Graph system)**: 6/6 ✅ CLI infrastructure works; full `graph build` needs `OPENAI_API_KEY` for semantic extraction of docs
- **Pass 7 (Skills)**: 9/9 ✅ all 5 bundled skills with valid frontmatter
- **Pass 8 (Self-improvement)**: 8/8 ✅ append/restore cycle works
- **Pass 9 (MCP integration)**: 3/3 ✅ (Hindsight sandbox-disabled by design)
- **Pass 10 (Full integration)**: 19/19 ✅
- **Pass 11 (Background spawn)**: 7/7 ✅ phantom-log fix verified end-to-end with real tmux in the container
- **Pass 12 (Background architecture)**: 4/4 ✅ active `opencode run` subprocess path verified end-to-end
- **Total**: 510 plugin tests + 28 SDK tests + 7 dashboard v2 smoke + 19 new path-safe/tmux-wrap/opencode-runner tests + 116 root typecheck — all green, zero regressions.

### v0.8.0 — Background agent architecture rewrite (FIX 3)

User-reported: "it spawns a lot of sessions but doesn't do anything." Empirical reproduction in the dev container found the architectural issue documented inline in `task-delegator.mjs:596-624` and the plugin's `bg-spawn.ts`:

> "opencode serve is a passive HTTP server. The agent loop is driven by a TUI/web client. The plugin POSTs the prompt via the HTTP API; the prompt is admitted but no agent processes it unless a TUI is connected."

**Root cause:** Pre-v0.8.0, the plugin's `bizar_spawn_background` tool POSTed to `POST /api/session/{id}/prompt` on the opencode serve child. The server admitted the prompt (`session.next.prompt.admitted` event) but no agent loop processed it. Result: sessions created, tmux panes spawned, nothing happened. The user was right.

**Fix:** Replace the passive HTTP path with an **active subprocess path** via the new `opencode-runner` module (Bun.spawn for the plugin, child_process.spawn for the dashboard). Each background agent now spawns one `opencode run <prompt>` subprocess that drives the agent loop to completion.

**Files changed:**

- `plugins/bizar/src/opencode-runner.ts` (NEW) — Bun.spawn-based runner. Tracks PIDs in an in-memory map. Captures stdout+stderr to the LogWriter's log file. Parses the sessionId from the structured stderr log stream. Exposes `spawnAgent`, `getStatus`, `onExit`, `killAgent`, `list`, `_resetForTests`.
- `plugins/bizar/src/tools/bg-spawn.ts` — refactored to use the runner. The HTTP client and SSE event handler are gone; the runner's `onExit` callback now drives instance state transitions and triggers `maybeAutoRestart` for persistent instances. Returns immediately with `{ instanceId, sessionId, processId, status: "running", message, nextSteps }` so the calling agent can go idle.
- `plugins/bizar/src/background-state.ts` — `BackgroundState` now carries `processId`, `exitCode`, `runnerState`, `runnerError`, `spawnMessage`, `spawnNextSteps`, `sessionIdAt`, `runnerStartedAt`, `runnerEndedAt`, `spawnedAt`, `exitSignal` (all optional for backward compat).
- `plugins/bizar/src/background.ts` — `InstanceManager` now exposes a public `maybeAutoRestart(instanceId)` method (was private). The runner's onExit calls this for failed persistent instances.
- `plugins/bizar/index.ts` — `BgSpawnDeps` no longer requires `http`; the bg-spawn tool wires only `instanceManager`, `worktree`, and `logger`.
- `bizar-dash/src/server/opencode-runner.mjs` (NEW) — Node child_process version of the plugin runner. Same surface, same wire format.
- `bizar-dash/src/server/task-delegator.mjs` — `dispatchToBackground` now uses the runner instead of the passive HTTP API. Same wire format, same log path.
- `cli/bg.mjs` (NEW) — `bizar bg` CLI for managing background agents:
  - `bizar bg list` — one-line summary of every background instance (status, agent, prompt preview, tmux session).
  - `bizar bg status <id>` — full detail view of one instance.
  - `bizar bg view` — **the headline feature**: opens a desktop window with a tmux control session that splits into N panes, each `tail -F` of one running agent's log. Cross-platform: macOS (osascript + Terminal.app), Linux (gnome-terminal / konsole / xterm), Windows (wt.exe / cmd).
  - `bizar bg logs <id>` — `tail -F` the agent's log file.
  - `bizar bg kill <id>` — `SIGTERM` (then `SIGKILL` after 5s) to the subprocess and kill its tmux session.
- `cli/bin.mjs` — wires `bizar bg` into the CLI.
- `config/agents/odin.md` — explicit "go idle after spawning" guidance. The previous "stops and does nothing" trap was caused by the LLM calling `bizar_collect` immediately after spawn and waiting. The new prompt tells Odin: "acknowledge the spawn, return control to the user, do NOT call `bizar_collect` unless the user explicitly asked for the result. Suggest `bizar bg view` for live monitoring."

**Tests added (7 new, all pass):**

- `bizar-dash/tests/opencode-runner.test.mjs` (NEW, 7 tests) — covers the dashboard runner's API surface: `_resetForTests`, `getStatus` for unknown PIDs, `killAgent` no-ops on unknown PIDs, `spawnAgent` with non-existent worktree (still returns a processId), `spawnAgent` creates log dir if missing, `spawnAgent` captures stdout+stderr to logPath, `onExit` fires when the process exits.
- Total dashboard tests: 28 (path-safe: 9, tmux-wrap: 3, opencode-runner: 7, smoke-v2: 7, plus the original 2).

**Empirical end-to-end verification (scripts/pass12-bg-architecture.sh, 4/4 PASS):**

- `opencode serve` starts.
- Dashboard starts.
- Task submitted to `/api/tasks/submit`.
- Dashboard's `task-delegator` spawns an `opencode run` subprocess via the new runner.
- BG state file is written with `instanceId`, `sessionId`, `runnerState`, etc.
- Log file is written by the runner with structured `[stderr] timestamp=... level=... message=...` lines from opencode.
- `bizar bg list` correctly shows the agent with its tmux session name.
- `opencode-runner.mjs` directly: spawns an `opencode run`, gets a sessionId, and the `onExit` callback fires when the subprocess exits.

**Backward compatibility:** Old state files (pre-v0.8.0) load cleanly — all new fields are optional. The HTTP API path (`createOpencodeSession` + `sendPrompt`) is no longer called by the plugin or the dashboard, but the dashboard's `serve-info.mjs` still exports it for any external consumer (e.g. a custom dashboard plugin). The plugin's `opencode serve` child still starts and listens on its port — the v2 dashboard protocol uses it.

### Changed — Agent behavior under uncertainty

All 13 agent prompts now reference a new rule, `config/rules/uncertainty.md`, that codifies the **"stop and research"** behavior:

- When an agent is uncertain or stuck (e.g. about to retry a failed tool call with a slight variation, or guessing at a file path / API signature / config key), it must STOP.
- Stopping means using the available research tools before retrying: `semble search` for codebase patterns, `webfetch` for documentation, `read` for related files, `hindsight_recall` for prior project context, `skill` for domain guidance, or asking the user.
- After research, the agent acts with confidence. If the new attempt also fails, it updates its model — it does not loop back to the variation-spawning behavior.

The 5/8/12 runtime loop guard in the plugin remains a safety net but is now explicitly described as a last resort. Agents should self-correct **before** the guard fires, not after.

### Files
- `config/rules/uncertainty.md` (NEW, 70 lines) — the rule.
- `config/agents/{odin,vor,frigg,quick,mimir,heimdall,hermod,thor,baldr,tyr,vidarr,forseti,semble-search}.md` — `## Thinking style` sections now point to the new rule.

## v3.11.0 — 2026-06-23 — Dashboard v3.11.0 sync

### Highlights
- **Dashboard v3.11.0** ships as a single coordinated release with the CLI. New features: interactive file browser in Add Project dialog, `dashboard.projectsDirectory` setting with auto-scan, in-browser `New folder` button (`POST /api/fs/mkdir`), `dashboard.allowedRoots` for additional filesystem roots, and a critical fix for background-agent dispatch that was silently leaving every spawned instance stuck in `dispatchPending: true` (no tmux session, no worktree dispatch). See the dashboard package's CHANGELOG for full details.

### Changed
- `@polderlabs/bizar-dash` peer dep constraint unchanged (`^3.10.0`); 3.11.0 satisfies it.

### Files
- `package.json` — version bump 3.10.0 → 3.11.0
- `bizar-dash/package.json` — version bump 3.10.0 → 3.11.0
- `bizar-dash/CHANGELOG.md` — v3.11.0 entry finalized (Unreleased → dated)
- `CHANGELOG.md` (this file) — v3.11.0 entry added

## v3.10.0 — 2026-06-23 — Windows compat + CLI consolidation

### Highlights
- **CLI consolidation**: the `bizar-dash` binary is removed. All dashboard commands now live under `bizar dash <sub>`. The internal `@polderlabs/bizar-dash` npm package is still published (as a library) but no longer installs a `bizar-dash` binary.
- **Windows compatibility**: install, Python detection, signals, and shell helpers now work on Windows out of the box.
- **Concise thinking rule**: agents are now constrained to 2-4 sentence thinking with hard bans on informal self-talk. No more 15-minute ramble loops.
- **MiniMax interleaved fix**: `<thinking>...</thinking>` tags no longer leak into visible output for MiniMax on openrouter.

### Migration
| Old | New |
|---|---|
| `bizar-dash start` | `bizar dash start` |
| `bizar-dash stop` | `bizar dash stop` |
| `bizar-dash status` | `bizar dash status` |
| `bizar-dash tui` | `bizar dash tui` |
| `bizar dashboard X` | `bizar dash X` (still works, prints deprecation warning) |
| `bizar tui` | `bizar dash tui` (still works, prints deprecation warning) |
| `bizar start` | `bizar dash start` (REMOVED) |
| `bizar stop` | `bizar dash stop` (REMOVED) |
| `bizar status` | `bizar dash status` (REMOVED) |
| `bizar --bg` | `bizar dash start --bg` (REMOVED) |
| `bizar` (no args) | shows help (was: launch TUI) |
| `bizar-dash` binary | REMOVED — `rm $(which bizar-dash)` |

### Concise thinking rule
- Add `config/rules/thinking.md` (56 lines): caps thinking at 2-4 sentences, bans informal self-talk ("oh but what if", "actually", "let me think", "wait", "hmm", "I wonder", "on second thought", "alternatively"), requires one-shot decision pattern
- Add `## Thinking style` section to all 12 agent files referencing the new rule
- Update `install.sh` with post-install warning about `variant: "high"` on Odin/Tyr/Forseti

### MiniMax interleaved fix
- Add `provider.<minimax|openrouter>.models` config with `interleaved: { field: "reasoning_details" }` and `reasoning: true` for MiniMax-M3, MiniMax-M2.7, minimax-m3, minimax-m2.7, owl-alpha
- Fixes `<thinking>...</thinking>` tags being shown as raw text instead of rendered as native thinking blocks in opencode

### Windows compatibility
- `install.sh` is bash-only; Windows users use `npm install -g @polderlabs/bizar` (documented in README)
- `curl | sh` patterns (5 sites) wrapped in `process.platform === 'win32'` with PowerShell `irm | iex` alternative
- `python3` → `py` launcher on Windows (`cli/graph.mjs`, `cli/init.mjs`)
- `pip` → `py -m pip` on Windows (`cli/install.mjs`, `cli/graph.mjs`)
- `SIGTERM`/`SIGKILL` → no-arg `process.kill()` / `taskkill /F` on Windows (`cli/update.mjs`, `plugins/bizar/src/serve.ts`)
- `sleep` command → `setTimeout` (3 sites in `cli/update.mjs`)
- `bizar-dash` `~/.config/opencode` → `%APPDATA%\opencode` (4 places: `bizar-dash/src/cli.mjs`, `bizar-dash/src/server/tui.mjs`, `bizar-dash/src/server/tui.mjs` runTui)
- `.gitattributes` forces LF for shell/script files (prevents CRLF breaking shebangs)
- Hardcoded `/tmp/` in 12 test files → `os.tmpdir()`
- `killAndWait` made async (no external callers, internal-only breaking change)

### CLI consolidation
- `bizar-dash` binary REMOVED. `rm $(which bizar-dash)` to clean up old symlink.
- `bizar dash <subcommand>` is the new canonical form (start, stop, status, tui)
- `bizar dashboard X` and `bizar tui` are deprecated aliases (still work, with warning)
- `bizar start`, `bizar stop`, `bizar status`, `bizar --bg`, `--web`, `--web-only`, `--no-web`, `--detach` REMOVED
- `bizar` (no args) no longer launches TUI (shows help)
- `bizar-dash/src/cli.mjs` refactored to export functions (`start`, `stop`, `status`, `tui`) with `isMainEntry()` guard so signal handlers only register when run as a CLI (for legacy `cli/update.mjs#spawnFreshDashboard` path)
- `bizar-dash/package.json` got `exports` map: `{ ".": "./src/server/server.mjs", "./dash-cli": "./src/cli.mjs" }`. Removed `bin` field. The package is now a LIBRARY, not a CLI.
- In-process imports replace subprocess spawn: `cli/bin.mjs` calls `import('@polderlabs/bizar-dash/dash-cli')` and uses the exported functions directly
- The plugin's `commands-impl.ts` spawns `bizar dash start` instead of `bizar dashboard start`

### Environment variables
- Unchanged. `BIZAR_DASHBOARD_*` env vars still work.

## v3.9.1 — 2026-06-23

### Fixed — Concise thinking rule + MiniMax interleaved output

- **`config/rules/thinking.md`** (NEW) — caps agent thinking at 2-4 sentences, bans informal self-talk, requires one-shot decision pattern.
- **`config/agents/*.md`** — added `## Thinking style` section to all 12 agent files referencing the new rule.
- **`config/opencode.json.template`** — added `interleaved: { field: "reasoning_details" }` and `reasoning: true` for MiniMax models (both `minimax` and `openrouter` providers), fixing `<thinking>` tags leaking as raw text into visible output.
- **`install.sh`** — added post-install warning about `variant: "high"` multiplying thinking verbosity.

## v3.9.0 — 2026-06-23

### Added — Slash commands open real dialogs

Slash commands used to print their usage text as a chat bubble. v3.9.0 makes them open interactive dialogs in the dashboard.

- **`plugins/bizar/src/commands.ts`** — every command handler (`/visual-plan`, `/plan new|list|open|...`, `/bizar`, `/help`, `/audit`) now returns a `DialogDescriptor` instead of a text string.
- **`plugins/bizar/index.ts`** — the `chat.message` hook writes the descriptor to `~/.cache/bizar/dialogs/<id>.json` (validated against `dlg_[a-zA-Z0-9_-]{1,64}`) and returns silently instead of throwing.
- **`bizar-dash/src/server/dialog-store.mjs`** (NEW) — persists dialog requests to disk.
- **`bizar-dash/src/server/dialog-poller.mjs`** (NEW) — ticks every 1s, broadcasts `dialog:show` over WebSocket.
- **`bizar-dash/src/server/routes/dialogs.mjs`** (NEW) — mounted in `api.mjs`. Provides `GET /api/dialogs` for inspection.
- **`bizar-dash/src/web/components/CommandDialog.tsx`** (NEW) — generic dispatcher. Mounts the right specific dialog.
- **`bizar-dash/src/web/components/{VisualPlanDialog,PlanCreateDialog,PlanListDialog,HelpDialog,AuditDialog}.tsx`** (NEW) — one component per command.
- **`bizar-dash/src/web/lib/types.ts`** — added `DialogDescriptor` and `DialogComponent` types; extended `WsMessage` union with `{ type: 'dialog:show'; dialog: DialogDescriptor }`.

### Added — Schedules overhaul (Sunday 1pm code review actually works now)

The schedule feature was 6 critical bugs deep. v3.9.0 fixes all of them.

- **Agent dispatch is no longer a stub.** `schedules-runner.mjs:97-113` now calls `taskDelegator.submit()` so a cron-scheduled `agent` action actually runs the named agent with the prompt text. Previously it just logged `"deferred to v3.1"` and marked the run successful — silent no-op.
- **Timezones work.** Replaced the hand-rolled 5-field cron evaluator with the `croner` library (10.0.1). Schedules can now carry `timezone: "America/New_York"` and fire at 1pm ET, not 1pm UTC. Added `croner ^10.0.1` to `bizar-dash/package.json`.
- **Structured pickers in the UI.** Day-of-week dropdown, hour dropdown (with 12h labels), minute select — composes into `"M H * * DOW"`. Timezone selector with 6 IANA presets plus an "Other…" input. Raw cron still available behind an "Advanced" toggle.
- **Edit modal on desktop and mobile.** Both `Schedules.tsx` and `MobileSchedules.tsx` now have an Edit button that pre-populates the form.
- **Mobile toggle fixed.** `MobileSchedules.tsx:41-49` called `api.patch()` but the server only had `PUT`. Added `PATCH /api/schedules/:id` (line 35-44 of `routes/schedules.mjs`) that does a partial update.
- **Mobile `/trigger` alias.** Mobile called `/schedules/:id/trigger` but server had `/run`. Added an alias route.
- **Budget-aware pre-flight.** Schedules can now carry `budgetCheck: { skipIfBudgetLow: boolean, maxConcurrent: number }`. The runner checks `backgroundStore.list()` for running+pending count; if over the cap, it records `result: "skipped"` (a new third terminal state alongside `success`/`error`) and moves on. The user's "Sunday 1pm before the weekly token reset" scenario is now expressible as a schedule config.

### Added — Background agents: persistent mode + live status UI

- **Persistent background tasks.** `background-state.ts` now tracks `persistent`, `restartCount`, `maxRestarts`, `restartError`, `lastRestartAt`. `bg-spawn.ts` accepts a `persistent: boolean` arg. When a persistent instance reaches a terminal `failed` state (session error, tool-cap, loop-guard, stall timeout, or thinking-loop), the plugin auto-restarts it up to `maxRestarts` (default 3) times via the new `InstanceManager.restart()` method. `restartCount` is summed across the parent chain (cycle-safe via a `visited` set) so a chain cannot exceed the cap. Explicit kills are never auto-restarted.
- **Background Agents status card.** New reusable `BgStatusBadge` component surfaces pending/running/done/failed/killed/timed_out with distinct colors and a pulse animation for `running`. `Tasks.tsx` shows the badge and a kill button on every task card that has `metadata.bgInstanceId`.
- **Kill confirmation dialog.** `KillConfirmDialog` requires the user to confirm before `DELETE /api/background/:id` is called.
- **Background Agents Settings card.** 5 plugin options (`maxConcurrentInstances`, `backgroundToolCallCap`, `backgroundStallTimeoutMs`, `backgroundThinkingLoopTimeoutMs`, `backgroundMaxInterventions`) are now configurable from the dashboard. Saves to `~/.config/bizar/plugin-options.json` via `PUT /api/settings/plugin-options`. Plugin reads it on next start.
- **`POST /api/background/cleanup`** — deletes terminal instances older than N days (default 7).
- **`GET /api/background/summary`** — returns `{ instances, counts, total }` for the Overview widget.

### Added — Installer uses `uv` by default

`cli/install.mjs` `promptGraphifyInstall()` was trying `pip install graphifyy` first, which fails on Arch/Fedora/macOS due to PEP 668. Now:
- Detects `uv` first.
- If uv is installed: asks to `uv tool install graphifyy`.
- If uv is missing: asks to install uv via the astral installer (`curl -LsSf https://astral.sh/uv/install.sh | sh`) and then run `uv tool install graphifyy`.
- Falls back to `pip install graphifyy` only if the user declines uv.

Matches the pattern already used for Semble install.

### Changed — MiniMax models default to OpenRouter provider

OpenRouter now serves the MiniMax M2.7 and M3 tiers. Verified via the OpenRouter `/api/v1/models` endpoint:
- `minimax/minimax-m2.7` — `MiniMax: MiniMax M2.7`
- `minimax/minimax-m3` — `MiniMax: MiniMax M3`

The default opencode provider is now `openrouter`. Model strings changed across:
- `config/opencode.json.template` — top-level `model`/`small_model`, all 12 agent `model:` fields, and a new `provider.openrouter` block that declares the two model IDs and reads `OPENROUTER_API_KEY` from env.
- `config/agents/*.md` (7 files: odin, thor, tyr, hermod, forseti, baldr, quick) — frontmatter `model:`.
- `config/AGENTS.md` — routing table + 4 section headers.
- `config/skills/bizar/SKILL.md` — troubleshooting section rewritten for the new provider.
- `cli/audit.mjs` — `validModels` list updated.
- `README.md` — provider setup table.
- All 5 wiki pages that reference the old strings.
- Plugin source, plugin tests (67 fixtures updated), and the `bg-spawn.ts` error message example.

API key setup: users now set `OPENROUTER_API_KEY` instead of `MINIMAX_API_KEY`.

### Files changed
- **44 modified**: `cli/install.mjs`, `cli/audit.mjs`, `config/opencode.json.template`, all 7 `config/agents/*.md`, `config/AGENTS.md`, `config/skills/bizar/SKILL.md`, `plugins/bizar/index.ts`, `plugins/bizar/src/{background-state,background,commands,bg-spawn}.ts`, 6 plugin test files, `plugins/bizar/README.md`, `bizar-dash/package.json`, `bizar-dash/src/server/{background-store,schedules-store,schedules-runner,server,api}.mjs`, `bizar-dash/src/server/routes/{background,schedules,chat}.mjs`, `bizar-dash/src/web/{App.tsx,lib/types.ts}`, `bizar-dash/src/web/views/{Chat,Tasks,Settings,Schedules}.tsx`, `bizar-dash/src/web/mobile/views/MobileSchedules.tsx`, `README.md`, 5 wiki pages.
- **9 new**: `bizar-dash/src/server/{dialog-store,dialog-poller}.mjs`, `bizar-dash/src/server/routes/dialogs.mjs`, `bizar-dash/src/server/settings-store.mjs`, `bizar-dash/src/server/routes/settings.mjs`, 6 dialog components under `bizar-dash/src/web/components/`.

## v3.8.0 — 2026-06-22

### Added — `bizar graph` subcommand for per-project knowledge graphs

**`bizar graph`** (powered by [graphify](https://github.com/bretbthomas/graphify)) provides a structured, queryable map of every agent, skill, command, and rule in the BizarHarness project. Graph files live in `.bizar/graph/` and are git-trackable.

#### New files
- **`cli/graph.mjs`** — `bizar graph` subcommand implementing `build`, `update`, `query`, `path`, `explain`, `watch`, `status`, and `install` actions
- **`cli/graph.test.mjs`** — 11 Node `node:test` cases, all passing

#### Modified files
- **`cli/bin.mjs`** — wired `graph` into the dispatcher, added `showGraphHelp()`, updated top-level help and `showInitHelp()`
- **`cli/init.mjs`** (+35 lines) — soft graph build step after writing `.bizar/PROJECT.md`; fails open if `graphifyy` is missing
- **`cli/install.mjs`** (+58 lines) — post-install `promptGraphifyInstall()` that offers to install or build the graph

#### Config updates
- **`config/commands/init.md`** — rewritten (1→23 lines) to teach the new graph flow, status verification, and retry instructions
- **`config/AGENTS.md`** — new `## Graph Query (bizar graph)` section

#### Agent parallel-execution coordination
All 9 agent files (`baldr`, `forseti`, `heimdall`, `hermod`, `mimir`, `odin`, `thor`, `tyr`, `vidarr`) received a new `## Parallel Execution` section with:
- Sibling-awareness rules for when agents run in the same working directory concurrently
- Disjoint file-scoping discipline to prevent write collisions
- Git operation boundaries (only `@hermod` performs write-level git)
- Pre-write checklists and `.git/index.lock` handling
- Mandatory end-of-session reporting (`Siblings: … Conflicts: … Git ops: …`)

Odin's dispatch block now includes a full `## PARALLEL EXECUTION CONTEXT` template to prepend to every parallel subagent prompt.

#### Dashboard
- **`bizar-dash/src/web/views/Tasks.tsx`** — archived tasks (`status: "archived"` OR `archived: true`) now surface in the DONE kanban column so earlier-existing tasks are visible from a fresh dashboard load. `matchesColumn()` helper added.

#### Requirements
Graph features require **Python 3.10+** and **`graphifyy`** (`pip install graphifyy`). The `bizar graph` commands and the `bizar init` / `bizar install` integration fail open if the dependency is absent.

## v3.7.3 — 2026-06-22

### Fixed — `bizar update` rewritten for correctness
The `bizar update` command previously had three critical gaps that could leave the install in a broken or partially-updated state. v3.7.3 fixes all of them.

#### What was broken
1. **Did not update `@polderlabs/bizar-dash`.** Only `bizar`, `plugin`, and `opencode` were updated — the dashboard package was invisible to the updater. After update, the dashboard ran stale code from `npm-global/lib/node_modules/@polderlabs/bizar-dash/`.
2. **Did not kill running instances before installing.** `npm install -g @polderlabs/bizar@latest` could fail or leave the running dashboard service running old code in memory. On Linux the npm-global directory is locked by running processes.
3. **Did not warn the user.** No prompt, no list, no chance to back out. Users had no way to know their dashboard session was about to be terminated.
4. **Did not restart the dashboard after update.** Even if the install succeeded, the dashboard stayed on the old code until manually restarted.
5. **PID files were never validated.** A stale `service.pid` containing the empty string (`0 bytes`) or a dead PID was reported as "running", preventing clean update flow.
6. **CLI self-update was unreliable.** The `rerunInstallScript()` logic ran `npm install -g @polderlabs/bizar-plugin@latest` but never updated `bizar-dash`.

#### What changed
- **Full instance detection** — Reads `~/.config/bizar/{service,dashboard}.pid` and `~/.config/bizar/dashboard.port`. Validates each PID is actually alive (`process.kill(pid, 0)`), cleans up stale/empty/corrupt files automatically.
- **Explicit warning before kill** — Lists every running instance by name, PID, and (for dashboard) port. Asks for confirmation via inquirer. Non-TTY shells refuse to proceed without `--yes`.
- **Graceful then forced kill** — Sends `SIGTERM`, polls for exit (up to 5s), escalates to `SIGKILL` if needed. Cleans up the corresponding PID file on success.
- **PID-recycle-safe kill verification** — `process.kill(pid, 0)` after a kill is unreliable on Linux (PIDs recycle immediately after death). The function now treats successful signal delivery as success, since `SIGKILL` is uncatchable.
- **`@polderlabs/bizar-dash` is now a first-class component.** It shows in the version table, the interactive prompt, and the `--all` flag. Selection key is `dash` (e.g. `bizar update dash`).
- **Auto-restart the dashboard after update** — If the dashboard was running and either `bizar` or `dash` was updated, spawns a fresh detached `bizar-dash start --bg` process using the same port. Skipped with `--no-restart`.
- **New flags** — `--yes` / `-y` / `--force` (auto-confirm kill + `--all`), `--no-restart` (skip dashboard restart), `--all` (update every component without prompting).
- **Exported `readLivePid` and `killAndWait`** for unit testing (also exported for future health-check tooling).
- **Improved help text** with examples for headless / partial / no-restart flows.

### Behavior
```
$ bizar update --all --yes     # headless full update + restart
$ bizar update dash             # update only the dashboard
$ bizar update plugin --no-restart   # plugin only, leave dashboard alone
```

### Files
- `cli/update.mjs` — full rewrite (~290 → ~440 lines)
- `cli/bin.mjs` — `showUpdateHelp()` updated with new flags and components

## v3.7.2 — 2026-06-22

### Added
- **Comprehensive Always-On Behavior Baseline** in `config/AGENTS.md` ("General Agent Baseline — Always-On Behavior"). Translated from the upstream Claude Fable 5 system prompt — every Claude-specific tool, directory, and concept has been mapped to the BizarHarness equivalent. Single source of truth for every agent's behavior so the rules don't drift across the 13 agent files.

  Sections covered:
  - **Identity preamble** — Bizar Norse-pantheon identity, replace "Claude / Anthropic"
  - **Tool translation table** — `view`→`read`, `str_replace`→`edit`, `create_file`→`write`, `bash_tool`→`bash`, `web_search`→`websearch`, `web_fetch`→`webfetch`, `ask_user_input_v0`→`question`, `skill`→`skill`, MCP registry→`skills` CLI. Lists which upstream tools **don't** exist in Bizar (`image_search`, `places_*`, `weather_fetch`, etc.) so agents don't assume them.
  - **refusal_handling** — be open, attempt with stated assumptions rather than refuse
  - **tone_and_formatting** — warm, direct, kind; never use bullets when declining
  - **lists_and_bullets** — prose preferred; lists only when essential
  - **user_wellbeing** — mental health, self-harm, disordered eating, crisis resources; NEDA → National Alliance for Eating Disorders helpline (NEDA is permanently disconnected)
  - **evenhandedness** — best case for the position, not the agent's view; end advocacy with opposing perspectives
  - **responding_to_mistakes_and_criticism** — own it, fix it, don't collapse
  - **knowledge_cutoff_and_research_first** — no shared cutoff across models; search for fast-changing facts; project context via Hindsight
  - **mcp_servers_and_skills** — Semble and Hindsight always-on; Skills CLI for domain packs; agent-browser for E2E
  - **skills_mandatory_read** — read every plausibly-relevant SKILL.md before writing code
  - **file_creation_advice** — standalone artifact vs conversational answer; tone/length don't change the bucket
  - **file_handling_rules** — Bizar workspace paths, parser per file type, verify before claiming
  - **search_instructions** — websearch/webfetch, copyright hard limits (15-word ceiling, one quote per source)
  - **copyright_compliance** — non-negotiable, paraphrasing default, no lyrics/poems/article paragraphs
  - **harmful_content_safety** — refuse to search for, reference, or cite extremist/harmful sources
  - **citation_instructions** — claims in your own words, never quoted text
  - **images_and_visual_content** — no `image_search`; use agent-browser for local screenshots
  - **memory_privacy_and_user_data** — conservative retention, no secrets/PII
  - **files_execution_and_data_handling** — preserve user content, real files when requested, scoped commands
  - **clarification_and_ambiguity** — one high-value question; dispatch to Vör/Mimir
  - **communication_and_final_responses** — match user register, brief progress updates

### Changed
- **All 13 agent files** (`config/agents/*.md`) now reference the global baseline instead of carrying a duplicated copy. The per-agent "General Operating Baseline" section is replaced by a one-liner pointer: *"Follow the global baseline in `config/AGENTS.md` → 'General Agent Baseline — Always-On Behavior'."* Net change: -716 lines of duplicated boilerplate, +286 lines of single-source-of-truth baseline.

### Files
- `config/AGENTS.md` — added comprehensive baseline (~325 lines)
- `config/agents/*.md` — replaced duplicated local baseline with pointer (13 files)

## v3.7.1 — 2026-06-22

### Fixed
- **"Submit Task to Odin" modal no longer requires a title.** The Title field is now optional across web UI, API, and CLI. If the user (or caller) leaves it blank and supplies a description, the title is auto-generated by stripping markdown headers, taking the first non-empty line, and truncating to ~60 chars at a word boundary. Falls back to `Untitled task — YYYY-MM-DD HH:MM` if both fields are empty.
- **Empty-title backend rejection improved.** `/api/tasks/submit` now accepts `{ title: '' }` as long as `description` is non-empty (auto-generates). Only rejects when **both** fields are empty, with the clearer error message `title or description is required`.
- **Same fix applies to curl/CLI callers.** The `autoTitleFromContent` helper is duplicated in `src/web/lib/utils.ts` (TS) and `src/server/task-delegator.mjs` (mjs) so both frontend and backend behave identically.

### Files
- `bizar-dash/src/web/lib/utils.ts` — added `autoTitleFromContent()` helper
- `bizar-dash/src/web/views/Tasks.tsx` — modal markup updated, title no longer required, auto-fill on submit
- `bizar-dash/src/server/task-delegator.mjs` — backend accepts empty title, auto-generates server-side

## v3.7.0 — 2026-06-22

Full audit pass across all Bizar components — plugin, CLI, dashboard (server + desktop web + mobile), agent configs, install scripts, and templates. **116 files changed, 3154 insertions, 1334 deletions.** Every component was security-reviewed, code-reviewed, tested, and fixed in parallel.

### Plugin (`@polderlabs/bizar-plugin` 0.5.4 → 0.6.0)
- **Signal-handler leak fixed.** Plugin was calling `process.removeAllListeners(SIGTERM|SIGINT)` which stripped unrelated host signal handlers. Now uses plugin-owned handler tracking with proper remove-on-dispose.
- **`dispose()` now clears `serve.json`** after shutdown so stale endpoint/password data isn't left behind for dashboard/out-of-process consumers.
- **Background agent leaks fixed.** Tracked SSE unsubscription per instance and `unref()` on the periodic checker timer — fixes event-listener and open-handle leaks for terminal background instances.
- **`plan-fs.ts`** atomic-write parent dir creation switched from `join(filePath, "..")` to `dirname(filePath)` for correctness.
- **`serve.ts`** `ServeInfo` type extended with `baseUrl`, `worktree`, `startedAt` to match actual usage.
- **Test suite aligned with strict TypeScript** — fixed breakages in 11 test files (attach-handler-bug, update-deadlock, bg-get-comments, plan-action, wait-for-feedback, http-client, serve, event-stream, bg-kill, bg-status, init-helpers).
- **Test results:** 212/212 pass (npm test), 504/504 pass (bun test). Typecheck PASS. `check:imports` PASS.

### CLI (`@polderlabs/bizar` 3.6.1 → 3.7.0)
- **`--version` / `--help` no longer trigger first-run setup.** Added informational-flag bootstrap bypass and centralized error handling in `bin.mjs`.
- **Version detection rewritten.** Replaced broken ESM `import(package.json)` with safe JSON reads; tool detection for Skills/Semble no longer performs network installs (`npx --yes`, `uvx ...`).
- **`install.mjs`** missing `detectUv` import fixed; ESM-safe `require.resolve` removed.
- **`install.sh`** `jq` merge now writes to a temp file and uses atomic `mv` (previous version printed merged JSON to stdout and never wrote it back).
- **`plan.mjs`** plan/config writes now atomic; request body size guarded; `startServer()` no longer leaks signal listeners across tests.
- **`service.mjs`** config-dir handling fixed (no fail-before-mkdir); stale PID cleanup; cross-platform main-module detection.
- **`update.mjs`** path string concat replaced with `node cli/bin.mjs --setup` cross-platform rerun.
- **`prompts.mjs`** API key prompts now use masked password inputs.
- **Help text expanded** for `install`, `update`, `init`, `export`, `service`, `dashboard`, `test-gate`.
- **Banner agent count fixed** from 11 → 13.
- **`init.mjs`** Windows-unsafe `cwd.split('/')` replaced; skills install skips cleanly when CLI is absent.
- **`copy.mjs`** atomic writes for `opencode.json` merges; nested `.bizar/` file copying fixed.
- **`export.mjs`** hardcoded home-path assumptions removed; clear guard when no installed agents exist.
- **Test results:** 140/140 pass (cli/plan.test.mjs). All subcommands (`init`, `plan`, `update`, `export`, `audit`, `service`, `install`, `test-gate`, `dashboard`) accept `--help` and return sensible output. `--version` prints `3.7.0`.

### Dashboard server (`@polderlabs/bizar-dash` 3.6.1 → 3.7.0)
- **Auth bypass on proxied loopback traffic fixed.** Remote clients arriving through a local proxy could inherit loopback trust. Loopback/original-peer evaluation and auth-status reporting fixed.
- **Artifact metadata trusted arbitrary `meta.path`** enabling arbitrary file read/delete if sidecars were tampered. Constrained artifact body paths to the artifact directory; metadata sanitized before read/list/delete.
- **Schedule webhook SSRF hardened.** Reject credentialed URLs, block redirects, constrain methods.
- **Secret file permissions** re-harden to `0600` on read/create.
- **WebSocket initial `snapshot` payload** now matches `/api/snapshot` and the web `Snapshot` expectations — includes active project, settings, tasks, mods, schedules, providers, and MCPs.
- **Project registry** could duplicate the same path under new IDs after name collisions — fixed path-first ID reuse.
- **Skills install API** could report success even when `skills` CLI failed — fixed store result reporting and route status handling.
- **Service scheduler** ignored `"default"` schedules unless tied to a registered project — fixed global/default schedule execution.
- **Diagnostics log tail** accepted invalid/negative values — clamped.
- **Notifications** read-state and destructive log rewrites made atomic; single read/delete actions now broadcast UI updates.
- **Hardcoded/stale dashboard versions** in settings/diagnostics/CLI/TUI now resolve from `package.json`.
- **Activity append paths** allowed caller-supplied `ts` to override server timestamps — server-side timestamp ownership enforced.
- **`/api/updates/apply`** now validates package IDs instead of accepting arbitrary strings.
- **`/api/chat`** clamps `limit` sanely.
- **Restart endpoint** handles spawn errors explicitly.
- **TUI** supports bearer-token auth when local auth is forced.

### Dashboard — desktop web
- **WebSocket stale-close reconnect race fixed** in `lib/ws.ts`.
- **Artifact viewer auth breakage fixed** — content/open/download routed through tokenized URLs.
- **Tasks column "select all" bug** fixed — only toggles that column's cards, not the whole board.
- **Chat ordering fixed** — no longer reverses conversation against "newest at bottom" intent.
- **Fullscreen plan cleanup fixed** — exits browser fullscreen on teardown.
- **Modal focus trap + focus restore added** across all modals and search.
- **Missing aria labels added** to icon-only controls in Plans, Activity, Tasks, Providers, Artifact viewer.
- **Dead duplicate artifact modal** removed.
- **Broken updates card heading** misuse (`<Card title=...>`) replaced with real visible header.
- **Unused imports cleaned** in Providers.
- **Repeated duplicated CSS blocks removed** from `main.css`.

### Dashboard — mobile
- **BottomSheet** fixed: focus entry/restore, guaranteed close button, drag-dismiss, dialog semantics, iOS-safe scroll lock.
- **Modal** fixed: focus trap/restore, overlay dismissal, safe-area padding, fixed-body scroll lock.
- **Sticky chat composer overlap** with bottom nav fixed — message space reserved, composer wraps on small widths.
- **44px touch targets** brought up across multiple mobile controls; `touch-action: manipulation` enforced.
- **Online / pageshow / visibility resume rebinds** added so mobile WS sessions recover after network/app resume.
- **Stable list/message keys** + assistant-message merge fixes reduce unnecessary remounts/duplicates.
- **iOS tap highlight reset** + `dvh`/safe-area-aware sizing for sheets and modals.
- **Routing verification:** server already correctly handles `/ → /m` and `?desktop=1` (no change needed).

### Agent configs (`config/`)
- **Critical fix:** 11 agent `.md` files had wrong model `openai/gpt-5.4` (bulk copy-paste error). Each agent now has its correct model:
  - Odin, Tyr, Forseti → `minimax/MiniMax-M3`
  - Hermod, Thor, Baldr, Quick → `minimax/MiniMax-M2.7`
  - Vidarr → `openai/gpt-5.5`
  - Vör, Frigg, Mimir, Heimdall → `opencode/deepseek-v4-flash-free` (free tier)
- **`config/opencode.json`** had the same model errors for 4 free-tier agents (costing $0.30/M instead of free).
- **`config/opencode.json`** command template paths fixed from `commands-bizar/` → `commands/`.
- **`config/opencode.json`** `bizar` command had malformed template field (template + arguments on one line) — split into proper `template` + `arguments` fields.
- **`semble-search` agent** was missing `model`, `color`, and permissions — added.
- **Hindsight permissions** added to all 11 agents that were missing `hindsight_recall`/`hindsight_retain`. Odin got `hindsight_list_banks` and `hindsight_create_bank`.
- **`plugins/bizar/src/commands.ts`** `default` branch was blocking all unknown commands — now passes through to let other handlers (built-ins, other agents) process them. This fixes `/explain`, `/init`, `/learn`, `/pr-review`, `/audit`, etc.
- **Typo** `competito → competitors` in `config/agents/baldr.md`.
- **Secrets:** verified no live secrets in `config/`; placeholder `__HINDSIGHT_BEARER_TOKEN__` retained.
- **Created `config/opencode.json.template`** so users have a safe reference copy. **`config/opencode.json`** is gitignored.

### Install scripts / templates
- **`install.sh`** prefers `opencode.json.template` over `opencode.json` for new installs; graceful skip when neither exists.
- **`install.sh`** `jq` fallback now warns user explicitly when merging is unsafe.
- **`scripts/git-hooks/pre-commit`** pre-commit token scanner verified present and working (Bearer tokens, `sk-ant-`, `sk-`, `ghp_`, `AIza` patterns).
- **`.gitignore`** cosmetic comment alignment; `config/opencode.json` already listed (file is git-tracked from prior commits — recommended `git rm --cached` done in this release).
- **All shell scripts pass `bash -n` syntax check.**
- **`templates/plan/`** fields match `buildVars()` in `cli/plan-templates.mjs` and `regenerateHtml()` in `cli/plan.mjs`.

### Build / typecheck / tests (all green)
- Root typecheck: PASS (after fixing `include` paths to cover `bizar-dash/src/`, `plugins/bizar/{index.ts,src/,tests/}`)
- Dashboard typecheck: PASS
- Dashboard build: PASS — 1884 modules, 1.56s, `index-*.js` 339.11 kB / 106.36 kB gzip, `main-*.css` 99.02 kB / 16.04 kB gzip, `mobile-*.js` 91.16 kB / 21.02 kB gzip
- Plugin typecheck: PASS
- Plugin tests: 212/212 pass (607 expects)
- CLI tests: 140/140 pass

### Files (116 changed, +3154 / −1334)
CLI: bin, audit, banner, bootstrap, copy, export, init, install, plan, plan-templates, prompts, service, update, utils, install.sh
Plugin: index.ts, src/{background, plan-fs, serve, commands}, 11 test files
Dashboard server: cli.mjs + 21 server modules and route files
Dashboard desktop web: App.tsx, 4 components, 8 views, lib/ws.ts, main.css
Dashboard mobile: MobileApp.tsx, 3 mobile components, 4 mobile views, mobile.css
Agent configs: opencode.json, 9 agent .md files, plugins/bizar/src/commands.ts
Install/templates: install.sh, .gitignore, config/opencode.json.template (new)

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

## v3.5.3 — 2026-06-19

### Fixed
- **Updates work end-to-end now**: previous versions could check for updates but couldn't apply them properly. Now:
  - Per-package selection (checkboxes for each of bizar / bizar-dash / bizar-plugin)
  - Live progress streamed via WebSocket (status: starting/installing/done/error per package)
  - npm output logged to a collapsible panel per package
  - "Restart Dashboard" button after update completes
- **Auto-restart**: `POST /api/restart` spawns a self-respawner that exits the current process and starts a fresh one. Frontend auto-reloads after 3 seconds.

### Added
- `POST /api/restart` endpoint
- WebSocket events: `update:progress`, `update:log`, `update:complete`

## v3.5.2 — 2026-06-19

### Fixed
- **WebUI randomly jumps back to Overview on data refresh**: Fixed a key-repeat event bug in the digit-key shortcut handler. When a user closes a modal and the browser fires a delayed key-repeat for a digit key, the handler was incorrectly switching tabs after the 1500ms safe window had closed. Added `if (e.repeat) return;` as the first guard in the handler, ensuring only the initial keydown fires a tab switch.
- **History tab broken**: The `/api/history` endpoint was already implemented. The view component was structurally correct; the apparent "broken" state was likely secondary to the tab-switching bug causing navigation away from the History tab.

### Changed
- **Activity tab redesigned**: Removed the separate Canvas/Timeline mode toggle. The Activity view is now a single integrated fullscreen mode combining the live agent/task graph with a collapsible timeline event strip. Users see one unified canvas with the floating control bar (zoom, fit, refresh) and a collapsible left-side timeline panel.
- **OpenCode config now has a real UI**: The Config → OpenCode config section no longer shows just a raw JSON editor. It now has a structured tabbed form with dedicated sections for Model (provider, model ID, base URL), Plugins (list with add/edit/delete/enable), Tools (enable/disable per tool), Permissions (allow/deny rule lists), and Hooks (pre/post tool and agent hooks). A raw JSON "Advanced" tab remains for power users.

## v3.5.1 — 2026-06-19

### Fixed
- **Mobile dashboard blank page on Tailscale**: `mobile.html` used relative asset paths (`./assets/...`) which resolved to `/m/assets/...` when served at `/m`. The server's `/m/*` SPA fallback route intercepted these asset requests and returned HTML instead of JS, causing the mobile bundle to fail to load. Two-part fix:
  1. Changed `vite.config.ts` `base: './'` → `base: '/'` so all asset paths are absolute
  2. Tightened the server's `/m/*` SPA fallback to a regex `/^\/m\/(?!assets\/)/` that excludes `/assets/*` paths

## v3.5.0 — 2026-06-19

### Added
- **Mobile dashboard at `/m`**: New mobile-friendly version of the Bizar dashboard optimized for phones (320px-768px wide). Features bottom navigation bar (5 tabs: Activity, Chat, Tasks, Settings, More), single-column layouts, 44px touch targets, sticky bottom chat composer, and touch-first interactions. Auto-redirects mobile users from `/` to `/m`. Use `?desktop=1` to bypass the redirect.

### API
- `GET /m` — serves the mobile dashboard HTML entry
- `GET /m/*` — serves the mobile dashboard HTML entry

### Files
- `bizar-dash/src/web/mobile.html` — mobile HTML entry point
- `bizar-dash/src/web/mobile.tsx` — mobile React entry point
- `bizar-dash/src/web/MobileApp.tsx` — mobile shell with bottom nav + tab routing
- `bizar-dash/src/web/mobile/MobileTopbar.tsx` — compact top bar (48px)
- `bizar-dash/src/web/mobile/MobileBottomNav.tsx` — bottom navigation (56px)
- `bizar-dash/src/web/mobile/views/MobileActivity.tsx` — quick stats + activity feed
- `bizar-dash/src/web/mobile/views/MobileChat.tsx` — messages + sticky composer
- `bizar-dash/src/web/mobile/views/MobileTasks.tsx` — vertical task list by status
- `bizar-dash/src/web/mobile/views/MobileSettings.tsx` — theme/project/about settings
- `bizar-dash/src/web/mobile/views/MobileMore.tsx` — agents, plans, projects, mods
- `bizar-dash/src/web/styles/mobile.css` — mobile-specific CSS (44px tap targets, safe areas, sticky nav)

## v3.4.1 — 2026-06-19

### Fixed (CRITICAL)
- **Removed `install` bin that shadowed the system `install(1)` command.** The `install` symlink in `package.json#bin` was pointing to the same script as `bizar`. When opencode or any program ran `install -dm700 /some/path` (a common Unix idiom for creating directories with specific permissions), it was hitting the bizarre installer instead of the system `install` command, causing the dashboard to spawn in a broken state. The `bizar install` subcommand continues to work — users should use `bizar install` explicitly instead of just `install`.

### Fixed
- **Settings `about.version` was being overridden by stale user settings.** `mergeSettings()` was allowing the user settings file to override `about.version`, causing the UI to show an outdated version. Now `about.version` is always sourced from the package default.
- **CSS hardcoded colors replaced with CSS variables.** `.badge-info` border and `.mod-mini-pill-on` background were using hardcoded rgba values instead of theme-aware variables.
- **Provider POST now auto-generates `id` from `name`** — was requiring `id` field in request body unnecessarily.

## v3.4.0 — 2026-06-19

### Fixed
- **Pervasive theme bug — all colors + shadows now respond to theme change**. Audit of every hardcoded `rgba(0,0,0,...)` / `rgba(139,92,246,...)` / `rgba(248,113,113,...)` / `rgba(52,211,153,...)` in `main.css`. Replaced with theme-aware CSS variables: `--accent-glow`, `--accent-soft`, `--success-soft`, `--error-soft`, `--warning-soft`, `--overlay-bg`, `--shadow-color-strong`. Sidebar tab text colors, drop shadows on cards, modal backdrops, status pills, badge borders, focus rings, WebSocket indicator, brand-logo glow, and button hover backgrounds all switch correctly between dark/light.

### Added
- **Config page rewrite — sidebar nav + fully editable Providers/MCPs**: two-column layout with left nav (OpenCode / Providers / MCPs / Diagnostics / Export). Add, edit, delete, toggle on/off for both providers and MCPs through proper modal forms. Provider fields: id, name, base URL, API key (masked), models (list), enabled toggle. MCP fields: id, type (local/remote), command + args OR URL + headers + OAuth, enabled toggle.
- **MCP store — supports new opencode.json format**: handles `command: [...]` array, `type: "remote"` with `url`/`headers`/`oauth`, and the legacy `command: "string"` + `args: [...]` shape.
- **Tasks horizontal kanban**: 4 columns (Queued / Doing / Blocked / Done) side-by-side. On narrow viewports, columns scroll horizontally with scroll-snap. Card drag-drop with smooth highlight on hover-target.
- **Tasks compact toolbar**: single-row layout with grouped Search / Filter / Sort labels + actions on the right. Replaces the previous oversized button row.
- **Activity visual timeline canvas**: new "Timeline" mode (alongside existing Graph view). X-axis = time, Y-axis = lane per agent (+ system, plans, bg). Events render as colored circles on their lane with hover tooltips. Time axis with hour:minute ticks. Lane separators. Event kind filter. Zoom in/out. Click event → opens node detail panel.
- **Overview — big no-frame hero**: replaced card wrapper with `.overview-hero-noframe`. 48px gradient title (`var(--text-strong)` → `var(--accent)`). 160px min-height textarea with glow focus ring. Quick-action chips in a centered row.
- **History view (new tab)**: cross-project history with time range filter (1h / 1d / 7d / 30d / all). Per-project expandable timeline rows showing recent events. Project stats (tasks done/doing/blocked/queued, plan count, last opened). Global events section. JSON export. Tag in Topbar.
- **New `/api/history` endpoint**: aggregates activity log events with per-project task + plan counts. Supports `?since=` and `?limit=` query params.

### API
- `GET /api/history?since=&limit=` — cross-project history
- `GET /api/config/providers` — list (was already there, now reliable)
- `POST /api/config/providers` — add (was already there)
- `PUT /api/config/providers/:id` — update (was already there)
- `DELETE /api/config/providers/:id` — remove (was already there)
- `GET /api/config/mcps` — list, now with type/url/headers/oauth fields
- `POST /api/config/mcps` — add, handles local + remote
- `PUT /api/config/mcps/:id` — update
- `DELETE /api/config/mcps/:id` — remove

### Plan
- `plans/v3-4-0-ui-overhaul/` — visual plan tracking the UI overhaul work

## v3.3.3 — 2026-06-19

### Added
- **Updates card in Settings**: shows currently installed versions of `@polderlabs/bizar`, `@polderlabs/bizar-dash`, and `@polderlabs/bizar-plugin`. "Check for updates" button queries npm for latest versions. "Update now" button runs `npm install -g @latest --ignore-scripts`. Progress and result displayed in the card.

### API
- `GET /api/updates/status` — current installed versions
- `GET /api/updates/check` — current + latest (queries npm)
- `POST /api/updates/apply` body `{ packages: [...] }` — run updates

## v3.3.2 — 2026-06-19

### Fixed
- **Theme color/shadow leakage**: hardcoded `rgba(0,0,0,...)` shadows that didn't respond to light theme. Now all shadows use `--shadow-color` CSS variable, defined as `rgba(0,0,0,0.45)` (dark) and `rgba(15,23,42,0.08)` (light).
- **Logo**: changed from emoji to runic B (ᛒ).

### Added
- **Activity canvas**: timeline panel is now embedded IN the canvas (left side, collapsible) instead of a separate tab. Floating controls bar at top center (zoom %, +/-, fit, refresh, timeline toggle).
- **Plans canvas**: floating controls overlay at top (Back, plan name, status, + Element, Comment, Configure).
- **Custom right-click context menu** in canvases (Activity + Plans): reusable `CanvasContextMenu` component. Right-click on canvas to access actions.
- **Overview main text input**: prominent hero input at the top of Overview — "What would you like to do?" with quick-action chips below. Submits to Odin via `POST /api/tasks/submit`.

## v3.3.1 — 2026-06-19

### Fixed
- **Chat redirect after actions (real fix)**: The v3.3.0 fix used a 250ms safe window which was too short. Now extended to 1500ms and listens for `focusin` and `keydown` events too. Also bails when active element is body/null within the safe window (the actual bug case — modal close → focus moves to body → stray keypress triggers tab switch).
- **Mods page**: `mods-loader.mjs` now never throws — all listing functions return empty arrays on error and protect against race conditions in `statSync`.
- **Submit handlers**: Every submit handler in Tasks view explicitly calls `preventDefault` + `stopPropagation`, closes the modal first, bumps the safe window, then updates state.

### Improved
- **Activity canvas**: No longer has a fixed `min-height: 600px` — now fills available space. New Timeline tab showing chronological events with timestamps.
- **Skills page**: Collapsible `<details>`/`<summary>` category sections (first 3 expanded by default). Search input stays at top.
- **Theme presets**: 8 one-click accent color swatches in Settings (Purple/Blue/Green/Orange/Red/Pink/Cyan/Mono).
- **CSS**: `.btn-success` now uses `var(--text-strong)` instead of hardcoded `#0b0e14`.

## v3.2.2 — 2026-06-19

### Fixed
- **npm install no longer requires allow-scripts approval.** npm v10+ blocks postinstall scripts by default. The setup work (agents, plugin, RTK, Semble, Skills CLI, core skills) used to live entirely in the postinstall hook, which meant many users had a broken install without knowing it. The setup logic now self-bootstraps on first bin invocation.

### Added
- **`bizar --setup`** explicitly runs the setup (replaces `node cli/bin.mjs --postinstall`).
- **`bizar --check`** prints setup status as JSON, exits 1 if setup is needed (useful for CI/scripts).
- **`BIZAR_SKIP_INSTALL=1`** env var disables auto-setup (useful for sandboxed environments).
- Every bin command (`bizar`, `install`, `bizar-dash`, etc.) now checks setup status on entry. If anything is missing, the setup runs automatically before the command proceeds. Already-installed components are detected and skipped.

### Removed
- The `postinstall` script in package.json. npm install just installs the package files now — setup happens on first use.

### Migration
- Nothing required. Existing installs work as before. Future installs work without needing `npm approve-scripts`.

## v3.2.1 — 2026-06-19

### Added
- **Install prompts**: When you run `npm install -g @polderlabs/bizar`, the postinstall now detects missing `@polderlabs/bizar-plugin` and `@polderlabs/bizar-dash` and prompts to install them. Defaults to yes (just press Enter).
- **Skip flag**: Set `BIZAR_SKIP_OPTIONAL_INSTALLS=1` to skip the prompts (useful for CI).
- Plugin prompt explains: "required for /bizar in opencode"
- Dashboard prompt explains: "optional web/TUI dashboard"
- If a package is already installed, it's detected and the prompt is skipped.
- If installation fails, helpful message with manual fallback command.

## v3.2.0 — 2026-06-19

### Fixed
- **Redirect-to-home on click**: form submits and stray `setActiveTab('overview')` calls were triggering unwanted navigation. Digit-key shortcuts (`1`, `2`, …) now bail out when focus is on any focusable form control (`<input>`, `<textarea>`, `<select>`, `<button>`, `<option>`, `<label>`, `[contenteditable]`) or when the target is inside a `<form>`, `[role="dialog"]`, `[contenteditable]`, or `[data-no-key]`. The shell's keyboard handler also short-circuits when `Shift` is held so OS / extension shortcuts pass through cleanly.

### Added
- **Main task container with auto-delegation**: Submit a task to Odin via the Tasks view's "Submit to Odin" modal. Odin analyzes the title/description, splits it into subtasks using a heuristic (detect `implement / test / docs / design / research / refactor`), assigns each subtask to the best-fit agent based on keyword + tag rules, and best-effort dispatches them to the background-agent infrastructure. New `POST /api/tasks/submit` returns `{ main, subtasks }`. New `src/server/task-delegator.mjs` (411 LoC) + `splitTask` / `matchAgent` / `dispatchToBackground` helpers.
- **Background agents via tmux**: New Background tab/API bridge (`src/server/background-store.mjs`). Lists all running bg instances from `~/.cache/bizar/bg/*.json`, `~/.config/opencode/bg/`, and `~/.bizar/bg/`, enriches with live tmux session info (active state, last N lines of output), and exposes `sendMessage` / `kill` / `captureOutput` / `attachCommand` operations. New endpoints: `GET /api/background`, `GET /api/background/:id`, `GET /api/background/:id/output`, `POST /api/background/:id/message`, `DELETE /api/background/:id`.
- **Agent hierarchy**: Each agent has `level` (0=router, 1=coordinator, 2=worker, 3=fallback), `parent` (who delegates to them), and `role`. New `GET /api/agents/hierarchy` returns a tree (roots + flat `all`). 13 agents mapped: Odin & Forseti at level 0; Tyr, Thor, Hermod, Baldr, Mimir report to Odin; Heimdall under Thor; Frigg & Vor under Mimir; Vidarr at level 3 as ultimate fallback. `Agent` type extended with `level` / `parent` / `role`.
- **Activity canvas**: New Activity tab with a full-graph SVG canvas. All agents, active tasks, and bg instances rendered as nodes. Edges show hierarchy (`parent → child`, accent color), assignment (`agent → task`, info color), and subtask relationships (`task → child task`, dashed muted). Pan/zoom (mouse drag, scroll-wheel), click any node for details. `data-task-parent` added to task cards for cross-linking. New `src/web/views/Activity.tsx` (690 LoC) + `src/web/styles/main.css` `+340` lines for the canvas, controls, legend, and detail panel.
- **Comment + task injection on canvas nodes**: Click any node to open a 360px detail panel showing the node's meta (type, status, role, model, assignee, priority, started at, description, prompt preview). For bg nodes: live tmux output, refresh button, kill button, send-message input. For all nodes: a per-node activity log + comment thread, plus a quick "Create follow-up task" form. New endpoints: `POST /api/comments` (node-scoped), `POST /api/nodes/:nodeId/tasks` (creates a task tagged with the node id), `POST /api/activity`, `GET /api/activity` (filter by `nodeId` or `kind`).
- **Activity log**: Append-only JSONL at `~/.config/opencode/activity.jsonl`. Auto-rotates when >5MB. The task delegator writes `task.delegated` events; canvas comments write `node.comment`; node-created tasks write `node.task`. All events are broadcast over WebSocket as `activity:change`. New `src/server/activity-log.mjs` (157 LoC) with `append` / `recent` / `forNode` / `byKind` / `stats`.

### Changed
- **App.tsx** — imports + mounts the Activity view; broadens the digit-key guard. `VERSION` bumped to `v3.2.0`.
- **Topbar.tsx** — adds the "Activity" tab (icon: `Activity`).
- **types.ts** — extends `Agent` with `level` / `parent` / `role`; extends `Task` with `subtasks` (string[]) and `metadata` (Record<string, unknown>).
- **api.mjs** — adds `/api/tasks/submit`, `/api/agents/hierarchy`, `/api/background[/...]`, `/api/activity`, `/api/comments`, `/api/nodes/:nodeId/tasks`. Bumps `about.version` to `3.2.0`. Reorders the `/api/agents/*` block so `/agents/hierarchy` and `/agents/stuck` are mounted before the `/agents/:name` catch-all.
- **agents-store.mjs** — `HIERARCHY` map + `level` / `parent` / `role` on every agent snapshot. New `buildHierarchyTree(agents)` exported helper.
- **tasks-store.mjs** — `create()` now persists `subtasks` and `metadata`; `update()` merges metadata and replaces subtask ids.
- **diagnostics-store.mjs** — `version` → `3.2.0`.

### Verified
- Type-check: 0 errors (103 errors → 0; added explicit types in `Activity.tsx` and `Tasks.tsx`).
- Build: passes (`vite build` — 503 KB JS / 68 KB CSS).
- Tests: **140/140 pass** (`node --test cli/plan.test.mjs`).
- Task submission creates subtasks and dispatches to background; round-trips via `POST /api/tasks/submit` for both `impl+test` (thor) and `research+design` (baldr) prompts.
- Activity canvas renders agents, tasks, and bg instances.
- All existing endpoints (`/api/agents`, `/api/projects`, `/api/search`, `/api/diagnostics`, `/api/chat`, `/api/plans`, …) still work.
- The global install at `~/.local/npm/lib/node_modules/@polderlabs/bizar-dash` was synced in place (no publish).

## v3.1.1 — 2026-06-19

### Fixed
- **Sidebar (and topbar) disappeared on chat/plans/skills tabs.** The "fullscreen" CSS used `position: fixed; inset: 0; z-index: 5` which covered the entire viewport including the sidebar. Now these views fill the content area (`flex: 1`) while the sidebar and topbar stay visible above.

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
