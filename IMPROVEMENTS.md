# BizarHarness Autonomy and Self-Improvement Audit

**Audit date:** 2026-08-27  
**Initial audited revision:** `bc3dffceb3f6c44c9b08ce72dfbdaa4da7dc4708` (`master`)  
**Model-selection follow-up:** 2026-08-27  
**Target:** a fully autonomous, self-improving development harness that completes useful engineering work with minimal human interaction  
**Non-negotiable design constraint:** agents retain full local tool permissions and run non-interactively. Improvements in this document must not restore routine permission prompts or reduce the local development tool surface.

## Executive summary

BizarHarness is already a broad and unusually disciplined Claude Code harness. It has role-based orchestration, dynamic workflows, worktree isolation, a shared task ledger, bounded workflow state, cost controls, evaluation scripts, lifecycle hooks, model routing, session handoffs, an SDK, and extensive tests. These are strong foundations for autonomous development.

However, the repository currently implements **autonomous execution with learning records**, not a complete **self-improving closed loop**. The harness can plan, dispatch, edit, test, review, recover, and record instincts or decisions, but there is no sufficiently rigorous mechanism that:

1. derives a candidate harness change from repeated execution evidence;
2. evaluates the candidate against a stable benchmark and an unchanged control;
3. promotes it only when it improves target metrics without safety regressions;
4. deploys it gradually;
5. detects regression in live use; and
6. rolls it back automatically.

The largest gap is therefore not more agents, commands, or prompts. It is an evidence-driven improvement controller around the existing execution engine.

The full-permission policy is intentional and should remain. The engineering requirement is to make that power safe through **isolation, invariants, budgets, provenance, evaluation, and rollback**, rather than interactive approval. Routine local development should remain fully autonomous.

## Scope and method

This is a static repository audit. It reviewed the repository structure and the principal documentation and implementation surfaces visible at the audited revision, including:

- `README.md`, `AGENTS.md`, `docs/architecture.md`, and `docs/safety.md`;
- `config/claude/settings.json`, agent, workflow, hook, and skill surfaces;
- durable workflow and task-state code;
- cost, audit, evaluation, feature-ledger, worktree, and recovery tooling;
- SDK learning, routing, loop, decision, instinct, graph, federation, consensus, and MCP surfaces;
- the test inventory and the claims/evidence stored in `feature_list.json`.

The audit did not execute the repository test suite because the assessment was performed through the GitHub repository connection rather than a checked-out runtime. Existing test evidence was treated as repository evidence, not independently reproduced proof.

## Current maturity assessment

| Capability | Current maturity | Assessment |
| --- | ---: | --- |
| Autonomous local execution | 4/5 | Full tool access, autonomous edit/test loops, workflows, and agent dispatch are present. |
| Task decomposition and routing | 4/5 | Role agents, workflow phases, model routing, parallel dispatch, and task ownership are substantial. |
| Parallel change isolation | 4/5 | Git worktrees, leases, path scopes, an integration queue, and merge sequencing are strong foundations. |
| Durable recovery | 4/5 | Workflow revisions, atomic writes, bounded retries, session restoration, and handoffs are present. |
| Verification | 3/5 | Many checks exist, but evidence is not yet a unified, tamper-resistant promotion contract. |
| Observability | 3/5 | Logs and state exist, but end-to-end traces, comparable run metrics, and causal attribution are incomplete. |
| Safety under full permission | 2/5 | Full permission is intentional, but advisory guidance alone cannot provide deterministic containment. |
| Learning | 2/5 | Instinct and decision records capture experience; demonstrated policy improvement is limited. |
| Self-improvement | 1/5 | No complete generate-evaluate-canary-promote-rollback controller is evident. |
| Production readiness | 2/5 | The unprotected default branch and incomplete release/promotion controls are material operational gaps. |

**Overall conclusion:** BizarHarness is a capable guarded workflow framework evolving toward autonomy, but it is not yet a reliably self-improving development system. The next stage should focus on closing the empirical control loop rather than expanding surface area.

## Strengths to preserve

### 1. Worktree and task-ledger architecture

Editing agents are isolated in Git worktrees, while shared SQLite state coordinates dependencies, claims, path scopes, leases, and integration. This is the correct direction for full-permission agents: isolate their change domains and serialize integration instead of interrupting every tool call.

Preserve this architecture and make it the mandatory substrate for self-modification experiments.

### 2. Bounded durable workflows

The autopilot lifecycle has explicit phases, revisioned state, bounded failure/QA/validation transitions, and resume semantics. Completion requires fresh evidence rather than assistant prose alone. These are essential properties for unattended execution.

### 3. Verification breadth

The repository contains architectural checks, cleanup checks, E2E scripts, feature-state machinery, evaluation gates, SDK and CLI tests, hook tests, and package-boundary checks. This provides raw material for a promotion gate.

### 4. Operational evidence

`feature_list.json`, `PROGRESS.md`, decision records, instincts, audit records, session handoffs, and task evidence form an extensive evidence trail. The problem is not absence of data; it is lack of a canonical schema and causal promotion process.

