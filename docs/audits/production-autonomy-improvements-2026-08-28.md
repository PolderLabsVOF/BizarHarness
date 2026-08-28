# Production Autonomy and Long-Horizon Improvements

**Audit date:** 2026-08-28  
**Audited repository:** `DrB0rk/BizarHarness`  
**Audited revision:** `bd9492eeae3172fb08433772710bd27df8dd0c8a` (`master`)  
**Scope:** static review of repository structure, primary documentation, configuration, task/workflow/control surfaces, tests, release metadata, and the existing autonomy audit. The test suite was not executed in this GitHub-connected review.

## Executive assessment

BizarHarness has stronger foundations than most agent harnesses: worktree isolation, shared SQLite task coordination, leases and path scopes, explicit integration ownership, lifecycle hooks, workflow recovery, model routing, cost gates, evidence records, and a broad test inventory.

The remaining gap is architectural rather than prompt-level. BizarHarness can coordinate autonomous work, but it does not yet expose one durable, authoritative objective controller that can own a goal for hours or days, survive interruption, prove progress from external evidence, adapt without thrashing, and terminate safely. Several useful subsystems exist, but their state and guarantees remain fragmented across Markdown, JSON/JSONL, SQLite, Git, hook output, and session context.

The highest-value change is therefore to make **the durable objective—not the chat session—the unit of execution**.

## Target operating model

A production long-horizon run should follow this lifecycle:

```text
admit objective
  -> compile acceptance contract
  -> create durable task graph
  -> reserve budgets and capabilities
  -> dispatch isolated workers
  -> collect controller-owned evidence
  -> integrate in dependency order
  -> verify objective-level acceptance
  -> deliver or enter a typed blocked state
```

The controller must be able to resume every transition after process loss. Agents may propose decisions and perform work, but durable state transitions, budgets, evidence, and completion are controller-owned.

## Findings and recommendations

### P0 — Introduce a canonical durable ObjectiveRun

Current workflow, task, control, feature, progress, and evidence records cover overlapping parts of execution. Long-horizon reliability requires one root aggregate with a stable ID and explicit state machine.

Add a versioned `ObjectiveRun` schema containing:

- objective text and normalized intent;
- immutable acceptance contract and scope boundaries;
- repository, baseline revision, configuration digest, and runtime versions;
- task DAG and critical path;
- current phase, attempt, owner, lease, and last heartbeat;
- consumed and remaining token, cost, time, tool, and fan-out budgets;
- assumptions, decisions, risks, blockers, and unresolved questions;
- evidence/artifact references;
- terminal status and machine-readable reason.

Use append-only events plus a materialized view. Every mutation needs an idempotency key and monotonic revision. SQLite can remain the local store, but migrations, integrity checks, backups, and crash recovery must be first-class.

**Acceptance criteria**

- Kill the controller during every state transition and resume without duplicated work or lost ownership.
- Replay events to reconstruct the same materialized state.
- Reject stale writes and duplicate hook deliveries.
- Export a complete run without reading chat transcripts.

### P0 — Compile user intent into an executable acceptance contract

The harness should not let a long-running agent decide at the end what “done” means. At admission time, compile the objective into a reviewed, versioned contract:

- deliverables and exact paths or external targets;
- functional and non-functional requirements;
- required checks and evidence;
- explicit non-goals;
- constraints and allowed assumptions;
- risk class and permitted side effects;
- escalation conditions;
- completion, partial-success, blocked, and abort semantics.

Agents may refine the plan, but weakening acceptance criteria must require a new contract revision with a recorded reason. The verifier evaluates the contract, not the worker’s narrative.

A concrete defect illustrates the need: `scripts/sprint.mjs` pre-checks every standard Definition of Done checkbox while merely generating the sprint contract. Planning artifacts must never mark verification complete before evidence exists.

**Acceptance criteria**

- A newly generated contract begins with all evidence-dependent checks incomplete.
- Completion is impossible while any mandatory criterion lacks a valid evidence reference.
- Contract changes produce an auditable diff and invalidate affected evidence.

### P0 — Make execution policies internally consistent and enforceable

The repository describes both deterministic guarded autonomy and advisory full-permission hooks. `README.md`, `docs/architecture.md`, existing audits, and policy notes do not present one unambiguous trust model. This is operationally dangerous.

Create one authoritative `AUTONOMY_CONTRACT.md` and a machine-readable policy file. Define:

- what workers may do autonomously;
- which side effects require operator approval;
- the containment boundary for full-permission workers;
- task-scoped filesystem, network, secret, and process capabilities;
- budget and fan-out ceilings;
- promotion and rollback authority;
- fail-open versus fail-closed behavior for every hook/controller failure.

Full autonomy should mean full freedom **inside a bounded execution envelope**, not ambient host authority. Use disposable worktrees by default and containers or microVMs for untrusted repositories, self-modification, and high-risk tools.

**Acceptance criteria**

- Documentation/config drift is caught in CI.
- A worker cannot alter controller state, frozen evaluators, sibling worktrees, or unrelated credentials.
- Policy-engine failure has a documented and tested default behavior.

