# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## Current State

- **Last commit:** 0fcdec2 (Phase 4)
- **`make check`:** passing (22/22 E2E, 0 TS errors)
- **`make test`:** 637/639 plugin + 71/74 SDK pass (2 pre-existing unrelated on plugin + 3 in research/)
- **`make e2e`:** 22/22 pass via `/tmp/bh-full-e2e.mjs`
- **Branch:** `migrate/cline-replacement`
- **Phase:** v6.0.0 — **CURRENT_ISSUES_AND_NEW_FEATURES implementation sprint**

## In Progress (Sprint: CURRENT_ISSUES sprint)

Active feature (WIP=1): **Odin orchestrator + Loop engineering + Slash commands + Memory vault linking + Dash update**

This sprint covers `CURRENT_ISSUES_ AND_NEW_FEATURES.md` (5 items):

1. **Odin orchestrator + Cline agent teams integration** —
   `plugins/bizar/src/tools/odin.ts`, `src/tools/odin-delegate.ts`,
   `src/hooks/odin-decompose.ts`. Routes user prompts to team spawn.
2. **Full /loop integration** (loop-engineering pattern) —
   `plugins/bizar/src/tools/loop.ts`, `src/loop-engineering.ts`,
   `cli/commands/loop.mjs`. Inspired by cobusgreyling/loop-engineering
   + rudy2steiner/awesome-agent-loops.
3. **Wire all 22 slash commands into Cline** —
   `src/commands-impl.ts` already has the table; need to register each
   one with `api.registerCommand()` so Cline shows them in the slash menu.
4. **Memory vault linking (clone existing repo)** —
   `cli/commands/memory.mjs:link` currently fails when vault isn't
   git-init'd. Fix: allow `link <url-or-path>` without prior init.
5. **Dash update for memory vault linking** —
   `bizar-dash/src/views/MemoryVault.tsx` (or equivalent) — add Link
   button, fix init gating.

## Next Steps (priority order within this sprint)

1. ✅ Odin tool + team delegation wiring
2. ✅ /loop command + loop-engineering module
3. ✅ Slash command registration pass (22 commands)
4. ✅ Memory vault link fix + init-less clone
5. ✅ Dash: MemoryVault view + Link UI
6. Run `make check` → must be green before commit.
7. `make vcr` — feature_list.json updated, all marked `passing`.
8. Commit + push branch + publish v6.0.0-beta.1.

## Recent releases

| Version         | Date       | Type   | Notes                                          |
| --------------- | ---------- | ------ | ---------------------------------------------- |
| v5.6.0-beta.1   | 2026-07-07 | BETA   | OpenCode → Cline rewrite (4 phases)            |
| v5.5.6          | 2026-07-07 | stable | new `/plow-through` slash command              |

## Blockers

_None currently._

## Recent sessions

| Date       | Phase | Outcome                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
| 2026-07-08 | 5     | CURRENT_ISSUES sprint — Odin, /loop, slash cmds, vault    |
| 2026-07-07 | 3     | In-process ClineRuntime + agent teams + memory vault + E2E  |
| 2026-07-07 | 2     | OpenCode → Cline rewrite (17 tools, 4 hooks)                |
| 2026-07-07 | 1     | Mechanical OpenCode→Cline rename + @cline/sdk wiring        |

## Verification commands (single source of truth)

```sh
make check       # typecheck + tests (full pipeline)
make test        # unit tests only
make e2e         # real plugin load + tool invocation (22 checks)
make clean-check # 5-dimension exit verification
make vcr         # feature_list VCR ratio
```
