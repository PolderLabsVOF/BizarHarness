# Agent harness comparison and Bizar roadmap

Date: 2026-07-30

## Executive conclusion

Bizar already has strong safety hooks, specialized agents, guarded autonomy,
and repository-native workflow records. Its highest-value gap is safe
concurrent execution: editing agents can still share a checkout, feature claims
do not form a general dependency graph, and completed parallel work has no
serialized integration queue.

The recommended order is:

1. worktree-first isolation and path ownership;
2. a durable task DAG with leases and recovery;
3. a serialized integration queue;
4. trajectory replay and behavioral evaluation;
5. optional remote transport only when collaboration must cross processes or
   hosts.

WebSocket communication is deliberately not the first step. Claude Code already
provides worktrees, Agent teams, task coordination, and direct messages for
same-host agents. A custom transport would add distributed-systems failure
modes before Bizar has established the task and ownership model that such a
transport would need.

## Current strengths

- Deterministic lifecycle and safety hooks.
- Specialized role agents with explicit approval boundaries.
- A phase-oriented office-manager workflow.
- Atomic feature claim transitions.
- SQLite-backed cost reservations and concurrency controls.
- A local, service-free runtime with a bounded nine-tool MCP surface.
- Existing federation policy, signing, PII, trust, and budget primitives that
  can support a future optional remote adapter.

These choices align with Anthropic's guidance on incremental long-running agent
work and OpenAI's emphasis on repository-native instructions, mechanical
invariants, and per-worktree development environments.

## Comparative findings

### OpenAI Codex and Symphony

[OpenAI's harness engineering write-up](https://openai.com/index/harness-engineering/)
uses per-worktree bootable application instances, repository documentation as
the system of record, mechanical architecture rules, and agent-queryable
observability.

[OpenAI Symphony](https://openai.com/index/open-source-codex-orchestration-symphony/)
treats tasks as the control plane. Only dependency-unblocked tasks start, each
task receives an isolated workspace, and stalled workers can be restarted.
Symphony also watches verification, rebases work, resolves conflicts, and
retries bounded failures.

Transferable lesson: workspace containment and task readiness must be hard
runtime invariants rather than prompt conventions.

### Claude Code

[Claude Code worktrees](https://code.claude.com/docs/en/worktrees) isolate file
edits while keeping shared Git history. Custom subagents can declare
`isolation: worktree`, and `worktree.baseRef: head` lets isolated agents inherit
the leader's current local state.

[Claude Code agent teams](https://code.claude.com/docs/en/agent-teams) already
provide shared tasks, dependencies, mailboxes, direct messages, and automatic
dependency unblocking. Teams do not by themselves prevent filesystem
collisions, so worktree isolation and explicit ownership remain necessary.

Transferable lesson: use native coordination for same-host collaboration and
add Bizar enforcement around workspace and path ownership.

### OpenHands

[OpenHands runtimes](https://docs.openhands.dev/openhands/usage/architecture/runtime)
use sandboxed workspaces for consistency, reproducibility, resource control,
and isolation.

[The OpenHands agent server](https://docs.openhands.dev/sdk/arch/agent-server)
adds authenticated workspace and conversation APIs plus a reconnectable
WebSocket event stream.

Transferable lesson: WebSocket is useful as an optional remote event transport,
not as the durable task database or the first mechanism used to stop local edit
collisions.

### Gas Town

[Gas Town](https://github.com/gastownhall/gastown) combines persistent agent
identity, Git worktrees, a Git-backed task ledger, watchdogs, checkpoint
recovery, capacity controls, and per-project integration queues.

Transferable lesson: supervisors and merge queues should operate on durable
task/workspace records and route failures back to the original owner.

### Gemini CLI and SWE-agent

[Gemini CLI checkpointing](https://geminicli.com/docs/cli/checkpointing/) saves
project state before model-driven modifications, enabling transactional
rollback.

[SWE-agent](https://swe-agent.com/latest/usage/cli/) records trajectories that
can be replayed and inspected with its
[trajectory inspector](https://swe-agent.com/latest/usage/inspector/).

Transferable lesson: after collision-free execution, Bizar should add mutation
checkpoints and an append-only task/tool/test event journal.

### Evaluation and interoperability

[Anthropic's agent evaluation guidance](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
recommends evaluating full trajectories and tool use, not only final outputs.
Bizar's current audit and eval gates should evolve from presence/evidence
checks into checked-in behavioral scenarios.

For future cross-runtime interoperability, the
[A2A specification](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)
provides task, message, context, state, and artifact semantics. A future remote
adapter should reuse those concepts rather than invent a proprietary task
lifecycle.

## Prioritized roadmap

### P0: collision-free parallel execution

#### 1. Worktree-first editing

- Add `isolation: worktree` to code-writing subagents.
- Preserve one non-isolated integration owner for shared Git operations.
- Branch isolated agents from the current `HEAD`.
- Bootstrap dependencies without copying mutable task state.
- Reject writes that overlap another live task's path scope.

#### 2. Durable task DAG

Store task identity, dependencies, state, owner, workspace, path scopes, lease
expiration, retry count, artifacts, evidence, and integration status in a
cross-worktree SQLite database. Claims and dependency checks must be one atomic
transaction. Stale leases must return work to the ready pool.

#### 3. Serialized integration queue

Completed task commits enter a durable FIFO queue. Exactly one integrator may
hold an active queue item. Success marks the task integrated; failure returns
the task to a blocked owner-visible state with evidence. Actual Git merge,
rebase, push, and publication remain behind the existing approval policy.

### P1: observable and recoverable execution

- Append-only task, agent, tool, test, and integration event journal.
- Correlation IDs and a trajectory inspection/replay CLI.
- Checked-in behavioral evaluations for safety, containment, leases,
  dependencies, and integration ordering.
- Transactional snapshots before material mutations.
- Optional OpenTelemetry export without requiring a dashboard.

### P2: optional remote collaboration

Only after the task ledger is stable:

- add an authenticated, reconnectable transport adapter;
- use sequence numbers, replay protection, idempotency keys, and backpressure;
- carry task/artifact references rather than repository contents;
- reuse Bizar federation signing, trust, PII, and budget controls;
- keep the adapter optional so the core remains service-free.

## F-118 acceptance criteria

1. Every ordinary code-writing subagent is worktree-isolated.
2. Two agents can atomically claim independent scopes.
3. Overlapping live scopes cannot be claimed.
4. Tasks with unfinished dependencies cannot start.
5. Expired leases are recoverable without manual database edits.
6. Edit hooks deny out-of-scope and cross-workspace writes.
7. Only one integration item can be active at a time.
8. Integration failure returns the task to its owner with structured evidence.
9. No automatic Git publication or persistent network service is introduced.
