# Changelog

All notable changes to BizarHarness are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For npm releases, see https://www.npmjs.com/package/@polderlabs/bizar. For GitHub releases, see https://github.com/DrB0rk/BizarHarness/releases.

## v4.1.0 — Memory Service Phase 2 + Mandatory session-start memory check

New `bizar memory write` CLI; dashboard boot fix (async `createApiRouter`); wired `autoCommitOnMemoryWrite`; LightRAG integration scaffold; removed dead Hindsight permissions; rewrote memory docs; new `memory-protocol` skill codifying the mandatory session-start memory check.

Full entry: see top-level [`CHANGELOG.md`](../CHANGELOG.md). **107 memory tests pass / 0 fail.**

## v4.0.0 — Package consolidation (BREAKING)

Collapsed 4 npm packages (`@polderlabs/bizar`, `-dash`, `-plugin`, `-sdk`) into one. Single CLI, single install, single bin. Migration: re-install globally with `npm install -g @polderlabs/bizar` and remove the old packages. **463 tests pass / 0 fail.**

Full entry: see top-level [`CHANGELOG.md`](../CHANGELOG.md).

## v3.24.0 — Bizar Memory Service Phase 1 (Markdown + Git)

> **Replaces Hindsight with local-first memory.** New `bizar memory` command family, dashboard `/api/memory/*` routes, schema validator, secret scanner, and Git-backed sync.

### Highlights

- **`bizar memory <sub>`** — 11 subcommands (`init`, `status`, `link`, `unlink`, `pull`, `commit`, `push`, `sync`, `reindex`, `conflicts`, `doctor`).
- **Dashboard `/api/memory/*`** — 18 REST endpoints for note CRUD, search, schema validation, secret scanning, Git sync, reindex (stub), and health checks.
- **Three-layer model** — Markdown is canonical truth, Git is the collaboration layer, LightRAG is a derived index (Phase 2).
- **Three namespaces** — `projects/<projectId>/`, `global/bizar/`, `users/<userId>/` under one shared user repo at `~/.local/share/bizar/memory/<name>/`.
- **Schema validator** — 8 required frontmatter fields; 11 memory types; 6 statuses; 3 confidences.
- **Secret scanner** — 12 patterns (HIGH/MEDIUM). HIGH blocks commit; MEDIUM warns.
- **Back-compat** — `/api/obsidian/*` routes preserved with legacy response shapes.
- **85 new tests** — YAML parser, schema, secrets, store, git ops, sync orchestrator, back-compat.

### Files added (Phase 1)

- `cli/memory.mjs`, `cli/memory-constants.mjs`, `cli/atomic.mjs`
- `bizar-dash/src/server/yaml.mjs`, `memory-store.mjs`, `memory-schema.mjs`, `memory-secrets.mjs`, `memory-git.mjs`
- `bizar-dash/src/server/routes/memory.mjs`
- 7 new test files under `bizar-dash/tests/`

### Files modified

- `cli/bin.mjs` — new `memory` dispatch
- `cli/init.mjs` — memory.json write + prompt
- `bizar-dash/src/server/api.mjs` — lazy import + router registration
- `bizar-dash/src/server/routes/obsidian.mjs` — back-compat rewrite
- `install.sh` — memory service bootstrap step
- `config/skills/obsidian/SKILL.md` — replaced with Memory Service guide
- `.bizar/PROJECT.md`, `.bizar/AGENTS_SELF_IMPROVEMENT.md` — memory section + entry

### LightRAG status

`bizar memory reindex` is a STUB for Phase 1. Phase 2 will integrate the existing `mods-examples/lightrag/` server as the derived retrieval index, rebuildable from Markdown at any time.

## Unreleased

### Changed (v0.5.4)

- **Major rename: `bizarharness` → `bizar`.** The CLI command is now `bizar` (was `bizarharness`). The npm packages are renamed:
  - `@polderlabs/bizarharness` → `@polderlabs/bizar` (CLI, v2.3.0)
  - `@polderlabs/bizarharness-plugin` → `@polderlabs/bizar-plugin` (plugin, v0.5.3)
- **New `bizar update` subcommand.** Update opencode, `@polderlabs/bizar`, and/or `@polderlabs/bizar-plugin`. By default prompts for each component; with `--all` or explicit subcommands (`opencode`, `bizar`, `plugin`) runs only the named update. After any package update, re-runs the install script so the locally deployed plugin matches the registry (fixes the BUGS.md "version skew" trap).
- **Bundled skill renamed:** `config/skills/bizarharness/` → `config/skills/bizar/` (folder and `SKILL.md` frontmatter).
- **Default cache path renamed:** `~/.cache/bizarharness/` → `~/.cache/bizar/`. The renamed path is a clean break — no migration script. Existing users will see new files at the new path; old files at the old path are orphaned but harmless.
- **All in-repo references updated.** README, all 19 wiki pages, all CLI source files, the plugin source, and the bundled skill are clean of `bizarharness`. The brand name "BizarHarness" is preserved in titles and historical context (the project is BizarHarness; the tool is `bizar`).

### Upgrade notes

