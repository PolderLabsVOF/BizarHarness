---
name: goal-bootstrap
description: Operate the F-207 autonomous goal / ultragoal bootstrap. Re-seed the durable ultragoal charter when no goal is active, resume an in-flight one, or run `bizar goal-bootstrap` to inspect the current verdict.
argument-hint: "[run]"
---

# /goal-bootstrap — Mike's Autonomous Goal Seed (F-207)

The goal-bootstrap is the single authority for "what is the active
goal right now" in Bizar. It runs once per SessionStart and emits a
discriminated-union verdict:

```text
{ action: "resume",    id, source }      ← existing charter, in-flight feature
{ action: "bootstrap", id, charterPath } ← wrote a fresh aggregate charter
{ action: "idle" }                       ← no not_started features
```

The verdict is delivered through two surfaces:

1. **SessionStart hook** — `config/claude/hooks/goal-bootstrap.mjs`
   emits the verdict into the SessionStart `additionalContext` block.
   `config/claude/hooks/sessionstart-prime.mjs` prefixes its
   standard briefing with a `goal: …` line so Mike sees the
   verdict on turn 1.
2. **CLI** — `bizar goal-bootstrap [--feature-list <p>] [--specs-dir <s>]`
   prints the same `{action, id?, charterPath?}` JSON. Use this
   from tests, recovery scripts, and operator inspection.

The bootstrap MUST NEVER auto-commit, auto-push, or auto-publish.
The `bootstrap` action writes exactly one durable artifact
(`docs/specs/ultragoal-<id>.md` in aggregate mode) and that is all.

## Lifecycle

1. **Read state.** `bootstrapGoalFromFile` reads `feature_list.json`
   and enumerates `docs/specs/ultragoal-*.md`.
2. **Resume path.** A non-passing feature (`in_progress`, `blocked`,
   `not_started`, plus the OMX `executing | planning | verifying |
   reviewing | checkpointing | active` enum) whose charter exists
   wins → `{action: "resume", id, source: "spec"}`. The existing
   charter is left untouched.
3. **Bootstrap path.** No resumable goal exists AND at least one
   feature is `not_started`. The helper picks the smallest F-ID
   (lexical `F-005` < `F-205` < `F-999` regardless of numeric) and
   writes an aggregate-mode charter (`renderAggregateCharter`).
4. **Idle path.** No resumable goal AND zero `not_started` features
   → `{action: "idle"}`. Nothing is written; the hook emits a
   descriptive idle line so the operator knows the helper ran.

A malformed `feature_list.json` or a write failure is degraded to
`{action: "idle"}` with a `warning` field. SessionStart NEVER
aborts because of a bootstrap error.

## Operator actions

| Verdict | Action |
|---|---|
| `resume` | Continue Mike's normal routing against the active goal. Read `docs/specs/ultragoal-<id>.md`. |
| `bootstrap` | Read the just-written charter, announce it in the operator-facing reply, and proceed against it. |
| `idle` | No work is queued. Either wait for operator direction, surface a follow-up question, or close out the session cleanly. |
| `idle` + warning | Treat as a verification failure. Show the warning; do not advance to implementation. |

## Schema

- `GOAL_BOOTSTRAP_SCHEMA_VERSION = "1.0.0"` — bump on a breaking
  change to the on-disk charter shape.
- The charter body is rendered by `renderAggregateCharter`
  (`packages/sdk/src/agent/goal-bootstrap.ts`); its
  `## Mode` is always `aggregate` and its `## Subtasks` table
  has exactly one weighted row (`weight: 1.0`) anchored at the
  chosen F-ID.

## Wiring

- SDK: `packages/sdk/src/agent/goal-bootstrap.ts`
- CLI: `cli/commands/goal-bootstrap.mjs`
- SessionStart hook: `config/claude/hooks/goal-bootstrap.mjs`
- Briefing wiring: `config/claude/hooks/sessionstart-prime.mjs`
  (prefixes the briefing with the goal line)
- Mike prompt: `config/claude/agents/office-manager.md` (the
  `## Autonomous Goal Bootstrap` section treats the verdict as
  authoritative)
- Tests: `packages/sdk/tests/agent/goal-bootstrap.test.ts` (vitest,
  14 cases) and `cli/__tests__/goal-bootstrap.test.mjs` (node --test,
  5 cases)
