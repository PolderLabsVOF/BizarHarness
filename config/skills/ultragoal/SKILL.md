---
name: ultragoal
description: Track one durable multi-objective run with weighted subtasks and a four-lane completion fence, persisted in docs/specs/ultragoal-<id>.md plus a jsonl ledger.
argument-hint: "[--mode aggregate|per-story] <objective text or resumable run id>"
---

# Ultragoal

Ultragoal is Bizar's bounded multi-objective progress tracker. Use it when a
single durable run must coordinate several goals (or stories) that progress
together and complete only when every lane passes a fresh quality gate. It is
not a parallel-execution engine and not an iterate-on-criterion loop — see
"Distinct from siblings" below.

> **No `bizar goal` / `bizar workflow` CLI exists.** All durable state
> lives in the OpenKan `.ok/` workspace (a PRD owns the run, one plan
> tracks the objective, child OpenKan tasks own the subgoals). The
> ledger/charter under `docs/specs/ultragoal-<id>.md` is preserved as the
> human-readable audit trail; `ok` mutations are the source of truth.

## OMX → Bizar mapping rationale

The OMX `$ultragoal` feature (synthesized from
`yeachan-heo/oh-my-claudecode` at the same pinned revision used by
`config/skills/autopilot/SKILL.md`) is a multi-objective tracker that owns a
ledger, supports subtask split/merge, and rejects premature completion. Bizar
adapts that shape to its own runtime:

- The phase vocabulary extends the existing `ObjectiveRun` enum
  (`planning | executing | verifying | done | failed | cancelled`) with three
  additive values: `reviewing | checkpointing | blocked`. `blocked` is
  **non-terminal** and returns to `executing` on resume; `done | failed |
  cancelled` keep their terminal semantics. The phase is recorded as a
  tag/metadata on the parent PRD (e.g. PRD `phase: executing`) and on each
  subgoal task's `description` / acceptance metadata.
- Subgoals reuse `ok task` records (parent plan = ultragoal run id). Subgoal
  weight is stored in the task's `acceptance` field (e.g.
  `--acceptance "weight=0.25"`) so OpenKan's durable schema carries the
  weighted-subtask information without parallel state.
- Completion claims pass through a four-lane quality gate (`cleaner`,
  `verification`, `review`, `architecture_invariant`) — never through OpenKan
  status alone.
- The hard-approval floor in `AGENTS.md` (push, PR mutation, release,
  publish, deploy, prod writes, credential changes, public exposure,
  irreversible destruction) remains enforced by `permission-request.mjs`
  even when the plan status says `complete`.

The durable artifacts land under `docs/specs/` per
`docs/decisions/DEC-022-omx-canonical-artifact-location.md`:

- Spec / charter: `docs/specs/ultragoal-<id>.md`
- Append-only ledger: `docs/specs/ultragoal/<id>.jsonl`

`docs/specs/` is the only canonical sink for OMX-derived artifacts; no writes
to `.harness/specs/`, `.omc/specs/`, or a generic note vault.

## Start or resume

Read durable state first. Resume an unfinished PRD/plan or start a new one:

```sh
ok prd list --json
ok plan list --json
ok task list --json
# When no PRD exists:
ok prd add "$ARGUMENTS" --review-cadence weekly --json
ok plan add "<objective>" --prd "$PRD_ID" --json
ok task add "research/spec" --plan "$PLAN_ID" --priority p1 --json
```

`--mode aggregate|per-story` is a leading selector on the ultragoal CLI
that was retired; the mode is now recorded as PRD metadata
(`--goals "<id>:aggregate"` or the equivalent written via the plan's
`--phase` field). Parse and remove the leading `--mode` flag from
`$ARGUMENTS` before passing the remainder as the goal text. Reject unknown
mode names; do not silently substitute `aggregate`.

## Goal modes

The two mode shapes are different on the wire and in the ledger. Pick one at
`start`; do not migrate between modes mid-run (start a fresh run instead).

### `--mode aggregate` — single ledger, weighted subtasks

One `docs/specs/ultragoal-<id>.md` charter and one
`docs/specs/ultragoal/<id>.jsonl` ledger track every subgoal in the same
record. Each subgoal carries a `weight` (integer ≥ 0) recorded in the
OpenKan task's `acceptance` field; the run completes when the weighted
sum of completed subgoals reaches the configured `completionThreshold`
(default: `1.0`).

```sh
ok task add "<summary>" --plan "$PLAN_ID" --priority p1 \
  --acceptance "weight=0.25" --description "<summary>" --json
```