### P0 — Replace session-driven continuation with scheduler-driven continuation

Hooks and handoffs help sessions, but long-horizon operation needs a scheduler that owns runnable work independently of any model context.

Implement:

- durable ready/delayed/blocked queues;
- lease acquisition with fencing tokens;
- heartbeat, timeout, cancellation, and orphan reaping;
- exponential backoff with jitter;
- typed retryability and maximum attempts;
- dependency-aware dispatch and critical-path priority;
- global and per-objective concurrency limits;
- fair scheduling across objectives;
- process-tree cleanup and resumable workers.

A stale worker must be unable to commit results after its lease is reassigned. Fencing tokens must be checked at every state-changing boundary, including evidence submission and integration.

**Acceptance criteria**

- Two controllers cannot execute the same task concurrently.
- An expired worker’s late result is quarantined, not accepted.
- Restarting the scheduler resumes queued work without manual session repair.

### P0 — Make evidence independent, immutable, and objective-level

Markdown claims are useful summaries, not production proof. Introduce controller-produced `EvidenceBundle` records with:

- command, working directory, sanitized environment digest, and timestamps;
- exit code plus hashed stdout/stderr artifacts;
- test counts and structured test reports;
- baseline revision, resulting revision, patch and lockfile digests;
- evaluator/version/rubric digests;
- resource consumption;
- provenance and signature/HMAC from the controller.

Evidence needs freshness rules and dependency invalidation. If integration changes a shared dependency, previously passing downstream evidence may become stale. Final acceptance must run against the integrated objective revision, not isolated worker branches.

**Acceptance criteria**

- A worker cannot self-certify completion.
- Changing code, configuration, dependencies, evaluator, or acceptance criteria invalidates affected evidence.
- Final delivery points to one reproducible evidence manifest.

### P1 — Add bounded replanning and anti-thrashing controls

Long tasks need adaptation, but unrestricted replanning wastes budget and destabilizes scope. Add a replan policy triggered only by typed events such as failed assumptions, dependency changes, repeated verifier failures, budget forecast breach, or newly discovered critical risk.

Each replan should record:

- trigger and evidence;
- old/new DAG diff;
- discarded work and sunk cost;
- changed critical path;
- updated budget forecast;
- invariants preserved;
- replan count and cooldown.

Use maximum replan depth, duplicate-work detection, and semantic task fingerprints to stop loops. After repeated equivalent failures, escalate to a stronger model, alternative strategy, or a typed blocked outcome—not another identical attempt.

### P1 — Introduce hierarchical budgets and admission control

Existing cost controls should evolve into reservations and hard ceilings at objective, phase, task, agent, model, tool, and retry levels.

Track and enforce:

- wall-clock and compute;
- tokens and monetary cost;
- tool calls and external requests;
- concurrent workers and worktrees;
- disk/artifact usage;
- retry and replan allowance;
- exploration versus delivery budget.

Before dispatch, estimate whether the task can finish within remaining budget. Use quality-adjusted cost and expected utility for escalation. Reject or defer objectives when capacity is unavailable instead of overcommitting.

### P1 — Separate worker, verifier, integrator, and policy authority

The current role system is useful, but production trust must be based on capability separation rather than names in prompts.

Define distinct principals:

- **controller** owns durable state and policy;
- **planner** proposes the DAG;
- **worker** edits only its task scope;
- **verifier** runs frozen checks without modifying candidate code;
- **integrator** serializes accepted changes;
- **delivery agent** performs approved external side effects;
- **watchdog** detects stalls, policy violations, and regressions.

Give each principal separate writable scopes and credentials. A worker must not modify its own verifier, benchmarks, evidence, or promotion policy in the same run.

### P1 — Build objective-level observability and operational SLOs

Add a unified trace model across controller, CLI, hooks, SDK, MCP, tasks, models, tools, tests, Git, and integration. Use stable correlation IDs and OpenTelemetry-compatible export.

Minimum metrics:

- objective success, partial-success, blocked, and abort rates;
- time to first useful work and time to verified completion;
- queue delay and critical-path duration;
- retry, replan, stale-lease, and orphan rates;
- cost and tokens per successful objective;
- verifier disagreement and flaky-check rates;
- unnecessary diff and revert rates;
- operator interruption and correction rates;
- p50/p95/p99 durations.

Define SLOs and alert conditions for stuck objectives, runaway cost, queue starvation, repeated recovery, database corruption, and delivery failures. Add `bizar status`, `bizar explain-run`, and `bizar doctor --run <id>` views grounded only in durable data.

### P1 — Test failure recovery with deterministic fault injection

The test inventory is broad, but long-horizon guarantees require systematic crash and corruption tests. Cover:

- controller death before and after commit;
- worker death mid-write;
- SQLite lock, corruption, and migration failure;
- disk full and artifact write failure;
- provider timeout, rate limit, malformed response, and cancellation;
- duplicate/out-of-order hook events;
- network partition and credential expiry;
- stale baseline and merge conflict;
- evaluator crash after tests finish;
- cleanup failure and leaked subprocess;
- clock skew affecting leases;
- delivery success with lost acknowledgement.

