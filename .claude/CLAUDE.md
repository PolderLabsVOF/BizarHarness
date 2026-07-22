# CLAUDE.md — Mirror of AGENTS.md for Claude Code compatibility

> **This file is auto-mirrored from `AGENTS.md` for tools that look for
> `CLAUDE.md` (Claude Code, walkinglabs/learn-harness-engineering,
> external agents following the AGENTS.md convention). DO NOT EDIT THIS
> FILE DIRECTLY — edit `AGENTS.md` and run `make mirror-claude-md`.
>
> Source: `AGENTS.md` (canonical)
> Mirrored: 2026-07-22T21:08:27+02:00 by `scripts/mirror-claude-md.sh`

---


> **Bizar Harness** is a Claude Code-native multi-agent coding harness
> for the Bizar project. It embeds the Claude Code Agent SDK
> in-process, ships skills + MCP servers + slash commands under
> `.claude/`, and ships a TypeScript dashboard with a kanban task
> board and live agent viewer.

If you are an agent: read this file, then `PROGRESS.md`, then run `make check`.

## Quick commands

```sh
make setup       # Install dependencies (bun install)
make dev         # Start dashboard in dev mode
make check       # Full verification pipeline (typecheck + test)
make test        # Run all tests (skill + sdk + dashboard)
make e2e         # End-to-end tests (real plugin load + tool exercise)
make vcr         # Verify Code Reality check via feature_list.json
make verify-feature ID=<n>  # Verify feature ID from feature_list.json
make check-arch  # Architectural constraints (scripts/check-arch.sh)
make clean-check # 5-dimension clean-state check
make session-start  # Record session start
make session-end    # Record session end
```

## Hard constraints (MUST / MUST NOT)

These rules are not optional. Violations break long sessions.

- **MUST** run `make check` before claiming work is done.
  # why: TS drift + failing tests are the #1 cause of broken sessions.
- **MUST** update `PROGRESS.md` before AND after every code change.
  # why: Cross-session memory lives there.
- **MUST** keep one logical operation per commit.
  # why: Bisecting, reverting, reviewing require atomic units.
- **MUST** keep documentation in sync with code in the same commit.
  # why: Stale docs are worse than no docs.
- **MUST** follow the WIP=1 rule: only one feature active at a time.
  # why: Parallel WIP prevents VCR from reaching 1.0.
- **MUST NOT** use `claude daemon` or any persistent subprocess for the
  runtime. Claude Code is in-process by default; if you need a long-running
  background context, use `claude --bg` per the Claude Code CLI docs.
  # why: Subprocess hangs in headless test envs.
- **MUST NOT** call dashboard HTTP from plugin for memory — use the in-process vault.
  # why: The plugin must work without a dashboard.
- **MUST NOT** commit `console.log`, `debugger`, or `.only()`.
  # why: `make clean-check` fails on these.
- **MUST NOT** skip E2E tests when changes cross component boundaries.
  # why: Unit tests pass on stubs; only E2E catches drift.
- **MUST** configure tool access via `.claude/settings.json` (project) or
  `~/.claude/settings.json` (user). Permission table is expressed as a
  Claude Code allow/deny list scoped to the Claude Code tool surface:
  Read, Edit, Write, Bash, Grep, Glob, WebFetch, WebSearch, NotebookEdit,
  Agent (subagent dispatch with `run_in_background` / `isolation: "worktree"`),
  Skill, AskUserQuestion, SendMessage.

## Operating Manual (Claude Code-aware)

This harness runs **inside Claude Code**. Its hooks execute in Claude Code's
event loop (`PreToolUse`, `PostToolUse`, `UserPromptSubmit`,
`SessionStart`, `SessionEnd`); its skills live under `.claude/skills/` and
are loaded by name; its agents live under `.claude/agents/` and are
dispatched via the `Agent` tool; its MCP servers live under
`.claude/mcp.json` and are spawned at session start. Plugin / agent
extension logic that previously needed Cline's `AgentPlugin` API is now
expressed as a Claude Code skill (markdown + optional hooks script) plus,
when state is needed across sessions, a Claude Code MCP server registered
via the Agent SDK (`@anthropic-ai/claude-agent-sdk`).

