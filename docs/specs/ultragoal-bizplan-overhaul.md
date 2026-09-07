# Ultragoal charter — bizplan-overhaul

> **Migration note (postscript)**: as of 2026-09-07, this run's tracking state has been migrated to OpenKan at `.ok/prds/prd-bizplan-overhaul.json` + `.ok/plans/pln-bizplan-overhaul.json` + `.ok/tasks/tsk-*.json`. The legacy ledger at `docs/specs/ultragoal/ultragoal-bizplan-overhaul.jsonl` is preserved as a historical artifact but is no longer the canonical state. All subsequent task/goal/planning work flows through the native `ok` CLI.

- **Run id**: `ultragoal-bizplan-overhaul`
- **Run uuid**: `eaebafbb-586d-45e2-938a-5725ffaf2d5c`
- **Started**: 2026-09-07T06:33:50Z
- **Mode**: `aggregate` (single deliverable; weighted subtasks)
- **Completion threshold**: 1.0
- **Hard-approval carve-out**: none — no push, no publish, no release, no PR mutation in this run. All work stays local until the operator signs off on the e2e loop evidence.

> ⚠️ **Surface gap (operator-facing)**: The skill layer describes a `bizar goal start|steer|checkpoint|complete` CLI; only `bizar workflow start --mode ralplan` ships in 10.26.0. This charter is therefore persisted by hand at the canonical `docs/specs/` path (per `DEC-022-omx-canonical-artifact-location.md`) rather than driven through `bizar goal steer`. When the goal CLI ships, this run should be re-bootstrapped under it; the four-lane fence evidence is structured so it can be replayed into `complete --quality-gate-json` verbatim.

## Goal

Rename `ralplan` → `bizplan`. Make bizplan the **only** planning surface in Bizar. Add three planning tiers (light / standard / heavy) selected by request shape. Persist every bizplan run into `.ok/plans/pln-*.json`, cross-reference an open PRD, and auto-spawn the executor task in `.ok/tasks/`. Hard-rename the SDK `RalplanHandoff` contract to `BizplanHandoff`. Delete `/ralplan` and `/plan`. Wire Mike's office-manager routing so non-trivial requests default to bizplan. Ship one recorded end-to-end loop (plan → task → evidence → close) as the integration test.

## Non-goals

- No multi-PRD scope creep. Only PRD-level cross-reference is added; PRD authoring/editing stays on the existing `ok prd` surface.
- No new daemon, no new note vault, no new web control plane. Bizplan state is `.ok/plans/pln-*.json` only.
- No new model routing. Bizplan's tier selection is purely request-shape driven (length + ambiguity + scope); the existing static `haiku|sonnet|opus|fable` alias map still drives dispatch.
- No automated cut of a 10.27.0 release. The DoD is DoD + replaced default in Mike routing + one recorded e2e loop. The release, if any, is operator-driven after this run closes.
- No silent deletion of `ralplan` historical references in `feature_list.legacy.json` or `docs/historical/`. Those are historical records.

## Tier model

| Tier | Trigger | Phases | Persists? | Spawns task? |
|---|---|---|---|---|
| `bizplan-light` | one obvious target, single file, no behavior change | spec → plan (interview only) | `.ok/plans/pln-*.json` with `tier: 'light'` | only when scope > 1 file |
| `bizplan-standard` (default) | multi-file change, single owner fits | spec → plan → architect → critic → plan-final | yes, cross-refs open PRD | yes |
| `bizplan-heavy` | architectural change, multi-lane, worktree split | spec → plan → pre-mortem → architect → critic → lane-split → plan-final | yes, with `lanes[]` and `worktreeStrategy` | yes, one task per lane |

Selection rule (implemented in `packages/sdk/src/handoff/bizplan.ts:tierFromRequest`):

```
if (scope.files === 1 && scope.behaviorChange === false) tier = 'light'
else if (scope.lanes === 1 || scope.architectureImpact === 'isolated') tier = 'standard'
else tier = 'heavy'
```

