# BizarHarness Autonomy and Self-Improvement Audit

**Audit date:** 2026-08-27  
**Audited revision:** `bc3dffceb3f6c44c9b08ce72dfbdaa4da7dc4708` (`master`)  
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
