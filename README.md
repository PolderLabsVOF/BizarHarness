# Bizar Harness

Bizar is a guarded-autonomy harness for Claude Code. It packages 16 uniquely named role agents, 65 skills, slash-command workflows, lifecycle and safety hooks, a typed SDK, a nine-tool MCP server, and install/audit/test utilities.

## What it does

- Executes clear local edit/test/verify work autonomously.
- Uses Claude Code permission modes plus deterministic hooks for safety.
- Requires human confirmation for commits, pushes, PR mutations, releases, publishing, deployments, and other external or irreversible operations.
- Routes non-trivial work through research, plan/audit, implementation, review, and verification phases.
- Preserves bounded session handoffs and learning evidence without providing a general-purpose note vault.
- Guards compaction fidelity, commit quality, prose quality, dangerous shell commands, protected paths, and reviewer context.

Bizar deliberately ships no web control plane, browser extension, background web service, or note-vault/search subsystem.

## Quick start

```sh
npm install
npm run build
node cli/bin.mjs install
make check
make test
make e2e
```

Claude Code reads `.claude/settings.json`. `cli/provision.mjs` can copy agents, commands, skills, hooks, rules, and settings into `~/.claude/` for user-level use.

## Core surfaces

| Surface | Purpose |
| --- | --- |
| `.claude/agents/` | Office-themed role agents and orchestrator |
| `config/skills/` | Canonical skill library |
| `.claude/commands/` | Slash-command workflows |
| `.claude/hooks/` | Safety, HITL, lifecycle, routing, telemetry, and compaction hooks |
| `packages/sdk/` | Agent registry, router, learning logs, federation, consensus, and MCP |
| `cli/` | Installer, validator, backup, audit, cost/claim/task, sandbox, repair |
| `scripts/` | Architecture, absence, E2E, feature, eval, and clean-state verification |

The MCP tools are `plan_action`, `loop_start`, `loop_stop`, `loop_list`, `loop_status`, `graph_query`, `graph_path`, `list_instincts`, and `list_decisions`.

## Parallel agent coordination

Code-writing subagents run in isolated Git worktrees. `bizar task` stores a
shared SQLite task graph under Git's common directory, so all worktrees observe
the same dependencies, owners, path scopes, and expiring leases. The
PreToolUse ownership hook denies edits outside the current task scope and edits
to paths leased by sibling agents.

```sh
bizar task create sdk-change --title "Update SDK" --scope "packages/sdk/**"
bizar task claim sdk-change --owner todd --workspace "$PWD"
bizar task heartbeat sdk-change --owner todd
bizar task complete sdk-change --owner todd --evidence "targeted tests passed"
bizar task integrate enqueue sdk-change --commit abc1234 --owner todd
bizar task integrate claim --worker steve
bizar task integrate pass 1 --worker steve --evidence "aggregate checks passed"
```

The integration queue records the commit, base reference, verification command,
owner, integrator, and outcome. It deliberately does not perform unapproved
merge, rebase, push, or publication operations.

## Guarded autonomy

Project settings default to `acceptEdits`, which lets Claude iterate locally while preserving prompts around broader shell operations. Operators who meet Claude Code's requirements may choose Auto mode; Bizar's deny/ask hooks still apply before permission-mode evaluation.

The Git workflow hook denies force-push, rebase, unsupported commit subjects, and AI-attribution trailers. It asks before a commit, push, PR mutation, release, publish, or deploy. The simplify guard requires `/simplify` for every commit attempt.

## Verification

```sh
make verify-removed-surfaces
make verify-repo-structure
make check-arch
make test
make e2e
make clean-check
make check
```

The root package uses a runtime-only allowlist: no test files, local state,
duplicate skill mirror, or source-only fixture is published.

See [the documentation index](docs/INDEX.md), [architecture](docs/architecture.md), [core feature audit](docs/audits/core-feature-audit-2026-07-30.md), [repository cleanup audit](docs/audits/repository-cleanup-2026-07-30.md), and [upstream parity matrix](docs/audits/claude-codex-settings-parity-2026-07-30.md).

## License

MIT
