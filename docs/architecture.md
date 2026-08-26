# Architecture

## Runtime model

Claude Code is the host. Native Agent, Skill, command, permission, and hook surfaces drive orchestration. Bizar adds project configuration, deterministic guards, role definitions, a typed SDK, and an optional stdio MCP server; it does not run a persistent application service.

### Routing default

Native dynamic workflows under `config/workflows/` (mirrored to
`~/.claude/workflows/`) are the primary dispatch mechanism for non-trivial
tasks. `@mike` invokes a named workflow when the request maps to a research /
implement / debug / review shape — typically
`config/workflows/bizar-research.js`, `bizar-implement.js`, or
`bizar-debug.js`. Long-lived work that needs ≥3 workers with bounded cross-talk
fans out as a native agent team; the team is host-side state under
`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (per Anthropic's docs `team_name` is
deprecated and ignored). Plain `Agent` calls survive only for trivial,
single-shot, or fully isolated work. Routing policy and decision tree live in
`config/claude/agents/office-manager.md`; the full plan and audit trail are at
`docs/decisions/PLAN-agent-teams-default.md` (F-165).

## Layers

1. **Control configuration:** `config/claude/agents`, `config/claude/commands`, `config/claude/hooks`, `config/claude/settings.json`, and canonical `config/skills`. The repo deliberately has no top-level `.claude/` directory so Claude Code sessions inside the repo do not auto-load Bizar's own assets.
2. **Core library:** `packages/sdk` contains framework-light registries, routing, learning records, federation, consensus, dangerous-pattern checks, and MCP definitions.
3. **Integration:** `config/claude/settings.json` is the canonical settings template shipped via the npm package; `bizar install` writes it (merged with the user's existing settings) to their `~/.claude/settings.json`.
4. **Operations:** `cli`, `scripts`, `.harness`, and `templates` install, validate, audit, back up, and verify the harness.

## Plugin and hook boundary

`.claude-plugin/plugin.json` describes Bizar's distributable Claude Code
surface: agents, skills, commands, hooks, and the retained stdio MCP server.
Project-local `config/claude/` configuration is the contributor surface, while
the installer materializes an immutable versioned bundle to `~/.claude/` on the
user's machine.

All lifecycle entries invoke the stable `bizar hook <event>` dispatcher rather
than reaching through checkout-relative paths. The dispatcher reads one Claude
Code event object from stdin, resolves the active installed bundle, calls the
event implementation, and emits schema-valid JSON. Project and plugin wiring
are verified as equivalent, and simultaneous activation must not execute a
logical hook twice.

Hook code is finite and deterministic. It uses exit status `2` only for an
intentional block, never starts a daemon, and does not convert transcript,
tool, or web content into executable instructions.

## Durable workflows and autopilot

The workflow registry permits one primary durable mode for a real project path
and Claude session. `/autopilot` advances through a closed lifecycle:

```text
research/specification -> consensus plan -> implementation waves
  -> QA/fix -> multi-perspective validation -> complete