The mistake limit follows Claude Code's default of `6` consecutive
tool-validation failures before a session is aborted; specific agents
may override this in their `.claude/agents/<agent>.md` `permission`
frontmatter (or via `isolation: { max_mistakes: 10 }` on the Agent
tool call). The plugin's previous `clineruntimeMaxConsecutiveMistakes`
field is renamed `claudeAgentMaxConsecutiveMistakes` in v6.3.0; the
default is 10 (the floor is always Math.max'd against the runtime's
default).

The hook shape is the Claude Code event bag: each hook receives a
typed payload and returns either `{ continue: true }` (pass through),
`{ continue: false, stopReason: "..." }` (block), or, for `PreToolUse`
hooks, `{ hookSpecificOutput: { permissionDecision: "allow" | "deny" | "ask", ...}}`
(matches the previous `decision: allow|require-approval|deny` semantics).

## State files (where the system remembers things)

- `PROGRESS.md` — Current state, In Progress, Next Steps, Blockers
- `DECISIONS.md` — Architectural decisions log
- `feature_list.json` — Machine-readable feature state
- `docs/architecture.md` — Layer model + module map
- `docs/quality-document.md` — A/B/C/D module health scores
- `.harness/arch-rules.json` — Architectural rule registry (WHAT/WHY/FIX)
- `.harness/traces/sessions.jsonl` — Runtime session traces (gitignored)
- `templates/sprint-contract.md` — Pre-feature negotiation template
- `templates/evaluator-rubric.md` — Sprint scoring rubric
- `templates/clean-state-checklist.md` — 5-dimension exit checklist
- `.claude/settings.json` — Project-scoped Claude Code tool permissions
- `.claude/agents/*.md` — Bizar agent definitions (Mike, Susan, ...)
- `.claude/skills/*/SKILL.md` — Bizar skill packs (auto-loaded by name)
- `.claude/commands/*.md` — User/project-level slash commands
- `.claude/hooks/*` — Executable hook scripts (PreToolUse, PostToolUse, ...)
- `.claude/mcp.json` — MCP server registrations (Semble, Bizar memory, ...)

## Clock-in (start of session)

1. Read `PROGRESS.md` → confirm starting state + last commit.
2. Read `CLAUDE.md` (Claude Code reads this automatically).
3. Run `make check` → confirm green baseline.
4. Read `feature_list.json` → pick next `not_started` feature (WIP=1).
5. If feature needs negotiation, fill `templates/sprint-contract.md`.
6. Mark feature `active` in `feature_list.json`, commit.
7. Run `make session-start`.

## Clock-out (end of session)

1. Update `PROGRESS.md` Current State (commit hash + `make check` result).
2. Move feature from `active` → `passing` in `feature_list.json`.
3. Populate `evidence` field with test output / commit hash.
4. Score against `templates/evaluator-rubric.md` — every dim B+.
5. Run `make clean-check` — must pass on all 5 dimensions.
6. Run `make check` — must be green.
7. Commit with WHY-focused message.
8. Run `make session-end`.

> **Context anxiety warning:** If running low on context, do NOT rush
> to finish. Stop, update `PROGRESS.md` Next Steps with concrete actions,
> commit a clean checkpoint. Claude Code's `/compact` is the safety net;
> reach for it before panic-editing.

## Definition of Done (L09)

A feature is `passing` only when ALL THREE LAYERS verify:

- **Layer 1 — Compile/typecheck:** `make check` is green.
- **Layer 2 — Unit tests:** `make test` passes for the touched module.
- **Layer 3 — E2E:** `make e2e` exercises real plugin load + tools + hooks.

Layer ordering is mandatory. **Do NOT proceed to Layer N+1 if Layer N
fails.** A typecheck error (Layer 1) means Layers 2 and 3 will also
fail — fix it first.

Runtime signals include:
- `bun run /tmp/bh-full-e2e.mjs` exits 0 (22/22 pass)
- Plugin `setup()` returns in < 1s and registers 19 tools
- Memory tools round-trip (write → read → list → search)
- Claude Code agent dispatch wired (Mike → subagents via `Agent` tool)
- Kanban board renders against `/api/tasks`

## Feature List Rules (L08)

State machine: `not_started` → `active` → `passing` (or back to `active` on failure).

- **Granularity:** One session per feature. Split if longer.
- **Pass-state gating:** Only `passing` features count toward VCR.
- **Evidence:** Required when marking `passing` (test output / commit hash).

## Architecture Boundaries (L10)

