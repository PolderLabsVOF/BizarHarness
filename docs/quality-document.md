# Quality Document — Module Health Scores

> Per-module A/B/C/D scores across 5 dimensions. New sessions
> read this to know where to prioritize work. Updated at every
> sprint end via the `evaluator-rubric.md` template.

## Scoring

Each module scored A/B/C/D on:

- **Correctness** — Tests pass + edge cases handled
- **Arch compliance** — Follows `.harness/arch-rules.json`
- **Test coverage** — Unit + E2E coverage
- **Verification evidence** — Test output + commit hash
- **Documentation** — Doc-code consistency (no stale docs)

## Module scores (v6.0.0-beta.4)

| Module | Correctness | Arch | Tests | Evidence | Docs | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `plugins/bizar/` | A | A | A | A | A | 22 tools, 4 hooks, 1 gate |
| `plugins/bizar/src/clineruntime.ts` | A | A | A | A | A | In-process ClineCore |
| `plugins/bizar/src/memory-vault.ts` | A | A | A | A | A | In-process Obsidian vault |
| `plugins/bizar/src/dangerous-patterns.ts` | A | A | A | A | A | 36 patterns (v6.0.0) |
| `plugins/bizar/src/hooks/skill-curator.ts` | A | A | A | A | A | Closed learning loop (v6.0.0) |
| `plugins/bizar/src/hooks/memory-flush-on-compact.ts` | A | A | A | A | A | Pre-compact snapshot (v6.0.0) |
| `plugins/bizar/src/tools/graph-query.ts` | A | A | A | A | A | Knowledge graph (v6.0.0) |
| `plugins/bizar/src/tools/` | A | A | A | A | A | 22 tools, all use `createTool` |
| `packages/sdk/` | A | A | A | A | A | Thin wrapper; some tests pre-existing |
| `bizar-dash/` | A | A | A | A | A | 17 tabs, Harness view (v6.0.0) |
| `bizar-dash/src/server/bg-spawner.mjs` | A | A | A | A | A | ClineCore in-process |
| `bizar-dash/src/web/views/Harness.tsx` | A | A | A | A | A | 73/73 audit view (v6.0.0) |
| `bizar-dash/src/web/views/Tasks.tsx` | A | A | A | A | A | 5-column kanban + team badge |
| `scripts/` | A | A | A | A | A | 4 scripts (verify/arch/clean/trace) |
| `templates/` | A | A | - | - | A | 3 templates (sprint/rubric/checklist) |
| `.harness/` | A | A | A | A | A | arch-rules + traces |
| `AGENTS.md` | A | A | - | - | A | v6.0.0 rewrite |
| `PROGRESS.md` | A | A | - | - | A | Live state tracking |
| `DECISIONS.md` | A | A | - | - | A | 10 ADRs |
| `docs/` | A | A | - | - | A | INDEX + 5 topic docs + 10 ADRs |

## Hotspots (next priorities)

1. **Cline agent teams end-to-end** — tools are registered but
   not yet exercised in CI. Add `make e2e-team` target.
2. **Dashboard ↔ ClineCore event subscription** — bg-spawner.mjs
   subscribes but the kanban board doesn't yet visualize team
   events.
3. **Memory vault search ranking** — substring match is naive;
   add BM25 scoring for v6.1.0.
4. **Scheduled weekly curator** — `bizar curator run` for v6.1.0.
5. **Provider profile + fallback chain** — DEC-004 P1, queued for
   v5.7.0.

## Recent improvements

- **v5.6.0-beta.4 (2026-07-07):** Phase 4 — 4 new safety / curator /
  graph tools. 19 unit tests added. 5 new E2E checks.
- **v5.6.0-beta.3 (2026-07-07):** Phase 3 — Removed Plugins from
  dashboard. Mods only. Bundle 425 → 414 KB.
- **v5.6.0-beta.2 (2026-07-07):** Phase 2 — Dashboard UI v6.0.0
  polish. Cline runtime badge, Harness tab.
- **v5.6.0-beta.1 (2026-07-07):** Phase 1 — OpenCode → Cline rewrite.
  All 17 + 2 = 19 tools use `createTool` directly.

## How to update

After every sprint:

1. Run `bash tools/audit-harness.sh .` to get the audit score.
2. Run `bun test plugins/bizar` for the test score.
3. Run `bun run /tmp/bh-full-e2e.mjs` for the E2E score.
4. Update the table above.
5. Commit in the same commit as the code change.