`scope` is derived from the deep-interview spec (`packages/sdk/src/ambiguity/score.ts` + the `ObjectiveRun.ambiguity` field). Ambiguity > 0.20 forces `heavy` regardless of file count.

## Subtasks (weighted)

Two streams under disjoint worktree ownership:

- **Stream A (sdk + slash + persistence)**: `sdk-bizplan-contract`, `sdk-bizplan-persistence`, `slash-bizplan-commands` — owned by one agent (todd).
- **Stream B (skill + agents + mcp + arch-tests + goal-cli)**: `skill-bizplan-tiering`, `office-manager-routing`, `mcp-tool-rename`, `arch-tests-cleanup`, `sdk-goal-cli` — owned by one agent (karen).
- **Stream C (e2e evidence, serial after A+B)**: `e2e-loop-evidence` — runs last against merged main; integration gate.

| weight | id | stream | summary |
|---|---|---|---|
| 0.10 | `sdk-bizplan-contract` | A | New `packages/sdk/src/handoff/bizplan.ts` with `BizplanHandoff`, `Tier`, `Plan`, `PlanLane`, `tierFromRequest()`, `validateBizplanHandoff()`. Mirror tests in `bizplan.test.ts`. Delete `ralplan.ts` + `ralplan.test.ts`. |
| 0.15 | `sdk-bizplan-persistence` | A | `persistBizplanPlan(handoff)` writes `.ok/plans/pln-<id>.json` with PRD cross-ref (read from `ok prd list`); `spawnExecutorTask(plan)` writes `.ok/tasks/tsk-<id>.json` (status `claimed`, links `planId`). |
| 0.10 | `slash-bizplan-commands` | A | Create `config/claude/commands/bizplan.md`, `bizplan-light.md`, `bizplan-heavy.md`. Delete `config/claude/commands/ralplan.md` and `config/claude/commands/plan.md`. Update `mirror-claude-md` (CLAUDE.md mirror) and any `claude-cmd.test.mjs` allow-list. |
| 0.15 | `skill-bizplan-tiering` | B | Rewrite `config/skills/ralplan/SKILL.md` → `config/skills/bizplan/SKILL.md` with three tier playbooks + tier-selection decision tree. Mirror to `config/claude/skills/bizplan/`. Update `keyword-router.mjs` if it routes "plan" → bizplan. |
| 0.10 | `office-manager-routing` | B | Update `config/claude/agents/office-manager.md` routing pivots: replace `ralplan` mentions with `bizplan`; add tier-selection rule; drop the ralplan pivot reference. Update `config/claude/agents/office-greeter.md` if it surfaces /plan. |
| 0.10 | `mcp-tool-rename` | B | `packages/sdk/src/mcp/server.ts` registers `bizplan_persist`, `bizplan_spawn_task`, `bizplan_validate` (replacing any `ralplan_*` tool). Update `packages/sdk/src/index.ts` re-exports and `packages/sdk/tests/sdk.test.mjs`. |
| 0.10 | `sdk-goal-cli` | B | Implement `bizar goal start|steer|checkpoint|complete|status|fail|cancel` per ultragoal skill surface. Atomic ledger writes under `docs/specs/ultragoal/<id>.jsonl` per `DEC-022`. Plus `bizar goal resume` for re-bootstrapping. Tests cover atomic write, revision-bump, phase transitions. |
| 0.15 | `arch-tests-cleanup` | B | `make verify-removed-surfaces` and `make check-arch` must pass: no references to `ralplan` (except historical), `/plan` deleted, `packages/sdk/src/handoff/ralplan.ts` deleted, `RalplanHandoff` type deleted. Update `cli/__tests__/check-arch.test.mjs`, `cli/__tests__/claude-cmd.test.mjs`, `cli/__tests__/hook-portability.test.mjs`. |
| 0.15 | `e2e-loop-evidence` | C | Run one real bizplan-standard workflow against a stub PRD + 2-file change, capture the loop as `.harness/evals/bizplan-e2e-<timestamp>.json` containing: plan JSON, spawned task id, status transition (`claimed → in_progress → done`), four-lane evidence bundles, transcript of the tier-selection step. Plus: `bizar goal start` + `steer add_subgoal` + `steer complete` driven through the new CLI for this same run. The eval is the integration test. |

