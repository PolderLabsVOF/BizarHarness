# PROGRESS.md — Cross-Session State

> This file is the **single source of truth** for what the system is doing
> right now. Updated at every clock-in AND clock-out. New sessions start
> by reading this file before touching any code.

## Current State

- **Last commit:** 3511390 (Phase 3)
- **`make check`:** passing (22/22 E2E, 0 TS errors)
- **`make test`:** 637/639 plugin + 71/74 SDK pass (2 pre-existing unrelated on plugin + 3 in research/)
- **`make e2e`:** 22/22 pass via `/tmp/bh-full-e2e.mjs`
- **Branch:** `migrate/cline-replacement`
- **Phase:** v6.0.0 — Phase 3 complete (in-process ClineRuntime + agent teams + memory vault)

## In Progress

_Nothing currently active. WIP=1 is enforced. Next: pick a `not_started` feature from `feature_list.json` to begin a new sprint._

## Next Steps (priority order)

1. **Fix pre-existing test failures** — 3 unrelated: `InstanceManager.update mutex regression`,
   `config drift detection`, `OpenClaw SDK package e2e`. Promote them to `.harness/arch-rules.json`
   if they relate to harness.
2. **Add E2E team-spawn test** — verify `bizar_spawn_team` actually creates a Cline team session.
3. **Wire team events to the kanban** — dashboard's Tasks.tsx should show team progress
   events as cards move between columns.
4. **Replace legacy `serve.ts / http-client.ts / event-stream.ts`** — they're now dead code
   (replaced by `clineruntime.ts`). Delete to remove confusion.

## Blockers

_None currently._

## Recent sessions

| Date       | Phase | Outcome                                                     |
| ---------- | ----- | ----------------------------------------------------------- |
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
