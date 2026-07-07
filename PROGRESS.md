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
- **Phase:** v6.0.0 — Phase 4 complete (full harness audit 73/73); **v5.6.0-beta.1 published**

## In Progress

_Nothing currently active. WIP=1 is enforced. Next: pick a `not_started` feature from `feature_list.json` to begin a new sprint._

## Next Steps (priority order)

1. **Stabilize beta** — address issues reported by v5.6.0-beta.1 users.
   Move to v5.6.0 stable once no critical bugs reported for 1 week.
2. **Fix pre-existing test failures** — `InstanceManager.update mutex regression`,
   `config drift detection`, `OpenClaw SDK package e2e`. Promote to `.harness/arch-rules.json`.
3. **Add E2E team-spawn test** — verify `bizar_spawn_team` actually creates a Cline team session.
4. **Wire team progress events to the kanban** — Tasks.tsx should show real-time
   progress from team_progress_projection events as cards move between columns.
5. **Replace legacy `serve.ts / http-client.ts / event-stream.ts`** — they're now dead code
   (replaced by `clineruntime.ts`). Delete to remove confusion.
6. **Polish Harness dashboard** — add live audit scores, VCR ratio, link to feature_list.json
   from the new Harness tab.

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