Every scenario must prove either idempotent continuation or clean rollback. Run a subset on every PR and a full chaos matrix on a schedule.

### P1 — Harden repository governance and release engineering

The observed repository settings allow merge commits, do not enable auto-merge, and do not advertise automatic branch updating. The existing audit also reports an unprotected default branch. For a production autonomous harness:

- protect `master`;
- require canonical CI, architecture, security, package, and autonomy-contract checks;
- require signed/provenanced release artifacts;
- pin GitHub Actions by commit SHA;
- generate SBOM and dependency/license reports;
- add secret scanning and dependency review;
- define supported Node/Bun/Claude Code/OS versions;
- test clean install, upgrade, downgrade, and rollback;
- publish checksums and maintain a signed known-good release pointer;
- prevent a candidate from weakening its own required checks.

Automation may merge low-risk changes after all machine gates pass; releases and other external mutations should follow the explicit autonomy contract.

### P2 — Reduce specification sprawl and generated-document risk

The repository contains large and partly overlapping `AGENTS.md`, `CLAUDE.md`, `PROGRESS.md`, `DECISIONS.md`, feature records, architecture documents, and audits. This increases context cost and drift risk.

Recommended cleanup:

- define a single canonical source for mirrored agent instructions and verify byte equality;
- move historical progress to append-only releases or generated reports;
- keep operational truth in typed stores and generate Markdown summaries;
- version every schema and document which file is authoritative;
- add ownership and review cadence to each policy document;
- keep prompts concise and load role-specific instructions on demand.

### P2 — Make efficiency measurable before adding more agents

More roles and parallelism do not guarantee faster completion. Add controlled benchmarks comparing:

- single-agent versus multi-agent execution;
- sequential versus parallel DAGs;
- model tiers and escalation policies;
- worktree overhead versus saved conflict time;
- research depth versus task success;
- reviewer count versus defect escape rate.

Optimize for verified outcomes per euro and per wall-clock minute. Automatically reduce fan-out when coordination overhead exceeds expected benefit.

## Recommended implementation sequence

### Milestone 1: One source of truth

1. Add `AUTONOMY_CONTRACT.md` and machine-readable policy.
2. Define `ObjectiveRun`, event, task, evidence, budget, and artifact schemas.
3. Stop pre-completing Definition of Done in sprint generation.
4. Add schema migrations, integrity checking, backup, and replay tests.
5. Protect the default branch and freeze required checks.

**Exit:** a run can be reconstructed deterministically and cannot complete without controller-owned evidence.

### Milestone 2: Resumable controller

1. Implement durable queues, leases with fencing, and orphan recovery.
2. Connect workflow/task/control state beneath the ObjectiveRun aggregate.
3. Add bounded retries, replans, cancellation, and hierarchical budgets.
4. Add status, explain, pause, resume, cancel, and export commands.

**Exit:** a multi-hour fixture survives repeated controller and worker termination without duplicate integration.

### Milestone 3: Independent verification

1. Implement immutable evidence bundles and freshness invalidation.
2. Separate worker/verifier/integrator capabilities.
3. Verify the fully integrated objective revision.
4. Add representative long-horizon and adversarial benchmark tasks.

**Exit:** workers cannot self-certify and stale isolated-branch evidence cannot complete an objective.

### Milestone 4: Production operations

1. Add unified traces, metrics, SLOs, and redaction.
2. Add chaos testing and resource-leak checks.
3. Harden release provenance, compatibility testing, and rollback.
4. Benchmark routing and parallelism efficiency.

**Exit:** unattended runs meet documented reliability, cost, recovery, and safety targets over a sustained canary period.

## Suggested production readiness gates

| Area | Gate |
| --- | --- |
| Durability | 1,000 randomized crash/replay cycles with zero lost or duplicated terminal transitions |
| Idempotency | Duplicate and out-of-order events do not change final state |
| Recovery | p95 automatic recovery under five minutes for worker/controller loss |
| Correctness | 100% mandatory acceptance criteria backed by fresh evidence |
| Isolation | Adversarial worker cannot escape declared workspace/capabilities |
| Efficiency | No regression in success-per-euro or p95 completion time versus baseline |
| Stability | Bounded retries/replans; no infinite fan-out or unbounded queues |
| Observability | Every state transition is traceable to actor, policy, inputs, and evidence |
| Release | Reproducible artifact, SBOM, provenance, compatibility matrix, rollback test |
| Operations | Seven-day canary with no unresolved P0/P1 autonomy incidents |

## What to preserve

Do not discard the current strengths while consolidating them:

- Git worktree isolation for editing agents;
- SQLite coordination shared through Git common state;
- dependency-aware task ownership and expiring leases;
- serialized integration and archive references;
- model selection constrained to explicit user choices;
- current architecture, package-boundary, and drift tests;
- the CLI-first, service-optional design;
- explicit human control over publication and irreversible external actions unless policy deliberately changes.

The correct next step is not a larger prompt library. It is a small, durable controller that turns the existing components into a coherent, replayable, measurable operating system for autonomous engineering.
