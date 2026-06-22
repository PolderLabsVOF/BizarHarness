# Self Improvement

Project-level agent learning. Entries are auto-appended by Odin at task completion and read at session start.

## Active Rules
1. **Per-project Hindsight banks** — every project gets its own bank; default is for general/system knowledge only
2. **Session start bank check** — always call `hindsight_list_banks` to discover and set the correct bank
3. **Never use default for project work** — pass `bank_id: "<project-name>"` in all Hindsight calls
4. **Create bank if missing** — if no bank exists for a project, create one with `hindsight_create_bank`
5. **AMS Studio bank populated** — 40+ documents migrated from default to ams-studio bank
6. **Config files with tokens go in .gitignore from day 1** — `config/opencode.json` leaked a Hindsight bearer token for 30+ commits. Use `.template` files for reference, never commit live config. `git rm --cached <file>` to fully untrack.
7. **Pre-commit hook scans for secrets** — a token-scanning pre-commit hook (`scripts/git-hooks/pre-commit`) is mandatory for any project handling credentials. Install via `scripts/install-hooks.sh`.
8. **Release audits check for Bearer tokens** — before publishing any release, grep for `Bearer [A-Za-z0-9+/=]{20,}` in every config file.
9. **Forward-test new skills on a real task before shipping** — skills written in isolation are biased toward the author's mental model. Dispatch a fresh subagent on a real repo task, require explicit references to skill sections, and report whether the skill actually helped or was noise. The first forward-test of `$cpp-coding-standards` + `$cpp-testing` + `$embedded-esp-idf` on `feature_flags.cpp` found 9 real issues and identified 4 concrete skill improvements.
10. **Skills should expose a task-to-reference index** — when a skill has 7+ references, agents waste context loading the wrong one. A small table mapping common tasks to the single best reference is worth more than perfect section ordering in SKILL.md.
11. **Plugin command pass-through** — `plugins/bizar/src/commands.ts` `default` branch must `return null` (not `{ handled: true }`) so unknown commands fall through to other handlers (built-ins, other plugins). Returning `handled: true` swallowed every unknown command including `/explain`, `/init`, `/learn`, `/pr-review`, `/audit`.
12. **Atomic file writes for plugin files too** — `plan-fs.ts` and `serve.ts` should use temp-file-then-rename, not direct `writeFile`. Partial writes corrupt state on crash.
13. **Track plugin-owned signal handlers** — never call `process.removeAllListeners(SIGTERM|SIGINT)`; track handler refs and remove only the plugin's own.
14. **Bundled agent .md frontmatter must match `config/opencode.json`** — drift between them causes routing to silently use the wrong model (the v3.7.0 audit found 11 files with `openai/gpt-5.4` while the actual model should have been M3/M2.7/deepseek).
15. **Verify root `tsconfig.json` `include` paths** — a stale `include: ["src/**/*"]` at the monorepo root will typecheck against nothing. Either point at the actual subdirs or remove the typecheck script entirely if each subpackage has its own.
16. **Dashboard WebSocket initial snapshot must match REST snapshot** — server was sending a different shape than `/api/snapshot`; web client threw on type mismatch. Keep WS `snapshot` and HTTP `snapshot` payloads identical.
17. **Auth bypass via loopback proxy** — Express + `req.ip` trusts loopback by default; if you accept `X-Forwarded-For`, do not use `req.ip` for auth status — derive trust from the actual TCP peer (`req.socket.remoteAddress`) and only honor trusted proxies.
18. **Parallel dispatch requires sibling-awareness context** — When dispatching 2+ parallel subagents, Odin MUST prepend a `## PARALLEL EXECUTION CONTEXT` block listing siblings + disjoint file scopes + git rules. Subagents MUST treat scope as sacred and avoid all write-level git except via @hermod. If tasks cannot be decomposed into disjoint file scopes, dispatch sequentially.
19. **When integrating Python tools into Bizar's Node harness, use a thin `cli/<tool>.mjs` wrapper with `child_process.spawnSync`.** Detect the tool, fail open with install instructions, never block init. Route output to `.bizar/<tool>/` to match existing convention.

## Log

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
