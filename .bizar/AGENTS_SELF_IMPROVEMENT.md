# Self Improvement

Project-level agent learning. Entries are auto-appended by Odin at task completion and read at session start.

## Active Rules
1. **Per-project Hindsight banks** — every project gets its own bank; default is for general/system knowledge only
2. **Session start bank check** — always call `hindsight_list_banks` to discover and set the correct bank
3. **Never use default for project work** — pass `bank_id: "<project-name>"` in all Hindsight calls
4. **Config files with tokens go in .gitignore from day 1** — `config/opencode.json` leaked a Hindsight bearer token for 30+ commits. Use `.template` files for reference, never commit live config. `git rm --cached <file>` to fully untrack.
5. **Pre-commit hook scans for secrets** — a token-scanning pre-commit hook (`scripts/git-hooks/pre-commit`) is mandatory for any project handling credentials. Install via `scripts/install-hooks.sh`.
6. **Release audits check for Bearer tokens** — before publishing any release, grep for `Bearer [A-Za-z0-9+/=]{20,}` in every config file.
7. **Plugin command pass-through** — `plugins/bizar/src/commands.ts` `default` branch must `return null` (not `{ handled: true }`) so unknown commands fall through to other handlers (built-ins, other plugins). Returning `handled: true` swallowed every unknown command including `/explain`, `/init`, `/learn`, `/pr-review`, `/audit`.
8. **Bundled agent .md frontmatter must match `config/opencode.json`** — drift between them causes routing to silently use the wrong model (the v3.7.0 audit found 11 files with `openai/gpt-5.4` while the actual model should have been M3/M2.7/deepseek).
9. **Parallel dispatch requires sibling-awareness context** — When dispatching 2+ parallel subagents, Odin MUST prepend a `## PARALLEL EXECUTION CONTEXT` block listing siblings + disjoint file scopes + git rules. Subagents MUST treat scope as sacred and avoid all write-level git except via @hermod. If tasks cannot be decomposed into disjoint file scopes, dispatch sequentially.
10. **Thinking/interleaved config is a hard requirement for MiniMax models** — All agent .md files must include a "## Thinking style" section referencing `config/rules/thinking.md`. Always add `interleaved: { field: "reasoning_details" }` and `reasoning: true` for MiniMax models on openrouter. Avoid `variant: "high"` for Odin/Tyr/Forseti unless deep reasoning is explicitly requested.
11. **Dashboard commands go under `bizar dash <subcommand>`** — not as top-level `bizar` commands. The dashboard npm package is a library, not a CLI; no `bin` field.
12. **All cross-CLI integration uses in-process imports, not subprocess spawn** — when one CLI needs another's functionality, expose it as a named export and import directly. Reserve subprocess `spawn` for true process isolation needs (e.g., backgrounded/daemonized children).
13. **Signal handlers in dual-purpose files (CLI + library) must be gated by `isMainEntry()` checks** — otherwise they affect the parent process when the file is imported in-process. Compare `import.meta.url` to `pathToFileURL(process.argv[1]).href` to detect main-entry.
14. **Verify subagent file changes persisted before proceeding** — when delegating a refactor, re-read the file at the end of the delegated step. The previous Tyr task claimed a `write` that didn't take effect; never trust a subagent's "done" report without reading.
 15. **Filesystem-listing endpoints must use segment-aware allow-lists, not just `path.resolve()`** — endpoints that list directory contents MUST resolve paths against an allow-list using segment-by-segment comparison (the `resolveSafePath` pattern), not a single `path.resolve()` call. A prefix check after `path.resolve()` is vulnerable to `../` traversal at intermediate segments. The `resolveSafePath` helper in `lib/path-safe.mjs` also rejects first-level dotdirs as roots. Without this, one slipped bug in a read endpoint can expose the entire filesystem.

16. **Schema tolerance for external state files** — files written by sibling processes (the opencode plugin writes `serve.json`) MUST be parsed defensively. The strict pre-v3.11.0 schema required all 6 fields but only 2 (`password`, `port`) are truly required. When reading external state, use an additive schema: require only the fields you need, derive the rest from them (e.g., derive `baseUrl` from `port` when missing). A strict schema on external, evolving files creates silent null-return cascades.

17. **Health probes must not depend on auth** — "is X alive" checks must use TCP-connect (`net.createConnection`, 1.5s timeout), not an authenticated HTTP GET. Auth-gated endpoints can return 401 even when the service is healthy. TCP handshake is auth-free, transport-only, and produces zero false negatives for liveness.

18. **npm publish order matters for interdependent packages** — when package B imports package A at runtime, publish A first, wait for registry propagation, then publish B. Always run dry-runs and registry verification — they catch packaging errors and confirm the publish landed.
19. **HTTP 204/205/304 responses MUST NOT have a body** — `new Response("", { status: 204 })` throws in Node 24+ (strict Fetch spec enforcement). Use `new Response(null, { status: 204 })`. SDK test fixtures and mocks must mirror real fetch semantics or the request path never gets exercised (the catch block converts the throw to a confusing ConnectionError).
20. **npm workspaces need root `package.json` config + symlinks** — `"workspaces": ["packages/*"]` at root + `"@scope/pkg": "workspace:*"` in dependent packages. `npm install` at root creates symlinks at `node_modules/@scope/pkg -> ../../packages/pkg`. Bun also reads workspaces from root package.json.
21. **Vitest captures `console.error` in test output** — debug logging inside the SDK doesn't surface during tests. Use `process.env.MY_DEBUG` to gate verbose debug logs OR write to `/tmp/*.log` from inside the SDK when investigating tricky issues.
22. **`bun test <path>` treats path as a name filter** — must use `./<path>` (or run from the dir) to ensure it's treated as a path. Otherwise bun reports "Tests need `.test` in the filename" and silently filters everything out.
23. **Mount namespace routers BEFORE broader catch-all routers** — Express matches middleware in registration order. If you have `/api/v2` and `/api` and the `/api` router has an internal 404 catch-all (api.mjs:109 style), the catch-all will swallow `/api/v2/*` requests because `/api` matches first. Always mount the more specific namespace router first. Verified in BizarHarness-dev simulation: 157 tests passed only after reordering `/api/v2` mount to before `/api` apiRouter.
24. **HTTP basic auth files: persist only the secret, not the port** — the port can drift (server restarts on a different port, port conflicts, etc.). Always use the CURRENT port argument when reading/writing the auth file, and rewrite the file when persisted port differs. The persisted password + createdAt are what should survive restarts. The dashboard's `~/.cache/<scope>/auth.json` should reflect WHERE IT IS LISTENING NOW, not where it listened last time.
25. **CLI args must be parsed, not silently dropped** — `startDashboard({ port: ... })` with `port` from caller IS NOT the same as `startDashboard()` after parsing `argv`. The original `dashboard dash start --port 4098` was silently ignoring `--port` and falling through to `findFreePort(4321)`. Always: parse argv → validate → pass typed args down. The Bash→Node hand-off is a common silent-drop point.
26. **Add request-log middleware to HTTP servers during integration tests** — when a plugin→server flow doesn't behave, a per-request middleware like `console.log(\`[v2-req] ${req.method} ${req.originalUrl}\`)` is the fastest way to confirm "is the client even reaching us?". Static logs of startup output won't show mid-run traffic. Took the dev-container simulation from "no events visible" to "no POST /api/v2/event from plugin" in one log line.
27. **Opencode event hook has `sessionID` nested in `properties`, not at top level** — the legacy `bizar` plugin assumed `event.sessionID` was top-level, so its hook returned early for every opencode event. Correct extraction: `const sessionID = ev.sessionID ?? ev.properties?.sessionID`. This is a real bug in `plugins/bizar/index.ts` v0.6.2 that silently disables the session-tracking hook. Fixed in v0.7.0-alpha.1.
28. **`opencode run <prompt>` is too short-lived to emit lifecycle events** — the `event` hook (session.created, session.updated, session.idle) only fires for long-running TUI/server sessions. For end-to-end SDK verification, use a manual SDK POST against the dashboard's `/api/v2/event` endpoint (the smoke test does this) rather than waiting for organic opencode events from `run`.

