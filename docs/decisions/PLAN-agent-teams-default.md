# PLAN: Agent teams and native workflows as the primary Bizar default

**Status:** Draft — pending @linda audit
**Date:** 2026-08-26
**Author:** @karen (implementation plan) for @mike (orchestrator)
**Feature:** F-165 (proposed) — flip routing default from plain subagents to native
dynamic workflows and agent teams

## Context

Commit `fac9d85` (F-164, master) introduced three native dynamic workflow
scripts (`ultracode.js`, `ultracode-research.js`, `ultracode-review.js`), the
`/ultracode` slash command, the `ultracode` skill, the
`enableWorkflows: true` settings flag, the
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var, and the bounded fail-open
`team-lifecycle.mjs` hook for `TaskCreated / TaskCompleted / TeammateIdle`.
The same commit, however, framed the old defaults as the primary path:

> "Subagent dispatch through the Agent tool is the default for focused disjoint
> work. Native dynamic workflows under `~/.claude/workflows/` are used when a
> large or repeatable task benefits from deterministic scripted fan-out. Native
> agent teams are used only when independent workers need direct communication or
> shared task state."

`config/claude/agents/office-manager.md` reinforces this with the "Run both in
parallel via a single `Agent` message" pattern and the "Every implementation
task MUST be split into parallel streams. Never send a monolithic task to one
agent" rule.

The user wants the default flipped: agent teams and native workflows become the
primary pattern. Plain `Agent` calls become the fallback (trivial or fully
isolated work). F-164 delivered the substrate; this plan flips the policy and
ships three reusable Bizar workflows that exercise it.

## Goals

1. **Routing policy flip.** `AGENTS.md`, `config/claude/CLAUDE.md`, and
   `config/claude/agents/office-manager.md` describe native workflows and agent
   teams as the primary dispatch mechanism. Plain `Agent` calls survive only
   for trivial or fully isolated work.
2. **Decision tree.** `office-manager.md` opens with a routing decision tree
   that selects among plain `Agent`, native agent team (workflow-managed
   multi-agent coordination with shared state), and native workflow
   (`.claude/workflows/*.js`) based on the request shape.
3. **Reusable workflows.** Three new workflow scripts under
   `config/workflows/`, modelled on `ultracode*.js`:
   - `bizar-research.js` — pipeline pattern. `agent()` research → `agent()`
     plan → `agent()` audit → parallel `agent()` implementation lanes
     (greg → paul → linda → todd + karen). Accepts `{ topic }`.
   - `bizar-implement.js` — parallel + barrier pattern. Disjoint `agent()`
     lanes execute concurrently, a barrier phase merges results, a final
     `agent()` synthesizes. Accepts `{ topic, scope }`.
   - `bizar-debug.js` — loop-until-dry pattern. `agent()` RCA hypothesis →
     adversarial `agent()` verify → bounded re-plan if verify returns a
     confirmed defect. Accepts `{ bug_id, topic }`.