Use `aggregate` when the subgoals are facets of a single deliverable (e.g.
"ship feature X" split into spec / tests / impl / docs) and the team should
report progress as one number.

### `--mode per-story` — one subledger per story

The charter lists the stories; every story owns its own
`docs/specs/ultragoal/<id>/story-<sid>.jsonl` subledger. The parent ledger at
`docs/specs/ultragoal/<id>.jsonl` carries only steering and cross-story
checkpoint events. The run completes only when **every** story has reached
its own `done` state; partial completion stays at `review` or
`checkpointing`.

```sh
ok task add "<story summary>" --plan "$PLAN_ID" --priority p1 \
  --acceptance "story=true,story-id=<sid>" --description "<story summary>" --json
```

Use `per-story` when each story is genuinely independent progress a different
agent owns, and you need per-story audit trails without aggregate-weight
math.

## Lifecycle

```
planning → executing → verifying → reviewing → checkpointing → done
                                                       ↑
                                                    blocked (non-terminal, → executing)
```

The active phase is recorded as PRD/plan metadata (e.g.
`ok prd update <id> --phase executing` or `--milestone <m> --milestone-status <s>`)
and reflected in task statuses (`pending` / `in_progress` / `review` /
`done` / `cancelled`). Re-read state at every transition; never assume
the previous read is current.

1. **planning** — research the objective, ground any external API / framework
   behavior in current official documentation, and write
   `docs/specs/ultragoal-<id>.md` with: goal, non-goals, subtask list (with
   weights in `aggregate` mode or story ids in `per-story` mode), explicit
   stop condition, and hard-approval carve-outs that apply to this run
   (push-only, deploy-only, etc.). Create the matching OpenKan plan and the
   first task (`research/spec`) before claiming `executing`.
2. **executing** — claim `ok task` records for each subgoal via
   `ok task claim`, dispatch bounded worker agents with disjoint ownership,
   and append every steer event to the ledger. Long-running subgoals renew
   their leases inside the 30-second window so they are not reaped
   mid-execution.
3. **verifying** — run targeted tests for each completed subgoal and collect
   the four-lane evidence bundles below. Subgoal completion is local; run
   completion is not.
4. **reviewing** — an independent QA reviewer (separate from the executing
   agent) challenges each subgoal's evidence, the cross-subgoal integration,
   and the residual risk. Reviewer findings must be resolved or explicitly
   accepted in the ledger before the run advances.
5. **checkpointing** — final integration, full-gate run, and the four-lane
   quality-gate fence. `complete` is reachable only from this phase.
6. **done** — terminal. Reachable only after the four-lane fence passes. The
   ledger records the gate evidence; the durable state moves to a frozen
   snapshot via `ok plan update <id> --status complete`.
7. **blocked** — non-terminal. A subgoal cannot proceed (missing input,
   external dependency, operator decision). The run parks here until the
   operator steers via additional `ok task add` or
   `ok task update <id> --status pending`. On resume the run returns to
   `executing`; do not re-plan from scratch.
8. **failed** / **cancelled** — terminal, recorded with reason and final
   ledger tail. Marked via `ok plan update <id> --status abandoned`.

## Steer surface

`ok task` mutations are the only sanctioned mutation path after start.
Every command takes the current `--plan` / `--task` identity, mutates the
ledger atomically, and returns the next state. Do not edit the ledger
file or charter by hand; document each steer as an `ok task update`
evidence entry so the audit trail stays bounded.

| Original `bizar goal steer` | OpenKan replacement |
|---|---|
| `add_subgoal --subgoal-id <id> --weight <N>` | `ok task add "<summary>" --plan <plan-id> --acceptance "weight=<N>"` |
| `split_subgoal --subgoal-id <id> --into <a,b>` | `ok task cancel <id> --reason "split into <a>,<b>"` then `ok task add` for each |
| `checkpoint --evidence <text>` | `ok task complete <id> --evidence "<bounded text>"` |
| `update --field <dot.path> --value <json>` | `ok task update <id> --description <text>` / `--acceptance <text>` |
| `fail --reason <text>` | `ok task cancel <id> --reason "<bounded reason>"` and `ok plan update <plan-id> --status abandoned` |
| `cancel --reason <text>` | `ok task cancel <id> --reason "<bounded reason>"` and `ok plan update <plan-id> --status abandoned` |
| `complete --quality-gate-json <path>` | `ok task complete <id> --evidence <text>` after the four-lane fence passes, then `ok plan update <plan-id> --status complete` |

