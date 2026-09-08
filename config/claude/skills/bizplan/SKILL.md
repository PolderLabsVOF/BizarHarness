---
name: bizplan
description: Bizar's only planning surface. Three tiers (light / standard / heavy) selected by request shape (file count, ambiguity score, PRD presence). Persists every run to `.ok/plans/pln-*.json` and cross-references an open PRD.
argument-hint: "<task to plan and persist>"
---

# Bizplan — tier decision tree

Bizplan is the **only** planning surface in Bizar. Every planning-tier request must
be classified into one of three tiers before any work begins. The classification
rule is deterministic and inspectable; the routing is unambiguous; downstream
consumers trust the persisted `tier` field on the plan JSON.

Previously known as `ralplan` (deleted in the bizplan-overhaul ultragoal). The
skill filename changed from `ralplan` to `bizplan`; the OMX-shaped 8-step
protocol and the typed handoff (`BizplanHandoff`) are unchanged in shape.

## 1. Estimate scope first

```
- One file, no behavior change -> tier = light
- Multi-file, single owner fits -> tier = standard
- Architectural, multi-lane, worktree split -> tier = heavy
```

The boundary cases:

- **Two files with a behavior change** → `standard` (not `light`).
- **Two files with no behavior change but a test update** → `standard`.
- **A single file with a behaviour change but no test update** → `standard`
  (the behaviour change pulls the request out of the `light` exemption).
- **Multi-lane work that requires concurrent worktrees** → `heavy` even if the
  total file count is small.

## 2. Check ambiguity score (from `deep-interview`)

```
- ambiguity > 0.20 -> tier = heavy   (forces deeper review regardless of file count)
- 0.10 < ambiguity <= 0.20 -> tier = standard minimum
- ambiguity <= 0.10 -> tier per file-count rule above
```

`ambiguity` is read from the persisted `AmbiguityScore` in the deep-interview
spec (`packages/sdk/src/ambiguity/score.ts` + `ObjectiveRun.ambiguity`). When
no deep-interview has run yet, treat `ambiguity` as `null` (not zero) and
default to `standard` minimum.

`bizplan-light` MUST NOT run when `ambiguity > 0.10`.

## 3. Check if an open PRD exists in `.ok/prds/`

```
- Yes -> cross-reference; tier = standard or heavy only (light does not persist PRD link)
- No  -> warn operator; bizplan-heavy can still proceed (creates PRD link on persistence step)
```

`bizplan-light` does not require a PRD link. `bizplan-standard` and
`bizplan-heavy` MUST cross-reference an open PRD; if no PRD exists, surface a
warning to the operator and require explicit confirmation before persistence.

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

## State and research

```sh
ok task list --json
ok plan list --json
ok prd list --json
# When no plan exists:
ok plan add "$ARGUMENTS" --summary "bizplan plan-build" --json
ok task add "research/spec" --plan "$PLAN_ID" --priority normal --json
```

Ground the specification in repository evidence. For external APIs, frameworks,
CLI behavior, configuration formats, or version-sensitive dependencies,
WebSearch current official documentation and WebFetch the exact page. State
acceptance criteria, exclusions, risks, approval boundaries, and stop
condition. Re-read status and advance `research` with bounded evidence.

---

# Tier playbooks

## Playbook — `bizplan-light`

**Phases (in order)**: spec → plan (interview only).

**Evidence required at every phase**:

1. `spec` — single-page spec noting the one file/one behavior exemption, plus a
   one-line acceptance criterion.
2. `plan` — direct execution plan with bounded file ownership and a single
   reviewer pass. The reviewer may be the same agent that drafted the plan
   (this is the only tier where self-review is permitted).

**Owner**:

- Planner: `@paul`.
- Reviewer: `@paul` (self-review permitted).
- Persistence: `packages/sdk/src/handoff/bizplan.ts:persistBizplanPlan` (no PRD
  cross-reference; `prdLink` field is `null` in the persisted plan).

**When to advance**: when the spec's `AmbiguityScore ≤ 0.10` and the
self-review pass produced no material finding.

**When to abort**:

- A second file becomes in scope → upgrade to `standard` and restart the
  interview loop.
- A behaviour change enters scope → upgrade to `standard`.
- `AmbiguityScore > 0.10` after spec → upgrade to `standard`.

**Stop condition**: plan JSON persisted, `BizplanHandoff.tier === 'light'`,
no task spawned (unless scope > 1 file at plan time, in which case a single
task is spawned by `spawnExecutorTask`).

