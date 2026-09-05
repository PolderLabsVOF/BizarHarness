---
name: autopilot
description: Run Bizar's durable end-to-end workflow from researched specification through implementation, QA, independent validation, and required repository gates.
argument-hint: "[--workflow <default|plan-build-qa>] <task or outcome>"
---

# Autopilot

Use Autopilot for a clear, non-trivial outcome that should be delivered locally without routine permission handoffs. The office manager remains the single orchestrator; worker agents receive bounded, disjoint assignments.

## Start or resume

1. Read repository instructions and authoritative OpenKan `.ok/` state with `ok task list`, `ok plan list`, and `ok prd list`.
2. Query durable state first:

   ```sh
   bizar workflow status --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
   ```

3. If that session owns an unfinished run, resume it with the returned identity:

   ```sh
   bizar workflow resume --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
   ```

4. Otherwise parse the optional leading `--workflow <default|plan-build-qa>` selector and remove it from the task text used as the goal. If the selector is omitted, use `default`: bounded task-wave execution with at most three parallel agents. Use `plan-build-qa` for a plan-led build with dedicated QA/validation gates and at most five parallel agents. Preserve the returned `runId`, `revision`, and `stage` for compare-before-write transitions:

   ```sh
   bizar workflow start --workflow "$WORKFLOW_PROFILE" --goal "$TASK_GOAL" --session "$CLAUDE_SESSION_ID" --project "$CLAUDE_PROJECT_DIR" --json
   ```

   Examples: `/autopilot implement the task` selects `default`; `/autopilot --workflow plan-build-qa implement the task` selects the plan-led profile. Reject unknown workflow names instead of silently substituting another profile.

Only one workflow may own a project/session pair. Never delete or edit workflow state files directly.

## Lifecycle

For every transition, re-read status and use the current values. Record compact evidence that identifies the proving command, result, or artifact; do not place transcripts or secrets in workflow state.

```sh
bizar workflow advance --run "$RUN_ID" --revision "$REVISION" --stage "$CURRENT_STAGE" --evidence "$BOUNDED_EVIDENCE" --json
```

Run the stages in order:

1. **Research/spec** — establish current behavior from the repository. For external or version-sensitive behavior, WebSearch current official documentation and WebFetch the exact relevant page. Produce explicit acceptance criteria, exclusions, risks, and stop condition. Advance `research` only when this evidence exists.
2. **Consensus plan** — have the planner draft an implementation-ready plan and a separate QA reviewer challenge architecture, approval boundaries, and test shape. Resolve findings, assign each shared root file to one owner, then advance `plan`.
3. **Implementation waves** — lock missing behavior with regression tests, then dispatch independent file scopes in parallel. Dependent work stays sequential. Integrate and run targeted checks before advancing `execute`.
4. **Bounded QA/fix** — reproduce the acceptance path, run affected tests, and fix failures. Limit the cycle to five attempts; a repeated or unrecoverable failure uses `bizar workflow fail` with the current run, revision, and stage plus a concise reason. Advance `qa` only after fresh passing evidence.
5. **Parallel validation** — use separate functional, security/policy, and code-quality reviewers when their scopes are independent. Reconcile findings, run the repository's required final gates, and advance `validate`. Advancing the final stage completes the run.

## Guardrails

- Continue local read/edit/test/build work autonomously.
- Never auto-commit, push, open or mutate a pull request, publish, release, deploy, change credentials/access, expose a service publicly, or perform irreversible destruction.
- Do not add a note vault, wiki, semantic-memory service, daemon, or tmux controller. Durable workflow state is bounded operational state only.
- If cancelled, invoke the `cancel` skill; do not remove state by hand.
- If a conflict reports a newer revision or different stage, stop the stale write, fetch status, and continue from current state.

## Phase 6 cross-reference (OMX-derived primitives)

The four primitives below pivot the operator to a sibling skill when the
current task shape does not match `/autopilot`'s lifecycle. They are
informational — `/autopilot` itself continues unchanged — and they are not
invoked from the autopilot lifecycle. The office-manager (`@mike`) and the
`worker-suggest` hook surface them as routing pivots; the seven-category
HITL floor in `permission-request.mjs` remains the source of truth and
applies on top of every primitive.

- **`deep-interview`** — Stage 1-3 spec crispening. Use when the request is
  brief, broad, or missing acceptance criteria, decision boundaries, or
  non-goals; emit a durable spec at `docs/specs/deep-interview-<slug>.md`
  with the ambiguity score at or below `0.10` before advancing.
- **`ralplan`** — Separate planner and adversarial reviewer passes that
  produce a research-grounded implementation plan. Use when the operator
  asks only for a plan / architecture decision; do not let execution leak
  past the `plan` stage advance.
- **`ultragoal`** — Long-horizon multi-objective run with weighted
  sub-stories and a four-lane completion fence. Use when the operator
  wants durable steer across multiple objectives that only complete when
  every lane passes a fresh quality gate.
- **`brainstorming`** — Greenfield ideation. Use when the request is a new
  product / feature / tool with no spec yet, before any `deep-interview`
  or `ralplan` escalation.

## Provenance

The durable phased-run concept was independently adapted for Bizar after studying the MIT-licensed `oh-my-claudecode` project at pinned revision `41a4c0f77144c5beb5f5f000a89cff379c680606`. This procedure and its runtime contract are Bizar-specific; no upstream memory/wiki service, daemon transport, or automatic publication behavior is included.