## Log

### 2026-06-23: Published v3.11.0 to npm (dash + CLI)
- **Task**: Publish `@polderlabs/bizar-dash@3.11.0` then `@polderlabs/bizar@3.11.0` to npm
- **Lesson**: Dry-run + verify cycle caught nothing unexpected, but the 5-second safety check is well worth it for public publishes
- **Pattern**: npm publish checklist: whoami → git status/tags → dry-run both → publish dash → npm view dash → publish CLI → npm view CLI → verify peerDeps + exports
- **Files**: `bizar-dash/package.json`, `package.json`
- **Agent**: heimdall

### 2026-06-22: Full v3.7.0 audit pass — 116 files, +3154/−1334

### 2026-06-22: Full v3.7.0 audit pass — 116 files, +3154/−1334
- **Task**: Extensive full pass on every component of the Bizar system (plugin, CLI, dashboard server, desktop web, mobile, agent configs, install scripts, templates). Fix every issue, push, release, publish.
- **Files changed**: 116 files, 3154 insertions, 1334 deletions
- **Agents used**: parallel dispatch — @thor (CLI, mobile, install/templates, plugin), @tyr (dashboard server, desktop web), @mimir (agent configs)
- **Approach**: 7 parallel subagent dispatches from one Odin message; each scoped to a single component with explicit "do not touch other parts". Final integration (typecheck/build/tests) and E2E browser test done in this session after parallel work returned.
- **Lessons learned**:
  - Bulk-copy frontmatter errors propagate silently — `openai/gpt-5.4` ended up in 11 agent files even though routing docs said M3. Validate frontmatter against actual config on every release.
  - `process.removeAllListeners` is a footgun in plugins — always track and remove only your own handlers.
  - Server-side `dispose()` must clear all on-disk state it owns (`serve.json`, PID files, temp files). Otherwise re-init inherits stale config.
  - `request.ip` is unsafe for auth when behind a proxy; use `request.socket.remoteAddress` and only honor trusted hops.
  - WebSocket initial snapshot payload must exactly match the REST snapshot shape; type drift breaks the client.
  - Mobile sheet/modal scroll lock must use `position: fixed` on body, not just `overflow: hidden` (iOS Safari ignores overflow locking).
- **Pattern to follow next time**: For monorepo audit tasks, dispatch all component-level audits in parallel from one Odin message, then run integration + E2E + release from a single sequencer. This compressed 116 files of fixes + verification + publish into one Odin turn.

### 2026-06-23 — v3.9.0 four-stream release

- **Context:** User requested five changes in one turn: (1) update the graphify installer to use `uv` by default (PEP 668 workaround on Arch); (2) migrate the MiniMax default provider from `minimax.io` to OpenRouter across every config + wiki page; (3) deep-dive the slash-command system and make every `/command` open an actual dialog instead of printing usage text as a chat bubble; (4) deep-dive the schedule feature and make "Sunday 1pm weekly code review" actually work end-to-end (currently 6 critical bugs); (5) audit + improve the always-on / background-agent dashboard so status is clear and configuration is reachable in the UI.

- **Approach:** Three parallel research streams (@mimir for slash commands, schedules, background system) → four parallel implementation streams (@thor for installer + slash-command dialogs, @tyr for OpenRouter migration + schedules overhaul, @heimdall for background UX) → @forseti audit → fix dispatch for 3 CRITICAL + 4 HIGH findings → @thor test gate → Odin does housekeeping inline (version bump, CHANGELOG entry, this entry) → @hermod release commit + push + tag.

- **Lessons learned:**
  - **The plugin `chat.message` hook silently hijacks every `/`-prefixed message** including commands that opencode would have dispatched natively. The "Unknown command" branch in `commands.ts` returned `handled: true`, swallowing `/audit`, `/explain`, `/init`, `/learn`, `/pr-review`, `/tailscale-serve` — the agent files referenced by `command:` in `opencode.json` were never reached. Fix: only intercept commands that need plugin-side effects (`/visual-plan`, `/plan`, `/bizar`); let the rest fall through.
  - **`throw new Error(text)` from `chat.message` is a footgun.** It looks like an error, but opencode treats it as the assistant response — the user sees the thrown string as a chat bubble. Any plugin that wants to communicate something to the UI without producing a chat reply must write to a side channel (file bus or WS), not throw.
  - **A "deferred to vX.Y" comment is technical debt that ages into a bug.** `schedules-runner.mjs:107-111` had `"agent dispatch (deferred to v3.1)"` — three minor versions later it was still a stub logging success for a no-op. Audit cycles need to specifically flag TODO comments with version numbers and either ship them or remove them.
  - **Cron libraries are worth the dependency.** The hand-rolled 5-field cron evaluator (`nextCronMinute`) worked for simple patterns but had no timezone support and would have been wrong on the very feature the user asked for (Sunday 1pm ET). `croner` (10KB gzipped, built-in IANA TZ, single `.nextRun()` API) replaced 40 lines and added timezone, validation, and iterator support. Don't roll your own cron.
  - **`restartCount` on the child instance is not enough.** When persistent instances auto-restart, each child has its own counter starting fresh — a chain can exceed `maxRestarts` indefinitely. The fix is to walk the `parentInstanceId` chain and sum all counters, cycle-safe.
  - **Dead "Settings" UIs are worse than no UI.** The first Background Agents card had inputs with `defaultValue={N}` and no `value`/`onChange`/Save. The CardMeta said "Tune plugin options" — pure deception. Either implement it (the second pass did) or remove it; never ship a card that looks editable but isn't.
  - **Cross-package type duplication needs a "kept in sync" comment.** `DialogComponent` was defined in `plugins/bizar/src/commands.ts` (the source) and `bizar-dash/src/web/lib/types.ts` (the consumer). They're literal unions, easy to drift. Solution: a comment in both files pointing at the other.
  - **`api.mjs` vs `server.mjs` router mount style matters.** Forseti found that `createDialogsRouter` was exported but never registered — the implementation assumed `server.mjs` mounts routers but the actual mount point was `api.mjs`. Always check both files when adding a new route.
  - **TypeScript `import type` erasure hides bad imports.** `CommandDialog.tsx:10` had `import type { DialogDescriptor } from './types'` referencing a nonexistent file. Project-wide `tsc --noEmit` passed because the import was type-only and erased at runtime; Vite's bundler would have failed at build. Lesson: typecheck the file in isolation, not just as part of the project.

- **Patterns for next time:**
  - For UI that emits dialogs from the plugin, use a file-based message bus (`~/.cache/bizar/dialogs/<id>.json`) polled every 1s by a dashboard worker. Easier than threading WS through the plugin's process boundary.
  - For multi-stream releases, dispatch implementation in parallel with explicit `WIRING` comments for cross-cutting glue (the dialog router mount, the audit endpoint). One agent creates the artifact; another wires it. The comments make the contract explicit.
  - Always run `@forseti` audit after multi-stream implementation. Three of the seven findings would have shipped as silent no-ops (Settings card, AuditDialog 404, dialog router unmounted). The audit catches what the implementation agents cannot self-verify.

- **Files changed:**
  - 44 modified, 9 new (full list in `CHANGELOG.md` v3.9.0)
  - Net: +2,372/-481 lines

- **Agents used:** @mimir (3 deep-dive research streams), @thor (installer, slash-command dialogs, fix stream), @tyr (OpenRouter migration, schedules overhaul), @heimdall (background UX, fix stream), @forseti (audit), @hermod (release pending).

### 2026-06-17: Created bizar-remote repo from scaffold
- **Context**: Scaffold had 1 TSX file with backticks in template literal causing parse error
- **Lesson**: Template literals with inner backticks fail at compile time. Use string concatenation for help text containing backticks.
- **Pattern**: When TypeScript `noUncheckedIndexedAccess` is on (our default), always guard `array[i]` lookups with `if (!arg) continue` before using `.startsWith()` etc.
- **Files**: src/cli/bin.ts
- **Agent**: heimdall

