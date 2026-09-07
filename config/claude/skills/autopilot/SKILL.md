---
name: autopilot
description: Run Bizar's durable end-to-end workflow from researched specification through implementation, QA, independent validation, and required repository gates.
argument-hint: "[--workflow <default|plan-build-qa>] <task or outcome>"
---

# Autopilot

Use Autopilot for a clear, non-trivial outcome that should be delivered locally without routine permission handoffs. The office manager remains the single orchestrator; worker agents receive bounded, disjoint assignments.

> **Phase discipline is preserved** — research/spec → consensus plan →
> implementation waves → bounded QA/fix → parallel validation. The
> durable artifact for each phase is an OpenKan task; phase advances are
> `ok task update <id> --status <new-status> --evidence "..."`. There is
> no `bizar workflow` CLI; everything routes through `ok` (the
> OpenKan-native CLI at `~/.local/bin/ok`).

## Start or resume

1. Read repository instructions and authoritative OpenKan `.ok/` state with `ok task list`, `ok plan list`, and `ok prd list`.
2. Query durable state first:

   ```sh
   ok task list --json
   ok plan list --json
   ok prd list --json
   ```

3. If an active plan already owns the session's intent, resume by reading its current state:

   ```sh
   ok plan show "$ACTIVE_PLAN_ID" --json
   ok task list --plan "$ACTIVE_PLAN_ID" --json
   ```

4. Otherwise parse the optional leading `--workflow <default|plan-build-qa>` selector and remove it from the task text used as the goal. If the selector is omitted, use `default`: bounded task-wave execution with at most three parallel agents. Use `plan-build-qa` for a plan-led build with dedicated QA/validation gates and at most five parallel agents. Create the durable plan and its first task:

   ```sh
   # default profile → bounded task-wave execution, ≤3 parallel agents
   ok plan add "$TASK_GOAL" --summary "Autopilot plan-build-qa run" --json
   ok task add "research/spec" --plan "$PLAN_ID" --priority p1 --json
   ```

   Examples: `/autopilot implement the task` selects `default`; `/autopilot --workflow plan-build-qa implement the task` selects the plan-led profile. Reject unknown workflow names instead of silently substituting another profile.

Only one plan may own a project/session pair at a time. Never delete or edit `.ok/` files directly — always go through the `ok` CLI.

## Lifecycle

For every transition, re-read task/plan state and use the current values. Record compact evidence that identifies the proving command, result, or artifact; do not place transcripts or secrets in OpenKan evidence fields.

```sh
ok task update "$TASK_ID" --status in_progress --json
ok task complete "$TASK_ID" --evidence "$BOUNDED_EVIDENCE" --json
ok task add "<next-stage>" --plan "$PLAN_ID" --priority p1 --json
```

Run the stages in order. Each stage is a task under the plan; advancing the run means completing the current task with evidence and creating the next.

1. **Research/spec** — establish current behavior from the repository. For external or version-sensitive behavior, WebSearch current official documentation and WebFetch the exact relevant page. Produce explicit acceptance criteria, exclusions, risks, and stop condition. Mark `research` done only when this evidence exists.
2. **Consensus plan** — have the planner draft an implementation-ready plan and a separate QA reviewer challenge architecture, approval boundaries, and test shape. Resolve findings, assign each shared root file to one owner, then mark `plan` done.
3. **Implementation waves** — lock missing behavior with regression tests, then dispatch independent file scopes in parallel. Dependent work stays sequential. Integrate and run targeted checks before completing `execute`.
4. **Bounded QA/fix** — reproduce the acceptance path, run affected tests, and fix failures. Limit the cycle to five attempts; a repeated or unrecoverable failure uses `ok task cancel <id> --reason "..."` with the current task id and a concise reason. Complete `qa` only after fresh passing evidence.
5. **Parallel validation** — use separate functional, security/policy, and code-quality reviewers when their scopes are independent. Reconcile findings, run the repository's required final gates, and complete `validate`. Completing the final task closes the plan.

## Guardrails

- Continue local read/edit/test/build work autonomously.
- Never auto-commit, push, open or mutate a pull request, publish, release, deploy, change credentials/access, expose a service publicly, or perform irreversible destruction.
- Do not add a note vault, wiki, semantic-memory service, daemon, or tmux controller. Durable state lives only in OpenKan's `.ok/` workspace.
- If cancelled, invoke the `cancel` skill; do not remove state by hand.
- If a task reports an unexpected status or owner, stop the stale write, fetch `ok task show <id>`, and continue from current state.

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
- **`bizplan`** — Separate planner and adversarial reviewer passes that
  produce a research-grounded implementation plan. Use when the operator
  asks only for a plan / architecture decision; do not let execution leak
  past the `bizplan` stage advance.
- **`ultragoal`** — Long-horizon multi-objective run with weighted
  sub-stories and a four-lane completion fence. Use when the operator
  wants durable steer across multiple objectives that only complete when
  every lane passes a fresh quality gate.
- **`brainstorming`** — Greenfield ideation. Use when the request is a new
  product / feature / tool with no spec yet, before any `deep-interview`
  or `bizplan` escalation.

## Provenance

The durable phased-run concept was independently adapted for Bizar after studying the MIT-licensed `oh-my-claudecode` project at pinned revision `41a4c0f77144c5beb5f5f000a89cff379c680606`. This procedure and its runtime contract are Bizar-specific; no upstream memory/wiki service, daemon transport, or automatic publication behavior is included.
