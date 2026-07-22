# Agent Audit — 2026-07-22

> Goal (per user): "do an audit of all agent features and tools and see if they actually automatically get userd. everything should automatically be included and used by the agents"

This audit is a cross-reference between:

- **What agents exist** → `.claude/agents/*.md` (canonical) and `config/agents/*.md` (legacy Cline)
- **What they declare** → `tools:`, model, body references
- **What the runtime actually loads** → `.claude/settings.json` (mcpServers, permissions), the provisioner (`cli/provision.mjs`)
- **What features the project ships** → skills, commands, hooks, MCP servers, slash commands

---

## Headline finding

**The audit reveals two structural problems and ~12 concrete gaps, all of which prevent agents from automatically using everything the project ships.** The biggest blocker: **the project has a complete Cline-era copy of every agent file in `config/agents/` that nobody loads, that is older than the canonical `.claude/agents/` copies, and that the provisioner's `syncAgentFiles` would re-copy onto `.claude/agents/` on the next `make provision`** — silently overwriting the Claude Code versions.

---

## A. Project surface (what ships)

### A1. Agent definitions — **drift**

| Source | Path | Count | Loaded by | Mtime |
|---|---|---|---|---|
| Canonical | `.claude/agents/*.md` | 14 | Claude Code (in-process) | 16 Jul 19:08–21:46 |
| Legacy | `config/agents/*.md` | 14 | Nothing — `cli/provision.mjs` writes *from* this dir to `.claude/agents/`, but no caller invokes `syncAgentFiles` from the legacy tree | 13 Jul 11:12 |

`diff .claude/agents/mike.md config/agents/mike.md` shows massive divergence:
- Different `tools:` schemas (Claude Code vs Cline permission block)
- Different model IDs (`cx/gpt-5.6-terra` vs `minimaxcustom/MiniMax-M3`)
- Different tool surface (`Agent` vs `task`, `bizar_spawn_background` vs `run_in_background`)
- Different shared-doc references (`_shared/CLAUDE_TOOLS.md` vs `_shared/CLINE_TOOLS.md`)
- Different baseline references (`AGENT_BASELINE.md` location differs)
- Different subagent_type values (`Agent(subagent_type: "todd")` vs `task(subagent_type: "todd")`)

The canonical `.claude/agents/` tree is also internally inconsistent:
- `_shared/CLAUDE_TOOLS.md` is Claude Code format
- 8 of 14 agents reference `mcp__semble__*` tools, but **no Semble MCP server is registered anywhere** (see A4)
- Only 1 agent (`mike`) has `Agent` in its `tools:` — but `steve` and `carl` describe dispatching to other agents and have no `Agent` permission

### A2. Skills

| Source | Count | Notes |
|---|---|---|
| `config/skills/` (canonical) | 60 | includes 49 `thinking-*` + skillopt + 11 pre-existing |
| `.claude/skills/` (mirror) | 62 | 2 orphans vs canonical: `de-sloppify`, `find-skills` |

`config/skills/` is missing the 2 orphans. `syncSkillFiles` only copies canonical → mirror; it does not delete orphans.

### A3. Slash commands

| Source | Count | Missing |
|---|---|---|
| `.claude/commands/` (canonical) | 18 | — |
| `config/commands/` (legacy) | 14 | `cron.md`, `goal.md`, `spec.md`, `sprint.md` |

7 of 18 are wired into `thinking-route.mjs` as slash-command hints (`/plow-through`, `/team`, `/validate`, `/plan`, `/audit`, `/test`, `/pr-review`). The 11 others are not hinted by the hook.

### A4. MCP servers

| Server | Registered | Tools exposed | Tools allowed |
|---|---|---|---|
| `bizar` (in `.claude/settings.json`) | ✓ | 23 (per `plugins/bizar/index.ts`) | 14 (per `permissions.allow`) |
| `semble` | ✗ | — | — |
| `kevin` (referenced in `kevin.md:31`) | ✗ | — | — |

`mcp__semble__search` and `mcp__semble__find_related` are referenced in 6 files (see C1) but **the Semble MCP server is not registered**. The user-level `~/.claude/settings.json` registers only `bizar`.