### 5. Full-permission development mode

The current settings intentionally give agents broad local access and avoid permission friction. This aligns with the stated product goal. Keep this behavior for normal local development and for autonomous experiments inside isolated environments.

## Critical findings

### P0 — There is no closed-loop self-improvement controller

Bizar records learning artifacts and exposes loops, instincts, decisions, graph queries, and evaluation utilities, but these do not yet constitute a reproducible optimization loop.

A real self-improvement controller needs a typed lifecycle:

```text
observe -> diagnose -> propose -> isolate -> evaluate
        -> compare -> canary -> promote -> monitor -> retain/rollback
```

Every transition must be based on machine-verifiable evidence. An LLM's qualitative judgment may propose a candidate, but it must not be the sole promotion signal.

**Required improvement**

Add a first-class `ImprovementRun` subsystem with:

- immutable baseline revision and configuration digest;
- hypothesis, target metric, permitted scope, and expected trade-off;
- candidate branch/worktree and exact patch digest;
- frozen benchmark-set version;
- repeated control and candidate trials;
- quality, cost, latency, reliability, and safety results;
- statistical comparison and minimum effect threshold;
- canary status and exposure;
- automatic rollback criteria;
- final disposition and causal evidence links.

Store append-only events plus a materialized state view. Do not allow the candidate agent to rewrite its own evidence or benchmark definitions during the same run.

**Acceptance gate**

A command such as `bizar improve run <hypothesis>` must be able to create a candidate, execute control/candidate trials, reject a regression, canary a passing candidate, and automatically restore the previous installed bundle after a simulated live regression.

### P0 — Full permission lacks deterministic containment

The current policy intentionally uses `bypassPermissions`, broad allow patterns, empty ask/deny lists, and advisory PreToolUse hooks. This is acceptable as an interaction policy, but advisory text is not a containment boundary. A mistaken or prompt-injected agent can ignore context.

The correct response is not to remove full permission. It is to move containment below the conversational permission layer.

**Required improvement**

Introduce an execution envelope for autonomous workers:

- disposable worktree or ephemeral filesystem snapshot for every code-writing task;
- optional container/microVM profile for untrusted repositories and self-modification;
- workspace-scoped writable mounts by default, with explicit task-declared additional mounts;
- per-task network profile and egress recording;
- per-run CPU, memory, process, wall-clock, token, and monetary budgets;
- process-tree ownership and cleanup on cancellation or lease expiry;
- secret brokering that exposes only task-scoped credentials;
- immutable harness controller and benchmark mounts during candidate evaluation;
- automatic snapshot restore on failure.

The agent still receives full permission **inside its execution envelope**. No routine prompts are introduced.

**Acceptance gate**

A malicious fixture must be unable to alter the controller, baseline benchmark, sibling worktree, or host credential store, even though the worker itself runs in full-permission mode.

### P0 — Promotion and default-branch integrity are insufficient

At the audited revision, `master` is unprotected and has no required status checks. A self-improving system must not be able to declare itself improved and directly replace its only known-good state without an independent gate.

Minimal human interaction does not require an unprotected branch. Protection can be fully automated.

**Required improvement**

- Protect `master`.
- Require the canonical CI workflow, benchmark comparison, security/invariant suite, and artifact provenance check.
- Require linear promotion through an integration branch or promotion ref.
- Prevent the candidate under test from changing required checks, benchmark definitions, promotion policy, or controller code in the same promotion.
- Permit automatic merges only after all machine gates pass.
- Maintain a signed known-good release pointer and a one-command/automatic rollback path.

**Acceptance gate**

A candidate that deletes or weakens a required check must be rejected even when its ordinary tests pass.

### P0 — Self-reported evidence is too trusted

Feature records contain detailed prose evidence and state fields. This is useful for humans, but an autonomous agent can accidentally or deliberately mark a feature passing without reproducible proof. Evidence needs to reference immutable outputs produced by independent commands.

**Required improvement**

Create a canonical `EvidenceBundle`:

- command argv, working directory, sanitized environment digest, start/end times, and exit code;
- stdout/stderr artifact hashes;
- test case counts and machine-readable result files;
- code coverage and mutation score where relevant;
- Git revision, dirty-state status, patch digest, dependency lock digest, and runtime versions;
- evaluator identity/version and rubric digest;
- links to trace, benchmark, security, and cost artifacts;
- signature or HMAC produced by the controller, not the worker.

Promotion rules consume this bundle directly. Markdown summaries are generated views, never the source of truth.

### P1 — Evaluation is broad but not representative enough

Repository checks primarily prove internal consistency. Autonomous software engineering also requires task-level outcome evaluation across different repositories, task types, ambiguity levels, failure modes, and long-running sessions.

**Required improvement**

Build a versioned benchmark corpus with at least:

