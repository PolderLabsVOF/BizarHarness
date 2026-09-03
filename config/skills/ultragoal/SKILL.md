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
  cancelled` keep their terminal semantics.
- Subgoals reuse `bizar task` records (parent = ultragoal run id) rather than
  introducing a new task primitive. Subgoal leases are coordinated with the
  `bizar task` 30-second lease window.
- Completion claims pass through a four-lane quality gate (`cleaner`,
  `verification`, `review`, `architecture_invariant`) — never through OMX
  state alone.
- The hard-approval floor in `AGENTS.md` (push, PR mutation, release,
  publish, deploy, prod writes, credential changes, public exposure,
  irreversible destruction) remains enforced by `permission-request.mjs`
  even when the run ledger says `done`.

The durable artifacts land under `docs/specs/` per
`docs/decisions/DEC-022-omx-canonical-artifact-location.md`:

- Spec / charter: `docs/specs/ultragoal-<id>.md`
- Append-only ledger: `docs/specs/ultragoal/<id>.jsonl`

`docs/specs/` is the only canonical sink for OMX-derived artifacts; no writes
to `.harness/specs/`, `.omc/specs/`, or a generic note vault.

## Start or resume

Read durable state first. Resume an unfinished run or start a new one:

```sh
bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
# When no run exists:
bizar goal start --goal "$ARGUMENTS" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
```

`bizar goal start` takes a required leading `--mode aggregate|per-story`
selector. Parse and remove it from `$ARGUMENTS` before passing the remainder
as the goal text. Reject unknown mode names; do not silently substitute
`aggregate`.

## Goal modes

The two mode shapes are different on the wire and in the ledger. Pick one at
`start`; do not migrate between modes mid-run (start a fresh run instead).

### `--mode aggregate` — single ledger, weighted subtasks

One `docs/specs/ultragoal-<id>.md` charter and one
`docs/specs/ultragoal/<id>.jsonl` ledger track every subgoal in the same
record. Each subgoal carries a `weight` (integer ≥ 0) and the run completes
when the weighted sum of completed subgoals reaches the configured
`completionThreshold` (default: `1.0`).

```sh
bizar goal steer add_subgoal --run "$RUN_ID" --revision "$REVISION" \
  --subgoal-id "<stable-id>" --weight 0.25 --summary "<one line>" --json
```

Use `aggregate` when the subgoals are facets of a single deliverable (e.g.
"ship feature X" split into spec / tests / impl / docs) and the team should
report progress as one number.

### `--mode per-story` — one subledger per story

The charter lists the stories; every story owns its own
`docs/specs/ultragoal/<id>/story-<sid>.jsonl` subledger. The parent ledger at
`docs/specs/ultragoal/<id>.jsonl` carries only steering and cross-story
checkpoint events. The run completes only when **every** story has reached
its own `done` state; partial completion stays at `reviewing` or
`checkpointing`.

```sh
bizar goal steer add_subgoal --run "$RUN_ID" --revision "$REVISION" \
  --subgoal-id "<story-id>" --story-ledger --summary "<one line>" --json
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

Re-read status at every transition; compare-before-write every steer,
checkpoint, or phase advance using the returned `revision`.

1. **planning** — research the objective, ground any external API / framework
   behavior in current official documentation, and write
   `docs/specs/ultragoal-<id>.md` with: goal, non-goals, subtask list (with
   weights in `aggregate` mode or story ids in `per-story` mode), explicit
   stop condition, and hard-approval carve-outs that apply to this run
   (push-only, deploy-only, etc.). Advance to `executing` only after the
   charter exists.
2. **executing** — claim `bizar task` records for each subgoal, dispatch
   bounded worker agents with disjoint ownership, and append every steer
   event to the ledger. Long-running subgoals renew their leases inside the
   30-second window so they are not reaped mid-execution.
3. **verifying** — run targeted tests for each completed subgoal and collect
   the four-lane evidence bundles below. Subgoal completion is local; run
   completion is not.
4. **reviewing** — an independent QA reviewer (separate from the executing
   agent) challenges each subgoal's evidence, the cross-subgoal integration,
   and the residual risk. Reviewer findings must be resolved or explicitly
   accepted in the ledger before the run advances.
5. **checkpointing** — final integration, full-gate run, and the four-lane
   quality-gate fence. `done` is reachable only from this phase.
6. **done** — terminal. Reachable only after the four-lane fence passes. The
   ledger records the gate evidence; the durable state moves to a frozen
   snapshot.
