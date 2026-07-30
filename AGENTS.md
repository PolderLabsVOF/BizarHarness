# AGENTS.md — Bizar Harness

Bizar Harness is a Claude Code-native, guarded-autonomy harness. It ships project and user-level agents, skills, slash commands, hooks, an MCP server, CLI utilities, and verification scripts. It has no web control plane and no Bizar note-vault subsystem.

If you are an agent: read this file, read `PROGRESS.md`, inspect `feature_list.json`, then run `make check` before changing code.

## Commands

```sh
make setup                    # install Claude Code and project dependencies
make check                    # TypeScript gate
make test                     # retained SDK, CLI, hook, and harness tests
make e2e                      # real SDK/MCP/Claude Code integration smoke test
make check-arch               # architectural and removed-surface checks
make verify-removed-surfaces  # prove deleted subsystems are absent
make clean-check              # debug-artifact/static hygiene gate
make vcr                      # feature-ledger reality ratio
make session-start            # lifecycle compatibility target
make session-end              # lifecycle compatibility target
```

## Hard constraints

- **MUST** update `PROGRESS.md` before and after each logical code change.
- **MUST** keep WIP=1 in `feature_list.json`.
- **MUST** keep one logical operation per commit and keep its docs in the same commit.
- **MUST** run targeted tests, then `make check`; run `make e2e` for cross-component changes.
- **MUST** verify evidence before claiming completion.
- **MUST NOT** commit `console.log`, `debugger`, `.only()`, credentials, generated secrets, or runtime logs.
- **MUST NOT** use a persistent Claude daemon. Claude Code and the Agent SDK run in-process; background work uses Claude Code's Agent tool.
- **MUST NOT** bypass human approval for commits, pushes, pull-request mutations, releases, package publication, deployments, production/shared-infrastructure writes, credential changes, public exposure, or irreversible destruction.
- **MUST NOT** rebase or force-push under the default project policy.

## Execution model

Clear, local, reversible work proceeds autonomously: inspect, edit, test, and iterate without permission handoffs. The project defaults to `acceptEdits`; eligible operators may opt into Claude Code Auto mode. PreToolUse hooks still deny prohibited actions and escalate externally visible or irreversible actions with `permissionDecision: "ask"`.

For non-trivial requests, `office-manager` coordinates three ordered phases:

1. Research: `greg` (`research-analyst.md`) plus an implementation-context specialist.
2. Plan: `planner` drafts; `qa-reviewer` challenges assumptions and test shape.
3. Implement: engineering agents edit and test; review and verification follow before `commit-staged` asks for the final human commit confirmation.

Do not manufacture delegation authority. Use Claude Code's native Agent tool only when bounded parallel work materially improves the outcome.

## Architecture

- `.claude/agents/` — Claude Code subagent definitions.
- `config/skills/` — canonical skills; `.claude/skills/` is the verified project mirror.
- `.claude/commands/` — user-invoked workflows.
- `.claude/hooks/` + `.claude/settings.json` — safety, routing, lifecycle, telemetry, compaction, reviewer-context, simplify, and HITL gates.
- `packages/sdk/` — typed autonomy primitives and the nine-tool stdio MCP surface: plans, loops, graph queries, instincts, and decisions.
- `cli/` — install/provision, audit, validation, backup, cost/claim, sandbox, and repair utilities.
- `scripts/` + `.harness/` + `templates/` — verification, feature/eval state, session traces, and reusable contracts.

The harness has no browser/server UI layer or local web editor. Session handoff and learning logs are bounded operational records for autonomy; they are not a general note vault, semantic search service, or knowledge-base API.

## State and evidence

- `PROGRESS.md` — current objective, evidence, next actions, blockers.
- `feature_list.json` — WIP=1 feature state.
- `DECISIONS.md` and `docs/decisions/` — current architecture decisions.
- `.harness/evals/` — feature evaluation records.
- `.harness/traces/` — gitignored runtime traces.
- `.bizar/session-state.json` — bounded SessionEnd→SessionStart handoff.

## Definition of done

1. Behavior is implemented with a regression test.
2. Documentation and feature state describe the actual code.
3. `make verify-removed-surfaces`, `make check-arch`, `make test`, `make e2e`, `make clean-check`, and `make check` pass as applicable.
4. `PROGRESS.md` records fresh evidence and no required work remains.
5. `/simplify` reviews the staged diff before the approval-gated commit.