- small bug fixes with hidden tests;
- cross-package refactors;
- dependency/API migrations using current official documentation;
- frontend tasks with browser assertions;
- backend tasks with integration and persistence assertions;
- security fixes with exploit regression tests;
- flaky-test diagnosis;
- ambiguous tasks requiring assumption tracking;
- merge-conflict and parallel-agent scenarios;
- interrupted/resumed multi-session work;
- adversarial repository instructions and prompt-injection fixtures;
- cost-constrained tasks that force model-routing decisions.

Use frozen train/tune/holdout partitions. Self-improvement may optimize on train/tune but promotion must depend on hidden holdout results controlled by the evaluator.

Track:

- task success rate;
- hidden-test pass rate;
- regression rate;
- human correction rate;
- median and p95 wall time;
- token and monetary cost;
- unnecessary diff size;
- revert rate;
- nondeterminism across repeated trials;
- policy/invariant violations.

### P1 — Learning records are not connected to measured outcomes

Instincts and decisions are useful only if the harness can establish when a learned rule improves behavior, when it is irrelevant, and when it should expire.

**Required improvement**

Give every learned policy:

- provenance to the runs that produced it;
- applicability predicates;
- confidence and uncertainty;
- success/failure counters;
- last validated timestamp;
- expiration/decay behavior;
- conflicts with other policies;
- evaluator results before and after activation;
- rollout state: shadow, canary, active, quarantined, retired.

Learned rules should first run in shadow mode, where their recommended action is logged but not applied. Promote only after counterfactual or A/B evidence indicates benefit.

### P1 — No explicit separation between optimizer and evaluator

If the same agent proposes a change, edits benchmarks, judges the output, and promotes the result, Goodhart's law and reward hacking become inevitable.

**Required improvement**

Define separate trust domains:

- **Worker:** performs product task.
- **Optimizer:** analyzes traces and proposes harness changes.
- **Evaluator:** owns frozen tests and metrics; cannot modify candidate.
- **Promoter:** applies deterministic policy to evaluator results.
- **Watchdog:** monitors canary/live regressions and rolls back.

These can use the same underlying model provider, but they must have separate contexts, writable scopes, and credentials. The evaluator should be deterministic wherever possible and model-graded only where necessary. Model-graded evaluations should use multiple blinded samples and calibrated rubrics.

### P1 — Observability does not yet support causal diagnosis

A collection of logs is not enough to know why an autonomous run improved or failed.

**Required improvement**

Adopt a unified trace model:

- run, phase, task, agent, model, tool call, worktree, commit, test, evaluation, and promotion spans;
- stable correlation IDs across Claude Code hooks, CLI, SDK, MCP, task ledger, and control messages;
- prompt/config/model/tool versions;
- structured failure taxonomy;
- retry and recovery relationships;
- decisions and retrieved evidence linked to the action they influenced;
- automatic redaction at ingestion;
- export to JSONL/OpenTelemetry without requiring a persistent Bizar service.

Add `bizar explain-run <id>` to produce a causal summary grounded in trace links.

### P1 — Budgeting must become hierarchical and adaptive

Cost gates exist, but a fully autonomous harness needs budgets at objective, workflow, agent, model, tool, and retry levels.

**Required improvement**

- Reserve a budget before dispatch.
- Charge actual use to the task ledger.
- Enforce hard ceilings without human intervention.
- Stop low-value retries based on expected utility.
- Escalate model tier only after a recorded failure condition.
- Compare candidate policies on quality per euro/token/minute, not quality alone.
- Detect runaway fan-out, repeated equivalent searches, and duplicate test execution.
- Allocate an explicit exploration budget for self-improvement.

### P1 — Recovery needs tested fault injection

Bounded retries and workflow restoration are present, but recovery claims should be continuously tested under controlled faults.

**Required improvement**

Add deterministic chaos scenarios:

- worker killed mid-write;
- controller killed during state transition;
- corrupt/truncated JSONL;
- SQLite busy/locked;
- expired lease with a live process;
- disk full;
- network unavailable;
- provider timeout/rate limit;
- partial worktree merge;
- failing cleanup;
- stale baseline;
- duplicate hook delivery;
- evaluator crash after candidate completes.

Each scenario must prove idempotent resume or clean rollback without double promotion, lost ownership, or evidence corruption.

## Important documentation and contract drift

The repository describes both guarded autonomy and a later full-permission/advisory-hook policy. The latter is the intended direction, but multiple surfaces still frame hooks as deterministic denial/approval gates.

This ambiguity is dangerous because operators and future agents cannot determine the actual trust boundary from a single authoritative source.

**Required improvement**

Create one versioned `AUTONOMY_CONTRACT.md` and make other documents link to it. It should state:

- agents have full non-interactive local tool permission;
- which isolation envelope contains that permission;
- which operations are autonomous;
- which external side effects are disabled, automatically gated, or operator-configurable;
- who owns benchmarks and promotion policy;
- budget behavior;
- rollback guarantees;
- recovery-point objectives;
- what “self-improving” means in measurable terms;
- explicit non-goals.

Add an automated documentation-as-code test that compares the contract against settings, hook behavior, CI policy, controller configuration, and release rules.

## Recommended target architecture