- `.claude/skills/` + `.claude/mcp.json` + `.claude/agents/` — Layer 0 (Core). Skills and MCP servers replace the previous plugin layer.
- `bizar-dash/` — Layer 1 (UI).
- They communicate via the Claude Code Agent SDK, never via raw HTTP/stdio for memory.

`make check-arch` enforces:
- Skill must not import from `bizar-dash/` (cross-layer).
- Skill must not call `fetch('http://127.0.0.1:...')` for memory.
- Dashboard must not re-implement Claude Code Agent SDK features.

Every code-review finding becomes a rule in `.harness/arch-rules.json`
with `what` / `why` / `fix` fields.

## Observability (L11)

Per feature:

1. **Pre:** Fill `templates/sprint-contract.md` (scope, DoD, exclusions).
2. **During:** `make session-start` records session ID.
3. **During:** Tool invocations logged to `.harness/traces/sessions.jsonl`.
4. **Post:** Score against `templates/evaluator-rubric.md`.

## Clean State Protocol (L12)

A session is "clean" when ALL FIVE dimensions pass:

1. **Build passes:** `make check` exits 0.
2. **Tests pass:** `make test` exits 0.
3. **Feature list updated:** `feature_list.json` reflects actual state.
4. **No debug artifacts:** No `console.log`, `debugger`, `*.only()`.
5. **Startup path works:** `make e2e` registers the plugin and runs.

`make clean-check` is the idempotent verifier. Run at every clock-out.

**Dual-mode cleanup:**
- *Immediate:* Run `make clean-check` at every clock-out.
- *Periodic (weekly):* Full structural sweep — unused files, stale deps,
  orphaned tests.

## Topic documents

- [MILESTONES.md](MILESTONES.md) — strategic roadmap (vision, 4 phases)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — tactical plan (current state + sprints)
- [docs/INDEX.md](docs/INDEX.md) — documentation map (start here)
- [docs/architecture.md](docs/architecture.md) — layer model, module map
- [docs/quality-document.md](docs/quality-document.md) — module health (A/B/C/D)
- [docs/code-review.md](docs/code-review.md) — code review findings + actions
- [docs/safety.md](docs/safety.md) — DANGEROUS_PATTERNS reference (v6.0.0)
- [docs/curator.md](docs/curator.md) — Skill curator reference (v6.0.0)
- [docs/graph-tools.md](docs/graph-tools.md) — Knowledge graph tools (v6.0.0)
- [docs/migration-guide.md](docs/migration-guide.md) — Claude Code migration (v6.3.0)
- [docs/decisions/](docs/decisions/) — individual ADRs (see DECISIONS.md)
- [plugins/bizar/ARCHITECTURE.md](plugins/bizar/ARCHITECTURE.md) — plugin module
- [plugins/bizar/CONSTRAINTS.md](plugins/bizar/CONSTRAINTS.md) — plugin hard rules
- [plugins/bizar/tests/README.md](plugins/bizar/tests/README.md) — test reference
- [bizar-dash/ARCHITECTURE.md](bizar-dash/ARCHITECTURE.md) — dashboard module
- [packages/sdk/ARCHITECTURE.md](packages/sdk/ARCHITECTURE.md) — SDK module

## Repository structure

```
BizarHarness/
├── AGENTS.md               # entry point (canonical)
├── CLAUDE.md               # mirror of AGENTS.md for Claude Code
├── PROGRESS.md             # current state, in progress, next steps
├── DECISIONS.md            # architectural decisions
├── feature_list.json       # machine-readable features
├── Makefile                # setup / dev / check / test / e2e / ...
├── package.json            # bun workspace root
├── .nvmrc                  # pinned runtime version
├── .claude/
│   ├── settings.json       # scoped tool access
│   ├── agents/             # Mike, Susan, ... (one .md per agent)
│   ├── skills/             # auto-loaded SKILL.md packs
│   ├── commands/           # user-level slash commands
│   ├── hooks/              # executable hook scripts
│   └── mcp.json            # MCP server registrations
├── .harness/
│   ├── arch-rules.json
│   └── traces/             # gitignored
├── docs/                   # architecture, quality, decisions
├── templates/              # sprint contract, rubric, clean-state
├── scripts/                # verify-feature, check-arch, clean-state, session-trace
├── plugins/bizar/          # Bizar MCP server + 19 tools
├── packages/sdk/           # SDK wrapper around Claude Code Agent SDK
└── bizar-dash/             # dashboard server + UI
```
