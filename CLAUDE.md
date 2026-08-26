# AGENTS.md — Bizar Harness

Bizar Harness is a Claude Code-native, guarded-autonomy harness. It ships project and user-level agents, skills, slash commands, hooks, an MCP server, CLI utilities, and verification scripts. It has no embedded web control plane and no Bizar note-vault subsystem; OpenKan can consume the explicit `bizar control` CLI boundary as an optional external UI.

If you are an agent: read this file, read `PROGRESS.md`, inspect `feature_list.json`, then run `make check` before changing code.

## Commands

```sh
make setup                    # install Claude Code and project dependencies
make check                    # TypeScript gate
make test                     # retained SDK, CLI, hook, and harness tests
make e2e                      # real SDK/MCP/Claude Code integration smoke test
make check-arch               # architectural and removed-surface checks
make verify-removed-surfaces  # prove deleted subsystems are absent
make verify-repo-structure    # prove tracked/package paths are clean
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
- **MUST NOT** rebase or force-push under the default project policy.

## Autonomy and parallelism

Agents execute clear, local, reversible work autonomously — they inspect,
edit, test, and iterate without pausing for routine decisions. Routine
decisions (file layout, naming, scope of a single commit, choosing between
two equivalent stdlib calls, picking a verification command from the Makefile,
or marking a task `passing` after `make check` is green) do NOT require
human approval and MUST NOT trigger a permission handoff. PreToolUse hooks
still deny prohibited actions and escalate externally visible or irreversible
actions with `permissionDecision: "ask"`; that escalation list is the
authoritative floor, not a starting point.

Native dynamic workflows under `config/workflows/` and `~/.claude/workflows/`
are the primary dispatch mechanism for non-trivial tasks. Mike dispatches a
named workflow when the request maps to a research / implement / debug /
review shape. For work that needs 3+ long-lived workers with bounded cross-
talk, Mike invokes a workflow that fans out as a native agent team; the team
is host-side state under `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, and per
Anthropic's docs `team_name` is deprecated and ignored. Plain `Agent` calls
are reserved for trivial, single-shot, or fully isolated work. When two or
more subtasks within a workflow have non-overlapping file scopes and no data
dependency on each other's intermediate output, the orchestrator MUST dispatch
them concurrently through `parallel([...])`. Sequential dispatch is reserved
for dependent phases and integration.

Agent roles are model-agnostic. Mike selects the cheapest sufficient tier for
each dispatch. It passes a concrete model only when live discovery proves a
configured tier candidate; otherwise it omits `model` and inherits the active
session. Bizar never retries a failed dispatch by cycling aliases, providers, or
tiers.

The authoritative hard approval list (cannot be auto-approved) is: commits, pushes, pull-request
mutations, releases, package publication, deployments, production/shared-
infrastructure writes, credential changes, public exposure, irreversible
destruction. Everything else proceeds.

## Execution model

The autonomy and approval policy above governs this execution model. The project defaults to `acceptEdits`; eligible operators may opt into Claude Code Auto mode.

Every non-empty primary request must use Claude Code's Agent tool to enter the
Bizar agent pipeline through `office-manager` (`@mike`) before task analysis or
implementation. Mike routes trivial work to `@brenda` and non-trivial work
through the phased team. A session already running as a Bizar custom agent
follows its assigned role and does not recursively dispatch itself.

Every shipped agent has `WebSearch` access. Before proposing, explaining,
troubleshooting, or implementing behavior from an external API, library,
framework, CLI, configuration format, or version-sensitive dependency, the
agent must WebSearch for current official documentation and WebFetch the exact
relevant page. Guess-and-try integration work is prohibited. When official
documentation is unavailable or ambiguous, inspect authoritative source code
and report the evidence gap.

For non-trivial requests, `office-manager` coordinates three ordered phases:

1. Research: `greg` (`research-analyst.md`) plus an implementation-context specialist.
2. Plan: `planner` drafts; `qa-reviewer` challenges assumptions and test shape.
3. Implement: engineering agents edit and test; review and verification follow before `commit-staged` asks for the final human commit confirmation.

Use Claude Code's native Agent tool for Bizar routing on every request.
Additional parallel fan-out remains bounded to scopes that materially improve
speed, quality, or safety.

## Architecture

- `.claude/agents/` — Claude Code subagent definitions.
- `config/skills/` — canonical skills; `.claude/skills/` is the verified project mirror.
- `.claude/commands/` — user-invoked workflows.
- `.claude/hooks/` + `.claude/settings.json` — safety, routing, lifecycle, telemetry, compaction, reviewer-context, simplify, and HITL gates.
- `packages/sdk/` — typed autonomy primitives and the nine-tool stdio MCP surface: plans, loops, graph queries, instincts, and decisions.
- `cli/` — install/provision, audit, validation, backup, cost/claim/task, OpenKan control, sandbox, and repair utilities.
- `scripts/` + `.harness/` + `templates/` — verification, feature/eval state, audit output, and reusable contracts.

The harness has no embedded browser/server UI layer or local web editor.
`bizar control` is a machine-readable subprocess boundary for optional OpenKan
integration; OpenKan owns HTTP, WebSocket, and presentation concerns. Session
handoff, control inbox, and learning logs are bounded operational records for
autonomy; they are not a general note vault, semantic search service, or
knowledge-base API.

## State and evidence

- `PROGRESS.md` — current objective, evidence, next actions, blockers.
- `feature_list.json` — WIP=1 feature state.
- `DECISIONS.md` and `docs/decisions/` — current architecture decisions.
- `.harness/evals/` — feature evaluation records.
- `~/.config/bizar/telemetry/` — local correlation and rejected-action feedback.
- `.bizar/session-state.json` — bounded SessionEnd→SessionStart handoff.

## Definition of done

1. Behavior is implemented with a regression test.
2. Documentation and feature state describe the actual code.
3. `make verify-removed-surfaces`, `make verify-repo-structure`, `make check-arch`, `make test`, `make e2e`, `make clean-check`, and `make check` pass as applicable.
4. `PROGRESS.md` records fresh evidence and no required work remains.
5. `/simplify` reviews the staged diff before the approval-gated commit.
