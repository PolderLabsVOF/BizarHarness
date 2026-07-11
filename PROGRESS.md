# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## Current State

- **Last commit:** v6.3.0 — Claude Code migration
- **Released:** v6.3.0 — published to npm (3 packages)
- **`make check`:** 765/765 pass, 0 TS errors (F-034 worker-dispatcher + hook are pure .mjs; no new TS source)
- **`make test`:** 765 + 66 pass (54 plugin/sdk files + CLI tests incl. new worker-dispatcher 18-case suite)
- **`make e2e`:** 20/20 pass
- **`make clean-check`:** 5/5 dimensions pass (F-034 files clean)
- **`make vcr`:** 32/33 = 0.970 (F-032 still active in parallel work stream; F-034 now passing)
- **Container test (`scripts/test-in-container.sh`):** ✓ all 6 stages green
- **Branch:** master (pushed)
- **Phase:** v6.4.0 — **Ruflo port cycle** (F-032 active; F-033, F-035, F-036 not_started; **F-034 passing**)

## In Progress — v6.4.0 Ruflo Port Cycle

Started 2026-07-11. CodeGraph-driven mapping of the ruflo
codebase (`/home/drb0rk/Projects/BizarHarness/ruflo`) produced
5 port-backlog features in `feature_list.json`:

| F-id | Feature | Source map | Port target |
|---|---|---|---|
| **F-032** (active) | Swarm Coordination — `agent/{spawn,list,terminate}` + `swarm/init` + `BizarAgentRegistry` | `02-agent-system-map.md` | `packages/sdk/src/mcp/server.ts` + `agent-registry.ts` (new) |
| **F-034** (passing) | Background Workers — trigger-pattern dispatcher wired to `UserPromptSubmit` | `04-dashboard-cli-map.md` | `.claude/hooks/worker-suggest.mjs` (new) + `cli/worker-dispatcher.mjs` (new) + `config/trigger-patterns.json` (new) |
| F-033 | Self-Learning — ReasoningBank distillation (ADR-174) + adaptive model router + Tier-1 codemod intent | `03-memory-learning-map.md` | `packages/sdk/src/router/*` (new) + `bizar-dash/src/server/memory-{distillation,consolidator}.mjs` (new) |
| F-035 | MetaHarness — atomic cost gate + 3-tier routing transparency panel + GitHub claim protocol | `02-agent-system-map.md` (cost gate) + `04-dashboard-cli-map.md` (GitHub claims) | `cli/cost-gate.mjs` (new) + `bizar-dash/src/web/components/agents/RoutingDecisions.tsx` (new) |
| F-036 | Goal Planner UI — GOAP A* from plain-English goal + 5 dashboard panels | `04-dashboard-cli-map.md` | `bizar-dash/src/web/pages/GoalPlanner.tsx` + 7 new components |

Full analysis: `/tmp/ruflo-port-analysis/00-SYNTHESIS.md` (and
`0[1-4]-*.md` for the per-area maps).

**Sprint order constraint:** F-033 should land after F-032
because the router benefits from the agent registry. The other
three (F-034, F-035, F-036) are independent of each other and of
F-032.

## What landed in v6.4.0 (so far)

### F-034 — Background Workers (commits 533d81b + 702631d)

Trigger-pattern dispatcher wired to Claude Code's `UserPromptSubmit`
event. Every prompt auto-suggests relevant Bizar skills/agents.

- `config/trigger-patterns.json` (new) — 12 workers with regex-driven
  triggers: `testgaps`, `audit`, `deepdive`, `refactor`, `document`,
  `optimize`, `ultralearn`, `consolidate`, `predict`, `map`, `preload`,
  `benchmark`. Each carries `weight`, `skill`, `agent`, `description`.
- `cli/worker-dispatcher.mjs` (new, 256 lines) — pure JS, no deps.
  Exports `dispatch()`, `listWorkers()`, `loadPatterns()`, `resetCache()`.
  Cached regex compilation, weight-ranked output, defensively handles
  missing/malformed config.
