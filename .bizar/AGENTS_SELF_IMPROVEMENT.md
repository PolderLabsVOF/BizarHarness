# Self Improvement

Project-level agent learning. Entries are auto-appended by Odin at task completion and read at session start.

## Active Rules
1. **Per-project Hindsight banks** — every project gets its own bank; default is for general/system knowledge only
2. **Session start bank check** — always call `hindsight_list_banks` to discover and set the correct bank
3. **Never use default for project work** — pass `bank_id: "<project-name>"` in all Hindsight calls
4. **Create bank if missing** — if no bank exists for a project, create it with `hindsight_create_bank`
5. **AMS Studio bank populated** — 40+ documents migrated from default to ams-studio bank

## Log

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