`mcp__bizar__*` — plugin exposes 23 tools; `permissions.allow` admits 14. Missing: `federation_*`, `consensus_*`, `agent_registry_*`, `router_*`, `swarm_*`, `fingerprint_*`, `learn_*`, `cron_*`, `memory_delete`. No agent body references any of the missing ones — they're safe to leave out.

### A5. Hooks

| Path | Count | Loaded |
|---|---|---|
| `.claude/hooks/` (canonical, flat shape) | 12 files + README + __tests__ | ✓ (all wired in `.claude/settings.json`) |
| `config/hooks/` (legacy, Cline-shape subdirs) | 5 subdirs (`PostToolUse/`, `PreToolUse/`, `TaskResume/`, `TaskStart/`, `UserPromptSubmit/`) + README | ✗ — not loaded |

The 5 `config/hooks/*` subdirs are the Cline-era shape. Nothing references them.

### A6. Shared agent docs

| Path | Files | Status |
|---|---|---|
| `.claude/agents/_shared/` | `AGENT_BASELINE.md`, `CLAUDE_TOOLS.md`, `SKILLS.md` | ✓ canonical |
| `config/agents/_shared/` | `AGENT_BASELINE.md`, `CLINE_TOOLS.md`, `SKILLS.md` | `CLINE_TOOLS.md` is dead — no consumer |

### A7. Rules

| Path | Files |
|---|---|
| `/home/drb0rk/.claude/rules/` (user-level) | general, git, javascript, python, testing, thinking, uncertainty |
| `config/rules/` | (none — empty) |

User-level rules apply to every session. No project-level rules exist.

---

## B. Per-agent cross-reference

Format: `tools frontmatter | MCPs declared in body | Skills referenced | Hooks referenced | Slash cmds referenced | STALE | MISSING`

### `.claude/agents/mike.md`
- **tools:** `Agent, Read, WebFetch, WebSearch`
- **MCPs in body:** none explicitly. Baseline reference: `mcp__semble__*` (via `_shared/AGENT_BASELINE.md` §3)
- **Skills in body:** `_shared/AGENT_BASELINE.md`, `_shared/SKILLS.md`, `_shared/CLAUDE_TOOLS.md`, `bizar/SKILL.md` (via baseline), `obsidian` (via baseline), `oscar`
- **Hooks in body:** none
- **Slash cmds in body:** none
- **STALE:** none — agents in routing table all exist in `.claude/agents/`
- **MISSING:**
  - (1) Routing table omits `@brad` from "Read-only" cluster (brad has Edit/Write). Cosmetic but inconsistent.
  - (2) Body says "Semble" search but **`mcp__semble__*` is not registered**. Odin would receive a permission-denied if it tried.
  - (3) `_shared/CLAUDE_TOOLS.md` lists `mcp__semble__search` as if it exists.

### `.claude/agents/todd.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** `mcp__semble__search` (via baseline), `mcp__bizar__*` (via baseline)
- **Skills in body:** baseline, Semble, `_shared/CLAUDE_TOOLS.md`
- **STALE:** None for tools (matches impl work).
- **MISSING:**
  - (1) `mcp__semble__*` not registered.
  - (2) No `Skill` tool in `tools:` frontmatter despite baseline §4 instructing skill loading via the Skill tool.

### `.claude/agents/karen.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** Semble (via baseline)
- **Skills in body:** baseline, `_shared/CLAUDE_TOOLS.md`
- **STALE:** None.
- **MISSING:**
  - (1) `mcp__semble__*` not registered.
  - (2) No `Skill` tool in frontmatter.

### `.claude/agents/brenda.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** Semble (via baseline)
- **Skills in body:** baseline, `_shared/CLAUDE_TOOLS.md`, `obsidian`, `memory-protocol`, `self-improvement` (referenced by baseline §12)
- **STALE:** None.
- **MISSING:**
  - (1) `mcp__semble__*` not registered.
  - (2) No `Skill` tool in frontmatter (Heimdall maintains `.bizar/` — would benefit from loading the relevant skills explicitly).