If upgrading from a previous version:
1. Re-run `bash install.sh` from the source tree.
2. The next `bizar update` will pull the latest npm package and re-deploy the plugin.
3. Old `~/.cache/bizarharness/` files are orphaned but harmless. Delete them with `rm -rf ~/.cache/bizarharness` if you want to clean up.

## v0.5.2 — 2026-06-18

## 0.5.2 — 2026-06-18

The "postmortem Layer 1" release. Closes the last open item from the [2026-06-18 startup hang postmortem](../postmortems/2026-06-18-plugin-state-deadlock.md) — Layer 1 was documented as "fixed" but never actually landed in the code.

### Fixed (v0.5.2)

- **Startup hang: 1-second timeout on `client.session.list()`.** `readValidSessionIds` in `plugins/bizar/index.ts` now races the opencode session-list call against a 1-second timeout via a small `withTimeout(promise, ms, label)` helper. On timeout, the function returns an empty set; the age-based cleanup branch still runs. A no-op `.catch(() => undefined)` is attached to the original promise to prevent late-rejection crashes after the race winner is discarded.

### Added (v0.5.2)

- **`withTimeout` helper, exported from `plugins/bizar/index.ts`.** Pure async helper — race a promise against a timer, throw a labeled error on timeout, clear the timer in a `finally` block. Extracted from `readValidSessionIds` so it can be unit tested in isolation.
- **`readValidSessionIds` exported from `plugins/bizar/index.ts`.** Previously private; now exported for testing.

### Tests (v0.5.2)

- **11 new regression tests in `plugins/bizar/tests/init-helpers.test.ts`.** Cover the `withTimeout` helper (4 tests) and the `readValidSessionIds` integration path (7 tests), including a test that simulates a hanging `list()` and verifies the function returns within 1.5s (it actually returns in ~1.0s).
- Test count: 491 → **502 pass, 0 fail**.

### Release

- Plugin version bumped to `0.5.2`. `package.json` and the version-pin in `config.test.ts` are updated in lockstep.
- Release notes at `docs/releases/v0.5.2.md`.
- Git tag `v0.5.2` points at the release commit.

## 2.1.0 — 2026-06-18 (Bizar plugin v0.5.0)

## 2.1.0 — 2026-06-18 (Bizar plugin v0.5.0)

The "plan side-effects" release. Wires the `/plan` slash commands to the Bizar plugin's `bizar_plan_action` tool, adds `bizar_wait_for_feedback`, and brings the plugin to v0.5.0.

### Added (Bizar plugin v0.5.0)

- **Plan side-effects wired.** `/plan new|list|open` actually create, list, and link plans instead of parsing-only.
- **New subcommands:** `/plan get`, `/plan add`, `/plan update`, `/plan delete`, `/plan comment`, `/plan status`, `/plan comments`. These route to `bizar_plan_action` and `bizar_get_plan_comments` via the unified `SideEffect.tool_invocation` shape.
- **Plan tools in `opencode.json`:** `bizar_plan_action`, `bizar_get_plan_comments`, `bizar_wait_for_feedback`.
- **Synthetic `ToolContext` construction.** Slash-command-driven tool calls build the required `ToolContext` from `ctx.worktree`, `ctx.directory`, and a fresh `AbortController`.
- **`bizar_wait_for_feedback` tool.** Blocks on a plan's comment file or `meta.json` status. Used by `/plan wait <slug>` to pause until the user comments or approves/rejects. Returns `feedback_received`, `approved`, `rejected`, or `timed_out`.
- **Background state on disk.** Each background instance writes its `BackgroundState` to `~/.cache/bizar/state/bg/<instanceId>.json` on every transition. The plugin recovers running instances on restart.
- **Stall and thinking-loop detection.** Long-running background sessions are monitored for no-event stalls (default 180s) and thinking-only loops (default 300s, max 1 intervention). Configurable via plugin options or `BIZAR_STALL_TIMEOUT_MS`.

### Fixed (Bizar plugin v0.5.0)

- **Tool-name typo: `bizarre_*` (double-r) renamed to `bizar_*` in `plugins/bizar/index.ts`.** The 4 background-agent tools are no longer silently disabled by the typo.
- Stale JSDoc in `src/settings.ts:62` now points at the real tools (`bizar_plan_action` + `bizar_wait_for_feedback`).
- **Startup hang recovery (2026-06-18).** Wrapped `client.session.list()` in plugin init with a 1-second timeout guard to prevent init promise deadlock. Postmortem at `docs/postmortems/2026-06-18-plugin-state-deadlock.md`.
- **Re-entrant lock removed from plugin state layer.** `plugins/bizar/src/state.ts` had a per-session mutex that self-deadlocked on first message submit. Removed nested locking from `load()`, `save()`, and `delete()`.

### Security (v0.5.0)

- Live Hindsight bearer token replaced with placeholder in `config/opencode.json`. `.gitignore` verified/updated to exclude the file. Token rotation is the user's responsibility.

## 2.0.0 — 2026-06-17

