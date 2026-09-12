# DEC-024: Agent Orchestrator is Bizar's primary multi-agent runtime

**Status:** Accepted
**Date:** 2026-09-12

## Decision

Agent Orchestrator (AO) is the primary Bizar orchestration runtime. AO owns
project registration, worker and orchestrator sessions, worktrees, branches,
PRs, CI/review feedback, previews, and browser state. Bizar is configured as
the Codex worker harness through AO's supported project configuration and CLI.

`bizar ao setup` preserves the existing AO project config before setting Codex
role overrides and a repo-relative AO worker-rules file. It does not access AO
storage directly or install AO from npm.

When `AO_SESSION_ID` or `AO_PROJECT_ID` is present, Bizar does not start its
own team, workflow fan-out, worktree manager, task lifecycle, or PR coordinator.
Workers perform their assigned task and report blockers through AO.

## OpenKan boundary

DEC-023 remains valid only for explicit standalone Bizar mode. OpenKan retains
its `bizar openkan` and `ok` interfaces, but it is not the default durable
planner inside an AO worker. AO's task/session/PR lifecycle is authoritative
there; OpenKan writes require an explicit, serialized AO task.

## Consequences

- AO users gain Codex-native Bizar worker rules without Bizar duplicating AO
  internals or overwriting Codex hook configuration.
- Existing standalone Claude Code and OpenKan users retain their current path.
- Bizar documents AO's native spawn, messaging, PR claim, preview, browser,
  and Codex/Claude session-switching capabilities instead of reimplementing
  them.