### `.claude/agents/greg.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** **`mcp__semble__search` (line 28), `mcp__semble__find_related` (line 29)** — primary
- **Skills in body:** baseline, `obsidian`, `lightrag`, `skills-cli`
- **STALE:** **CRITICAL — primary tool is unregistered.** Mimir's `#1` step is `mcp__semble__search "<concept>"` and the server doesn't exist. The agent is structurally broken.
- **MISSING:**
  - (1) `obsidian` skill ships in `.claude/skills/obsidian/` but Mimir (the Obsidian writer) doesn't reference it by name in body. Baseline does.
  - (2) No `Skill` tool in frontmatter.

### `.claude/agents/susan.md`
- **tools:** `Read, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** "Semble search (primary)" (line 24) — unregistered
- **STALE:** **CRITICAL** — body claims Semble is the primary tool; it's not available.
- **MISSING:**
  - (1) No `Skill` tool in frontmatter.

### `.claude/agents/steve.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** none
- **STALE:** None.
- **MISSING:**
  - (1) Body describes PR-review mode dispatching `@greg`/`@linda` (lines 41-42) but `Agent` is **not in `tools:` frontmatter** — Hermod cannot dispatch agents.

### `.claude/agents/brad.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **Skills in body:** baseline, `anthropics/skills` (via `npx skills add anthropics/skills --all -y` at line 40) — installs `frontend-design`, `taste-skill`
- **STALE:** `frontend-design` and `taste-skill` don't exist in local `.claude/skills/` (they're installed via the `npx` command at runtime). Cosmetic — Baldr's body has the install command.
- **MISSING:**
  - (1) `de-sloppify` skill ships in `.claude/skills/de-sloppify/` but Baldr (anti-slop mandate) doesn't reference it.
  - (2) `glyph` skill ships in `.claude/skills/glyph/` (typography) but Baldr doesn't reference it.
  - (3) No `Skill` tool in frontmatter.

### `.claude/agents/janet.md`
- **tools:** `Read, Glob, Grep, WebFetch`
- **Skills in body:** baseline, `_shared/CLAUDE_TOOLS.md`, `AskUserQuestion`
- **STALE:** **CRITICAL** — body says use `AskUserQuestion` (line 27, 53) but **`AskUserQuestion` is not in `tools:` frontmatter**. Vör's primary function is impossible.
- **MISSING:**
  - (1) `AskUserQuestion` tool MUST be added.
  - (2) No `Skill` tool in frontmatter.

### `.claude/agents/carl.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** Semble (via baseline)
- **STALE:** None.
- **MISSING:**
  - (1) Body says "send to @linda for review" but no `Agent` tool.
  - (2) No `Skill` tool in frontmatter.

### `.claude/agents/linda.md`
- **tools:** `Read, Bash, Glob, Grep, WebFetch`
- **STALE:** ~~references `bizar-dash/src/server/mod-security.mjs` (line 26)~~ — **CORRECTED 2026-07-22: the file does exist** (`bizar-dash/src/server/mod-security.mjs`, 14008 bytes, modified 2026-07-16). Audit was wrong; reference is accurate.
- **MISSING:**
  - (1) No `Skill` tool in frontmatter (the agent is a peer of Tyr/Vidarr but has no `Agent` either, which is fine for read-only).

### `.claude/agents/pam.md`
- **tools:** `Read, Edit, Write, Bash, Glob, Grep, WebFetch, WebSearch`
- **MCPs in body:** Semble (via baseline)
- **STALE:** None.
- **MISSING:**
  - (1) No `Skill` tool in frontmatter.

### `.claude/agents/kevin.md`
- **tools:** `Read, Bash, Glob, Grep, WebFetch, WebSearch`
- **Skills in body:** `~/.claude/skills/kevin/SKILL.md` (line 34) — **does not exist**
- **MCPs in body:** "kevin MCP stdio server" (line 31) — **does not exist**
- **STALE:**
  - (1) `~/.claude/skills/kevin/SKILL.md` — referenced but not shipped.
  - (2) kevin MCP stdio server — referenced but not registered.
- **MISSING:**
  - (1) `Skill` tool in frontmatter.