```text
Objective
   |
Autonomy controller
   |-- task graph and budget allocator
   |-- isolated full-permission workers
   |-- evidence collector
   |-- verifier
   |
Trace and outcome store
   |
Improvement optimizer
   |-- hypothesis generator
   |-- isolated candidate worktree
   |
Independent evaluator
   |-- frozen benchmarks
   |-- control/candidate trials
   |-- invariant and security suite
   |
Deterministic promoter
   |-- shadow -> canary -> active
   |-- signed known-good pointer
   |
Watchdog
   |-- drift/regression detection
   |-- automatic rollback
```

This architecture preserves the existing Claude Code-native approach. It does not require an embedded web control plane or a persistent general-purpose daemon. Long-running coordination can be implemented as resumable CLI jobs driven by CI, a scheduler, or the optional external control plane.

## Prioritized implementation roadmap

### Phase 0 — Define truth and freeze invariants

1. Add `AUTONOMY_CONTRACT.md`.
2. Define machine-readable invariants in `.harness/autonomy-policy.json`.
3. Protect `master` and require CI.
4. Define signed known-good and candidate refs.
5. Convert feature evidence to controller-generated bundles.
6. Add tests proving a candidate cannot modify its evaluator, benchmark, or promotion policy.

**Exit criterion:** the repository has one authoritative policy, protected promotion, immutable evidence, and a tested rollback pointer.

### Phase 1 — Unified run ledger and observability

1. Define `Run`, `Span`, `Artifact`, `EvidenceBundle`, and `Outcome` schemas.
2. Correlate CLI, SDK, hooks, tasks, worktrees, workflows, models, costs, and tests.
3. Add redaction and retention policies.
4. Implement `bizar run show`, `bizar explain-run`, and `bizar run replay`.
5. Replace prose-only completion claims with bundle references.

**Exit criterion:** every completed task can be reproduced or explained from immutable machine-readable evidence.

### Phase 2 — Autonomous execution envelope

1. Make isolated worktrees mandatory in code, not only agent instructions.
2. Add container/microVM execution profiles.
3. Add hierarchical resource and network budgets.
4. Add task-scoped secret brokering.
5. Add automatic cleanup and snapshot rollback.
6. Add adversarial containment tests.

**Exit criterion:** workers retain full permissions while host, controller, baseline, sibling tasks, and credentials remain protected.

### Phase 3 — Benchmark and evaluator

1. Create a versioned task corpus and hidden holdout.
2. Establish baseline results over repeated trials.
3. Add deterministic correctness, security, cost, latency, and diff-quality metrics.
4. Calibrate model-graded rubrics where deterministic checks are impossible.
5. Add nondeterminism and confidence-interval reporting.
6. Make evaluator artifacts immutable to optimizer and worker.

**Exit criterion:** a harness revision has a reproducible scorecard and regression budget.

### Phase 4 — Improvement controller

1. Add `bizar improve observe`, `propose`, `evaluate`, `canary`, `promote`, and `rollback`.
2. Mine repeated failure clusters and costly trace patterns.
3. Generate scoped hypotheses, not open-ended self-rewrites.
4. Run paired control/candidate trials.
5. Reject insignificant or mixed regressions.
6. Store causal links from observation to hypothesis to outcome.

**Exit criterion:** Bizar can autonomously produce and reject or promote a small routing/prompt/tooling improvement using objective evidence.

### Phase 5 — Shadow learning and safe online adaptation

1. Add learned-policy lifecycles and decay.
2. Run new instincts in shadow mode.
3. Canary by repository/task class.
4. Monitor live deltas against known-good behavior.
5. Roll back automatically on threshold breach.
6. Quarantine recurring harmful policies and feed evidence back to the optimizer.

**Exit criterion:** online learning changes behavior gradually and reversibly without routine human interaction.

### Phase 6 — Reliability and long-horizon autonomy

1. Add fault injection to CI.
2. Add unattended multi-day objective tests.
3. Test provider failover without alias-cycling loops.
4. Test interrupted sessions and machine restarts.
5. Add SLOs for completion, recovery, cost, and rollback.
6. Publish an automatically generated autonomy scorecard per release.

**Exit criterion:** the harness completes long-running objectives and recovers from injected failures within defined SLOs.

## Concrete initial backlog

| ID | Priority | Deliverable | Acceptance test |
| --- | --- | --- | --- |
| IMP-001 | P0 | `AUTONOMY_CONTRACT.md` plus policy schema | Settings/docs/policy consistency test passes. |
| IMP-002 | P0 | Protected automated promotion pipeline | Candidate cannot push directly to known-good ref. |
| IMP-003 | P0 | Immutable `EvidenceBundle` | Forged prose/state cannot satisfy completion gate. |
| IMP-004 | P0 | Full-permission execution envelope | Adversarial worker cannot modify host/controller/baseline. |
| IMP-005 | P0 | Improvement-run state machine | Simulated regression automatically rolls back. |
| IMP-006 | P1 | Versioned benchmark corpus | Baseline is reproducible across three repeated trials. |
| IMP-007 | P1 | Independent evaluator boundary | Candidate modifying evaluator paths is rejected. |
| IMP-008 | P1 | Unified trace IDs | One run is traceable across all orchestration surfaces. |
| IMP-009 | P1 | Hierarchical budgets | Runaway fan-out terminates within declared ceiling. |
| IMP-010 | P1 | Shadow/canary policy lifecycle | Harmful learned rule is quarantined without operator input. |
| IMP-011 | P1 | Fault-injection suite | Crash at every state transition resumes idempotently. |
| IMP-012 | P2 | Autonomy release scorecard | CI publishes quality/cost/reliability/safety deltas. |