Total weight = 1.10; threshold stays at 1.00 so the run completes when the weighted sum reaches 1.00 (i.e. all 9 reach completion, OR a subset totalling ≥ 1.00). In practice all 9 must complete because the heaviest 7 sum to 0.85 and the e2e lane requires A+B merged.

## Stop condition

`bizar workflow status --run <uuid>` returns a state that survives the four-lane fence **and** the e2e eval at `.harness/evals/bizplan-e2e-*.json` shows the full plan → task → evidence → close loop. No additional operator sign-off required to mark subgoals complete (operator-visible output is the e2e eval); the run advance to `done` still requires operator confirmation.

## Hard-approval carve-outs

- **Push / PR mutation / release / publish**: none. The bizplan-overhaul does NOT include a release cut. If a release is requested later, it is a separate run with its own ultragoal charter and the seven-category HITL floor.
- **Force-push / rebase / root deletion**: standard project policy applies (advisory only under F-176).
- **Credentials / public exposure / irreversible destruction**: not in scope.

## Risks and pre-mortem

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Hidden references to `RalplanHandoff` in MCP client code or external integrations break on rename | medium | medium | `check-arch` + `grep -rn "RalplanHandoff\|ralplan" --include="*.ts" --include="*.mjs" --include="*.js"` gate before declaring done. Surface any external hits in the eval. |
| `.ok/plans/` schema drift between bizplan-standard and bizplan-heavy | medium | medium | Single `BizplanPlan` interface with optional `lanes[]` and `worktreeStrategy`; tier-specific required fields validated at write time. |
| Operator routing pivot (`office-manager.md`) silently keeps /ralplan path because of stale examples | medium | low | Lint test that fails if `office-manager.md` mentions `ralplan` outside a "previously known as" footnote. |
| E2E eval records a passing loop against trivial scope that doesn't exercise cross-PRD link | low | medium | E2E test creates a stub PRD in `.ok/prds/prd-*.md`, then runs bizplan-standard against a 2-file change so the PRD cross-ref must succeed. |
| `tierFromRequest` is called before deep-interview completes and produces wrong tier | medium | medium | `tierFromRequest` returns `null` (not a tier) when `ambiguity > 0.10`; the workflow stays in `planning` until deep-interview collapses below 0.10. |

## Four-lane evidence targets

| Lane | What must be fresh |
|---|---|
| `cleaner` | `make clean-check` exit 0; no `console.log` / `debugger` / `.only()` introduced; no committed `RalplanHandoff` or `ralplan` reference in changed paths. |
| `verification` | `npm test` exit 0 with new `bizplan.test.ts` plus all retained SDK / CLI / harness tests green; `node scripts/with-sdk-dist-lock.mjs node scripts/run-test-with-sdk-build.mjs` passes. |
| `review` | Independent QA reviewer (linda, read-only) signs `APPROVED` on the diff + the e2e eval. Reviewer reads `packages/sdk/src/handoff/bizplan.ts`, `config/skills/bizplan/SKILL.md`, `config/claude/agents/office-manager.md`, and the e2e eval JSON. |
| `architecture_invariant` | `make check-arch`, `make verify-removed-surfaces`, `make verify-repo-structure` exit 0. `DEC-022-omx-canonical-artifact-location.md` honored: the only new specs path is `docs/specs/ultragoal-bizplan-overhaul.md` and `docs/specs/ultragoal/ultragoal-bizplan-overhaul.jsonl`. |

## Provenance

This charter is hand-written at the canonical path defined by `DEC-022-omx-canonical-artifact-location.md`. The `bizar goal steer` CLI surface described in the ultragoal skill is not implemented in the shipped 10.26.0 CLI; the run cannot drive the live state machine via session id. The charter, ledger, and subtask completion records are written directly so the four-lane fence can be replayed into the steer surface when it lands.
