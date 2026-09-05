---
name: bizar
description: Operate the Bizar Claude Code harness: route work, enforce autonomy and human approval boundaries, coordinate agents, and verify delivery.
---

# Bizar Harness

Bizar is a Claude Code-native autonomous engineering harness. Its control surfaces are repository files, Claude Code agents/skills/hooks, the Bizar MCP server, and the `bizar` CLI. It intentionally has no browser control plane and no persistent knowledge vault.

## Operating contract

1. Read the repository instructions and inspect `.ok/` with `bizar task list` and `bizar goals list` before non-trivial work.
2. Define the target result, success criteria, constraints, available evidence, and stop condition.
3. Work directly when one agent can complete and verify safely.
4. Use bounded subagents only when scopes are independent and coordination improves speed or correctness.
5. Claim a scoped OpenKan task before implementation; use OpenKan plans and PRDs for durable progression and goals.
6. Prefer project files and Semble for repository facts; use official documentation for external APIs.
7. Update OpenKan task status and verification evidence at durable handoffs; legacy `PROGRESS.md` and `feature_list.json` are not live planning state.
8. Run the smallest proving test first, then the repository's required full gates.

## Autonomy boundary

Proceed automatically for reversible local inspection, edits, tests, builds, formatting, and state updates already implied by the task.

Human approval is required before:

- publishing packages, releases, pull requests, or deployments;
- pushing commits or changing remote branches;
- destructive deletion not explicitly requested;
- changing credentials, billing, production data, or access controls;
- bypassing a safety hook or lowering a required quality gate.

When approval is required, present the exact command/action, scope, evidence, and rollback. Do not bundle unrelated approvals.

## Core surfaces

- `bizar audit`, `bizar doctor`, `bizar validate` — installation and configuration evidence.
- `bizar test-gate` — detect and run project tests.
- `bizar cost` — reserve/commit/release budget.
- `bizar openkan`, `bizar task`, `bizar plan`, `bizar goals`, `bizar claim` — default OpenKan planning, progression, goal, and scoped-ownership surfaces.
- `bizar team` / `bizar subagent` — Claude Code-native coordination wrappers.
- MCP tools — plans, loops, graph queries, bounded learning evidence, and decisions.
- `bizar learn` — explicit global preferences and project debugging lessons.
- `config/claude/hooks/` — guardrails, routing, lifecycle context, and bounded telemetry.

## Completion

Do not claim completion until the requested behavior works, required tests pass, documentation/state match the implementation, and remaining risks are explicit. Report changed files, validation evidence, and any intentionally excluded scope.