## Metrics for “fully autonomous” and “self-improving”

Do not declare the goal achieved based on feature count. Use explicit thresholds, initially:

- at least 80% completion on the hidden representative task suite;
- less than 2% regression against the known-good revision;
- zero benchmark, evaluator, controller, credential, or sibling-workspace integrity violations;
- 100% of completed tasks backed by valid evidence bundles;
- 100% automatic rollback success in promotion fault tests;
- at least 95% successful recovery from injected resumable faults;
- bounded p95 cost and duration per task class;
- a statistically supported improvement in at least one target metric with no forbidden regression before promotion;
- no routine permission prompts during normal local autonomous development;
- all promoted learned policies pass shadow and canary stages.

Thresholds should become task-class specific as the corpus matures.

## What not to build next

Until the P0/P1 control-loop work is complete, avoid prioritizing:

- more role-agent personas;
- more commands that duplicate existing workflow phases;
- a larger MCP surface without promotion evidence;
- unconstrained recursive prompt rewriting;
- autonomous modification of benchmarks and evaluator code;
- semantic memory that stores more text without outcome attribution;
- direct self-push to the known-good branch;
- a dashboard that visualizes state but does not improve evidence quality.

These additions increase complexity faster than autonomous reliability.

## Final assessment

BizarHarness has enough orchestration machinery to become the intended system. Its strongest components—durable workflows, task leasing, worktree isolation, verification scripts, cost controls, and learning records—should be composed into an empirical improvement controller.

The recommended direction is:

1. keep full permissions for agents;
2. contain those permissions inside isolated execution envelopes;
3. make evidence immutable and independently generated;
4. evaluate candidate changes against frozen benchmarks and a known-good control;
5. promote automatically through shadow and canary stages;
6. monitor outcomes and roll back automatically.

When those mechanisms are implemented and validated with representative benchmarks and fault injection, BizarHarness can credibly claim to be a fully autonomous, self-improving development harness with little human interaction.


---

## Model Selection Audit

**Audit date:** 2026-08-27  
**Revision inspected:** `274c7f59e437e2728f803d2371c0afab0ef73583` and its model-routing sources  
**Required behavior:** Mike must select the best suitable model from the operator's configured model pool for every subagent and team-member dispatch. Selection must be automatic, task-specific, observable, outcome-driven, and consistent across direct Agent calls and native workflows.

### Verdict

**The required behavior is documented but is not reliably implemented end to end.**

Direct dispatches made manually by Mike can include a model chosen according to the instructions in `office-manager.md`. However, the primary native workflows—`bizar-research.js`, `bizar-implement.js`, and `bizar-debug.js`—invoke `agent(prompt, options)` without a selected model, requested tier, named agent role, routing decision ID, or model-selection context. Those calls therefore have no executable connection to Mike's documented per-dispatch model-selection decision and can inherit the active session model.

The model-routing implementation is split across incompatible components:

1. `config/claude/model-router.json` defines six tiers: `budget`, `mid`, `default`, `mid-design`, `high`, and `premium`.
2. `office-manager.md` asks Mike to classify each task and manually choose from `userSelected.models` and `tierHints`.
3. `packages/sdk/src/router/model-router.ts` independently learns among three different tiers: `flash`, `mid`, and `expensive`.
4. `packages/sdk/src/router/agent-model-registry.ts` resolves static tier candidates intersected with an optional availability list, but does not implement the documented user-selected/tier-hint choice.
5. The workflow runtime calls do not consume either router's decision.
6. `agent-model-guard.mjs` is advisory and returns `permissionDecision: "allow"`; despite strings saying “blocked,” it neither selects a better model nor blocks an invalid one.

Consequently, Bizar currently has model-selection policy, configuration, and isolated routing utilities, but no single authoritative execution path that guarantees the best configured model reaches every dispatched worker.

### What works

- The operator can maintain an explicit allow-pool in `userSelected.models`.
- `tierHints` can attach intended tiers to model IDs.
- Agent definitions are model-agnostic, which is necessary for task-specific selection.
- Role defaults and task-complexity guidance exist.
- The SDK can load the registry, resolve static candidates, fingerprint assignment snapshots, and fall back to session inheritance.
- The three-tier bandit persists learning state.
- Tests cover configuration parsing, static candidate intersection, snapshot integrity, picker persistence, and router algorithms.
- Avoiding blind alias/provider retry loops is a good reliability property.