7. **blocked** — non-terminal. A subgoal cannot proceed (missing input,
   external dependency, operator decision). The run parks here until the
   operator steers `update` / `add_subgoal` / `fail`. On resume the run
   returns to `executing`; do not re-plan from scratch.
8. **failed** / **cancelled** — terminal, recorded with reason and final
   ledger tail.

## Steer surface

`bizar goal steer` is the only sanctioned mutation path after `start`. Every
subcommand takes the current `--run` and `--revision`, mutates the ledger
atomically, and returns the next revision. Do not edit the ledger file or
charter by hand.

```sh
bizar goal steer add_subgoal    --run "$RUN_ID" --revision "$REVISION" --subgoal-id "<id>" [--weight N | --story-ledger] --summary "<line>" --json
bizar goal steer split_subgoal  --run "$RUN_ID" --revision "$REVISION" --subgoal-id "<id>" --into "<id-a>,<id-b>" --json
bizar goal steer checkpoint     --run "$RUN_ID" --revision "$REVISION" --evidence "$BOUNDED_EVIDENCE" --json
bizar goal steer update         --run "$RUN_ID" --revision "$REVISION" --field "<dot.path>" --value "<json>" --json
bizar goal steer fail           --run "$RUN_ID" --revision "$REVISION" --reason "<bounded reason>" --json
bizar goal steer cancel         --run "$RUN_ID" --revision "$REVISION" --reason "<bounded reason>" --json
bizar goal steer complete       --run "$RUN_ID" --revision "$REVISION" --quality-gate-json "$GATE_JSON" --json
```

`add_subgoal` and `split_subgoal` are only valid in `planning` or `executing`.
`checkpoint` is valid in `executing | verifying | reviewing | checkpointing`.
`fail` and `cancel` are valid in any non-terminal phase.
`complete` is only valid in `checkpointing` and is rejected unless the
quality-gate JSON satisfies the four-lane fence.

## Four-lane completion fence

`bizar goal steer complete` accepts only when the
`--quality-gate-json` payload carries fresh evidence for **all four** lanes.
OMX key names are preserved (`cleaner`, `verification`, `review`,
`architecture_invariant`); Bizar additionally expects each lane value to
embed a typed `EvidenceBundle` reference so the gate is reproducible from
the ledger alone.

| Lane | Fresh evidence required (within the current run) |
|---|---|
| `cleaner` | Targeted lint / formatter / hygiene check output for the changed paths. |
| `verification` | Targeted test command, exit code, and bounded output proving the acceptance path. |
| `review` | Independent QA reviewer verdict (`APPROVED`) with the artifact the reviewer read. |
| `architecture_invariant` | Repo-level invariant gate (e.g. `make check-arch`, `make verify-removed-surfaces`, `make verify-repo-structure`) exit code and a short summary. |

A lane may be marked `"not_applicable": true` only when the operator has
recorded an explicit carve-out in the run charter and the rationale is in
the ledger. "I forgot" is never an acceptable rationale. If any lane is
absent, stale, or contested, `complete` is rejected and the run stays in
`checkpointing` (or returns to `reviewing`).

**Never claim completion from OMX state alone.** A `done` ledger row, an
empty todo list, or a quiet process are not completion evidence. Run
completion is a typed claim backed by the four-lane fence; subgoal
completion is local-only and does not promote the parent run.

## Distinct from siblings

- **vs. `ralph` (single-owner iterate-on-criterion).** Ralph loops on one
  scoped acceptance criterion, advances a `bizar workflow` run, and is
  bounded by attempt count. Ultragoal tracks many goals in one durable
  ledger, advances an `ObjectiveRun` phase enum, and is bounded by the
  four-lane fence. Reach for Ralph when one agent owns one criterion;
  reach for Ultragoal when the run is "ship these N things together" and
  per-goal evidence must survive independently.
- **vs. `autopilot` (end-to-end phased run).** Autopilot is a top-level
  workflow (`research → plan → execute → qa → validate`) with parallel
  validation reviewers and a `bizar workflow` state machine. Ultragoal is
  a progress tracker that lives inside or alongside an Autopilot run,
  surfacing weighted subtask progress. Ultragoal does not start workers,
  does not own the integration tree, and does not replace Autopilot's
  validation phase.
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
- Do not edit the ledger or charter by hand. Use `bizar goal steer`. A
  conflict that reports a newer revision or different phase means another
  hook or agent advanced state — stop the stale write, fetch status, and
  continue from current state.
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
