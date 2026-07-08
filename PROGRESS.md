# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## Current State

- **Last commit:** b4ee7c5 (v6.0.0-beta.1 release + version bump)
- **Released:** @polderlabs/bizar@6.0.0-beta.1, @polderlabs/bizar-sdk@0.3.0-beta.1
- **`make check`:** 715/715 pass, 0 TS errors
- **`make test`:** all pass (50 files, 1678 expects)
- **`make e2e`:** 16/16 pass via `/tmp/bh-full-e2e.mjs`
- **`make clean-check`:** 5/5 dimensions pass
- **`make vcr`:** 22/22 = 1.000
- **Branch:** master (pushed to origin)
- **Phase:** v6.0.0 — **CURRENT_ISSUES sprint COMPLETE + RELEASED**

## Sprint Status: ✅ DONE

All 5 items from `CURRENT_ISSUES_ AND_NEW_FEATURES.md` shipped:

1. ✅ **Odin orchestrator + Cline agent teams** (`plugins/bizar/src/odin.ts`)
   - Heuristic sentence-based task decomposition
   - Role templates: mimir/thor/forseti/vidarr/tyr/frigg/baldr/heimdall
   - `/odin <task>` slash command builds Odin system prompt

2. ✅ **Loop engineering** (`plugins/bizar/src/loop-engineering.ts` + tools)
   - Patterns: ralph, repl, cron, plan-execute
   - 5 tools wired (start, status, stop, list, delete)
   - Inspired by cobusgreyling + rudy2steiner catalogs

3. ✅ **All 22+ slash commands wired** (`plugins/bizar/src/commands.ts`)
   - 33 new handlers added; total 38 slash commands recognized
   - `/help` lists all of them

4. ✅ **Memory vault linking fixed** (`cli/memory.mjs` + dash endpoint)
   - `bizar memory link <url>` now handles missing/empty/non-empty vaults
   - `--force` backs up + replaces; `--target DIR` overrides destination
   - Node native `copyDir()` (avoids BusyBox `cp --exclude` quirks)
   - `POST /api/memory/link` endpoint added to dash

5. ✅ **Dash Memory Vault linking** (`bizar-dash/src/server/routes/memory.mjs`)
   - New endpoint wires the CLI `link` command over HTTP

## Recent releases

| Version             | Date       | Type   | Notes                                       |
| ------------------- | ---------- | ------ | ------------------------------------------- |
| **v6.0.0-beta.1**   | 2026-07-08 | BETA   | CURRENT_ISSUES sprint — Odin, /loop, slash commands, vault linking |
| v5.6.0-beta.17      | 2026-07-07 | BETA   | general repo cleanup release                |
| v5.6.0-beta.1       | 2026-07-07 | BETA   | OpenCode → Cline rewrite (4 phases)        |
| v5.5.6              | 2026-07-07 | stable | new `/plow-through` slash command          |

## Blockers

_None._

## Recent sessions

| Date       | Phase | Outcome                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
| 2026-07-08 | 5     | CURRENT_ISSUES sprint COMPLETE — published v6.0.0-beta.1  |
| 2026-07-07 | 3     | In-process ClineRuntime + agent teams + memory vault + E2E  |
| 2026-07-07 | 2     | OpenCode → Cline rewrite (17 tools, 4 hooks)                |
| 2026-07-07 | 1     | Mechanical OpenCode→Cline rename + @cline/sdk wiring        |

## Verification commands (single source of truth)

```sh
make check       # typecheck + tests (full pipeline) — 715/715 pass
make test        # unit tests only
make e2e         # real plugin load + tool invocation — 16/16 pass
make clean-check # 5-dimension exit verification — 5/5 pass
make vcr         # feature_list VCR ratio — 22/22 = 1.000
```