These foundations should be retained, but unified.

### P0 — Native workflows bypass task-specific model selection

Every audited `agent(...)` call in the native workflow scripts omits `model` and `tier`. Mike launches the workflow, but does not make each nested dispatch itself. Therefore the statement “Mike selects the cheapest sufficient model before each dispatch” is not enforceable for the main execution path.

Team members have the same problem: team/workflow fan-out defines tasks and phases but does not carry a resolved model assignment into each member spawn.

**Required improvement**

Make model routing a mandatory runtime primitive, not a prompt convention. The workflow engine's `agent()` wrapper should perform:

```ts
const decision = await selectDispatchModel({
  task: prompt,
  role: options.role,
  phase: options.phase,
  risk: options.risk,
  capabilities: options.capabilities,
  budget: workflowBudget,
  runId,
});

return agent(prompt, {
  ...options,
  model: decision.modelId ?? undefined,
  routingDecisionId: decision.id,
});
```

Workflow authors should declare semantic requirements, not raw model IDs:

```js
agent(prompt, {
  role: 'research-analyst',
  phase: 'Research',
  capabilities: ['long-context', 'tool-use', 'technical-research'],
  risk: 'medium',
});
```

The central wrapper then selects and injects the model. Direct Agent calls and team-member spawns must use the same wrapper.

**Acceptance gate**

An E2E test with at least two configured models must prove that:

- a mechanical edit receives the best qualifying budget model;
- architectural/security work receives the strongest qualified model;
- UI work receives a design-capable model;
- every nested workflow and team dispatch contains the expected `model`;
- the decision is recorded before dispatch;
- no workflow silently inherits merely because its author omitted `model`.

### P0 — Two incompatible tier taxonomies exist

The adaptive `ModelRouter` emits `flash | mid | expensive`, while the canonical registry uses six tiers. There is no authoritative mapping from `flash` to `budget`, from `expensive` to `high` or `premium`, or from any three-tier output to `mid-design`. A recommendation such as `[TASK_MODEL_RECOMMENDATION] expensive` cannot deterministically select a model from the six-tier user configuration.

**Required improvement**

Delete the duplicate taxonomy or make it an internal abstraction with a tested, explicit mapping. Prefer one canonical type everywhere:

```ts
type ModelTier =
  | 'budget'
  | 'mid'
  | 'default'
  | 'mid-design'
  | 'high'
  | 'premium';
```

The configuration schema, CLI picker, SDK resolver, workflow runtime, telemetry, snapshots, tests, and documentation must import or generate this same definition.

If adaptive learning remains, it should rank concrete eligible models within the canonical capability/risk constraints, not invent a parallel tier vocabulary.

### P0 — The registry resolver does not implement the user-selected policy

`resolveTierModel()` chooses the first static `tiers[tier].models` entry found in `availableModelIds`. It does not use `userSelected.models` or model-to-tier `tierHints` to build the eligible pool. A user-selected model that is not also present in the repository's static tier lists can be accepted by the picker and advisory guard yet never be selected by the SDK resolver.

The fallback described in `office-manager.md` is also ambiguous. It says to choose the cheapest model when no exact tier matches, while its concrete example says an unconfigured tier should inherit the session. These yield different behavior.

**Required improvement**

Implement one pure selector with an explicit contract:

```ts
selectDispatchModel(input: {
  task: TaskFeatures;
  role?: AgentRole;
  phase?: WorkflowPhase;
  selectedModels: ModelProfile[];
  activeSessionModel?: string;
  budget: BudgetState;
  health: ProviderHealth;
  history: OutcomeHistory;
}): ModelDecision
```

Eligibility must start with `userSelected.models`. Static tier lists may provide defaults and capability metadata, but must never exclude an operator-selected model solely because its ID is absent from the shipped list.

Define fallback order precisely:

1. exact capability and minimum-quality match from the selected pool;
2. next stronger selected model when the exact tier is absent;
3. strongest healthy selected model when task risk is high;
4. cheapest healthy selected model when task risk is low;
5. active session inheritance only when the selected pool is empty or no selected model is dispatchable.

Never downgrade security, architecture, adversarial verification, or repeated-failure work merely because a cheaper exact tier is absent.

### P0 — “Best model” is not represented by the current data model

A single tier hint cannot express model strengths. Models differ in coding, planning, visual judgment, long context, tool use, latency, reliability, and price. The current suffix/family heuristic can misclassify unfamiliar or newly released models, and a hand-entered tier does not establish which model is best for a specific task.

**Required improvement**

Replace tier-only hints with validated model profiles:

```json
{
  "id": "provider/model",
  "enabled": true,
  "capabilities": {
    "coding": 0.92,
    "architecture": 0.88,
    "security": 0.83,
    "research": 0.80,
    "visual": 0.30,
    "longContext": true,
    "toolUse": 0.91
  },
  "limits": {
    "contextTokens": 200000,
    "maxOutputTokens": 32000
  },
  "economics": {
    "inputPerMillion": 0,
    "outputPerMillion": 0,
    "latencyClass": "medium"
  },
  "source": "operator|benchmark|provider",
  "confidence": 0.85
}
```

