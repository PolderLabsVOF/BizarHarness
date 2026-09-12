# DEC-023: OpenKan is Bizar's standalone planning and goals runtime

**Status:** Accepted for standalone Bizar; superseded in AO sessions by DEC-024
**Date:** 2026-09-04

## Context

Bizar previously split live progression across a feature ledger, `PROGRESS.md`, a SQLite task ledger, and goal-bootstrap artifacts. That duplicated the durable planning capabilities already provided by OpenKan and made browser-facing state harder to trust.

## Decision

1. Outside Agent Orchestrator sessions, OpenKan `.ok/` is the sole durable source for Bizar tasks, scoped ownership, plans, PRD goals, progression, and verification evidence.
2. `bizar install` and `bizar update` ensure a working OpenKan runtime; `bizar openkan`, `ok task`, `ok plan`, `ok prd`, and `ok task claim` are Bizar convenience surfaces over the canonical OpenKan CLI.
3. Bizar retains Claude Code orchestration, hooks, agent metadata, bounded session handoff, and control messages. It never imports or forks OpenKan storage.
4. Session hooks, control snapshots, workflow cleanup, and the progress guard read `.ok/`. The legacy feature list, `PROGRESS.md`, and Bizar SQLite task ledger are historical compatibility artifacts, not live state.
5. The OpenKan runtime probe is required after installation so a partial OpenKan install fails visibly rather than creating a second Bizar state store.
6. The OpenKan installer (`bizar openkan install`, also run as part of `bizar install`) installs the published `@polderlabs/openkan@latest` package with npm into Bizar's managed OpenKan home. Npm lifecycle scripts stay disabled; Bizar explicitly runs the package-owned agent/skill installer after verifying the package layout. No remote shell script executes on the operator's machine.

## Consequences

- Standalone Bizar projects start with `ok init` and claim OpenKan tasks before implementation. Agent Orchestrator workers keep AO session/task/PR state authoritative and use OpenKan only when it is explicitly selected and serialized.
- Existing historical files remain readable for audit history but must not be updated for new work.
- OpenKan can evolve independently because Bizar crosses the boundary with supported CLI calls and read-only `.ok/` adapters.
- The managed npm home is resolved automatically by Bizar, so its `ok` and dashboard launchers work without adding another directory to `PATH`. A custom home selected in the interactive installer is persisted under Bizar's global configuration.
- The existing OpenKan UI/control-plane decision remains valid for presentation; this decision supersedes its Bizar-side task ownership wording.