- `.claude/hooks/worker-suggest.mjs` (new, 110 lines) — UserPromptSubmit
  hook. Reads stdin, calls `dispatch()`, emits
  `hookSpecificOutput.additionalContext` on stdout, stderr log for
  operator visibility, always exits 0 (informational only).
- `.claude/settings.json` — UserPromptSubmit entry appended as a sibling
  command (preserves existing `userpromptsubmit-tag.mjs`).
- `cli/worker-dispatcher.test.mjs` (new, 204 lines) — 18 `node:test`
  cases: 5 canonical dry-run prompts + 8 edge cases + `listWorkers`
  completeness + 4 `loadPatterns`/cache lifecycle + missing/malformed
  config tolerance.
- `Makefile` + `package.json` — test pipeline picks up the new suite.

**Verification (L09 layers):**
- L1 compile (`node --check`): PASS
- L2 unit (`node --test cli/worker-dispatcher.test.mjs`): 18/18 PASS
- L3 e2e (`./scripts/test-in-container.sh`): FAILS at typecheck stage
  due to **pre-existing F-035 WIP** in `cli/commands/cost.mjs`
  (cost-gate port) — unrelated to F-034. F-034 introduces zero TS
  source and lands cleanly on v6.3.0.

## What landed in v6.3.0

Complete migration from Cline to Claude Code. Plugin layer, agent
definitions, hook scripts, and mistake-limit machinery all rewired
to ride on Claude Code's Agent SDK + MCP + skill/agent/hook system.

- **Plugin layer → Claude Code MCP server.** The Bizar plugin now
  ships as a Claude Code MCP server (`@anthropic-ai/claude-agent-sdk`)
  exposing the same tool surface that previously came through the
  Cline plugin host.
- **Cline's `AgentPlugin` → Claude Code skills + agents + hooks.**
  All 14 agent files in `config/agents/` are now Claude Code agent
  definitions; `config/skills/` and `config/hooks/` are loaded by
  Claude Code's skill loader and hook system respectively.
- **Cline's `beforeTool` / `afterTool` → Claude Code's `PreToolUse` /
  `PostToolUse`.** The five hook scripts (`PreToolUse`, `PostToolUse`,
  `TaskStart`, `TaskResume`, `UserPromptSubmit`) are installed to
  Claude Code's canonical hook locations.
- **Cline's `ClineCore` → Claude Code `Agent SDK`
  (`@anthropic-ai/claude-agent-sdk`).** The plugin's `clineruntime.ts`
  is now an Agent SDK wrapper; session config is driven by Claude
  Code's runtime.
- **Cline's `createTool` from `@cline/sdk` → Claude Code MCP tool
  registration via `@anthropic-ai/claude-agent-sdk`.** All 19+ tools
  are registered through the SDK's MCP tool API.
- **Mistake-limit floor (default 10) now uses Claude Code's
  `onConsecutiveMistakeLimitReached` callback** instead of Cline's
  session-config field. Field renamed to `claudeAgentMaxConsecutiveMistakes`.

## What landed in v6.2.5

Deep-dive session: critical skill-lock bug, new CubeSandbox
integration, walkinglabs principles applied, container-based testing.

## What landed in v6.2.4

Fixes the silent v6.0.0 mistake-limit regression AND gives every
Bizar agent the exact schemas for Claude Code's tools so they stop making
the mistakes in the first place.

### Patches

1. **`plugins/bizar/src/clineruntime.ts:buildExecution`** — plugin
   defaultMaxConsecutiveMistakes is now a FLOOR (Math.max) instead
   of a default that gets overridden by the CLI's --retries flag.
2. **`plugins/bizar/src/options.ts`** — bumped plugin default from
   6 → 10.