```

An active phase can become blocked, failed, or cancelled. Resume continues the
recorded phase; QA and validation can return bounded fixes to implementation.
Iteration, repeated-failure, QA, and validation ceilings prevent an unbounded
Stop-hook loop.

State is bounded operational metadata: schema/run/session identifiers,
workspace identity, objective digest, phase and revision, resolved routing,
task/claim references, attempt counters, and evidence references. Writes use
session/project ownership checks, symlink rejection, atomic replacement, and
compare-before-write revisions so duplicate hooks cannot advance twice.
Completion requires an explicit revision-bound transition after fresh
verification; assistant prose and stale transcript records are not evidence.

`UserPromptSubmit` selects explicit workflow triggers, `SessionStart` restores
active context, `SubagentStart`/`SubagentStop` bind and verify task claims,
`PostToolUseFailure` records bounded failure signatures, `PreCompact`
checkpoints, and `Stop` requests only the next valid action. Cancellation is
always available and never performs Git or publication mutations.

## OpenKan control boundary

Bizar does not embed a web server or dashboard. The `bizar control` CLI is the
stable, machine-readable boundary for an optional OpenKan control plane. It
exposes agent definitions, the task and integration ledgers, feature/progress
state, Claude Code background sessions, and durable messages as JSON.

OpenKan invokes the CLI with argument arrays and owns all HTTP, WebSocket, and
browser code. It never imports Bizar modules, opens Bizar's SQLite database,
edits Claude transcripts, or duplicates task-lease semantics.

Cross-agent messages are file-per-message records under
`.bizar/control/messages/`. Atomic rename provides claim serialization.
`SessionStart` and `UserPromptSubmit` hooks inject matching messages through
Claude Code's documented `additionalContext` surface. Session-targeted messages
may request a background resume, but Bizar does not attempt unsupported
live-process mutation.

## Parallel execution boundary

Code-writing subagents declare `isolation: worktree` and branch from the
leader's current `HEAD`. Their source trees and build outputs are independent;
only the installed dependency tree is linked from the main checkout. The
designated Git integrator remains in the target checkout and serializes
completed work rather than letting sibling agents merge concurrently.

The task database defaults to `<git-common-dir>/bizar/tasks.sqlite`, which is
shared by linked worktrees but remains outside tracked source. Atomic SQLite
transactions guard dependency readiness, task claims, path-scope collisions,
and lease recovery. A PreToolUse hook consults the same database before every
Write/Edit/MultiEdit operation.

Completed task commits enter the same database's FIFO integration queue. An
immediate transaction and a partial unique index guarantee one active
integrator across processes. Passing integration releases the path reservation
and marks the task integrated; failure returns it to the original owner with a
repair lease and structured blocker. The queue never bypasses Git or
publication approval hooks.

## Source and publication boundary

`config/skills` is the canonical skill source; `config/claude/skills` is a
repository mirror for project sessions, not a second published copy. The root
npm package ships production CLI files, compiled SDK output, canonical
configuration, Claude agents/commands/hooks/settings, and install-time Git
hooks. Tests, runtime state, research clones, fixtures, and local tool
metadata are excluded.
`scripts/verify-repo-structure.mjs` enforces both the tracked tree and package
manifest.

## MCP boundary

The MCP server exposes nine tools only: plan CRUD, loop state, graph query/path, and read-only instinct/decision records. Tool handlers operate on local files and do not call a local HTTP service.

## Autonomy and approval

Local reversible work is the autonomous lane. Hook precedence is used intentionally: deny beats ask, ask beats the permission mode's normal approval. Protected paths and dangerous commands are denied; external publication and irreversible actions ask the operator. Auto mode is optional and account/provider-dependent, not assumed by the harness.

## Agent routing and evidence

Every non-empty primary prompt receives `UserPromptSubmit` context requiring
delegation through the custom `mike` agent. Mike routes trivial work to
`brenda`; non-trivial work enters the phased research, plan, implementation,
review, and verification pipeline. Specialized worker matches supplement this
route but never replace it.

Mike is the sole general orchestrator. Agent roles are model-agnostic: no
custom agent carries fixed `model:` frontmatter. Before each dispatch Mike
selects the cheapest sufficient tier from task risk and complexity. When live
gateway discovery reports a configured candidate, Mike passes that model on the
Agent call. When discovery is unavailable, stale, ambiguous, or has no matching
candidate, the Agent call omits `model` and inherits the active session model.
A dispatch is attempted once; Bizar does not cycle aliases, providers, or tiers.

Workflow state records only the routing decisions made for requested agents,
including whether each dispatch used a concrete live candidate or inherited the
session. The `cx/*`, `claude-qwen/*`, and `claude-minimax/*` IDs are optional
compatibility-gateway contracts, not permanent properties of agent roles.

Bizar also installs three native Claude Code dynamic workflows under
`~/.claude/workflows/`: `ultracode`, `ultracode-review`, and
`ultracode-research`. Native workflows hold deterministic fan-out in JavaScript;
subagents handle focused delegation; experimental agent teams handle tasks where
workers need direct coordination and shared task state. Agent teams are enabled
with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`, while TaskCreated, TaskCompleted,
and TeammateIdle hooks record advisory evidence without blocking or retrying.

Every `SubagentStart` receives a grounding contract: external APIs, libraries,
frameworks, CLIs, configuration formats, and version-sensitive behavior require
`WebSearch` for current official documentation followed by `WebFetch` of the
exact relevant page. All shipped agents expose `WebSearch` and reference the
shared baseline. `scripts/check-agents.mjs` and the `agent-grounding`
architecture rule fail if either property drifts.

## Operational records

Session lifecycle hooks write a bounded handoff and structured session record. Learning hooks maintain compact instinct and decision JSONL records. These files support continuation and routing only; there is no note CRUD, vault indexing, semantic search, or knowledge-base tool family.

Workflow and task records do not change that boundary. Bizar has no general
memory/note-vault subsystem, no persistent Claude daemon, and no automatic
commit, push, pull-request, release, package-publication, deployment, public
exposure, or irreversible-destruction path. Those mutations remain protected
by the human-approval hooks even while autopilot is active.

## No embedded local web surface

The retained CLI starts no web server. Visual planning uses Claude Code's
native session surfaces and repository documents, or the optional external
OpenKan adapter through `bizar control`.