### 2026-06-16: Created .bizar/ folder
- **Context**: Centralizing all BizarHarness project data into a single folder
- **Lesson**: Keeping project root clean — all agent-learning data in one place
- **Pattern**: Use `.bizar/` for all BizarHarness project data (self-improvement, design, memories)
- **Files**: .bizar/
- **Agent**: odin

### 2026-06-16: Migrated ams-studio memories + enforced per-project Hindsight banks
- **Context**: AMS Studio memories were scattered across 75 docs in the default bank instead of the ams-studio bank. All 10 agent files said "use default bank".
- **Lesson**: Per-project bank policy was documented but not enforced — agents kept writing to default. Need explicit bank selection logic at session start.
- **Pattern**: At session start: (1) `hindsight_list_banks` (2) determine project name (3) `hindsight_recall` with correct `bank_id` (4) create bank if missing
- **Files**: ~/.config/opencode/AGENTS.md, ~/.config/opencode/agents/odin.md, heimdall.md, mimir.md, vor.md, hermod.md, thor.md, baldr.md, tyr.md, vidarr.md, forseti.md
- **Agent**: thor, tyr
- **Details**: 40+ ams-studio docs migrated via `hindsight_sync_retain`. All agent files updated to use per-project banks with `bank_id` parameter. AGENTS.md now has bank selection rules table. Odin updated with session-start bank workflow.

## 2026-06-16: Windows compat fixes for npm package

**Files changed:**
- `cli/copy.mjs`: Replaced `lastIndexOf('/')` with `dirname()` for cross-platform path handling
- `cli/utils.mjs`: Added `isWin` detection, separate Windows/Nix config dir logic, Windows npm paths for version detection, extracted `tryReadVersion()` helper
- `.gitignore`: Added `node_modules/` and `package-lock.json`

**Key insight:** The hardcoded `/` path separator was the most subtle Windows bug — `lastIndexOf('/')` for parent dir silently returns `-1` on `C:\...` paths, which doesn't crash `slice()` but produces wrong paths. `path.dirname()` is the correct cross-platform API.

### 2026-06-16: Fixed Vör questioning agent — research-first protocol

**Task:** Fixed Vör questioning agent — was jumping to generic questions without researching project context first
**Files changed:**
  - `config/agents/vor.md` (rewrote workflow: research-first, question-only-if-still-ambiguous, questions must reference project context)
  - `config/AGENTS.md` (updated Vör description to reflect research-first protocol)
**Agents used:** heimdall

**Lessons learned:** Vör was asking generic questions ("what framework", "what files") before reading PROJECT.md or Hindsight banks. Fixed by reordering the workflow: project context first, questioning only if ambiguity remains after research, and all questions must reference actual project files/frameworks/patterns.

**Pattern to follow next time:** Any agent that needs to ask about the project must first demonstrate it has read the project context. Questions that could be answered by reading existing files or Hindsight memory indicate insufficient research.

### 2026-06-16: Added Skill Discovery Protocol
- **Task**: Agents now proactively find and install skills using the Skills CLI during execution
- **Files changed**:
  - `cli/copy.mjs` (added SKILL_PACKS + installCuratedSkills())
  - `cli/prompts.mjs` (added promptSkillPacks())
  - `cli/install.mjs` (wired skill pack selection + postinstall core skill install)
  - `cli/utils.mjs` (updated buildSummary for skillPacks)
  - `config/AGENTS.md` (added Skill Discovery Protocol section)
  - `config/agents/thor.md`, `tyr.md`, `heimdall.md`, `vidarr.md` (added Skill Discovery Protocol sections)
  - `README.md` (added Skill Discovery section with domain table)
- **Agents used**: heimdall, thor
- **Lessons learned**: Skills CLI `skills find` is interactive-only, so agents can't use it programmatically. Instead, agents should use `skills list --json` to check installed skills, and try known repos by domain (e.g., `skills add supabase/agent-skills --all -y` for database work).
- **Pattern to follow next time**: When adding a CLI tool dependency, first verify which commands work non-interactively before writing protocol steps.

### 2026-06-17: Split dev sandbox into separate `BizarHarness-dev` repo
- **Task**: User wanted dev-only files (Docker, scripts, dev docs) out of the main BizarHarness repo. Created sibling repo `BizarHarness-dev` and wired bidirectional git remotes.
- **Files changed**:
  - Created: `/home/drb0rk/Projects/BizarHarness-dev/{Dockerfile, docker-compose.yml, .dockerignore, .gitignore, README.md, DOCKER_DEV.md, scripts/dev.sh, scripts/dev-clean.sh}`
  - Removed from main: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/dev.sh`, `scripts/dev-clean.sh`, `DOCKER_DEV.md`
  - Main repo `README.md`: added "Development" section pointing to the dev repo
  - `scripts/dev.sh`: rewrote to use sibling-relative path resolution (`dirname dirname BASH_SOURCE` → `../BizarHarness`)
- **Agents used**: heimdall (Docker setup), hermod (repo split + remotes), thor (quick agent + name research)
- **Lessons learned**:
  - opencode config is **always** merged from global + project + env. There is no "skip global" flag. Only Docker gives true clean-install isolation. For daily dev, harness scripts in a temp dir + symlinks are fast and inherit API keys.
  - When splitting a repo, copy first, commit, then `git rm` from source. Use local file paths for the remotes (not GitHub URLs) — developer can swap to GitHub when ready.
  - The dev sandbox's `dev.sh` should validate that the sibling project exists before launching (`test -f $PROJECT_DIR/opencode.json`) so misconfig fails fast.
- **Pattern to follow next time**: For any opencode config/plugin project, default architecture is two repos — the main (shipped) and a `-dev` sibling (Docker sandbox + dev scripts). Use bidirectional file-path remotes; swap to GitHub URLs when pushing.

### 2026-06-17: Built Bizar opencode plugin (v0.1 → v0.3.1 spec → implementation)
- **Task**: User wanted loop detection, agent status reporting, and handoff-to-Odin for stuck subagents. Built the `bizar` opencode plugin in 7 source files, 7 test files, 112 tests passing.
- **Files changed** (under `plugins/bizar/`):
  - `index.ts` — Plugin entry, hook wiring, init try/catch, per-session mutex
  - `src/fingerprint.ts` — Canonical key sort, worktree-relative path normalization, sha256 hash
  - `src/state.ts` — SessionState, StateStore (atomic writes, per-session mutex, 7-day cleanup, corrupt fallback)
  - `src/report.ts` — LogWriter with 10MB rotation, metadata-only (no args in logs)
  - `src/loop.ts` — Threshold decision tree (5 warn / 8 escalate / 12 block)
  - `src/handoff.ts` — 3 static message templates for `experimental.chat.system.transform`
  - `src/logger.ts` — Thin wrapper over `client.app.log` with BIZAR_LOG_LEVEL
  - `src/options.ts` — Clamping, secret-dir refusal, env var flags
  - `scripts/check-forbidden-imports.sh` — CI gate: no `node:dns|net|http|https`
  - 5 test files, 112 tests, 241 assertions, all green
  - `README.md` with mandatory `## Limitations` section per spec §15 #4
- **Files changed** (wiring):
  - `cli/copy.mjs` — `installPluginBizar()` function (86 lines)
  - `cli/install.mjs`, `cli/prompts.mjs`, `cli/utils.mjs` — wired as install component
  - `config/opencode.json` — added `plugin` array with bizar entry + options
  - `install.sh` — plugin copy section + post-merge jq injection (idempotent)
- **Files changed** (agent prompts):
  - All 11 subagent files got byte-identical `## Loop Guard Handling` section (verified via SHA256)
  - `odin.md` got the longer Odin-specific PROTOCOL wording (recognizes 3 emitted strings + recovery procedure)