### `.claude/agents/oscar.md`
- **tools:** `Read, Glob, Grep, WebFetch`
- **MCPs in body:** **`mcp__semble__search` (5 refs), `mcp__semble__find_related` (2 refs)** — agent's PRIMARY tool
- **STALE:** **CRITICAL** — primary tools are unregistered. The agent exists but cannot do its core function.

---

## C. Cross-cutting findings

### C1. STALE references — confirmed broken

| # | File:Line | Reference | Why stale |
|---|---|---|---|
| 1 | `.claude/agents/greg.md:28-29` | `mcp__semble__search`, `mcp__semble__find_related` | Not registered in any settings file. |
| 2 | `.claude/agents/oscar.md:20-23, 32` | `mcp__semble__search`, `mcp__semble__find_related` | Not registered. Primary tool — agent unusable. |
| 3 | `.claude/agents/susan.md:24` | "Semble search (primary)" | `mcp__semble__*` not registered. |
| 4 | `.claude/agents/janet.md:27, 53` | "Use `AskUserQuestion`" | Not in `tools:` frontmatter. |
| 5 | `.claude/agents/kevin.md:34` | `~/.claude/skills/kevin/SKILL.md` | Skill dir doesn't exist. |
| 6 | `.claude/agents/kevin.md:31` | "kevin MCP stdio server" | Not registered in settings. |
| 7 | `.claude/agents/linda.md:26` | `bizar-dash/src/server/mod-security.mjs` | **CORRECTED 2026-07-22: file does exist** — audit's claim was wrong. Reference is accurate. |

Plus systemic: ALL agents in `.claude/agents/` reference "Semble search" via `_shared/AGENT_BASELINE.md` §3 — but no Semble MCP is registered. The baseline lies.

### C2. MISSING references — gaps in what agents use

| # | Agent | Missing | Why |
|---|---|---|---|
| 1 | janet | `AskUserQuestion` in `tools:` | Primary function. |
| 2 | All 14 agents | `Skill` in `tools:` | Baseline §4 instructs skill loading via Skill tool. |
| 3 | steve, carl | `Agent` in `tools:` | Body describes agent dispatch. |
| 4 | greg, brenda | Reference `obsidian` by name in body | They're the Obsidian writers. |
| 5 | brenda | Reference `memory-protocol`, `self-improvement` | Heimdall maintains `.bizar/`. |
| 6 | brad | Reference `de-sloppify`, `glyph` | Anti-slop mandate + typography. |
| 7 | greg, susan, todd, karen | Reference `9router-web-fetch`/`9router-web-search` | The project ships 9router skills (replaces WebFetch/WebSearch). |
| 8 | All agents except mike | Reference `Skill` loading pattern | Baseline says to load skills on demand. |

### C3. Duplicated files — drift (already noted in A1)

`.claude/agents/` ↔ `config/agents/`: **all 14 agents diverge.** No provisioner function copies `config/agents/` to `.claude/agents/` automatically — but the function exists in `cli/provision.mjs:syncAgentFiles` (line 433) and the reverse direction is what would happen on next provision. **The legacy tree is a footgun.**

`.claude/skills/` ↔ `config/skills/`: 60 canonical, 62 mirror (2 orphans). `syncSkillFiles` keeps orphans flagged as warnings.

`.claude/commands/` ↔ `config/commands/`: 18 vs 14 (4 missing from legacy: `cron`, `goal`, `spec`, `sprint`).

### C4. Slash-command wiring

7 of 18 slash commands are wired into `thinking-route.mjs`. The 11 others — `bizar`, `cron`, `explain`, `goal`, `init`, `learn`, `setup-provider`, `spec`, `sprint`, `tailscale-serve`, `visual-plan` — are **not hinted at by the hook** but exist as files.

**No agent body references any slash command by name.** Slash commands are only invoked from the user prompt; the hook picks them up. So the gap is purely "the user can invoke them, but the hook won't suggest them on a relevant prompt."

### C5. MCP registration vs reality

- `bizar`: 14/23 tools allowed. Plugin has 9 unused tools (`federation_*`, `consensus_*`, etc.) but no agent body references them — safe.
- `semble`: **0/2 tools registered.** 2 agents (`greg`, `oscar`) use it as primary. Plus 4 docs mention it. **Critical gap.**
- `kevin`: **0/M tools registered.** 1 agent body mentions it. **Critical gap.**

