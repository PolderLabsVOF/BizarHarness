# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## Current State

- **Last commit:** v6.0.1 — Cline mistake-recovery + tool-discipline + rules-sync + 9router gateway
- **Released:** (unreleased; on master)
- **`make check`:** 746/746 pass, 0 TS errors (53 files; +31 vs v6.0.0-beta.1)
- **`make test`:** all pass (53 files, 1754 expects)
- **`make e2e`:** N/A — `/tmp/bh-full-e2e.mjs` script is missing globally (pre-existing infra gap, unrelated to this PR)
- **`make clean-check`:** 4/5 dimensions pass; #5 (startup path) blocked by missing E2E script (pre-existing)
- **`make vcr`:** 26/26 = 1.000
- **Branch:** master
- **Phase:** v6.0.1 — **Cline STOPPING DIAGNOSIS + FIX + 9ROUTER GATEWAY**

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
| **v6.0.1**          | 2026-07-09 | dev    | Cline mistake-recovery + tool-discipline + rules-sync |
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
