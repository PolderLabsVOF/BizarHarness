# Changelog

All notable changes to BizarHarness are documented here. The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For npm releases, see https://www.npmjs.com/package/@polderlabs/bizarharness. For GitHub releases, see https://github.com/DrB0rk/BizarHarness/releases.

## Unreleased

### Added

- **`/tailscale-serve` command.** Authenticate and configure Tailscale Serve to expose a local port on your tailnet. Surfaces the admin-enable URL when Serve is not yet enabled. See [Commands Reference → /tailscale-serve](Commands-Reference#tailscale-serve--magicdns-hosting).
- **`install.sh` deploys `commands/` and `hooks/`.** Pre-v0.5.1, only `agents/`, `skills/`, and the Bizar plugin were copied to `~/.config/opencode/`. The v0.5.1 installer adds two new copy blocks for `config/commands/*.md` and `config/hooks/*` (recursive). All future commands ship via `install.sh` automatically.
- **Commands Reference wiki page.** New page documenting all three command layers: Bizar plugin (`/plan`, `/visual-plan`, `/help`), user-level (`/init`, `/learn`, `/plan`, etc.), and project-level (e.g. `/tailscale-serve`). See [Commands Reference](Commands-Reference).

### Fixed

- **`bizar_spawn_background` empty-sessionId bug (v0.5.1).** `InstanceManager.add()` was synchronously calling `attachEventHandler` with `sessionId: ""` (filled in later by `POST /session`). The `EventStream` guard rejected the empty string and the spawn failed before any HTTP call. Fix: move `attachEventHandler` out of `add()` and into `bg-spawn.ts` after the real sessionId is known. The "track BEFORE HTTP" invariant is preserved. Covered by `plugins/bizar/tests/attach-handler-bug.test.ts` (3 tests). Test count: 488 → 491 pass. See [Bizar Plugin → Recent fixes](Bizar-Plugin#recent-fixes).

### Known limitations (v0.5+)

- Plugin has no hot-reload — source changes require opencode restart.
- `install.sh` does not detect when the installed plugin is older than the source. Re-run after every `git pull`.

## 2.1.0 — 2026-06-18 (Bizar plugin v0.5.0)

The "plan side-effects" release. Wires the `/plan` slash commands to the Bizar plugin's `bizar_plan_action` tool, adds `bizar_wait_for_feedback`, and brings the plugin to v0.5.0.

### Added (Bizar plugin v0.5.0)

- **Plan side-effects wired.** `/plan new|list|open` actually create, list, and link plans instead of parsing-only.
- **New subcommands:** `/plan get`, `/plan add`, `/plan update`, `/plan delete`, `/plan comment`, `/plan status`, `/plan comments`. These route to `bizar_plan_action` and `bizar_get_plan_comments` via the unified `SideEffect.tool_invocation` shape.
- **Plan tools in `opencode.json`:** `bizar_plan_action`, `bizar_get_plan_comments`, `bizar_wait_for_feedback`.
- **Synthetic `ToolContext` construction.** Slash-command-driven tool calls build the required `ToolContext` from `ctx.worktree`, `ctx.directory`, and a fresh `AbortController`.
- **`bizar_wait_for_feedback` tool.** Blocks on a plan's comment file or `meta.json` status. Used by `/plan wait <slug>` to pause until the user comments or approves/rejects. Returns `feedback_received`, `approved`, `rejected`, or `timed_out`.
- **Background state on disk.** Each background instance writes its `BackgroundState` to `~/.cache/bizarharness/state/bg/<instanceId>.json` on every transition. The plugin recovers running instances on restart.
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
- **`bizarharness plan` command.** Visual plan tool with a browser-based viewer/editor. Subcommands: `new`, `open`, `list`, `delete`, `export`. See [Plans Command](Plans-Command).
- **Quick agent.** Free single-shot fast-path agent. Skips decomposition and delegation. Useful for one-line changes.
- **Forseti auditor.** Adversarial plan review for Tier 4 and Tier 5 work. Runs in M3 with `edit: deny`.
- **Self-improvement log.** Every task appends a lesson to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. Read at session start.
- **Per-project Hindsight banks.** Every project gets its own bank; the default bank is reserved for general/system knowledge only.
- **Skill discovery protocol.** Agents proactively install Skills CLI packs by domain (e.g., `skills add supabase/agent-skills --all -y` for database work).
- **`bizarharness audit` subcommand.** Security audit of agent configuration.
- **`bizarharness test-gate` subcommand.** Detect and run the project's test suite.
- **`bizarharness export` subcommand.** Export agents/rules to another harness (Claude Code, Cursor, opencode).

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
- **RTK integration.** Token optimization for shell commands.
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
- **`bizarharness` interactive installer.**
- **Source install script** (`install.sh`).
- **`opencode.json` template** with deep-merge via `jq`.
- **Master `AGENTS.md`** with the routing table and skill discovery protocol.

---

For older changes and detailed commit history, see the GitHub repository:

- [BizarHarness releases](https://github.com/DrB0rk/BizarHarness/releases)
- [BizarHarness commits](https://github.com/DrB0rk/BizarHarness/commits/main)