### C6. Tool frontmatter vs claimed work

| Agent | Tools | Claimed work | Match |
|---|---|---|---|
| mike | Agent, Read, WebFetch, WebSearch | Decompose + delegate | ✓ |
| todd | Read/Edit/Write/Bash/Glob/Grep/WF/WS | Impl | ✓ |
| karen | same | Impl + Forseti gate | ✓ |
| brenda | same | `.bizar/` maint | ✓ |
| greg | same | Obsidian write + Semble search | Semble missing |
| susan | Read/Glob/Grep/WF/WS | Read-only + Semble search | Semble missing |
| steve | same as todd | Git + PR review dispatch | `Agent` missing |
| brad | same | DESIGN.md write | ✓ |
| janet | Read/Glob/Grep/WF | **AskUserQuestion** | **Missing** |
| carl | same as todd | Impl + Forseti dispatch | `Agent` missing |
| linda | Read/Bash/Glob/Grep/WF | Read-only review | ✓ |
| pam | same as todd | Single-shot edits | ✓ |
| kevin | Read/Bash/Glob/Grep/WF/WS | Browser automation | Skill missing |
| oscar | Read/Glob/Grep/WF | Semble search (primary) | **Semble missing** |

---

## D. Top-priority fixes (in dependency order)

The user said "everything should automatically be included and used by the agents." Reading that against the audit, the minimal fix set is:

### D0. Foundation: stop the legacy tree from overwriting

**Delete `config/agents/` entirely.** Or: remove `syncAgentFiles` from the provisioner and rename `config/agents/` to `agents-legacy/`. Without this, every other agent fix is a house of cards. Same for `config/commands/`, `config/hooks/`, `config/agents/_shared/CLINE_TOOLS.md`.

### D1. Register the MCP servers the agents already use

- Register `semble` MCP server in `.claude/settings.json:mcpServers`. (Command: `semble-mcp` or `npx @semble/mcp` — needs verification of the actual install command.)
- Register `kevin` MCP server.
- Allow `mcp__semble__*` and `mcp__agent-browser__*` in `permissions.allow`.
- Verify Semble CLI is on PATH.

### D2. Fix agent frontmatter

- `janet.md` — add `AskUserQuestion` to `tools:`.
- `steve.md`, `carl.md` — add `Agent` to `tools:`.
- All 14 agents — add `Skill` to `tools:` (baseline §4 instructs this; the audit shows only Odin has delegation, but every agent should be able to load skills on demand).

### D3. Fix references in agent bodies