3. **`config/agents/_shared/AGENT_BASELINE.md`** — added "Tool
   Mistakes — Don't Kill the Session" section + removed stale
   "translated from Claude Fable 5" sentence (Claude-Code-only since
   v6.3.0 (was Cline-only in v6.1.0–v6.2.5)).
4. **`config/agents/_shared/CLINE_TOOLS.md`** (new) — schemas for
   `read_file`, `editor`, `ask_question`, `use_subagents`, etc.
   Highlights the #1 mistake: `ask_question` with `options: null`.
5. **All 14 agent files** — description frontmatter now references
   `CLINE_TOOLS.md`. The `agent-browser.md` agent (the only one
   that didn't reference the baseline) now does too.
6. **`cli/commands/validate.mjs`** — new `mistake-limit-floor`
   check (lenient warn).
7. **`scripts/check-agents.mjs`** (new) — CI check that all 14
   agents reference the shared docs.
8. **`scripts/bh-full-e2e.mjs`** — runs check-agents.mjs as part
   of e2e.

### User-reported trigger

> "all writes hang after the first failure, 'Tool execution was
> interrupted before a result was produced'." — Claude Code's log:
> `max consecutive mistakes reached (3) in yolo mode`. The model
> had tried 4 different approaches to edit a Dockerfile (editor,
> python heredoc, single-line python, sed) and all failed.

The fix is two-pronged:
- **Runtime:** the plugin's higher mistake limit (10) always wins
  via the Math.max floor.
- **Agent training:** every agent now has the exact tool schemas in
  their context, so they make fewer mistakes in the first place.

## What landed in v6.2.3

Full Claude Code CLI integration per the official Claude Code docs (https://docs.claude.com/claude-code):
- [cli/cli-reference](https://docs.claude.com/claude-code/cli/cli-reference)
- [cli/agent-teams](https://docs.claude.com/claude-code/cli/agent-teams)
- [features/subagents](https://docs.claude.com/claude-code/features/subagents)
- [cli/samples](https://docs.claude.com/claude-code/cli/samples/)

### Patches

1. **`plugins/bizar/src/clineruntime.ts:163`** — flipped
   `enableSpawnAgent: false` → `true`. Silent v6.0.0 regression
   that blocked Claude Code's Agent tool (subagent dispatch). Without
   this, Odin could not delegate to subagents.
2. **`cli/commands/setup-provider.mjs`** — wrote to the wrong file
   (v6.2.2 was `~/.claude/settings.json`, fixed to
   `~/.claude/settings.json` which is what Claude Code CLI
   + kanban mode actually read). Now also auto-migrates any legacy
   `openai-compatible` providerId to `litellm`.
3. **`cli/commands/cline-cmd.mjs`** (new) — pass-through wrappers:
   - `bizar config` → `claude config`
   - `bizar history` → `claude history`
   - `bizar hub` → `claude hub`
   - `bizar hook` → `claude hook`
   - `bizar team <name> "mission"` → use the Agent tool (note Claude Code has agent teams via Agent tool `team_name`)
   - `bizar subagent <agent> "task"` → research subagent
4. **`cli/commands/rca.mjs`** (new) — `bizar rca <github-issue-url>`
   adapted from the official Claude Code Agent SDK GitHub Issue RCA sample.
5. **`cli/commands/validate.mjs`** — new `cline-settings-provider`
   check that warns about fake/legacy providerIds in
   `~/.claude/settings.json`.
6. **`scripts/bh-full-e2e.mjs`** — added 3 new e2e checks
   (subagent plumbing, cline-cmd wrappers, rca sample).

## What landed in v6.2.2

Per operator request: the installer used to add a `provider.9router`
block to `~/.claude/settings.json` on every install. That's now removed —
the user picks their own provider. New `bizar setup-provider` CLI
command (and matching `/setup-provider` Claude Code slash command) make it
easy to add a provider with the live catalog from
`http://localhost:20128/v1/models`.

### Patches

1. **`config/cline.json.template`** — removed the `provider` block
   entirely (9router + minimax). Template is now provider-free.
2. **`cli/provision.mjs:patchClineJson`** — stopped auto-adding
   `provider.9router` and `provider.minimax`. Still backfills the
   Bizar scaffolding (plugin entry, default_agent, $schema,
   instructions, permission, snapshot) but NOT provider config.
3. **`cli/commands/setup-provider.mjs`** (new) — `bizar setup-provider`
   subcommand. Writes a `provider` block with `baseUrl` + `apiKey` +
   live model catalog. Flags: `--list`, `--remove`, `--gateway`,
   `--key`, `--provider`.
4. **`config/commands/setup-provider.md`** (new) — the matching
   `/setup-provider` Claude Code slash command.
5. **`cli/commands/validate.mjs`** — `provider-config` is now
   ALWAYS lenient (informational, never fails). New behavior
   reports whatever providers the user has configured.
6. **Agent `model:` fields** — updated to use the live gateway
   prefix `minimaxcustom/MiniMax-M3` (was stale `minimax/MiniMax-M3`).
   Same for `model` and `small_model` in claude settings.json template.
7. **Post-install hint** — when no provider is configured, the
   installer prints a clear setup hint pointing at `bizar setup-provider`.

## What landed in v6.2.1

Fixes the "I see skills but no hooks" user report. v6.0.0 shipped
"hooks" as markdown behavioral files in `~/.claude/hooks/` which Claude Code
silently ignored. v6.2.1 replaces them with five real Claude Code-native
executable hook scripts.

### Patches

1. **`config/hooks/{PreToolUse,PostToolUse,TaskStart,TaskResume,UserPromptSubmit}`** (new) —
   five real executable hook scripts with shebang lines:
   - `PreToolUse` blocks writes to `.env`/`secrets/`/`node_modules`/
     lockfiles; warns on `console.log`/`debugger`/`.only()` in `src/`
   - `PostToolUse` logs tool latency to `~/.config/bizar/hook-logs/`
   - `TaskStart` primes the AI with project context
   - `TaskResume` reminds the AI to re-read state + check git log
   - `UserPromptSubmit` tags the prompt for routing
2. **`cli/provision.mjs:syncConfigExtras`** — installs hooks to BOTH
   `~/.claude/hooks/` AND `~/Documents/Claude/Hooks/` (Claude Code's default
   global hooks location), with `chmod +x`.
3. **`cli/commands/validate.mjs`** — `hooks-installed` now verifies
   shebang + executable bit (not just file presence). New
   `hooks-canonical-location` check confirms
   `~/Documents/Claude/Hooks/` is populated.
4. **`scripts/bh-full-e2e.mjs`** — new check verifies
   `config/hooks/` has all 5 Claude Code-native hook scripts with shebangs.
5. **Removed** the obsolete `config/hooks/{pre-tool-use,post-tool-use,README}.md`
   (markdown behavioral files that Claude Code never read).

## What landed in v6.2.0

Made Bizar's Claude Code integration end-to-end flawless: every plugin
artifact, slash command, agent file, skill, rule, hook, and provider
config now lands in the user's `~/.claude/` on every install. New
`bizar validate` + `/validate` Claude Code command, plus `/team` and
`/test` slash commands. The `make e2e` infrastructure is restored.

### Patches

1. **`plugins/bizar/src/clineruntime.ts:164`** — flipped
   `enableAgentTeams: false` → `true`. The `bizar_spawn_team` tool
   requires agent-teams to be enabled in Claude Code's session config;
   without this, `/team` and the team coordinator were silently
   unavailable.

2. **`config/cline.json.template`** — added three new slash command
   entries to the `command:` block:
   - `team` (routes to `odin`, template `commands-bizar/team.md`) —
     spawns a Claude Code agent team (Odin + Thor + Tyr + Mimir + Hermod +
     Forseti) for parallel multi-agent missions.
   - `test` (routes to `thor`, template `commands-bizar/test.md`) —
     thin wrapper around `bizar test-gate`, auto-detects the
     project's test runner.
   - `validate` (routes to `heimdall`, template
     `commands-bizar/validate.md`) — runs the full 21-point
     `bizar validate` check battery.

3. **`config/commands/team.md`** (new) — comprehensive guide for
   the `/team` command. Default team composition, decomposition
   rules, the pre-dispatch checklist, the sibling-awareness block,
   and three worked example missions (refactor, multi-feature
   build, bug hunt).

4. **`config/commands/test.md`** (new) — documents the `/test`
   slash command and its relationship to `bizar test-gate`.

5. **`config/commands/validate.md`** (new) — documents the
   `/validate` slash command and its 21 checks.

6. **`cli/commands/validate.mjs`** (new) — the `bizar validate`
   subcommand. 21-point health check that confirms:
   - claude CLI reachable + version
   - claude settings.json parses + plugin entry + path resolves
   - plugin runtime deps (zod, @anthropic-ai/claude-agent-sdk) wired
   - plugin index.ts + enableAgentTeams plumbing (regression check)
   - all 14 agent files installed + Claude Code .yaml format
   - all 13 slash commands (incl. /team, /test, /validate)
   - all skills / rules / hooks mirrored to ~/.claude/
   - provider.9router (preferred) or provider.minimax (legacy)
   - 9Router gateway reachable (lenient unless --strict)
   - default_agent + instructions[] in claude settings.json

   Flags: `--json` for machine output, `--strict` to fail on
   lenient checks, `--only <name>` to run a single check.

7. **`cli/commands/validate.test.mjs`** (new) — 15 unit tests
   covering: JSON output shape, missing-team/test/validate command
   detection, missing-agent detection, claude settings.json absence,
   enableAgentTeams regression, provider-config missing,
   9router-only / minimax-only configurations, --strict mode,
   --only filter, unknown --only name.

8. **`cli/provision.mjs:patchClineJson()`** — refactored to be
   more robust. On every install/update it now patches the
   following on the user's claude settings.json (additive, idempotent):
   - `plugin` entry (the critical one — Bizar plugin won't load
     without it)
   - `provider.9router` (the v6.0.1+ preferred gateway)
   - `provider.minimax` (legacy fallback)
   - `default_agent` (set to "odin" if missing)
   - `$schema` (https://docs.claude.com/claude-code/config.json)
   - `instructions` (point at the bundled tools reference)
   - `permission` ("allow")
   - `snapshot` (false)
   The previous version only added the plugin entry on first
   install; subsequent updates didn't backfill the other fields.

9. **`scripts/bh-full-e2e.mjs`** (new) — the 15-check end-to-end
   verifier. Lives at `scripts/bh-full-e2e.mjs` (not `/tmp/` —
   that was a pre-existing infra gap that blocked `make e2e` and
   clean-check dimension #5 since v5.6.0). Checks:
   - plugin entry resolves
   - enableAgentTeams: true in clineruntime.ts
   - claude settings.json.template completeness
   - config/commands/ has team/test/validate
   - config/agents/ has all 14 agents
   - config/skills/ has 8+ skills
   - config/rules/ has 7 always-on rules
   - plugin index.ts is well-formed
   - plugin source has 19+ tool files
   - plugin has 4+ hooks
   - claude CLI reachable
   - ClineRuntime class is importable
   - bizar validate command + tests present
   - package.json valid
   - TypeScript compiles cleanly

10. **`Makefile` + `scripts/clean-state-check.sh`** — point at
    `scripts/bh-full-e2e.mjs` instead of the missing
    `/tmp/bh-full-e2e.mjs`. `make e2e` and clean-check #5 now work.

11. **`package.json` `test` script** — added
    `cli/install.test.mjs`, `cli/provision.test.mjs`,
    `cli/commands/validate.test.mjs` to the npm test pipeline.
    Previously these only ran via `make test` (which also picks
    them up); now they're explicit so CI catches any regression.

12. **`.claude/instructions/bizar-tools.md`** — removed the
    lingering "opencode" references that survived the v6.1.0
    Cline-only rewrite. Now correctly says "Claude Code" and references
    `headroom wrap claude` / `~/.claude/skills/`.

### Tests

- `plugins/bizar/tests/clineruntime-config.test.ts` — 3 new cases
  pinning `enableAgentTeams: true` so the v6.0.0-era "false" can't
  silently regress.
- `cli/commands/validate.test.mjs` — 15 cases (new file).
- `scripts/bh-full-e2e.mjs` — 15 e2e checks (new file).

### Migration

Operators on a v6.1.0 install should run `bizar update` to pull
the new command files (team.md, test.md, validate.md) and the
patched clineruntime.ts (enableAgentTeams: true). The update is
backwards-compatible and idempotent.

## What landed in v6.0.1

Diagnosed root cause of "Claude Code keeps stopping" (Claude Code aborting sessions
after 3 consecutive tool-validation failures — bundled CLI default).

### Patches
1. **`plugins/bizar/src/clineruntime.ts`** (now wraps Claude Code Agent SDK) — `startSession` now passes through
   the `execution` block (`maxConsecutiveMistakes`, `reminderAfterIterations`,
   `reminderText`, `loopDetection`) and wires an `onConsecutiveMistakeLimitReached`
   callback by default. Runtime constructor accepts `defaultMaxConsecutiveMistakes`
   and `defaultOnConsecutiveMistakeLimitReached` so every session inherits them
   unless the caller overrides.

2. **`plugins/bizar/src/mistake-recovery.ts`** (new) — pure helper that
   builds the recovery callback. Recoverable mistakes
   (`invalid_tool_call`, `tool_execution_failed`) return
   `{action:"continue", guidance:"..."}` so the session keeps running with a
   guidance message; infra failures (`api_error`) return `{action:"stop"}`.

3. **`plugins/bizar/src/tool-discipline.ts`** (new) — system-prompt directive
   appended by `beforeModel`. Tells the model to populate all required schema
   fields, prefer built-in tools over bash (`read_file`, `editor`, `search`,
   `apply_patch`, `list_files`, `web_fetch`), keep `run_commands` small (≈600
   char ceiling, no `for`/`xargs`/`sed -i`/`heredoc`), and switch tools after
   two identical failures.

4. **`plugins/bizar/src/options.ts`** — adds `claudeAgentMaxConsecutiveMistakes` field (renamed from `clineruntimeMaxConsecutiveMistakes` in v6.3.0)
   normalized option (default 6, range [3, 20], env `BIZAR_MAX_CONSECUTIVE_MISTAKES`).

5. **`plugins/bizar/index.ts`** — wires the recovery callback into the
   runtime; `beforeModel` injects the tool-discipline directive idempotently.

6. **`cli/provision.mjs:syncConfigExtras`** — now also copies `config/rules/*.md`
   into `${CLAUDE_DIR}/rules/`. Pre-existing gap: `bizar install` / `bizar update`
   were silently skipping the always-on rules in `~/.claude/rules/`.

7. **`config/cline.json.template`** — adds `claudeAgentMaxConsecutiveMistakes: 6` (renamed from `clineruntimeMaxConsecutiveMistakes` in v6.3.0)
   to the Bizar plugin metadata block so a fresh `bizar install` writes the
   new field automatically.

### Tests
- `plugins/bizar/tests/mistake-recovery.test.ts` (10 cases)
- `plugins/bizar/tests/tool-discipline.test.ts` (9 cases)
- `plugins/bizar/tests/clineruntime-config.test.ts` (6 cases)
- `plugins/bizar/tests/options.test.ts` — 7 new cases for the field
- `cli/provision.test.mjs` — 2 new cases for rules sync

### v6.0.1 hotfix #2: 9Router gateway
All Bizar agents now route chat through 9Router at `http://localhost:20128/v1`
(the user's existing 9Router instance with MiniMax keys + auto-fallback to
free models on `kr/*` and `openrouter/*:free` IDs). Plus 8 capability
skills for the full 9Router feature surface — chat, web-search, web-fetch,
image, TTS, STT, embeddings — installed automatically by
`syncConfigExtras` into `~/.claude/skills/9router*/SKILL.md`.

| Patches |
|---|
| `config/skills/9router*/SKILL.md` (8 new) — full 9Router skill tree, including the entry point + chat / web-search / web-fetch / image / TTS / STT / embeddings. |
| `config/cline.json.template` — added `provider.9router` block (`baseUrl: http://localhost:20128/v1`, `apiKey: ${NINEROUTER_KEY}`). Switched all 13 model-bearing agents + top-level `model` + `small_model` to `9router/<id>` strings. |
| `cli/doctor.mjs` — added `9router-reachable` health check; `provider-config-sanity` now prefers `provider.9router` (falls back to legacy `provider.minimax`). |
| `cli/doctor.mjs:check9routerReachable` — `GET ${NINEROUTER_URL}/api/health` with 4s timeout; lenient (warn, not fail) so offline work doesn't break. |

Operators: re-run `bizar install` to push the new provider block to
`~/.claude/settings.json`. `NINEROUTER_URL` env var overrides the default
endpoint (handy when 9Router runs inside a container/tunnel).

## Recent releases

| Version             | Date       | Type   | Notes                                       |
| ------------------- | ---------- | ------ | ------------------------------------------- |
| **v6.3.0**          | 2026-07-11 | major  | Claude Code migration (plugin → MCP, skills, hooks) |
| **v6.1.0**          | 2026-07-09 | dev    | Cline-exclusive; superseded by v6.3.0 Claude Code migration |
| **v6.0.2**          | 2026-07-09 | patch  | fix dashboard-presence check in legacy installer |
| **v6.0.1**          | 2026-07-09 | dev    | Claude Code mistake-recovery + tool-discipline + rules-sync + 9router gateway |
| **v6.0.0-beta.1**   | 2026-07-08 | BETA   | CURRENT_ISSUES sprint — Odin, /loop, slash commands, vault linking |
| v5.6.0-beta.17      | 2026-07-07 | BETA   | general repo cleanup release                |
| v5.6.0-beta.1       | 2026-07-07 | BETA   | OpenCode → Cline rewrite (4 phases)        |
| v5.5.6              | 2026-07-07 | stable | new `/plow-through` slash command          |

## In Progress

_None._

## Blockers

- **`/tmp/bh-full-e2e.mjs` is missing globally.** Blocks `make e2e` and
  clean-check dimension #5 (startup path). Pre-existing — exists in
  `clean-state-check.sh` line 68 but no code path generates the file. Out
  of scope for v6.0.1.

## Recent sessions

| Date       | Phase | Outcome                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
| 2026-07-11 | 7     | v6.3.0 — Claude Code migration COMPLETE                     |
| 2026-07-09 | 6     | v6.0.1 — Claude Code mistake-recovery + tool-discipline + rules-sync |
| 2026-07-08 | 5     | CURRENT_ISSUES sprint COMPLETE — published v6.0.0-beta.1  |
| 2026-07-07 | 3     | In-process ClineRuntime + agent teams + memory vault + E2E  |
| 2026-07-07 | 2     | OpenCode → Cline rewrite (17 tools, 4 hooks)                |
| 2026-07-07 | 1     | Mechanical OpenCode→Cline rename + @cline/sdk wiring        |

## Verification commands (single source of truth)

```sh
make check       # typecheck + tests (full pipeline) — 746/746 pass
make test        # unit tests only
make e2e         # real plugin load + tool invocation — BLOCKED (script missing)
make clean-check # 5-dimension exit verification — 4/5 pass (E2E blocked)
make vcr         # feature_list VCR ratio — 25/25 = 1.000
```