4. **Workflow test.** A `node --test` suite runs each new workflow against a
   stub runtime, asserts fan-out (≥2 `agent()` calls per workflow) and barrier
   (later phases receive earlier phases' results), and proves the return shape.
   Lives at `config/workflows/__tests__/bizar-default.test.mjs`.
5. **Ledger + docs.** `feature_list.json` opens `F-165` with WIP=1, then
   promotes it to `passing` after evidence; `PROGRESS.md` records the
   current-state entry and an after-evidence entry; `docs/architecture.md`
   describes the new default.
6. **Verification.** All `make` gates that were green for F-164 stay green.
   The workflow test is reachable via `make test` (or a new targeted target).

## Non-goals

- No new workflow runtime primitives. We use the same `agent()`, `pipeline()`,
  `parallel()`, `phase()`, `log()`, and the `args` runtime variable — the
  same shape that `ultracode*.js` already use. The 'budget-scaled agent
  fleets' concept lives inside the workflow script as a local counter, not
  as a primitive.
- No SDK changes. `packages/sdk/src/mcp/{server,bin}.ts` stays as-is. The
  workflow test stubs the runtime locally; it does not require the MCP server.
- No new dependencies. `node --test` is already in use across the repo.
- No change to `config/claude/model-router.json` tier rules or cost ceilings.
- No change to `enableWorkflows`, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`,
  or `team-lifecycle.mjs`. Those already shipped under F-164.
- No change to the hard approval list (commits, pushes, PRs, releases, deploys,
  prod writes, creds, public exposure, irreversible destruction).
- No change to the role of `@brenda`, `@todd`, `@linda`, or any other agent —
  only the routing policy that @mike applies at the top of a session.
- No rewrite of the three existing `ultracode*.js` workflows. They remain
  as-is; the new `bizar-*.js` scripts are the default-shape examples.
- No new tests for the existing F-164 deliverables. F-164 gates stay green by
  construction (we are not editing the same lines they assert on).

## Files to change

| File | Why |
| --- | --- |
| `AGENTS.md` | Replace the "Subagent dispatch through the Agent tool is the default" paragraph with the flipped version. Keep the parallel-dispatch rule and the inheritance / retry ban verbatim. |
| `config/claude/CLAUDE.md` | Mirror `AGENTS.md` (regenerated by `scripts/mirror-claude-md.sh`; the file says "DO NOT EDIT" so the workflow is: edit `AGENTS.md`, run `make mirror-claude-md`). |
| `config/claude/agents/office-manager.md` | Add a routing decision tree at the top of the "How You Route" section; replace the "single `Agent` message" rule with a "workflow or team unless trivial" rule; keep all phase-by-phase tables intact. |
| `config/workflows/bizar-research.js` | New. Pipeline: research → plan → audit → parallel implement → review → verify. |
| `config/workflows/bizar-implement.js` | New. Parallel lanes + barrier merge + final synthesis. |
| `config/workflows/bizar-debug.js` | New. RCA pipeline with bounded loop-until-dry. |
| `config/workflows/__tests__/bizar-default.test.mjs` | New. `node --test` against a stub runtime; asserts fan-out and barrier semantics. |
| `scripts/mirror-claude-md.sh` (no change needed) | Already mirrors `AGENTS.md` → `config/claude/CLAUDE.md`. The plan only invokes it. |
| `docs/architecture.md` | Add a "Routing default" subsection under "Runtime model" that names native workflows and agent teams as the primary path; reference this plan and `F-165`. |
| `feature_list.json` | Open `F-165` with WIP=1 (matching feature schema); promote to `passing` after evidence, with `commit` set to the squash hash and `evidence` citing the test command. |
| `PROGRESS.md` | Pre-change entry under a new "Active — F-165" section (current objective + plan link); post-change evidence entry citing `node --test` and `make` results. |
| `docs/decisions/PLAN-agent-teams-default.md` | This file. Becomes the source of truth for the audit trail. |

## Phases / commits

Three commits, each one logical operation, each with its docs in the same
commit.

### Commit A — routing policy + decision tree

**Files:** `AGENTS.md`, `config/claude/CLAUDE.md` (via
`scripts/mirror-claude-md.sh`), `config/claude/agents/office-manager.md`,
`docs/decisions/PLAN-agent-teams-default.md`, `PROGRESS.md` (pre-change entry),
`feature_list.json` (open `F-165` as WIP=1).

**Changes:**

1. `AGENTS.md` "Autonomy and parallelism" paragraph becomes:

   > "Native dynamic workflows under `config/workflows/` and
   > `~/.claude/workflows/` are the primary dispatch mechanism for non-trivial
   > tasks. Mike dispatches a named workflow when the request maps to a
   > research / implement / debug / review shape. For work that needs 3+
   > long-lived workers with bounded cross-talk, Mike invokes a workflow
   > that fans out as a native agent team; the team is host-side state
   > under `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, and per Anthropic's
   > docs `team_name` is deprecated and ignored. Plain `Agent` calls are
   > reserved for trivial, single-shot, or fully isolated work. When two
   > or more subtasks within a workflow have non-overlapping file scopes
   > and no data dependency on each other's intermediate output, the
   > orchestrator MUST dispatch them concurrently through `parallel([...])`.
   > Sequential dispatch is reserved for dependent phases and integration."

   Keep the inheritance / retry ban verbatim (it is not the target of this
   change).

2. `config/claude/agents/office-manager.md` opens the "How You Route" section
   with this decision tree (replacing the "4 Steps" framing, which becomes a
   workflow-launching shape):

   ```text
   1. Classify: trivial, focused-disjoint, or shaped (research / implement /
      debug / review).
   2. Trivial → single `Agent` to `@brenda`.
   3. Shaped → pick the matching `config/workflows/bizar-*.js` script and
      invoke it through the `Workflow` tool (e.g., `/workflow bizar-research`
      with the script name as the argument).
   4. Long-lived (≥3 workers, cross-talk needed) → workflow-driven agent
      team; the team is host-side state under
      `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (per Anthropic's docs,
      `team_name` is deprecated and ignored), with the `TeammateIdle`
      hook recording lifecycle evidence.
   5. Focused disjoint with no shape → plain `Agent` calls in a single
      message, 2+ items, disjoint scopes.
   ```

   The phase tables (Phase 1 RESEARCH, Phase 2 PLAN, etc.) become
   *descriptions of what the workflows do internally*, not steps Mike runs by
   hand. Mike now delegates the table steps to the matching workflow.

3. `PROGRESS.md` pre-change entry under "Active — F-165" with the plan link,
   the goal, and the commit expectation.

4. `feature_list.json` opens `F-165` as a new feature entry, WIP=1, scoped to
   the files listed above.

**Verification:**

- `grep -nE "Native dynamic workflows|workflow-driven|plain \`Agent\`" AGENTS.md config/claude/CLAUDE.md config/claude/agents/office-manager.md`
  to confirm the flipped language renders in all three files.
- Spot-read the edited files to confirm the decision tree and the mirrored
  paragraph are coherent.

### Commit B — three reusable workflows + workflow test

**Files:** `config/workflows/bizar-research.js`,
`config/workflows/bizar-implement.js`,
`config/workflows/bizar-debug.js`,
`config/workflows/__tests__/bizar-default.test.mjs`,
`PROGRESS.md` (mid-change entry), `feature_list.json` (scope expansion only).

**Workflow shape (mirrors `ultracode.js`):**

Each script:

- `export const meta = { name, description, whenToUse, phases: [...] }`
- Reads `args` via the same `typeof args === 'string' ? args : args?.task ||
  JSON.stringify(args || {})` pattern.
- Defines a local schema for typed return values where it helps.
- Calls `phase('...')` to mark milestones.
- Uses `parallel([...])` for concurrent fan-out, `pipeline(items, fns)` for
  sequential stages, and `agent(prompt, { label, phase, schema,
  isolation?: 'worktree' })` per dispatch.
- Returns `{ status, task: TASK, ...phases }` so the caller can resume.

**Specific shapes:**

- **`bizar-research.js`** — pipeline pattern. Phases: `Research` (parallel:
  `repository-map` + `official-docs`), `Plan` (single `agent()` producing a
  PLAN with disjoint lanes), `Audit` (single `agent()` adversarially
  reviewing), `Implement` (parallel lanes from the audited plan), `Verify`
  (sequential pipeline over implementations, then a final `agent()` synthesis
  with the verified findings). `isolation: 'worktree'` on the implement lanes,
  matching `ultracode.js`. Returns `{ status: 'ready-for-integration', task,
  research, plan, implementation, reviews, final }`.

- **`bizar-implement.js`** — parallel + barrier. Phases: `Scope` (single
  `agent()` extracts disjoint lanes from `{ topic, scope }`), `Implement`
  (`parallel([lane1, lane2, lane3])` with `isolation: 'worktree'`), `Barrier`
  (single `agent()` that produces a `MERGE` plan reconciling the lane
  outputs), `Verify` (sequential pipeline per lane), `Synthesis` (single
  `agent()` integration report). Returns `{ status: 'ready-for-integration',
  task, lanes, implementations, merge, reviews, synthesis }`.

- **`bizar-debug.js`** — loop-until-dry. Phases: `Hypothesis` (single
  `agent()` produces an RCA + cheapest discriminating experiment),
  `AdversarialVerify` (single `agent()` that *only* returns `confirmed: true`
  if the hypothesis survives a refutation), `Loop` (if not confirmed, repeat
  with the new evidence; bounded to N=3 iterations via a local counter),
  `Fix` (single `agent()` producing the smallest fix + regression test),
  `Verify` (single `agent()` re-checks the fix). Returns
  `{ status: 'dry' | 'budget-exhausted', bug_id, iterations, hypothesis, fix,
  verification }`.

  The "loop" is implemented as a plain `for` over a counter — not a
  recursive workflow invocation — to keep the script self-contained. (No new
  workflow primitive is introduced.)

**Workflow test** (`config/workflows/__tests__/bizar-default.test.mjs`):

- Uses `node --test` (`import test from 'node:test'`, `import assert from
  'node:assert/strict'`), matching the style of
  `cli/__tests__/workflow-state.test.mjs`.
- For each workflow:
  1. Reads the source.
  2. Wraps it in an async IIFE that binds `args`, `agent`, `pipeline`,
     `parallel`, `phase`, `log` as parameters — no real Claude Code runtime
     required.
  3. The stub runtime records every primitive call into an in-memory
     `calls[]` array and returns `{ stub: true, ... }` from `agent()`.
  4. Asserts:
     - `meta` is exported and has `name`, `description`, `whenToUse`,
       `phases` keys.
     - At least 2 `agent()` calls fire during the run.
     - The phases returned by `phase(...)` are observed in order.
     - At least one `parallel([...])` call exists with ≥2 items.
     - The return shape has the documented keys.
     - `pipeline(...)` is used at least once in `bizar-research.js`
       (pipeline pattern); `bizar-implement.js` does **not** contain
       `pipeline(` (parallel-only — barrier is a single `agent()` after
       `parallel`); `bizar-debug.js` exercises the bounded loop and does
       not need `pipeline(`.
     - Per-script `describe` block imports the `meta` export via dynamic
       `import()` and asserts `name`, `description`, `whenToUse`,
       `phases` match the documented keys for each script.
- The test file stays under 250 lines and adds no new dependencies.

**Verification:**

- `node --test config/workflows/__tests__/bizar-default.test.mjs` —
  all assertions pass.
- `make test` — the new test runs as part of the Node test suite. If
  `scripts/run-node-tests.mjs` does not currently glob `config/workflows/`,
  add it to the directory list (one line in that script, in Commit B).
- `make check` — TypeScript gate stays green (no TS files touched).
- `make verify-repo-structure`, `make verify-removed-surfaces`,
  `make check-arch`, `make clean-check` — all clean.
- `make mirror-claude-md-check` — `config/claude/CLAUDE.md` stays in
  sync with `AGENTS.md` after Commit A and Commit C.

### Commit C — docs + ledger close-out

**Files:** `docs/architecture.md`, `PROGRESS.md` (after-evidence entry),
`feature_list.json` (`F-165` promoted to `passing`).

**Changes:**

1. `docs/architecture.md` "Runtime model" gains a "Routing default"
   subsection naming native workflows and agent teams as primary, plain
   `Agent` as fallback, with a one-paragraph rationale and a link to
   `F-165`.

2. `PROGRESS.md` "Active — F-165" section closes with the after-evidence
   entry:

   ```text
   **Verification (2026-08-26):**
   - node --test config/workflows/__tests__/bizar-default.test.mjs — N/N pass.
   - make check / make test / make verify-repo-structure / make verify-removed-surfaces / make check-arch / make clean-check — clean.
   - AGENTS.md, config/claude/CLAUDE.md (mirrored), config/claude/agents/office-manager.md reflect the flipped default.
   ```

3. `feature_list.json` `F-165`:
   - `state: "passing"`
   - `evidence`: dated, with the test command + counts + commit hash.
   - `commit`: squash hash from the merge that lands all three commits,
     matching the `F-164: "commit": "fac9d85"` precedent.

**Verification:**

- `make vcr` — activated + passing counts increment by 1.
- `make check-arch` — no new removed surfaces.
- `make verify-repo-structure` — no stray paths.

## Risks and stop conditions

- **Risk:** the routing flip makes a downstream workflow harder to read for
  callers who were using the old "single `Agent` message" pattern verbatim.
  **Mitigation:** default action is to delete the legacy paragraph; if
  @linda requests it, retain under a "Prior shape (deprecated, retained for
  reference)" callout inside `office-manager.md`.

- **Risk:** the workflow test depends on the stub runtime's return shape
  matching Claude Code's. If Claude Code's runtime ever changes, the test
  will silently pass on a stub but break in production.
  **Mitigation:** the test asserts *fan-out + barrier + return shape* — all
  shape-level, not value-level. The shape is documented in
  `config/workflows/ultracode.js` and has been stable across F-164.

- **Risk:** `bizar-debug.js`'s loop-until-dry runs unbounded if the verify
  agent keeps returning `confirmed: false` with no progress.
  **Mitigation:** explicit `for (let i = 0; i < 3; i++)` cap with a hard
  return of `{ status: 'budget-exhausted', ... }` and a `log(...)` entry
  naming the budget. No `while(true)` and no external retry loop.

- **Risk:** the workflow scripts import nothing and use bare globals. If a
  future maintainer treats them as ordinary ESM modules, they will get
  `ReferenceError`.
  **Mitigation:** keep the existing pattern (`ultracode*.js` already do
  this); the test enforces it by passing globals through `Function`
  constructor parameters. No new docstring is added — the shape is
  established.

- **Risk:** a user disables `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
  (the default — Anthropic: *"Agent teams are experimental and disabled
  by default"*). The team-shaped workflow path then silently runs as
  plain subagent dispatch with no error.
  **Mitigation:** `config/claude/settings.json` already sets the env var
  under F-164, so a fresh install is covered; document that `bizar audit`
  should flag a missing `enableWorkflows` +
  `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` as an installation drift, and
  keep `team-lifecycle.mjs` always-fail-open so a missing env var does
  not crash the harness.

- **Stop condition (any of):** `make check` red; `make test` red; the new
  workflow test fails twice in a row without an obvious cause; @linda rejects
  the plan in audit; a hard approval list item is touched (commit / push / PR
  / release / deploy / prod write / creds / public exposure / irreversible
  destruction).

- **Escalation:** any of the above triggers an immediate handoff to @mike
  with the exact failure, the failing command output, and a proposed next
  action.

## Definition of Done

1. `AGENTS.md`, `config/claude/CLAUDE.md` (mirrored), and
   `config/claude/agents/office-manager.md` describe native workflows and
   agent teams as the primary dispatch mechanism.
2. `config/workflows/bizar-research.js`, `bizar-implement.js`, and
   `bizar-debug.js` exist and pass
   `node --test config/workflows/__tests__/bizar-default.test.mjs`.
3. `docs/architecture.md` has a Routing-default subsection referencing
   `F-165`.
4. `feature_list.json` opens `F-165` as WIP=1 in Commit A and promotes it
   to `passing` in Commit C.
5. `PROGRESS.md` records a current-state entry (Commit A) and an
   after-evidence entry (Commit C) for `F-165`.
6. `make verify-removed-surfaces`, `make verify-repo-structure`,
   `make check-arch`, `make clean-check`, `make test`, and `make check`
   are green.
7. `make e2e` exits 0 and reports N/N passing (the new workflow scripts
   do not touch the SDK/MCP integration surface, so the count should match
   F-164's 13/13).
8. `/simplify` review of the staged diff happens before the approval-gated
   commits.

## Verification commands (run order)

```sh
# Commit A pre-push
grep -nE "Native dynamic workflows|workflow-driven|plain \`Agent\`" \
  AGENTS.md config/claude/CLAUDE.md config/claude/agents/office-manager.md
grep -nE 'bizar-research|bizar-implement|bizar-debug' \
  config/claude/agents/office-manager.md
make mirror-claude-md
make mirror-claude-md-check

# Commit B
node --test config/workflows/__tests__/bizar-default.test.mjs
make test
make check
make verify-repo-structure
make verify-removed-surfaces
make check-arch
make clean-check

# Commit C
make vcr
make e2e
```

## Open questions for @linda

1. **Team scope semantics.** WebSearch did not surface a primary Anthropic
   page that documents `team_name` as a parameter on the Workflow tool's
   `agent()` primitive; the team-lifecycle hook (F-164) treats teams as
   host-side state via `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` and
   `TeammateIdle`. The plan therefore describes an "agent team" as
   *workflow-managed multi-agent coordination with shared state*, not as a
   single API call. Should we instead describe this as "team-shaped
   workflows" to avoid implying a `team_name:` parameter that we cannot
   point at in the docs? (Community sources: alexop.dev, kimi.ai 2026 guide;
   no Anthropic primary doc located.)

2. **Squash vs. three-commit history.** `feature_list.json` `commit` field
   historically carries the squash hash. Should `F-165` carry the squash
   hash of all three commits landing together, or the hash of the
   workflows-commit specifically? (Default: squash hash, matching
   `F-164: "commit": "fac9d85"` precedent.)

3. **Workflow slash commands.** The plan does *not* add
   `/bizar-research`, `/bizar-implement`, `/bizar-debug` slash commands
   under `config/claude/commands/`. The Workflow tool already exposes
   installed scripts directly. Should the plan grow to add command wrappers
   for parity with `/ultracode`? (Default: skip — `/ultracode` was added
   because ultracode is the umbrella brand; `bizar-*.js` are internal
   patterns, not user-facing commands.)

4. **`bizar-debug.js` budget source.** The bounded loop counter lives
   inside the workflow script (a local `for` loop). Should it instead read
   `WORKFLOW_LIMITS.maxDebugIterations` from `cli/core/workflow-state.mjs`
   for cross-workflow consistency? (Default: hard-coded `3` inside the
   script — same pattern as `ultracode.js`'s `lanes.slice(0, 8)`. Cross-
   script config is its own future feature.)

5. **Out of scope.** The plan does *not* touch `packages/sdk`, the MCP
   server, the agent registry, model-router tiers, or the team-lifecycle
   hook. Should any of these be in-scope for the F-165 rollout? (Default:
   out of scope; they are F-164 deliverables and stay as-is.)

## Out-of-scope observations (flagged for future work)

- The `Workflow` tool's primitives are documented via
  `claudelog.com/claude-code/Workflows/` (search hit) but WebFetch returned
  403. We do not propose to fetch from a non-primary source as part of
  implementation; the existing `ultracode*.js` files are the authoritative
  in-repo shape reference, and the plan copies it.
- The plan does not add new tests for F-164's deliverables. They remain
  green by construction.
- The plan does not introduce a "workflow registry" or a "team registry"
  data structure. The shape stays filesystem-based.
