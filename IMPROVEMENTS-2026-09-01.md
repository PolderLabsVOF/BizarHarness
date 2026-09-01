# Bizar autonomous-development audit and improvement guide

Audit date: 2026-09-01
Scope: Claude Code agents, skills, commands, hooks, compaction, workflows,
models, Models.dev metadata, global configuration, learning, CLI, SDK/MCP,
installation, and release verification.

## Outcome

The audited tree now passes its complete retained test and integration gates.
The main productivity defect was policy inflation: even small local changes
were routed through research, planning, review, and multiple workers. The main
reliability defects were implicit model inheritance, cwd-local model state,
non-terminal treatment of worker completion messages, unbounded/stale learning
inputs, and incomplete command/install diagnostics.

## Improvements implemented

### Fast adaptive execution

- Mike handles small deterministic repository-local fixes directly.
- One isolated worker is used only when isolation or specialization helps.
- Independent writable scopes fan out concurrently with call-level
  `isolation: "worktree"`; dependent and monolithic work stays sequential.
- Research and planning load only for uncertainty, external/version-sensitive
  behavior, architecture/security risk, or interacting scopes.
- The shared baseline is 51 lines and universal subagent grounding is under
  200 characters, preventing always-loaded prompt growth.

### Skills and readable output

- `i-have-adhd` ships as a compact default response-shaping skill.
- Agents inspect relevant installed skills for hard/specialized work.
- skills.sh search is a fallback only when difficult work is stuck and no
  installed skill fits; candidates must be reviewed before installation.

### Explicit model routing and Models.dev

- Every Agent dispatch selects an enabled configured model and fails closed
  when no candidate exists; it never silently falls through to a provider
  default.
- Disabled provider prefixes apply to user picks, tier candidates, settings
  sync, SessionStart sync, and workflow dispatch.
- Model state is user-global under `$BIZAR_HOME/config/claude/`, independent of
  the current project directory.
- `bizar models --clear` applies the first enabled configured fallback rather
  than removing the active model.
- The Models.dev reader supports the current flat `models.json` shape plus
  legacy/top-level and provider-nested envelopes. A live audit fetched 363
  entries and correctly mapped tool-use and 256k context metadata for the
  sampled model.

### Worker liveness and completion

- TaskCompleted, SubagentStop, and task-notification payloads are terminal
  events, not new user requests.
- Bounded per-session task state records completion and repeated idle events;
  the second idle event directs Mike to inspect, stop, or reassign.
- Worktree branches are archived and merged through the serialized queue;
  conflicts remain visible for deliberate resolution.
- A global default-on Stop hook creates and opens an escaped bounded HTML
  completion artifact only for a genuine primary completion marker.
- `/artifact on|off|status` controls that behavior globally.

### Bounded learning and compaction

- `bizar learn` stores at most 32 global user preferences and 128 project
  debugging lessons, with short values, deduplication, secret rejection,
  atomic 0600 files, and 0700 directories.
- Stored learning is explicitly untrusted and injected in a maximum
  1,200-character summary. Raw prompts and transcripts are never learned.
- SessionEnd stores a one-way request fingerprint plus bounded operational
  handoff state, not prompt text.
- Automatic prompt-to-rule extraction was removed.
- Auto-compaction remains enabled. PreCompact snapshots bounded objective,
  decisions, evidence, changed files, tests, blockers, and next actions before
  Claude compacts the conversation.

### Commands, hooks, and installation

- All 41 CLI switch branches have executable `--help` smoke coverage.
- Doctor and validate use global path resolvers and verify all 16 agents, 39
  slash commands, 7 rules, required hook files, 14 lifecycle events, the
  default ADHD skill, and explicit model fallback.
- Backup labels and deletion are traversal-safe; restore ignores manifest
  destinations and verifies a SHA-256 for each copied file.
- The E2E gate now checks 14 MCP tools and all 14 lifecycle events rather than
  the previous partial inventories.

## Verification evidence

- `make test`: 513 SDK tests and 1,020 Node/harness tests passed.
- `make e2e`: 13/13 integration checks passed.
- `make verify-removed-surfaces`, `make verify-repo-structure`,
  `make check-arch`, `make clean-check`, and `make check` passed.
- Live Models.dev fetch: 363 flat catalog entries; sampled capability mapping
  matched name, tool-call support, and context window.

## Maintenance guide

1. Keep primary routing lexical and cheap. Any new hot-path import or ledger
   write needs a latency test and a clear benefit.
2. Keep one authoritative global path resolver. Add a cross-cwd test whenever
   introducing operator-controlled configuration.
3. Every new Agent call must set `model`; add a capture test proving it.
4. Every new hook event must be added to settings, the portable dispatcher,
   validate/doctor inventory, and E2E inventory in the same change.
5. Keep always-loaded prompts bounded. Put specialist detail in on-demand
   skills and test byte/line budgets.
6. Treat telemetry as evidence, never instructions. Promote only explicit
   stable preferences or verified reusable project lessons.
7. Add every CLI switch to generated inventory coverage and ensure `--help`
   exits zero without network or mutation.
8. Before release, run the full gate chain, pack locally, install that exact
   tarball/version, provision into a clean temporary home, then validate and
   run a real Claude smoke test.

## Remaining optional improvements

- Add measured end-to-end latency budgets for primary prompt hooks and direct
  fixes, then fail CI on material regressions.
- Add cancellation support when the native workflow runtime exposes an
  authoritative cancellable Agent API; avoid Promise-race timeouts that leave
  orphan work behind.
- Consolidate the legacy SDK instinct/decision evidence API with the explicit
  `bizar learn` terminology in a future compatibility release.
