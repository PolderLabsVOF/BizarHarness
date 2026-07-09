# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## Current State

- **Last commit:** v6.2.1 — hooks now actually work in Cline (executable scripts, not markdown)
- **Released:** (unreleased; on master)
- **`make check`:** 749/749 pass, 0 TS errors
- **`make test`:** 780/780 pass (53 plugin/sdk files + 31 CLI tests)
- **`make e2e`:** 16/16 pass (real plugin + cline integration verification)
- **`make clean-check`:** 5/5 dimensions pass
- **`make vcr`:** 27/27 = 1.000
- **Branch:** master
- **Phase:** v6.2.1 — **Cline hooks fix**

## What landed in v6.2.1

Fixes the "I see skills but no hooks" user report. v6.0.0 shipped
"hooks" as markdown behavioral files in `~/.cline/hooks/` which Cline
silently ignored. v6.2.1 replaces them with five real Cline-native
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
   `~/.cline/hooks/` AND `~/Documents/Cline/Hooks/` (Cline's default
   global hooks location), with `chmod +x`.
3. **`cli/commands/validate.mjs`** — `hooks-installed` now verifies
   shebang + executable bit (not just file presence). New
   `hooks-canonical-location` check confirms
   `~/Documents/Cline/Hooks/` is populated.
4. **`scripts/bh-full-e2e.mjs`** — new check verifies
   `config/hooks/` has all 5 Cline-native hook scripts with shebangs.
5. **Removed** the obsolete `config/hooks/{pre-tool-use,post-tool-use,README}.md`
   (markdown behavioral files that Cline never read).

## What landed in v6.2.0

Made Bizar's Cline integration end-to-end flawless: every plugin
artifact, slash command, agent file, skill, rule, hook, and provider
config now lands in the user's `~/.cline/` on every install. New
`bizar validate` + `/validate` Cline command, plus `/team` and
`/test` slash commands. The `make e2e` infrastructure is restored.

### Patches

1. **`plugins/bizar/src/clineruntime.ts:164`** — flipped
   `enableAgentTeams: false` → `true`. The `bizar_spawn_team` tool
   requires agent-teams to be enabled in ClineCore's session config;
   without this, `/team` and the team coordinator were silently
   unavailable.

2. **`config/cline.json.template`** — added three new slash command
   entries to the `command:` block:
   - `team` (routes to `odin`, template `commands-bizar/team.md`) —
     spawns a Cline agent team (Odin + Thor + Tyr + Mimir + Hermod +
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
   - cline CLI reachable + version
   - cline.json parses + plugin entry + path resolves
   - plugin runtime deps (zod, @cline/sdk, @cline/core) wired
   - plugin index.ts + enableAgentTeams plumbing (regression check)
   - all 14 agent files installed + Cline .yaml format
   - all 13 slash commands (incl. /team, /test, /validate)
   - all skills / rules / hooks mirrored to ~/.cline/
   - provider.9router (preferred) or provider.minimax (legacy)
   - 9Router gateway reachable (lenient unless --strict)
   - default_agent + instructions[] in cline.json

   Flags: `--json` for machine output, `--strict` to fail on
   lenient checks, `--only <name>` to run a single check.

7. **`cli/commands/validate.test.mjs`** (new) — 15 unit tests
   covering: JSON output shape, missing-team/test/validate command
   detection, missing-agent detection, cline.json absence,
   enableAgentTeams regression, provider-config missing,
   9router-only / minimax-only configurations, --strict mode,
   --only filter, unknown --only name.

8. **`cli/provision.mjs:patchClineJson()`** — refactored to be
   more robust. On every install/update it now patches the
   following on the user's cline.json (additive, idempotent):
   - `plugin` entry (the critical one — Bizar plugin won't load
     without it)
   - `provider.9router` (the v6.0.1+ preferred gateway)
   - `provider.minimax` (legacy fallback)
   - `default_agent` (set to "odin" if missing)
   - `$schema` (https://docs.cline.bot/config.json)
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
   - cline.json.template completeness
   - config/commands/ has team/test/validate
   - config/agents/ has all 14 agents
   - config/skills/ has 8+ skills
   - config/rules/ has 7 always-on rules
   - plugin index.ts is well-formed
   - plugin source has 19+ tool files
   - plugin has 4+ hooks
   - cline CLI reachable
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

12. **`.cline/instructions/bizar-tools.md`** — removed the
    lingering "opencode" references that survived the v6.1.0
    Cline-only rewrite. Now correctly says "Cline" and references
    `headroom wrap cline` / `~/.cline/skills/`.

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

Diagnosed root cause of "Cline keeps stopping" (Cline runtime aborting sessions
after 3 consecutive tool-validation failures — bundled CLI default).

### Patches
1. **`plugins/bizar/src/clineruntime.ts`** — `startSession` now passes through
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

4. **`plugins/bizar/src/options.ts`** — adds `clineruntimeMaxConsecutiveMistakes`
   normalized option (default 6, range [3, 20], env `BIZAR_MAX_CONSECUTIVE_MISTAKES`).

5. **`plugins/bizar/index.ts`** — wires the recovery callback into the
   runtime; `beforeModel` injects the tool-discipline directive idempotently.

6. **`cli/provision.mjs:syncConfigExtras`** — now also copies `config/rules/*.md`
   into `${CLINE_DIR}/rules/`. Pre-existing gap: `bizar install` / `bizar update`
   were silently skipping the always-on rules in `~/.cline/rules/`.

7. **`config/cline.json.template`** — adds `clineruntimeMaxConsecutiveMistakes: 6`
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
`syncConfigExtras` into `~/.cline/skills/9router*/SKILL.md`.

| Patches |
|---|
| `config/skills/9router*/SKILL.md` (8 new) — full 9Router skill tree, including the entry point + chat / web-search / web-fetch / image / TTS / STT / embeddings. |
| `config/cline.json.template` — added `provider.9router` block (`baseUrl: http://localhost:20128/v1`, `apiKey: ${NINEROUTER_KEY}`). Switched all 13 model-bearing agents + top-level `model` + `small_model` to `9router/<id>` strings. |
| `cli/doctor.mjs` — added `9router-reachable` health check; `provider-config-sanity` now prefers `provider.9router` (falls back to legacy `provider.minimax`). |
| `cli/doctor.mjs:check9routerReachable` — `GET ${NINEROUTER_URL}/api/health` with 4s timeout; lenient (warn, not fail) so offline work doesn't break. |

Operators: re-run `bizar install` to push the new provider block to
`~/.cline/cline.json`. `NINEROUTER_URL` env var overrides the default
endpoint (handy when 9Router runs inside a container/tunnel).

## Recent releases

| Version             | Date       | Type   | Notes                                       |
| ------------------- | ---------- | ------ | ------------------------------------------- |
| **v6.1.0**          | 2026-07-09 | dev    | Cline-exclusive; OpenCode support removed   |
| **v6.0.2**          | 2026-07-09 | patch  | fix dashboard-presence check in legacy installer |
| **v6.0.1**          | 2026-07-09 | dev    | Cline mistake-recovery + tool-discipline + rules-sync + 9router gateway |
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
| 2026-07-09 | 6     | v6.0.1 — Cline mistake-recovery + tool-discipline + rules-sync |
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
