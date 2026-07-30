# Architecture

## Runtime model

Claude Code is the host. Native Agent, Skill, command, permission, and hook surfaces drive orchestration. Bizar adds project configuration, deterministic guards, role definitions, a typed SDK, and an optional stdio MCP server; it does not run a persistent application service.

## Layers

1. **Control configuration:** `.claude/agents`, `.claude/commands`, `.claude/hooks`, `.claude/settings.json`, and canonical `config/skills`.
2. **Core library:** `packages/sdk` contains framework-light registries, routing, learning records, federation, consensus, dangerous-pattern checks, and MCP definitions.
3. **Integration:** `.claude/settings.json` launches the SDK's stdio MCP server directly.
4. **Operations:** `cli`, `scripts`, `.harness`, and `templates` install, validate, audit, back up, and verify the harness.

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

## Source and publication boundary

`config/skills` is the canonical skill source; `.claude/skills` is a repository
mirror for project sessions, not a second published copy. The root npm package
ships production CLI files, compiled SDK output, canonical configuration,
Claude agents/commands/hooks/settings, and install-time Git hooks. Tests,
runtime state, research clones, fixtures, and local tool metadata are excluded.
`scripts/verify-repo-structure.mjs` enforces both the tracked tree and package
manifest.

## MCP boundary

The MCP server exposes nine tools only: plan CRUD, loop state, graph query/path, and read-only instinct/decision records. Tool handlers operate on local files and do not call a local HTTP service.

## Autonomy and approval

Local reversible work is the autonomous lane. Hook precedence is used intentionally: deny beats ask, ask beats the permission mode's normal approval. Protected paths and dangerous commands are denied; external publication and irreversible actions ask the operator. Auto mode is optional and account/provider-dependent, not assumed by the harness.

## Operational records

Session lifecycle hooks write a bounded handoff and structured session record. Learning hooks maintain compact instinct and decision JSONL records. These files support continuation and routing only; there is no note CRUD, vault indexing, semantic search, or knowledge-base tool family.

## No local web surface

The retained CLI starts no web server. Visual planning uses Claude Code's
native session surfaces and repository documents.