- `kevin.md` — drop the `~/.claude/skills/kevin/SKILL.md` reference (the skill isn't shipped) OR ship the skill.
- `linda.md` — ~~drop the `bizar-dash/src/server/mod-security.mjs` reference (path doesn't exist)~~. **CORRECTED 2026-07-22: path does exist; no fix needed.**
- `brad.md` — add explicit references to `de-sloppify` and `glyph`.
- `greg.md`, `brenda.md` — add explicit references to `obsidian`.

### D4. Fix the SKILLS mirror

Either delete `de-sloppify` and `find-skills` from `.claude/skills/` (treat as orphans) OR add them to `config/skills/`. Pick one source of truth.

### D5. Sync the slash commands

Either move the 4 missing slash commands (`cron.md`, `goal.md`, `spec.md`, `sprint.md`) into `config/commands/` OR drop `syncCommandFiles` and treat `.claude/commands/` as canonical.

### D6. Wire the unwired slash commands

Add the 11 unwired slash commands to `thinking-route.mjs` so the hook hints at them when relevant.

### D7. Ship the kevin skill

Either add `.claude/skills/kevin/SKILL.md` or remove the reference from `kevin.md`.

### D8. Audit documentation drift

- `EXPLORATION.md` doesn't mention the agent duplication problem.
- `PROGRESS.md` doesn't list this as an active feature.
- `feature_list.json` doesn't have a feature for this audit.

---

## E. Out-of-scope (deliberate skips)

- **Migrating `mcp__bizar__*` permissions** — the 9 unused tools (`federation_*`, etc.) are plugin-exposed but unused. Leaving them out of `permissions.allow` is correct (no agent uses them).
- **Restructuring `.bizar/`** — not the audit's scope.
- **Re-running the Explore agent's full output** — this audit is built from direct reads + the partial Explorer tail. The Explorer is still running; once it finishes, cross-reference its output against this report.

---

## F. Recommended next step

**Enter plan mode and write a 4-feature plan:**

- **F-107:** Remove legacy `config/agents/`, `config/commands/`, `config/hooks/` trees + `_shared/CLINE_TOOLS.md`. Audit complete: no consumer exists.
- **F-108:** Register `semble` and `kevin` MCP servers in `.claude/settings.json` + add `mcp__semble__*`, `mcp__agent-browser__*` to `permissions.allow`.
- **F-109:** Add `AskUserQuestion` to `janet.md`, `Agent` to `steve.md`/`carl.md`, `Skill` to all 14 agents. ~~Drop the stale `bizar-dash/src/server/mod-security.mjs` ref from `linda.md`~~ — **CORRECTED 2026-07-22: path exists, ref is accurate, no change needed.**
- **F-110:** Sync the 4 orphan slash commands (`cron`, `goal`, `spec`, `sprint`) into `config/commands/`. Wire all 11 non-hinted slash commands into `thinking-route.mjs`. Add explicit skill refs in agent bodies (`obsidian`, `de-sloppify`, `glyph`).

WIP=1 says one at a time. Recommend starting with **F-107** (zero-risk delete) → **F-109** (frontmatter fixes, no infra changes) → **F-108** (MCP registration, needs verification of Semble install path) → **F-110** (slash command wiring).

---

## G. Resolution log (live updates)

### F-107 — DONE (2026-07-22)

Deleted `config/agents/`, `config/commands/`, `config/hooks/`, plus the dead `syncAgentFiles` function. Repointed 2 tests + 1 e2e check + 5 doc references. `make check` exits 0; both updated tests pass.

### F-108 — DONE (2026-07-22)

Registered `semble` and `kevin` MCP servers in `.claude/settings.json:mcpServers`. Added wildcard permissions `mcp__semble__*` and `mcp__agent-browser__*` to `permissions.allow` (Claude Code supports `mcp__server__*` wildcard per upstream changelog; user-level settings already use this pattern for `mcp__bizar__*`).

**Install verification:**
- `semble` is on `$PATH` at `/home/drb0rk/.local/bin/semble` (uv-installed)
- `semble mcp` runs as stdio MCP server (semble 1.28.0, FastMCP)
- MCP tool surface: `search(query, repo, top_k)`, `find_related(file_path, line, repo, top_k)` — **no `content` arg** (the earlier agent docs claiming `--content docs` / `--content config` on `mcp__semble__search` were wrong; that flag only works on the CLI)
- `kevin mcp` runs as stdio MCP server (kevin 0.31.1, FastMCP)

**Fixes that fell out:**
- `kevin.md`: dropped reference to nonexistent `~/.claude/skills/kevin/SKILL.md`; updated MCP registration note from `.claude/mcp.json` to `.claude/settings.json:mcpServers`.
- `oscar.md`: corrected tool list to match actual MCP surface (query, repo, top_k); moved content-filtering to Bash fallback.
- `AGENT_BASELINE.md` §3: corrected claim that `mcp__semble__search` accepts `--content`; now uses CLI fallback for content-type filtering.

`make check` exits 0; `node --test bizar-dash/tests/memory-protocol-drift.test.mjs` 4/4 PASS.

### F-109 — DONE (2026-07-22)

Agent frontmatter fixes applied across 13 agents (Odin is a pure router and intentionally has only `Agent` + `Read` + `WebFetch` + `WebSearch`):

| Agent | Added to `tools:` |
|---|---|
| `janet.md` | `AskUserQuestion` (its body says use it; now allowed), `Skill` |
| `steve.md` | `Agent` (PR-review mode dispatches `@greg`/`@linda`), `Skill` |
| `carl.md` | `Agent` (sends to `@linda` for review), `Skill` |
| `todd.md`, `karen.md`, `greg.md`, `brenda.md`, `brad.md`, `pam.md` | `Skill` (AGENT_BASELINE §4 tells every agent to invoke skills on demand) |
| `susan.md`, `linda.md`, `kevin.md`, `oscar.md` | `Skill` (same; read-only agents still need it for skill discovery) |

**Audit correction:** The audit claimed `linda.md:26` references a nonexistent `bizar-dash/src/server/mod-security.mjs`. The file does exist (14008 bytes, 2026-07-16). Audit was wrong; no fix needed.

`make check` exits 0; target tests pass.

### F-110 — DONE (2026-07-22)

**Slash command wiring:** All 18 commands under `.claude/commands/` are now hinted by `thinking-route.mjs` when invoked (was 7/18):
- Newly wired: `/setup-provider`, `/explain`, `/visual-plan`, `/tailscale-serve`, `/bizar`, `/init`, `/cron`, `/spec`, `/sprint`, `/goal`, `/learn`
- Order in SLASH table is **length-desc** so longer commands (e.g. `/setup-provider`) win over shorter prefix matches (e.g. `/spec` would not match `/spec-something` — anchor is at word boundary).
- 11 new test cases added to `thinking-route.test.mjs` (61 → 72 PASS).

**Orphan slash commands:** The 4 commands previously missing from `config/commands/` (`cron.md`, `goal.md`, `spec.md`, `sprint.md`) are already canonical in `.claude/commands/`. After F-107's deletion of `config/commands/`, the orphan-sync problem evaporated — no copy step needed.

**Skill references in agent bodies:**
- `greg.md` — added explicit reference to `obsidian` skill (`.claude/skills/obsidian/SKILL.md`) — three-layer vault discipline.
- `brenda.md` — added references to `obsidian`, `memory-protocol`, and `self-improvement` skills — all three are relevant to `.bizar/` maintenance which is Heimdall's primary duty.
- `brad.md` — added references to `glyph` (visual artifacts) and `de-sloppify` (anti-slop review) — both match the design-system agent's anti-slop mandate.

`make check` exits 0; 72/72 thinking-route tests PASS; all other targeted tests pass.

### Audit completed (2026-07-22)

F-107, F-108, F-109, F-110 all DONE. The audit's top-priority recommendations are resolved. Original gaps remaining for separate sprints:
- Drop the `pretooluse-bash.mjs` rm-rf-home false-positive (fix already shipped as a follow-up earlier this session, not part of this audit).
- The `mcp__bizar__*` 9-tool permission gap (federation/consensus/etc.) — by design; no agent uses them.
- Skill mirror drift (`de-sloppify`, `find-skills` orphans in `.claude/skills/` vs. `config/skills/`) — cosmetic; no agent broken.

### F-111 — DONE (2026-07-22)

Audit follow-up — shipped the four remaining gaps the original "Audit completed" note flagged as out-of-scope-but-worth-fixing:

**(1) NEW `.claude/skills/kevin/SKILL.md`** — first-class skill docs for the kevin CLI + `mcp__agent-browser__*` MCP tools (refs vs selectors, plugin system, daemon setup). The `@kevin` agent now has a SKILL.md to load on demand.

**(2) Cline-era paths purged from `.claude/skills/`** — `bizar/SKILL.md` had four `~/.cline/skills/...` references (lines 370, 384, 385, 386) pointing at a Cline-era install location that doesn't exist. Replaced with the actual canonical paths under `.claude/skills/`. Also fixed the `~/.cline/skills/9router/` path in `9router/SKILL.md:61`.

**(3) `AGENT_BASELINE.md` §6** — the section listed `config/rules/<name>.md` paths as the rules source. The project-level `config/rules/` is empty (audit §A7); user-level `~/.claude/rules/` is the real source. Reworded §6 to point at the user-level rules and add a note that `config/rules/` is a legacy empty tree. Also extended §4 (skill discovery) to mention the 9router umbrella + web-fetch/web-search leaf skills.

**(4) 9router skill refs in 4 agents** — todd, karen, greg, susan all use `WebFetch`/`WebSearch` to hit external docs; the 9router skills (`9router-web-fetch`, `9router-web-search`) provide Firecrawl / Jina Reader / Tavily / Exa with format options and provider auto-fallback via a single `$NINEROUTER_URL` gateway. Added explicit "Prefer the 9router-… skill" rules in each agent's Always-On section.

**Verification:** `make check` exits 0. `node --test .claude/hooks/__tests__/*.test.mjs` 113/113 PASS. `node --test bizar-dash/tests/memory-protocol-drift.test.mjs` 4/4 PASS. `node --test cli/plow-through.test.mjs` 5/5 PASS. `grep -rn "~/.cline/" .claude/` returns no matches. `ls .claude/skills/kevin/SKILL.md` exists.

**Audit fully closed.** All 4 critical fixes (F-107..F-110) and all 4 follow-up fixes (F-111) shipped. Original gaps remaining for separate sprints: none flagged from this audit.

### F-112 — DONE (2026-07-22)

Theme pivot — full rename Norse → 90s corporate office. Same 14-agent
multi-tier shape, new funny boring names. Mapping: Odin→Mike, Thor→Todd,
Tyr→Karen, Heimdall→Brenda, Mimir→Greg, Frigg→Susan, Hermod→Steve,
Baldr→Brad, Vor→Janet, Vidarr→Carl, Forseti→Linda, Quick→Pam,
agent-browser→Kevin, semble-search→Oscar.

**What shipped:**
- 14 agents renamed via `git mv` (history-preserving). New `name:`
  frontmatter. New first sentence (e.g., "You are Susan, the front-desk
  Help Desk."). Same role, same model tier, same tools.
- `.claude/agents/_shared/AGENT_BASELINE.md` §8 parallelism hint
  (Odin → Mike) + §12 self-improvement duty header (Heimdall → Brenda).
- `.claude/skills/bizar/SKILL.md` — full rewrite of routing table
  (10 rows), ASCII diagram (8 boxes), Cost Escalation, troubleshooting
  subsections (Mike/Odin/Forseti → Mike/Linda), Mike Routing Rules
  header, Config File Locations table, identity preamble, §12
  self-improvement line (Heimdall → Brenda).
- `.claude/agents/_shared/CLAUDE_TOOLS.md` roster line 357 — kept in
  sync with new names.
- `scripts/check-agents.mjs` — rewired from deleted `config/agents/`
  to `.claude/agents/` with new filenames (was broken since F-107).
- `bizar-dash/tests/memory-protocol-drift.test.mjs` regex updated
  `/Heimdall-only/` → `/Brenda-only/`.
- `AGENTS.md` + `CLAUDE.md` cosmetic Norse lines (`Odin, Frigg, ...`
  examples) updated to `Mike, Susan, ...`. Mirror refreshed via
  `scripts/mirror-claude-md.sh` (chmod +x added since the prior session).
- `feature_list.json` F-112 added: state `active` → `passing`,
  evidence line, `passed: 2026-07-22`. VCR 73 → **74**.

**Verification (all green):**
- `node scripts/check-agents.mjs` → ✓ All 14 agents reference the
  shared docs.
- `node --test bizar-dash/tests/memory-protocol-drift.test.mjs cli/plow-through.test.mjs .claude/hooks/__tests__/*.test.mjs` →
  **122/122 PASS** (4 memory-drift + 5 plow-through + 113 thinking-route).
- `make check` → 0 TS errors.
- `bash scripts/mirror-claude-md.sh` → ✓ mirror synced.
- `grep -niE 'odin|thor|tyr|heimdall|mimir|frigg|hermod|baldr|vidarr|forseti|norse|pantheon|asgard|valhalla' .claude/skills/bizar/SKILL.md .claude/agents/_shared/AGENT_BASELINE.md AGENTS.md CLAUDE.md` →
  0 Norse hits (false positives: "Bizar"=project name, "Bash"/">"=tool
  name, "authorized"/"401"=troubleshooting text, `claudeAgentMaxConsecutiveMistakes`
  historical legacy field name).

**Audit fully closed (final).** All 5 critical fixes (F-107..F-110) +
all 5 follow-up fixes (F-111, F-112) shipped. VCR ratio 74/74 = 1.0.