---

## Playbook — `bizplan-standard` (default)

**Phases (in order)**: spec → plan → architect → critic → plan-final.

**Evidence required at every phase**:

1. `spec` — multi-page spec covering acceptance criteria, exclusions, risks,
   approval boundaries, and stop condition. Cross-references an open PRD
   under `.ok/prds/`.
2. `plan` — `Planner` (`@paul`) drafts ordered steps, file ownership,
   dependency edges, rollback, and targeted/full verification.
3. `architect` — `Architect` (`@plan-architect`) consumes the Planner's draft
   and emits a structured `ArchitectPass` JSON. Verdict: `PROCEED | ITERATE`.
4. `critic` — `Critic` (`@linda` bizplan-critic sub-mode) consumes the
   Architect's pass and emits one of `APPROVED | CHANGES REQUIRED | REJECTED`
   plus the typed handoff JSON.
5. `plan-final` — Critic's `APPROVED` is the hard gate. Without `APPROVED`,
   the plan does not advance.

**Owners**:

- Planner: `@paul`.
- Architect: `bizar-architect` (`@plan-architect`).
- Critic: `bizar-code-reviewer` (`@linda` bizplan-critic sub-mode).
- Persistence: `persistBizplanPlan` (writes `.ok/plans/pln-<id>.json` with
  `prdLink` set).
- Task spawn: `spawnExecutorTask` (writes `.ok/tasks/tsk-<id>.json` with
  `status: 'claimed'` and `links.planId`).

**When to advance**: when the Critic returns `APPROVED` and the typed
`BizplanHandoff` JSON passes `validateBizplanHandoff()`.

**When to abort**:

- Five iterations without `APPROVED` → fail the workflow; the last verdict is
  recorded in the workflow state.
- A second PRD needs to be cross-referenced (PRD drift) → upgrade to `heavy`.

**Stop condition**: plan JSON persisted, `BizplanHandoff.tier === 'standard'`,
executor task spawned and `claimed`.

---

## Playbook — `bizplan-heavy`

**Phases (in order)**: spec → plan → pre-mortem → architect → critic →
lane-split → plan-final.

**Evidence required at every phase**:

1. `spec` — full architectural spec with risk register, failure modes, and
   explicit lane boundaries.
2. `plan` — Planner drafts cross-lane ordering, lane ownership, and rollback
   strategy.
3. `pre-mortem` — `Pre-mortem` round (deliberate mode) appended to the
   Architect pass; see `config/skills/thinking-pre-mortem/SKILL.md`.
4. `architect` — Architect consumes Planner + pre-mortem output and emits a
   structured `ArchitectPass`.
5. `critic` — Critic consumes the Architect pass and emits
   `APPROVED | CHANGES REQUIRED | REJECTED` plus handoff JSON.
6. `lane-split` — approved plan is split into lanes with explicit
   `worktreeStrategy` per lane.
7. `plan-final` — all lanes' handoff flags must be `true` before
   `BizplanHandoff.critic_complete = true`.

**Owners**:

- Planner: `@paul`.
- Pre-mortem: `bizar` (`@plan-architect` deliberate mode).
- Architect: `bizar-architect` (`@plan-architect`).
- Critic: `bizar-code-reviewer` (`@linda` bizplan-critic sub-mode).
- Lane-split: `@mike` (orchestrator) — assigns one worktree per lane.
- Persistence: `persistBizplanPlan` (writes `.ok/plans/pln-<id>.json` with
  `lanes[]` and `worktreeStrategy`).
- Task spawn: `spawnExecutorTask` (writes one `.ok/tasks/tsk-<id>.json` per lane).

**When to advance**: when all lanes' handoff JSONs validate and the Critic
returns `APPROVED` on the unified plan.

**When to abort**:

- A lane's pre-mortem finds a blocker that the Architect cannot mitigate →
  return to spec.
- Five iterations without `APPROVED` → fail the workflow.
- Lane count exceeds the operator's worktree budget → upgrade request scope.

**Stop condition**: plan JSON persisted with `lanes[]`, `BizplanHandoff.tier
=== 'heavy'`, one task per lane spawned.

---

# Consensus gate (all tiers)