- **Spec files**: `.bizar/plugin-architecture-v0.{1,2,3}.md` (3 versions of the spec, kept for history)
- **Agents used**: mimir (research x2), thor (quick agent + name research + supporting modules + tests), tyr (spec revisions + core impl + agent prompt updates), heimdall (Docker sandbox + install wiring), hermod (repo split), forseti (3 audit passes)
- **Lessons learned**:
  - **Forseti audit pattern works**: 3 spec revisions caught 6 HIGH + 17 MEDIUM + 11 LOW + 5 open questions before any code was written. The single most important catch was the §11.1 recognition pattern mismatch — without the audit, the entire handoff mechanism would have been built on a phantom marker.
  - **The `__ABS__` global sentinel is a security/precision anti-pattern**. Use `path.relative(worktree, ...)` for in-worktree paths and per-path hash for outside. A global sentinel allows false-positive collisions (different files with same prefix) and false-negative loop-detection bypass.
  - **`tool.execute.before` does NOT carry the agent name**. Drop per-call agent attribution; track per-session only. Agent identity comes from `chat.message` history.
  - **Bun is single-threaded but async I/O interleaves** — you need a per-session mutex (chain of pending Promises) to prevent re-entrancy corruption in `tool.execute.after`.
  - **Use `experimental.chat.system.transform`** for handoff message injection. NOT `chat.message` (which fires for every user message, not just on dispatch) and NOT mutating `output.parts` (risky).
  - **opencode agent file name IS the TUI display name** — the `name:` frontmatter field is silently ignored. For user-visible function descriptors in agent names, the only viable separator is hyphen (`odin-orchestrator.md`, NOT `odin (orchestrator).md` which would show parens literally). User input needed to decide on naming.
  - **Per-session mutex is necessary but not free** — `bun test` default 5s timeout can hit if the mutex test is real I/O. Use in-memory locks for unit tests.
  - **When two parallel agents (Thor + Tyr) both implement `options.ts`**, the second must delete theirs and re-create to match the first's naming. Interface contracts in the task prompt prevent this; explicit naming matters.
  - **`jq -s '.[0] * .[1]'` does NOT deep-merge arrays** — it REPLACES them. For `install.sh`, after the merge, post-inject the plugin entry to handle the case where the existing config has `plugin: []` that would wipe the template's plugin array.
- **Pattern to follow next time**:
  - For any new opencode plugin: 3-phase flow (spec → Forseti audit → parallel impl by Thor+Tyr). Skip audit for trivial plugins (<100 lines, no security implications).
  - Always define interface contracts explicitly in the task prompt when dispatching parallel agents to the same file area. Naming collisions are the #1 cause of merge conflicts in parallel work.
  - The `## Loop Guard Handling` section text must be **byte-identical** across all subagents — verified by SHA256 after the edit. One canonical text, never paraphrased.
  - When writing spec sections, run a self-audit pass after each changelog: check that no test bullet contradicts any lifecycle claim. The v0.3 → v0.3.1 fix was an internal contradiction between §4.5.1 and §12.1 — caught only because Tyr explicitly flagged it.

### 2026-06-17: Template system verification + spawnSync bugfix + test coverage
- **Context**: Wire template system (plan-templates.mjs) into plan.mjs with --template flag and templates subcommand
- **Lesson**: The wiring was already fully implemented — all imports, flag parsing, case handling, and help text were present. Only real fix was a pre-existing bug: `spawnSync` was used in `openBrowser()` but only `spawn` was imported from `child_process`.
- **Pattern**: Always verify the codebase state against task instructions before making changes — the spec may describe already-implemented features. Look for actual bugs (like missing imports) rather than assuming everything needs to be built from scratch.
- **Files**: cli/plan.mjs, cli/plan.test.mjs
- **Agent**: heimdall

### 2026-06-18: SECURITY INCIDENT — Hindsight bearer token leaked

**Context**: A Hindsight API bearer token was committed to `config/opencode.json` on Jun 16 (commit `f167aec`) and shipped in npm versions 1.0.0, 1.1.0, 1.2.0, 1.2.1, 1.2.2, and 2.0.0. Detected during a v2.1.0 audit on Jun 18. Fixed in commit `6fe76df` (replaced with placeholder).

**Timeline**:
- Jun 16 20:58 — token introduced in commit `f167aec`
- Jun 17 23:19 — npm v2.0.0 published with token
- Jun 18 00:03 — token replaced with placeholder in commit `6fe76df`
- Jun 18 ~00:30 — npm v2.1.0 published with placeholder
- Jun 18 — incident response: npm deprecate, BFG history scrub, gitignore + pre-commit hook

**Lessons learned**:
- **Audit files before pushing them.** The token was in `config/opencode.json` since v1.2.1; multiple audit passes during v2.0.0 development should have caught this BEFORE pushing to GitHub and npm. They didn't.
- **Never commit tokens to a repo, even private ones.** Tokens belong in environment variables or gitignored local files. The "private repo is safe" assumption failed here — even a private repo's history is a leak surface.
- **Add `.gitignore` BEFORE the first commit, not after.** The fix should be: `config/opencode.json` was never tracked.
- **Pre-commit hooks catch what humans miss.** A token-scanning pre-commit hook would have blocked the original commit.
- **Audit responses must include git history cleanup**, not just file fixes. The file fix doesn't remove the token from history.
- **npm deprecate is not enough** — old tarballs remain downloadable. The token must be REVOKED at the provider regardless.

**Pattern to follow next time**:
- All config files that may contain environment-specific values go in `.gitignore` from day 1
- A token-scanning pre-commit hook is mandatory for any project that handles credentials
- During release audits, explicitly grep for `Bearer [A-Za-z0-9+/=]{20,}` in every config file
- If a leak is found post-push, the response is: revoke + deprecate + scrub history + add preventive measures

**Files changed in response**:
- `config/opencode.json` — removed from tracking (replaced with `config/opencode.json.template`)
- `.gitignore` — added `config/opencode.json`
- `scripts/git-hooks/pre-commit` — new hook that scans staged changes for secrets
- `scripts/install-hooks.sh` — new script to install the hook per-clone
- npm: deprecated versions 1.0.0–2.0.0 with security warning
- git history: BFG scrub removed the token from all 56 commits that contained it

**Agent(s) used**: heimdall