The "Bizar plugin" release. Adds the bundled opencode plugin, the visual plan tool, the Quick agent, and the self-improvement protocol. Backwards-compatible with 1.x agent definitions and routing.

### Added

- **Bizar opencode plugin (v0.3.1).** Loop detection at thresholds 5/8/12, periodic status reporting, handoff signal. The plugin is bundled with the installer and enabled by default. See [Bizar Plugin](Bizar-Plugin).
- **Background agents (v0.4.2, experimental).** Asynchronous subagent execution via a single `opencode serve` instance. Four custom tools: `bizar_spawn_background`, `bizar_status`, `bizar_collect`, `bizar_kill`. See [Background Agents](Background-Agents).
- **`bizar plan` command.** Visual plan tool with a browser-based viewer/editor. Subcommands: `new`, `open`, `list`, `delete`, `export`. See [Plans Command](Plans-Command).
- **Quick agent.** Free single-shot fast-path agent. Skips decomposition and delegation. Useful for one-line changes.
- **Forseti auditor.** Adversarial plan review for Tier 4 and Tier 5 work. Runs in M3 with `edit: deny`.
- **Self-improvement log.** Every task appends a lesson to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. Read at session start.
- **Per-project Hindsight banks.** Every project gets its own bank; the default bank is reserved for general/system knowledge only.
- **Skill discovery protocol.** Agents proactively install Skills CLI packs by domain (e.g., `skills add supabase/agent-skills --all -y` for database work).
- **`bizar audit` subcommand.** Security audit of agent configuration.
- **`bizar test-gate` subcommand.** Detect and run the project's test suite.
- **`bizar export` subcommand.** Export agents/rules to another harness (Claude Code, Cursor, opencode).

### Changed

- **Odin tool surface stripped.** No `bash`, `glob`, `grep`, `edit`, `write`, `question`. Odin can only dispatch.
- **Vör research-first protocol.** Vör reads `.bizar/PROJECT.md` and the project's Hindsight bank before asking any questions.
- **AGENTS.md restructured.** New sections: Skill Discovery Protocol, Always-On Rules, Hindsight Memory Protocol, Model Routing & Agents.
- **All subagents get byte-identical `## Loop Guard Handling` section.** Verified by SHA256.

### Fixed

- Vör no longer asks generic questions before reading project context.
- Windows path-separator handling in `cli/copy.mjs` and `cli/utils.mjs` (replaced `lastIndexOf('/')` with `path.dirname()`).
- The `__ABS__` global sentinel in the plugin's path normalization was replaced with `path.relative(worktree, ...)` for in-worktree paths and a per-path stable hash for out-of-worktree paths. (Resolves a fingerprint-collision attack vector.)
- Plugin `tool.execute.before` no longer claims to carry the agent name (it doesn't). State is per-session only.

## 1.2.x — 2026-06

The "polish" release series. Adds hooks, commands, rules, and Windows compatibility.

### 1.2.1 — 2026-06-15

- Windows path-separator fixes (`cli/copy.mjs`, `cli/utils.mjs`).
- Added `tryReadVersion()` helper for cross-platform npm version detection.
- `.gitignore` now excludes `node_modules/` and `package-lock.json` for contributors.

### 1.2.0 — 2026-06-12

- **Hooks system.** Opencode hooks for session lifecycle events.
- **Slash commands.** Bundled commands for common operations.
- **Always-on rules.** `rules/general.md`, `rules/javascript.md`, `rules/python.md`, `rules/git.md`, `rules/testing.md`.
- **Skill packs via installer.** Curated skills from `skills.sh` integrated into the install flow.
- **Forseti agent added.** Adversarial plan review.
- **Baldr agent added.** Design system plans.

## 1.1.x — 2026-05

The "expansion" release series. Adds Frigg, Vör, and the research-first protocol.

### 1.1.0 — 2026-05-28

- **Frigg agent.** Read-only Q&A using DeepSeek V4 Flash (free). Never modifies files.
- **Vör agent with research-first protocol.** Reads `.bizar/PROJECT.md` and Hindsight bank before asking.
- **Mimir agent with Semble-first search.** Uses Semble MCP for codebase exploration.
- **Hindsight memory MCP integration.** Per-project banks with `bank_id` parameter.
- **Headroom integration.** Token optimization for shell commands (replaces RTK).
- **Semble integration.** AI-powered code search.

## 1.0.x — 2026-04

The initial release.

### 1.0.0 — 2026-04-22

- **Odin** (M3 router).
- **Thor** (M2.7, moderate implementation).
- **Tyr** (M3, complex implementation).
- **Heimdall** (free, file ops and mechanical work).
- **Hermod** (M2.7, git ops).
- **Vidarr** (GPT-5.5, last resort).
- **`bizar` interactive installer.**
- **Source install script** (`install.sh`).
- **`opencode.json` template** with deep-merge via `jq`.
- **Master `AGENTS.md`** with the routing table and skill discovery protocol.

---

For older changes and detailed commit history, see the GitHub repository:

- [BizarHarness releases](https://github.com/DrB0rk/BizarHarness/releases)
- [BizarHarness commits](https://github.com/DrB0rk/BizarHarness/commits/main)
