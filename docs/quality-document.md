# Quality Document — Module Health Scores

> Per-module health scores across 5 dimensions. New sessions read
> this to know where to prioritize work. Updated at every sprint end.

## Scoring

Each module scored A/B/C/D on:
- **Correctness:** Tests pass + edge cases handled
- **Arch compliance:** Follows `.harness/arch-rules.json`
- **Test coverage:** Unit + E2E coverage
- **Verification evidence:** Test output + commit hash
- **Documentation:** Doc-code consistency (no stale docs)

| Module             | Correctness | Arch | Tests | Evidence | Docs | Notes                          |
| ------------------ | ----------- | ---- | ----- | -------- | ---- | ------------------------------ |
| `plugins/bizar/`   | A           | A    | A     | A        | A    | Phase 3 complete; 19 tools     |
| `plugins/bizar/src/clineruntime.ts` | A | A | A  | A        | A    | New in Phase 3                |
| `plugins/bizar/src/memory-vault.ts` | A | A | A  | A        | A    | New in Phase 3                |
| `plugins/bizar/src/tools/` | A    | A    | A     | A        | A    | 19 tools, all use createTool   |
| `packages/sdk/`    | A           | A    | A     | A        | B    | Thin wrapper; some tests pre-exist |
| `bizar-dash/`      | A           | A    | B     | B        | A    | Kanban + tasks full feature    |
| `bizar-dash/src/server/bg-spawner.mjs` | A | A | B | B    | A    | Uses ClineCore in-process      |
| `scripts/`         | A           | A    | A     | A        | A    | 4 scripts (verify/arch/clean/trace) |
| `templates/`       | A           | A    | -     | -        | A    | 3 templates (sprint/rubric/checklist) |
| `.harness/`        | A           | A    | A     | A        | A    | arch-rules + traces            |

## Hotspots (next priorities)

1. **Cline agent teams end-to-end** — tools are registered but not
   yet exercised in CI. Add `make e2e-team` target.
2. **Dashboard ↔ ClineCore event subscription** — bg-spawner.mjs
   subscribes but the kanban board doesn't yet visualize team events.
3. **Memory vault search ranking** — substring match is naive;
   add TF-IDF or BM25 scoring.

## Recent improvements

- **Phase 3 (2026-07-07):** In-process ClineRuntime replaces subprocess,
  in-process memory vault, Cline agent teams, kanban integration.
- **Phase 2 (2026-07-07):** All 17 tools ported to `@cline/sdk`.
- **Phase 1 (2026-07-07):** Mechanical OpenCode → Cline rename.