### 2026-06-18: Added 3 C++ skills to BizarHarness (cpp-coding-standards, cpp-testing, embedded-esp-idf)
- **Context**: User asked to fill gaps in the opencode skills bundle and then ship them in BizarHarness. Authored 3 skills in `~/.opencode/skills/`, copied them to `BizarHarness/config/skills/`, wired the installer, and forward-tested on `feature_flags.cpp` in `/projects/ams7_esp32/`.
- **Lesson**: Forward-testing is non-negotiable for non-trivial skills. The first pass of `$embedded-esp-idf` buried NVS and logging under FreeRTOS and IRAM, which the forward test immediately flagged as wrong-priority for review tasks. A 1-line task-to-reference index in the Resources section fixes this without restructuring SKILL.md.
- **Pattern**: For any new skill with 5+ references, add a task-to-reference table near the Resources section. Tests showed agents waste context loading the wrong reference (~5KB each) when no index exists.
- **Files**: `BizarHarness/config/skills/{cpp-coding-standards,cpp-testing,embedded-esp-idf}/`, `cli/prompts.mjs`, `cli/install.mjs`, `install.sh`, `wiki/Getting-Started.md`, `wiki/Installation.md`, `.bizar/PROJECT.md`
- **Agent(s) used**: odin (decompose), heimdall (CLI + wiki + PROJECT.md wiring), thor (forward-test on AMS7 feature_flags.cpp), tyr (skill authoring)
- **Details**:
  - `cpp-coding-standards` (631 lines SKILL.md, 5 references) — universal C++17/20 RAII/memory-safety/modern-idioms/concurrency/review-checklist. Trigger on writing/reviewing/refactoring C++.
  - `cpp-testing` (303 lines, 5 references) — GoogleTest/Catch2/doctest selection, host-test pattern for embedded firmware (mirrors AMS7's `tests/<area>/run_*.sh` shell wrappers), mocking (abstract interface + link-time seam + `std::function` injection), TDD, 80% coverage gate.
  - `embedded-esp-idf` (421 lines, 7 references + 2 scripts) — ESP-IDF v5.x C++ patterns with AMS7 extensions tagged `(AMS7)`. Includes `scripts/idf_env.sh` and `scripts/size_check.sh`. Trigger on idf.py, FreeRTOS, IRAM/DRAM/PSRAM, packed structs, NVS, BLE/ESP-NOW, Kconfig, host tests.
  - Forward-test on `/projects/ams7_esp32/main/runtime/feature_flags.cpp` found 9 real issues: VLA in `Configuration::GetString` (gcc extension), virtual destructor with no base class, unused `<fstream>`/`<list>` headers, hardcoded `"DEBUG"` log tag, missing `const` on query functions, swallowed `nvs_set_*` errors, `nvs_flash_init()` called on every operation, fragile `FeatureFlag::Count`-sized array, and a missing test file.
  - Skills improved post-test: added `references/nvs.md` to embedded-esp-idf (NVS init anti-patterns, error handling, AMS7 `"ams7cfg"` namespace); added task-to-reference index; added 2 quick-start checklist items to cpp-coding-standards (virtual destructor without base, unused standard-library headers).
  - BizarHarness installer now exposes all 3 as opt-in components (`skill-cpp-std`, `skill-cpp-test`, `skill-esp-idf`) plus the new `install.sh` skills loop that copies all 5 bundled skills to `~/.opencode/skills/`. `install.sh` previously did NOT copy any skills — this was a gap-fill.

### 2026-06-21: API auth + api.mjs split (v3.6.0)
- **Context**: Addressed two deferred audit items for `@polderlabs/bizar-dash`: (1) bearer-token auth on the dashboard API + secure defaults (localhost bind), and (2) split the 2,395-line `api.mjs` monolith into per-domain router modules under `src/server/routes/`.
- **Files added**: `src/server/auth.mjs` (224 lines — token mgmt, middleware, WS upgrade check, timing-safe compare), `src/server/routes/_shared.mjs` (228 — settings/JSON helpers + `wrap` factory), 20 domain routers under `routes/` (tasks 467, chat 463, plans 241, activity 232, overview 87, etc.), plus `routes/auth.mjs` for the auth/status/reveal/regenerate endpoints.
- **Files rewritten**: `src/server/api.mjs` 2,395 → 112 lines (composer only).
- **Files modified**: `src/server/server.mjs` (noServer WS mode + upgrade-time auth check), `src/cli.mjs` (BIZAR_DASHBOARD_BIND), `src/web/lib/api.ts` (Bearer header), `src/web/lib/ws.ts` (token query param), `src/web/views/Overview.tsx` (EventSource token), `src/web/views/Settings.tsx` (Auth card with Copy/Regenerate).
- **Patterns worth keeping**:
  - **Lazy imports of large stores** — `background-store`, `activity-log`, `task-delegator` are imported inside route handlers (`await import('../...')`) so this module loads even when those subsystems are offline. Cuts the boot path and avoids forcing every router's transitive deps to be resolved.
  - **Always use `.projects` off `projectsStore.list()`** — it returns `{projects, active}`, not a bare array. The original api.mjs had a latent bug in `/api/history` (line 1202) where it iterated the wrapper object directly; fixed while splitting.
  - **Express ordering — declare literal paths BEFORE `:id` siblings** — `/tasks/bulk` and `/tasks/submit` must come before `/tasks/:id`, `/agents/stuck` and `/agents/hierarchy` before `/agents/:name`, `/mods/views` before `/mods/:id`. Each routes file's header documents which constraints it preserves.
  - **Token timing-safe compare** — `auth.mjs` XORs over `Math.max(a.length, b.length)` so runtime depends only on the expected token's length, not the attacker's candidate. Avoids byte-by-byte timing leaks.
  - **NoServer WS mode for auth** — switched `WebSocketServer({server, path:'/ws'})` to `{noServer: true}` so we can `server.on('upgrade')` ourselves and 401 before `wss.handleUpgrade`.
- **Caveats**:
  - The pre-existing broken `package.json` files (both root and `bizar-dash/`) had `... (30 lines truncated)` literal text instead of valid JSON. Fixed both as a side-effect of needing `npm run build` to work for verification. The fix preserves all listed deps and adds `typescript` + `vite` devDeps that were already installed in `node_modules/`.
  - `BIZAR_DASHBOARD_BIND=0.0.0.0` does NOT skip auth — the token gates even when the operator opts into remote exposure. This is intentional (the auth is the only thing keeping tailnet neighbors out).
  - The dashboard's `/api/auth/status` is unauthed and returns `{required: true}` — it does NOT include the token. The token is only retrievable via `/api/auth/reveal` which itself requires the token (chicken-and-egg by design; first-boot token comes from server stderr).
- **Smoke results**: 8/8 auth scenarios pass (unauthed 401, header 200, query 200, wrong 401, status 200, reveal 200, regenerate → old invalidated / new works, file mode 0600). WS auth (with/without token, bad token) all correct. SSE auth (header + query) both 200. All 36 GET endpoints return 200 (one was 500 on /api/history pre-fix — now 200).
- **Agent(s) used**: tyr (planning + implementation), heimdall (suggested).

### 2026-06-22 — Parallel-agent git conflict fix

- **Context:** User reported two parallel agents colliding on git operations in the same project. The harness had no mechanism to inform a subagent that sibling agents were running concurrently. Subagents shared the working directory and `.git/` directory and could (and did) race on `.git/index.lock`, branch contention, and silent file overwrites.

- **Root cause:** Odin's system prompt told it to dispatch 2+ agents in parallel via `task` calls but did not require it to inform each subagent about its siblings. Subagent prompts contained no parallel-awareness language. The shared `AGENTS.md` baseline had no universal parallel rules. No git worktree isolation exists (OpenCode upstream support not yet available).

- **Fix (prompt-level only — no infrastructure changes):**
  - Added "Parallel Dispatch Coordination" to both copies of `odin.md`: pre-dispatch checklist, sibling-awareness block template with placeholders, sequential fallback for monolithic tasks.
  - Added "Parallel Execution Awareness" to `config/AGENTS.md`: universal rules for all agents (file scope is sacred, no write-level git except Hermod, `.git/index.lock` discipline, lockfile handling).
  - Added role-specific "Parallel Execution" sections to all 8 bash-enabled subagents: standard section for Thor/Tyr/Heimdall/Mimir/Vidarr/Baldr, "Multi-Agent Integration" for Hermod, audit-only for Forseti.

- **Pattern for next time:** When the orchestrator dispatches parallel agents, it MUST prepend a `## PARALLEL EXECUTION CONTEXT` block listing siblings + file scopes + git rules. Subagents MUST treat the file scope as a hard boundary. Only Hermod performs write-level git. If a task cannot be decomposed into disjoint file scopes, do not parallelize — dispatch sequentially.

- **Files changed:**
  - `~/.config/opencode/agents/odin.md` (runtime)
  - `config/agents/odin.md` (source)
  - `config/AGENTS.md` (shared baseline)
  - `~/.config/opencode/agents/{thor,tyr,heimdall,mimir,vidarr,baldr,forseti,hermod}.md` (runtime, 8 files)
  - `config/agents/{thor,tyr,heimdall,mimir,vidarr,baldr,forseti,hermod}.md` (source, 8 files)

- **Agents used:** @mimir (audit + research), @thor (Odin + shared baseline), @tyr (subagent prompts), @heimdall (verification + self-improvement).

- **Follow-ups:**
  - Pre-existing drift between runtime and source agent files (different model identifiers, permission lists) — out of scope for this fix but worth a future `bizar install` review.
  - Heimdall may need an explicit exception for writing to `.bizar/AGENTS_SELF_IMPROVEMENT.md` when dispatched in parallel — currently the "scope is sacred" rule could conflict.
  - OpenCode upstream `isolation: worktree` support (PR #21680) is the long-term fix; this prompt-level discipline is the bridge.

### 2026-06-22 — graphify per-project knowledge graph integration

**Context:** User asked to integrate https://github.com/safishamsi/graphify into the Bizar harness with per-project graphs, and to extend `/init` to include everything needed.

**What landed:**
- New `cli/graph.mjs` (330 lines) — `bizar graph` subcommand: build/update/query/path/explain/watch/status/install. Routes graphify output to `.bizar/graph/` via `GRAPHIFY_OUT` env var.
- New `cli/graph.test.mjs` (188 lines) — 11 Node `node:test` cases covering `findPython()`, `parseGraphStats()`, `showGraphHelp()`, and the `GRAPH_DIR` constant.
- `cli/bin.mjs` updated — `graph` wired into dispatcher, `showGraphHelp()` added, top-level help updated, `showInitHelp()` updated to mention graph.
- `cli/init.mjs` updated — soft graph step at lines 153-186 runs after `.bizar/PROJECT.md` is written. Detects graphify, builds the graph, fails open with clear retry instructions if graphify is missing or build fails.
- `config/commands/init.md` rewritten — teaches heimdall the new flow: detect stack → install skills → write `.bizar/PROJECT.md` → write `AGENTS_SELF_IMPROVEMENT.md` → build graph → verify with `bizar graph status`.

**Pattern for next time:** When integrating a Python tool into a Node.js harness, the natural seam is a thin CLI wrapper module (`cli/<tool>.mjs`) that uses `child_process.spawnSync` to shell out, sets relevant env vars, and exports JS helpers for testability. Detect the tool's runtime at command entry, fail open with actionable install instructions, never block init on optional integrations. Route tool output to `.bizar/<tool>/` to mirror the project's existing git-trackable convention.

**Files changed:**
- `cli/graph.mjs` (new)
- `cli/graph.test.mjs` (new)
- `cli/bin.mjs` (modified, +~25 lines)
- `cli/init.mjs` (modified, +35 lines)
- `config/commands/init.md` (rewritten, 1→23 lines)

**Agents used:** @mimir (research), @thor (graph.mjs + tests + bin.mjs + showInitHelp follow-up), @tyr (init.mjs + commands/init.md), @heimdall (this entry).

**Follow-ups:**
- `bizar init` shells out to `npx bizar graph build` which requires either a global `@polderlabs/bizar` install or `node_modules/.bin/bizar`. The robust fallback is `node <repo>/cli/bin.mjs graph build`. If this proves flaky in real use, swap the spawn call.
- graphify is per-project by default but supports a global cross-project graph (`graphify global add <tag>`). A future enhancement could add `bizar graph global` to manage this from the harness.
- The OpenCode skill/plugin auto-install via `graphify install --platform opencode --project` is exposed through `bizar graph install` but not yet wired into `bizar init`. Consider adding it as a follow-up so init drops the OpenCode skill alongside building the graph.

### 2026-06-23 — Concise thinking rule + MiniMax interleaved fix

**Context:** User reported two issues: (1) agents ramble for 15+ minutes with informal self-talk ("oh but what if", "actually this is better"), (2) thinking output shows up as raw `<thinking>...</thinking>` text instead of native thinking blocks in opencode, mostly when using MiniMax via openrouter.

**Root causes:**
- (1) Agent .md files described themselves as "reasoning engines" with no concision constraints. Combined with `variant: "high"` + `reasoning: true` on the model, thinking was unbounded.
- (2) opencode's `interleaved` provider config was missing. Without it, opencode does not extract thinking from MiniMax's `reasoning_details` field on openrouter, so the raw tokens leak into the visible response.

**Files changed:**
- `config/rules/thinking.md` (NEW, 56 lines) — concise thinking rule with hard bans on informal self-talk, 80-word cap, one-shot decision pattern, BAD/GOOD examples
- `config/AGENTS.md` — added thinking rule to the rule files table + new "Thinking Rule" subsection
- `config/agents/*.md` (12 files) — added "## Thinking style" section that references the new rule
- `config/opencode.json.template` — added `provider.minimax.models` and `provider.openrouter.models` blocks with `interleaved: { field: "reasoning_details" }` and `reasoning: true` for MiniMax-M3, MiniMax-M2.7, minimax-m3, minimax-m2.7, owl-alpha (live `config/opencode.json` is gitignored — regenerated by `install.sh` on next run)
- `install.sh` — added post-install warning about lowering `variant: "high"` on odin/tyr/forseti

**Agents used:** Thor (concise thinking rules) + Tyr (provider config)

**Lessons learned:**
- When a model has `reasoning: true` and `variant: "high"`, the prompt must explicitly cap thinking length and ban informal phrases — otherwise the model interprets "be a reasoning engine" as license to ramble.
- opencode's `interleaved` field is required for any model that streams thinking in a non-standard field (MiniMax uses `reasoning_details`, DeepSeek uses `reasoning_content`). Without it, the raw tokens leak into output.
- The project's `minimax/MiniMax-M3` model ID format differs from the user's actual `openrouter/minimax-m3` setup. Provider config must cover BOTH to work for fresh installs and existing user setups.

**Pattern to follow next time:**
- Every agent .md file should reference `config/rules/thinking.md` in a "## Thinking style" section, not duplicate the rule text.
- When adding a new model to `config/opencode.json.template`, also add it to `provider.<providerID>.models` with the correct `interleaved` field for that model's thinking stream.
- Use `interleaved: { field: "reasoning_details" }` for MiniMax models on openrouter.
- Install script should warn about `variant: "high"` being a verbosity multiplier.

### 2026-06-23 — CLI consolidation: eliminate `bizar-dash` binary

**Context:** User reported that having two separate CLIs (`bizar` and `bizar-dash`) was confusing. User asked: "overhaul and make the bizar cli commands consistent so no separate bizar-dash commands. make everything 'bizar' with options".

**Root cause:** The dashboard was a separate npm package (`@polderlabs/bizar-dash`) with its own binary. Dashboard commands were reachable under 3 different paths (`bizar dashboard X`, `bizar X`, `bizar-dash X`), and `bizar` with no args would launch the TUI.

**Files changed:**
- `bizar-dash/src/cli.mjs` — refactored to export functions (start, stop, status, tui) with `isMainEntry()` guard so signal handlers only register when run as a CLI
- `bizar-dash/package.json` — added `"exports": { "./dash-cli": "./src/cli.mjs" }`, removed `bin` field
- `cli/bin.mjs` — added `bizar dash <subcommand>` dispatch with in-process import
- `cli/update.mjs` — updated user-facing strings (e.g., "bizar dash start --bg")
- `cli/install.mjs` — updated install prompts
- `cli/copy.mjs` — references updated
- `plugins/bizar/src/commands-impl.ts` — spawn uses `bizar dash start`
- `plugins/bizar/src/commands.ts` — doc comments updated
- `README.md`, `CHANGELOG.md`, `config/AGENTS.md`, `config/commands/bizar.md` — updated command examples

**Breaking changes (v3.10.0):**
- `bizar-dash` binary REMOVED (clean up: `rm $(which bizar-dash)`)
- `bizar start`, `bizar stop`, `bizar status` REMOVED (use `bizar dash X`)
- `bizar --bg`, `--web`, etc. REMOVED (use `bizar dash start --bg`)
- `bizar` (no args) no longer launches TUI (shows help)
- `bizar dashboard X` and `bizar tui` still work (deprecated, with warning)

**Lessons learned:**
- When in-process imports happen, signal handlers must be gated by `isMainEntry()` checks — otherwise they affect the parent process.
- npm package `exports` map is the right way to expose library subpaths; bare subpath imports are fragile.
- Backward compat via deprecation warnings is a smoother migration than hard removal.
- When delegating a refactor to a subagent, verify file changes persisted BEFORE proceeding — the previous Tyr task claimed a write that didn't take effect.

**Pattern to follow next time:**
- New dashboard-related subcommands go under `bizar dash X`, not as top-level `bizar` commands
- The dashboard npm package (`@polderlabs/bizar-dash`) is a LIBRARY, not a CLI. It has no `bin` field.
- The single `bizar` binary is the only user-facing entry point.

### 2026-06-23 — Interactive file browser + dashboard.projectsDirectory setting

- **Context**: User wanted two dashboard UX improvements: (1) replace the manual path text input in the Add project dialog with an interactive file browser, and (2) add a `dashboard.projectsDirectory` setting that becomes the default new-project location and is auto-scanned on server startup.

- **Approach**: Two parallel implementation streams → test gate → commit. @tyr (M3) built the backend (filesystem listing endpoint, scan logic, `resolveSafePath` security helpers, server startup integration). @thor (M2.7) built the frontend (FileBrowser component, modal replacement, Topbar fix for `prompt()`/`alert()` removal, Settings UI field, types updates). @thor also ran the test gate (typecheck + vite build + node --check + integration sanity) — all clean. @hermod handled the commit/push.

- **Files changed**:
  - New: `bizar-dash/src/server/lib/path-safe.mjs` (128 lines), `bizar-dash/src/server/routes/fs.mjs` (190 lines), `bizar-dash/src/web/components/FileBrowser.tsx` (493 lines)
  - Modified (12): `_shared.mjs`, `api.mjs`, `server.mjs`, `projects.mjs`, `projects-store.mjs`, `App.tsx`, `Topbar.tsx`, `Overview.tsx`, `Settings.tsx`, `types.ts`, `main.css`, `CHANGELOG.md`
  - Net: +833/−53

- **Agents used**: @tyr (M3, backend), @thor (M2.7, frontend + test gate), @hermod (commit/push)

- **Lessons learned**:
  - The `api.get/post` wrapper auto-prefixes `/api`, so frontend routes must omit the prefix. The test gate's sanity check caught this implicitly, but a comment in `api.ts` documenting the convention would prevent future agents from writing double-prefixed routes.
  - The shared types file (`types.ts`) was the contract between parallel agents. @thor owned it as the API consumer; @tyr read it as the API provider. Keeping it single-owner prevented drift.
  - Filesystem-listing endpoints that serve directory contents MUST enforce a segment-aware allow-list, not just `path.resolve()` against a fixed root. The `resolveSafePath` helper in `lib/path-safe.mjs` matches absolute paths segment-by-segment against the allowed root and rejects first-level dotdirs. Without this, a directory traversal bug in a read endpoint exposes the entire filesystem.
  - LRU caching the filesystem listing responses (200 entries, 5-min TTL, drop-oldest-50 eviction) makes back-navigation through the browser instant without unbounded memory growth.

- **Pattern to follow next time**: For multi-layer features (UI + backend + settings), split by layer — Thor owns the frontend (React components + CSS + types), Tyr owns the backend (Express routes + security + startup wiring). The types file belongs to the frontend agent (the consumer). Test gate always goes to a third run or back to Thor — never self-verified.

### 2026-06-23 — Background agent dispatch fix (3-root-cause)

- **Context**: User reported 7 background instances in their "home folder project" (the active project at `/home/drb0rk`) stuck in `dispatchPending: true` with no tmux session. Instances had been stuck for 4+ days. User asked to investigate and fix.

- **Approach**: @mimir researched the background agent + tmux + activities architecture; identified the queue gap at `task-delegator.mjs:532-546` and the serve-reachable guard at line 563. @heimdall confirmed environment state (tmux 3.6b installed, 2 running sessions — neither bg-related, dashboard on port 45451 returning 401, 6 stale E2E fixture bg files from Jun 19 + 1 bgr file from today's vLLM task all with `dispatchPending: true`). @tyr (M3) built the fix: relaxed serve-info schema, TCP-based health probe, logPath repair, new bg-retry.mjs retry loop, new retry endpoint, task-delegator worktree fallback, smoke tests. @thor (M2.7) ran the test gate: 0 TS errors, clean Vite build, 10/10 `node --check`, 8/8 smoke tests, plus a live E2E against the user's actual `serve.json` confirming `readServeInfo()` returns valid ServeInfo and `pingOpencodeServe` true on port 45451. @hermod committed as v3.11.0.

- **Root causes** (all three contributed to the same failure):
  1. **Strict serve-info schema** — `readServeInfo()` required 6 fields (`baseUrl`, `port`, `password`, `worktree`, `pid`, `startedAt`) but the user's `serve.json` only had 3 (`password`, `pid`, `port`). Returned `null`, which cascaded into the dispatch path's `if (serveInfo && serveReachable)` guard short-circuiting. Every new bg instance was marked `dispatchPending: true` forever.
  2. **Auth-dependent health probe** — `pingOpencodeServe()` did `HTTP GET /health` with Basic auth. Even after fixing the schema, the probe would have returned 401 in many configurations.
  3. **Broken logPath** — `path.join(worktree, '.opencode', 'log', id)` with empty `worktree` produced `//.opencode/log/...` (double slash, missing homedir).

- **Fix**: Relaxed `serve-info.mjs` schema — `readServeInfo()` now requires only `password` (string) + `port` (number); derives `baseUrl` from port when missing; defaults `worktree` and `startedAt` to empty/zero when missing. Replaced HTTP probe with TCP-connect via `net.createConnection` (1.5s timeout) — no auth dependency, no false negatives. New `deriveAbsoluteBgLogPath()` always returns an absolute path with sensible fallback to `~/.cache/bizar/logs/`. New `bg-retry.mjs` (569 lines) — periodic 30s retry loop that walks `~/.cache/bizar/bg/`, finds stuck instances, repairs broken logPath atomically, re-issues the dispatch. First tick fires on `setImmediate` so existing stuck instances recover immediately on next dashboard boot. Caps at `MAX_DISPATCH_RETRIES=10`. New `POST /api/background/:id/retry` endpoint for manual unstick. `task-delegator.mjs` falls back to `projectRoot` when `serveInfo.worktree` is empty.

- **Files changed**: 18 modified, 2 new (`bg-retry.mjs` + `scripts/smoke-bg-retry.mjs`). +1284 / −139.

- **Agents used**: @mimir (research), @heimdall (environment check), @tyr (M3, fix), @thor (M2.7, test gate + live E2E), @hermod (commit).

- **Lessons learned**:
  - **External state files need defensive schemas.** Files written by sibling processes (opencode plugin → `serve.json`) evolve independently. Strict schemas create silent failures. Always require only what you need, derive the rest.
  - **Health probes must not depend on auth.** Use `net.createConnection` for "is this process alive?" — not an authenticated HTTP GET. Auth-gated endpoints can return 401 even when the service is healthy.
  - **State machines need a recovery story, not just a happy path.** The Jun 19 E2E test fixtures were the canary — 6 instances in `dispatchPending: true` for 4+ days told us no one was watching this transition. Recovery mechanisms belong in the same PR as the state machine, not as a follow-up.
  - **Log every transition failure with enough context to diagnose from the file alone.** The user had no way to know WHY their instances were stuck. The bg file just said `dispatchPending: true` — no error, no log line, no broadcast. The new retry loop logs every attempt with instance id, retry count, and failure reason.
  - **Live E2E testing against the user's actual state catches what typecheck + build + unit tests cannot.** Thor's test gate ran `readServeInfo()` against the user's actual 99-byte `serve.json` — that's the only way to catch "the strict schema doesn't match the real world." Unit tests with a different-shaped fixture would have passed.

- **Pattern to follow next time**: For state-machine bugs, the test gate MUST include a live E2E against the user's actual data files, not just unit tests with synthetic fixtures. The user's `serve.json` had 3 fields, our schema expected 6. The unit test used 6 fields so the bug would have shipped. The live E2E caught it in 5 seconds. Also: commit each turn before starting the next — Odin had uncommitted v3.11.0 follow-up work when the user reported this bug, and two turns landed in one commit.

### 2026-06-24b: Full real-life simulation in BizarHarness-dev Docker container
- **Task**: Run full install → update → use → integration test of the v0.7.0-alpha.1 refactor inside the bizarharness-dev Docker sandbox. Fix any issues found.
- **Files changed**: 7 files (bizar-dash/{cli.mjs, server.mjs, v2-auth-file.mjs, routes-v2/index.mjs}; plugins/bizar/{index.ts, src/event-stream.ts}; scripts/bizar-sim.sh)
- **Agents used**: Direct execution (Odin) — Tyr/Thor task-tool routing still broken this session
- **Approach**: Single bash script in the container: install bizar to user prefix, copy plugin source, npm install plugin deps, start dashboard from LOCAL source (npm v3.11.0 lacks v2 routes), curl v2 routes, subscribe SSE, run opencode, run all test suites. Iteration: fixed three real bugs discovered during the simulation (route order, auth-file port, CLI arg parsing).
- **Test results in container**: 157 tests green (28 SDK vitest + 6 plugin dashboard-client bun + 7 dashboard smoke + 116 existing plugin tests). Zero regressions.
- **Critical bugs found and fixed**:
  1. **Route order** — `/api/v2` mounted after `/api/apiRouter` was swallowed by apiRouter's internal 404 catch-all (api.mjs:109). Fix: mount v2 BEFORE apiRouter.
  2. **Auth-file port drift** — dashboard's auth file persisted `port: 0` from a previous run because my `loadOrCreateAuth` was reading `parsed.port` instead of using the current `port` arg. Fix: always use current port, rewrite file when persisted differs.
  3. **CLI arg parsing** — `dashboard dash start --port 4098` silently ignored `--port`. Fix: parse `--port` and `--bind` in cli.mjs `main()`.
- **Pre-existing bug fixed (not from my refactor)**: plugin's `event` hook assumed `event.sessionID` was top-level but opencode's events have `sessionID` inside `properties.sessionID`. Result: hook returned early for every event. Fixed in plugins/bizar/index.ts.
- **Opencode `run` mode doesn't emit lifecycle events** — `event` hook only fires for long-running TUI/server sessions. The simulation's `opencode run <prompt>` is too short-lived. The v2 protocol itself verified end-to-end via the SDK smoke test (which POSTs to `/api/v2/event` and the SSE subscriber receives it).
- **Lessons learned**:
  - **Add request-log middleware to HTTP servers during integration testing.** A one-line `console.log(\`[v2-req] ${req.method} ${req.originalUrl}\`)` middleware is the fastest way to confirm "is the client even reaching us?" Static startup logs don't show mid-run traffic.
  - **Dev container has stale opencode.json model names** (`openrouter/minimax/minimax-m3` doesn't exist in opencode-ai 1.17.7). Use `--model opencode/deepseek-v4-flash-free` for the free tier. The model's actual ID was `MiniMax-M3` per opencode's suggestion, but that was a non-existent model in this container.
  - **`npm install -g` fails with EACCES in dev containers** where the Dockerfile installs packages as root but the runtime user is `dev`. Workaround: `npm install -g --prefix=~/.local`. The `~/.local/bin` is then in PATH.
  - **Cache volumes in dev containers persist auth files across runs** — `bizarharness-dev-cache:/home/dev/.cache` keeps stale `dash-auth.json` with `port: 0` from a previous run. Always delete or rewrite.
- **Pattern to follow next time**: For any HTTP+SSE refactor, the simulation harness (scripts/bizar-sim.sh) is the right shape:
  1. Install everything in a fresh container run (each `docker compose run --rm` is ephemeral)
  2. Use `--prefix=~/.local` for npm installs to avoid EACCES
  3. Run dashboard from LOCAL source (npm-published may be older than working tree)
  4. Add request-log middleware to BOTH ends (client SDK logs + server route logs)
  5. Run an SDK smoke test (publishes + subscribes via curl) BEFORE testing organic opencode events — confirms the protocol works independently of opencode lifecycle timing
  6. Then test organic events with a real opencode session
  7. Commit each fix as you discover it (otherwise you lose track of which fix solved which issue)

### 2026-06-24: Plugin↔Dashboard v2 Protocol — HTTP+SSE via @polderlabs/bizar-sdk
- **Task**: Rebuild plugin↔dashboard communication per three target sources (zenobi-us/bun-module, opencode SDK, opencode server). Full implementation + tests + iterations + push + publish. Tyr/Thor task-tool routing was broken this session, so Odin executed end-to-end directly.
- **Files changed**: 42 files, +5300 lines (new: `packages/sdk/*`, `bizar-dash/src/server/routes-v2/*`, `bizar-dash/src/server/v2-*`, `.bizar/research/*`, plugin dashboard-client + tests; modified: CHANGELOG, root + plugin package.json, dashboard server.mjs)
- **Scope change**: Initial draft was `@bizarharness/sdk`. User corrected to `@polderlabs/bizar-sdk` to match the existing `@polderlabs/{bizar,bizar-dash,bizar-plugin}` naming. Renamed across all files and re-ran all tests.
- **Agents used**: Direct execution (Odin), research by @mimir + @vor + @general
- **Approach**: 5-phase: research (parallel @mimir) → plan (synthesized by Odin after Tyr background was killed per user request) → SDK foundation → dashboard v2 routes → plugin client. Each phase ended with a test gate.
- **Test results**: 41 new tests, all passing. Zero regressions.
  - SDK: 28/28 vitest pass + typecheck + build + pack dry-run
  - Dashboard v2: 7/7 smoke pass
  - Plugin dashboard-client: 6/6 bun pass
  - Existing plugin tests: 152 pass (verified same as baseline by stashing my changes)
- **Lessons learned**:
  - **HTTP 204/205/304 responses MUST NOT have a body** — Node 24 strictly enforces this per the Fetch spec. `new Response("", { status: 204 })` throws. Use `new Response(null, { status: 204 })`. Without this fix, every SDK test calling a 204 endpoint hit a confusing "ConnectionError" via the catch block. **Mock fixtures must mirror real fetch spec semantics or you debug for 30 minutes wondering why the request path isn't even reached.**
  - **Vitest captures `console.error` in stderr** — debug logging inside the SDK didn't surface in test output. Workaround: write to a file. Better: use `--silent=false` or a debug logger injected via the test.
  - **`bun test tests/foo.test.ts` treats the path as a name filter** — must use `./tests/foo.test.ts` (or run from the dir) to ensure it's treated as a path. Adds 5 minutes of confusion otherwise.
  - **Path resolution under routes-v2/ is fragile** — `__dirname/../../..` from `src/server/routes-v2/` gives `bizar-dash/`, then `..` (one up) gives the repo root, NOT `..` twice. Always enumerate candidate paths explicitly rather than computing "the right number of `..`". Search paths made the smoke test pass on the first try after the bug.
  - **Background agents and direct execution are NOT mutually exclusive on infrastructure failure** — when task-tool subagent routing silently fails (Tyr/Thor's OpenRouter routing was 500ing), the user said "continue" which meant: take it yourself. Odin can execute end-to-end with `read/write/edit/bash` when the agent tier is unavailable, but loses the parallel-dispatch advantage.
  - **Opencode v1 session routes are broken upstream** (`/session`, `/session/{id}/prompt_async` etc. all hang indefinitely per `.bizar/opencode-sse-investigation.md`) — the plugin's v0.4.1 background-agent spec calls them. Pinning to v2 (`/api/session/*`) is mandatory. The plugin refactor for this is still pending (deferred to v0.8.0).
- **Pattern to follow next time**:
  1. When `task` tool fails for tier-3/tier-4 agents, **verify** with a minimal prompt first (`task thor "say hi"`) before assuming the issue is prompt-size. If minimal works, escalate to larger prompts via background agents (`bizar_spawn_background`).
  2. For every SDK design, **smoke-test the 204 path explicitly** in the first test pass. Fetch spec gotchas (no body for 204/205/304) only surface at runtime.
  3. When refactoring an existing communication protocol, **leave the old bridge in place for one full release cycle**. The new SDK-backed bridge is additive; consumers (TUI, hooks) migrate in follow-up PRs. The file-based `serve.json` bridge stays.
  4. **Persist test outputs to /tmp** when vitest eats stderr — saves 5+ minutes of debug confusion.
  5. **Smoke tests that spin up real HTTP servers** catch integration issues (path resolution, header handling, error mapping) that unit tests with mocks miss. Always include at least one end-to-end smoke alongside unit tests for any HTTP/SSE code.
