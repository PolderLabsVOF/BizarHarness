---
name: harness-engineering
description: Use when designing or evaluating an AI coding harness: instructions, state, verification, scope, lifecycle, autonomy, and human approval boundaries.
---

# Harness Engineering

The model decides the code; the harness constrains how work starts, continues,
is verified, and stops.

## Bizar's five subsystems

| Subsystem | Canonical surfaces |
| --- | --- |
| Instructions | `AGENTS.md`, `.claude/agents/_shared/AGENT_BASELINE.md`, `.claude/agents/_shared/CLAUDE_TOOLS.md` |
| State | `PROGRESS.md`, `feature_list.json`, `DECISIONS.md`, bounded `.bizar/` operational records |
| Verification | `make check`, `make test`, `make e2e`, `make clean-check` |
| Scope | WIP=1, explicit exclusions, approval boundaries, stop conditions |
| Lifecycle | `make session-start`, progress/evidence updates, `make session-end` |

## Session lifecycle

1. Read the repository instructions and `PROGRESS.md`.
2. Inspect `feature_list.json`; keep exactly one active feature.
3. Define the target, exclusions, evidence, and stop condition.
4. Execute reversible local work without unnecessary handoffs.
5. Ask before destructive, credential, production, publish, deploy, merge,
   push, release, or irreversible actions.
6. Run targeted tests, then the required project gates in dependency order.
7. Update documentation, progress, feature evidence, and eval records.
8. Let the configured commit workflow perform its simplify and approval gates.

## Definition of done

- **L1:** `make check`
- **L2:** `make test`
- **L3:** `make e2e` for cross-surface changes
- **Exit:** `make clean-check`

Confidence is not evidence. Do not advance to a dependent layer while its
prerequisite is failing.

## Context and observability

Load skills and files progressively. Preserve exact errors, decisions,
approvals, and remaining work before compaction. Session traces and local hook
telemetry are operational evidence, not a general note store or remote exporter.

## Repetition

When a manual sequence repeats, prefer a small deterministic loop with an
explicit validator and bounded retries. Never introduce a persistent Claude
daemon or hidden autonomous service.
