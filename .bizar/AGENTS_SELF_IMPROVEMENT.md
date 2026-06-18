# Self Improvement

Project-level agent learning. Entries are auto-appended by Odin at task completion and read at session start.

## Active Rules
1. **Per-project Hindsight banks** — every project gets its own bank; default is for general/system knowledge only
2. **Session start bank check** — always call `hindsight_list_banks` to discover and set the correct bank
3. **Never use default for project work** — pass `bank_id: "<project-name>"` in all Hindsight calls
4. **Create bank if missing** — if no bank exists for a project, create it with `hindsight_create_bank`
5. **AMS Studio bank populated** — 40+ documents migrated from default to ams-studio bank
6. **Config files with tokens go in .gitignore from day 1** — `config/opencode.json` leaked a Hindsight bearer token for 30+ commits. Use `.template` files for reference, never commit live config.
7. **Pre-commit hook scans for secrets** — a token-scanning pre-commit hook (`scripts/git-hooks/pre-commit`) is mandatory for any project handling credentials. Install via `scripts/install-hooks.sh`.
8. **Release audits check for Bearer tokens** — before publishing any release, grep for `Bearer [A-Za-z0-9+/=]{20,}` in every config file.

## Log

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