The “best” model should mean the highest expected probability of meeting the task's definition of done, subject to hard capability, health, context-window, and budget constraints. Cost should break ties or constrain selection; it should not dominate correctness for high-risk work.

A suitable initial score is:

```text
utility =
  predicted_success
  - lambda_cost * normalized_cost
  - lambda_latency * normalized_latency
  - lambda_failure * provider_failure_risk
```

Apply hard floors before scoring. For example, a security review may require `security >= 0.8`; a 150k-token repository task must require a sufficient context strategy; a visual task must require visual/design capability.

### P1 — Adaptive learning is not connected to actual model dispatch outcomes

The Thompson router records only a Boolean success per coarse tier. It does not learn per concrete model, task class, role, phase, provider, repository language, context size, cost, latency, or failure type. No audited workflow call records a model decision and later feeds its verified outcome back into this router.

The Q-learning component selects agents, not models. Its `recordOutcome(agent, success)` updates every state bucket for the selected agent rather than only the bucket associated with the completed task, contaminating unrelated task classes. Its cache key is only a 64-bucket hash, so distinct tasks collide and reuse decisions.

**Required improvement**

- Record outcome against the exact decision ID and concrete model.
- Update only the task/context state that produced the decision.
- Use verified result signals: tests, review severity, retry count, wall time, tokens, cost, and rollback—not assistant self-report.
- Maintain separate posteriors by model and meaningful task class.
- Use contextual-bandit exploration only for low/medium-risk tasks.
- Disable exploration for security-critical, irreversible, repeated-failure, and evaluator roles.
- Run new routing policies in shadow mode before they control dispatch.
- Decay stale model evidence after model/provider revisions.
- Quarantine a model automatically after repeated transport or correctness failures.

### P1 — Availability and health handling are incomplete

User-selected models bypass live discovery by design. That is acceptable for configuration, but it does not prove that a model is currently reachable. With `maxDispatchModelAttempts: 1` and no controlled failover, a transiently unavailable selected model can fail a worker even when another selected model is suitable.

Avoiding arbitrary alias cycling is correct; deterministic failover among explicitly selected models is different and should be supported.

**Required improvement**

- Probe/cache model health before workflow fan-out.
- Distinguish invalid model, authentication failure, rate limit, timeout, context overflow, provider outage, and model-quality failure.
- Permit one deterministic failover to the next ranked model in `userSelected.models` for transport/availability failures only.
- Never retry the same failed request through uncontrolled aliases.
- Preserve the original and fallback decisions in telemetry.
- Recalculate remaining workflow budget before fallback.
- Use circuit breakers to avoid dispatching ten parallel members to a known-unhealthy model.

### P1 — The advisory model guard contradicts its documentation

`agent-model-guard.mjs` returns `permissionDecision: "allow"` for out-of-pool or unavailable models while its messages say “blocked.” `office-manager.md` also says the guard “blocks any other model override.” It does not.

Full permissions should remain, but model-policy integrity should not depend on permission prompts or advisory text.

**Required improvement**

Enforce selection structurally in the dispatch wrapper:

- the wrapper accepts semantic requirements;
- only the wrapper emits the final model ID;
- raw workflow model overrides are ignored or normalized unless explicitly marked as an operator override;
- selection failures are recorded and inherit according to the canonical fallback contract;
- the hook remains advisory and accurately says so.

This preserves full permissions while making the normal orchestration path correct by construction.

### P1 — Assignment snapshots are not sufficient

`createRunAssignmentSnapshot()` can fingerprint role-to-model decisions, but current snapshots are agent-name keyed. Multiple members with the same role but different tasks collapse into one entry, and snapshots do not include the task features, workflow phase, selected-pool digest, capability profile, budget state, health state, or scoring breakdown.

**Required improvement**

Record one immutable `ModelDecision` per dispatch:

- decision ID, run ID, workflow ID, task ID, parent agent, role, and phase;
- normalized task-feature vector and risk classification;
- candidate pool and reasons for exclusions;
- selected model and fallback ranking;
- profile/config/version digests;
- expected quality, cost, latency, and utility;
- actual provider/model returned;
- token, cost, latency, retry, and outcome evidence;
- whether selection came from policy, learning, operator override, or session inheritance.

This record should feed both the global evidence bundle and the learning system.

### P1 — Tests prove components, not the required behavior

The existing tests demonstrate registry parsing, model-list handling, static tier resolution, bandit behavior, and workflow phase/fan-out structure. The workflow test stub records only `label` and `phase`; it does not assert `role`, `tier`, `model`, or routing decision IDs. There is no E2E proof that Mike or a native workflow sends the selected model to a real subagent or team member.

**Required improvement**

Add a model-selection test matrix covering:

| Scenario | Expected result |
| --- | --- |
| Empty selected pool | Inherit active session model and record reason. |
| One selected model | Use it for all compatible dispatches. |
| Budget + premium models | Mechanical task uses budget; architecture uses premium. |
| UI-capable + coding-capable models | UI lane uses visual model; backend lane uses coding model. |
| Exact tier absent | Deterministic stronger/safer fallback, not arbitrary inheritance. |
| Model unhealthy | One ranked failover within selected pool. |
| Context too large | Exclude insufficient model before dispatch. |
| Repeated task failure | Escalate quality tier on the next bounded attempt. |
| Parallel workflow | Every member gets an independent decision. |
| Agent team | Every teammate spawn carries its selected model. |
| Invalid raw override | Wrapper normalizes it and records the event. |
| Router restart | Learned state and decision provenance survive. |
| High-risk task | Exploration disabled. |
| Candidate model regression | Model is quarantined and prior policy restored. |

The E2E harness must capture the actual Agent tool payload or provider request and assert the resolved model ID—not merely inspect a recommendation tag.

### Recommended unified selection flow

```text
User-selected model pool
        |
Model profiles + live health + prices
        |
Task feature extraction
(role, phase, risk, capabilities, context, budget)
        |
Hard eligibility filters
        |
Outcome-informed ranking
        |
Per-dispatch ModelDecision
        |
Agent / workflow / team spawn with model ID
        |
Verified outcome + cost + latency
        |
Router learning, health update, and audit evidence
```

### Model-selection implementation roadmap

#### MS Phase 0 — Repair the execution path

1. Introduce the central `selectDispatchModel()` API.
2. Use the six-tier canonical vocabulary everywhere.
3. Make the workflow `agent()` wrapper and team spawn wrapper call it automatically.
4. Add role, phase, capability, and risk metadata to every workflow dispatch.
5. Record a per-dispatch `ModelDecision`.
6. Add E2E payload assertions.

**Exit criterion:** every direct, workflow, and team dispatch is proven to carry the expected model.

#### MS Phase 1 — Model profiles and deterministic ranking

1. Extend the picker to collect or infer model profiles.
2. Validate context, tool-use, modality, and provider constraints.
3. Implement quality-first multi-objective ranking.
4. Define exact stronger/safer and session-inheritance fallbacks.
5. Add health-aware deterministic failover.
6. Expose `bizar models explain <task>`.

**Exit criterion:** the same inputs yield an explainable, deterministic ranked candidate list.

#### MS Phase 2 — Outcome-driven adaptation

1. Link verified outcomes to exact model decisions.
2. Learn per concrete model and task class.
3. Add confidence intervals and minimum sample counts.
4. Shadow-test learned ranking changes.
5. Canary routing-policy changes.
6. Automatically quarantine regressions and restore the known-good policy.

**Exit criterion:** historical verified outcomes measurably improve model choice without increasing failure or cost beyond configured limits.

### Additional backlog

| ID | Priority | Deliverable | Acceptance test |
| --- | --- | --- | --- |
| IMP-013 | P0 | Central dispatch-model selector | All dispatch surfaces import one selector. |
| IMP-014 | P0 | Workflow/team routing integration | Captured nested Agent payloads contain expected models. |
| IMP-015 | P0 | Canonical tier taxonomy | No `flash/mid/expensive` vs six-tier mismatch remains. |
| IMP-016 | P0 | User-selected-aware resolver | Arbitrary selected IDs with valid profiles are selectable. |
| IMP-017 | P1 | Model capability profiles | Eligibility filters reject incapable/context-limited models. |
| IMP-018 | P1 | Per-dispatch model evidence | Decision and verified outcome are linked by immutable ID. |
| IMP-019 | P1 | Health-aware selected-pool failover | Provider outage causes one deterministic ranked failover. |
| IMP-020 | P1 | Contextual outcome learner | Updates affect only the relevant model/task state. |
| IMP-021 | P1 | Routing shadow/canary mode | Harmful learned policy cannot become global immediately. |
| IMP-022 | P1 | Model-selection E2E matrix | Direct, workflow, and team selection cases pass. |

### Model-selection success metrics

- 100% of subagent and team-member dispatches have a recorded model decision.
- 100% of non-inherited dispatches use a model from the operator-selected pool.
- 100% agreement between recorded decision and actual provider model.
- Zero silent fallback or provider substitution.
- Zero high-risk dispatches using exploration.
- At least 95% correct task-to-model classification on the frozen routing corpus.
- A measurable quality-per-cost improvement over always inheriting the session model.
- No statistically significant quality regression versus always using the strongest selected model.
- Deterministic replay for identical config, health snapshot, budget, task features, and router-policy version.

### Final model-selection assessment

The architecture has most of the pieces needed for intelligent selection, but the pieces currently operate beside one another. The immediate requirement is to connect model choice to the actual workflow and team dispatch payload. Until that E2E path exists, model recommendations and tier-learning results are advisory metadata rather than reliable orchestration behavior.

The intended end state is not a fixed model per agent. It is one centralized, outcome-informed selector that chooses the best eligible operator-selected model for each concrete subtask, automatically applies that choice to every dispatch surface, learns from independently verified outcomes, and can explain every decision.