1. A planner drafts ordered steps, file ownership, dependency edges, rollback, and targeted/full verification.
2. A separate QA reviewer challenges assumptions, race/interference risks, failure recovery, approval boundaries, and test adequacy.
3. Resolve every material finding. Shared root files have one owner; independent scopes are explicitly parallel; dependent work is serialized.
4. Persist the accepted plan in the repository's normal planning/state files, not in a note vault or wiki.
5. Re-read plan/task state, then mark the planning task complete:

   ```sh
   ok task update "$PLAN_TASK_ID" --status review --json
   ok task complete "$PLAN_TASK_ID" --evidence "$BOUNDED_EVIDENCE" --json
   ```

The resulting workflow is ready at execution. If the user requested plan-only
work, stop there and report the resumable run identity. Do not auto-commit,
push, publish, release, deploy, change credentials/access, perform
destructive work, or launch a daemon/tmux controller.

# OMX-shape 8-step protocol

The OMX-derived strengthening of `/bizplan` adds three named roles and a
hard iteration cap on top of the existing consensus gate. The existing
Planner → QA-reviewer flow above is preserved; the OMX shape layers the
Architect (`@plan-architect`) and the BIZPLAN-Critic sub-mode of
`@linda` between them.

### 8-step shape

1. **Planner** (`@paul`) drafts the plan per the consensus-gate section
   above. Output: `docs/specs/bizplan/<slug>.md`.
2. **Pre-mortem round** (deliberate mode only — see below).
3. **Architect** (`@plan-architect`) consumes the Planner's draft (and
   the pre-mortem output when present) and emits a structured
   `ArchitectPass` JSON. Verdict: `PROCEED | ITERATE`.
4. **Critic** (`@linda` BIZPLAN-Critic sub-mode) consumes the
   Architect's pass and emits one of `APPROVED | CHANGES REQUIRED |
   REJECTED` plus a structured handoff JSON.
5. **Iterate** on `ITERATE` or `CHANGES REQUIRED`. The iteration
   counter increments only on non-APPROVE verdicts.
6. **Cap at 5 iterations.** Five iterations without `APPROVED` fails
   the workflow; the last verdict is recorded in the workflow state.
7. **Gate execution.** The Critic's `APPROVED` is the hard gate
   independent of the Architect's score. Without `APPROVED`, the plan
   does not advance to execution.
8. **Persist handoff.** Write the typed handoff JSON to
   `docs/specs/bizplan/<slug>.handoff.json` per DEC-022.

### Deliberate mode (`--deliberate`)

Deliberate mode prepends a pre-mortem round between step 1 and step 3.
The canonical methodology lives at
`config/skills/thinking-pre-mortem/SKILL.md`; see
`config/skills/bizplan/references/pre-mortem.md` for how the round is
folded into the Architect pass.

Deliberate mode is **auto-enabled** when the prompt signals any of the
seven-category floor at
`config/claude/hooks/permission-request.mjs:64–69`:

- auth / security
- migration
- destructive operation
- public API breakage
- production incident
- compliance / PII
- irreversible destruction

The signal detection lives in the workflow routing hook and writes the
deliberate flag onto the workflow state at start; this skill reads the
flag and runs the pre-mortem round.

### Pre-execution gate (Mike's adaptive routing)

Prompts that satisfy both:

- effective word count ≤ 15, and
- contain no concrete anchors (no file path, no command, no error
  message, no API name, no named system),

route to `/bizplan`. The `force:` and `!` prefixes bypass this gate and
let the prompt land on the dispatcher's default selection. This row
sits alongside Mike's existing decision tree; it does not replace
`office-manager.md`'s other rules.

### Handoff JSON contract

The Critic consumes the Architect's pass and emits a handoff JSON. The
shared contract is:

```json
{
  "schema_version": "1.0.0",
  "tier": "light|standard|heavy",
  "planner_complete": false,
  "architect_complete": false,
  "critic_complete": false
}
```

All three `*_complete` flags must be `true` for the workflow to advance
past the bizplan gate. The typed shape is the SDK's `BizplanHandoff`
from `packages/sdk/src/handoff/bizplan.ts` (F-202 Phase 1 of the OMX
adoption plan, hard-renamed in the bizplan-overhaul ultragoal); the
skill references the type by name and does not import it.

### Handoff file location

Per DEC-022, the typed handoff lives at
`docs/specs/bizplan/<slug>.handoff.json`. The skill writes this file
when the gate closes (Critic emits `APPROVED`); the workflow state
references the file path so downstream consumers can find it.