Add and split are only valid when the plan is in `planning` or
`executing`. `checkpoint` (i.e. task completion) is valid in any non-terminal
phase. `fail` and `cancel` are valid in any non-terminal phase. `complete`
on the plan is only valid when every child task is `done` AND the four-lane
fence has been satisfied; otherwise `ok plan update --status complete` is
rejected by the operator contract.

## Four-lane completion fence

The plan only closes when the four-lane quality-gate payload carries fresh
evidence for **all four** lanes. OMX key names are preserved (`cleaner`,
`verification`, `review`, `architecture_invariant`); Bizar additionally
expects each lane value to embed a typed `EvidenceBundle` reference so the
gate is reproducible from the ledger alone. The fence is enforced by the
operator before `ok plan update <plan-id> --status complete`; the OpenKan
CLI itself does not enforce the four-lane shape, so the operator must keep
the contract.

| Lane | Fresh evidence required (within the current run) |
|---|---|
| `cleaner` | Targeted lint / formatter / hygiene check output for the changed paths. |
| `verification` | Targeted test command, exit code, and bounded output proving the acceptance path. |
| `review` | Independent QA reviewer verdict (`APPROVED`) with the artifact the reviewer read. |
| `architecture_invariant` | Repo-level invariant gate (e.g. `make check-arch`, `make verify-removed-surfaces`, `make verify-repo-structure`) exit code and a short summary. |

A lane may be marked `"not_applicable": true` only when the operator has
recorded an explicit carve-out in the run charter and the rationale is in
the ledger. "I forgot" is never an acceptable rationale. If any lane is
absent, stale, or contested, `ok plan update --status complete` is
rejected and the run stays in `checkpointing` (or returns to `reviewing`).

**Never claim completion from OpenKan status alone.** A `done` task row,
an empty todo list, or a quiet process are not completion evidence. Run
completion is a typed claim backed by the four-lane fence; subgoal
completion is local-only and does not promote the parent run.

## Distinct from siblings

- **vs. `ralph` (single-owner iterate-on-criterion).** Ralph loops on one
  scoped acceptance criterion and advances an OpenKan plan/task. Ultragoal
  tracks many goals in one durable PRD/plan, and is bounded by the
  four-lane fence. Reach for Ralph when one agent owns one criterion;
  reach for Ultragoal when the run is "ship these N things together" and
  per-goal evidence must survive independently.
- **vs. `autopilot` (end-to-end phased run).** Autopilot is a top-level
  OpenKan plan (`research → plan → execute → qa → validate`) with parallel
  validation reviewers. Ultragoal is a progress tracker that lives inside
  or alongside an Autopilot plan, surfacing weighted subtask progress.
  Ultragoal does not start workers, does not own the integration tree, and
  does not replace Autopilot's validation phase.
- **vs. `ultrawork` (bounded parallel implementation).** Ultrawork dispatches
  disjoint work lanes for one implementation phase and integrates the
  results. Ultragoal records progress across subtasks that may execute on
  different timelines; Ultrawork is one of the lanes Ultragoal can track.

## Guardrails

- Continue local read / edit / test / build work autonomously inside the
  bounded subtasks.
- Never auto-commit, push, open or mutate a pull request, publish, release,
  deploy, change credentials or access, expose a service publicly, or
  perform irreversible destruction — even when the run ledger says
  `done`. These seven hard-approval categories live on
  `permission-request.mjs` and are not delegated to the skill.
- Do not edit the ledger or charter by hand. Use the `ok` CLI. A
  conflict that reports an unexpected status or owner means another
  hook or agent advanced state — stop the stale write, fetch
  `ok task show <id>`, and continue from current state.
- If the user requests cancellation, invoke the `cancel` skill; do not
  silently drop state.
- Do not introduce a daemon, tmux surface, memory subsystem, note vault,
  or web control plane. Ultragoal state is operational metadata under
  `~/.config/bizar/ultragoal/<run>/state.json` and `docs/specs/ultragoal/`
  only.
- For external APIs, frameworks, CLI behavior, configuration formats, or
  version-sensitive dependencies, WebSearch current official documentation
  and WebFetch the exact page before editing. Purely repository-local work
  uses source and tests directly.

## Provenance

The multi-objective tracker shape was adapted for Bizar from the MIT-licensed
`oh-my-claudecode` project (`ultragoal` / `$ultragoal`) at pinned revision
`41a4c0f77144c5beb5f5f000a89cff379c680606`. The procedure, the four-lane
fence, the steer subcommand grammar, and the durable artifact paths are
Bizar-specific. No upstream memory / wiki / daemon transport ships with this
skill.
