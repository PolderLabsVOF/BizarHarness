# Agent Orchestrator integration

[Agent Orchestrator (AO)](https://github.com/Untrivial-ai/agent-orchestrator)
is Bizar's primary multi-agent runtime. AO owns the daemon, project registry,
isolated worktrees, worker sessions, branches, PR/review/CI feedback, previews,
and browser sessions. Bizar is the worker harness: it supplies repository
instructions, quality gates, skills, hooks, and release tooling.

This boundary deliberately avoids a second coordinator. In particular, Bizar
does not read AO's database, manage AO's runtime, write AO hook configuration,
or create a competing worktree, session, task, or PR ledger.

## Configure a project

Install AO from its official desktop/GitHub distribution and start its local
daemon. Do not use AO's frozen npm CLI package as the installation source.
Then configure the repository through AO's supported CLI boundary:

```sh
bizar ao doctor
bizar ao setup
```

`bizar ao setup` registers the current repository when needed, selects `codex`
for worker and orchestrator sessions, and preserves the complete existing AO
project configuration before writing it back. That preservation matters because
AO's `project set-config` replaces the whole configuration. The command sets
the repo-relative `.ao/bizar-worker-rules.md` file as AO's `agentRulesFile`.
It materializes that file from Bizar's versioned template without overwriting a
project-owned version.
Use `--project <id>`, `--model <id>`, or `--permissions <mode>` when the AO
project needs explicit values.

`bizar ao status`, `bizar ao sessions`, and `bizar ao <command>` expose AO's
supported CLI without reimplementing its protocol. Useful AO-native capabilities
include `ao spawn`, `ao send`, `ao session claim-pr`, session switching between
Codex and Claude Code, `ao preview`, and the session-scoped `ao browser` tools.

## Worker behavior

AO injects project rules into Codex through its supported launch configuration
and attaches AO activity hooks as invocation-scoped flags. Bizar therefore does
not overwrite `.codex/hooks.json` or user Codex settings. When `AO_SESSION_ID`
or `AO_PROJECT_ID` is present, a Bizar worker:

- completes only its assigned AO task in the assigned worktree;
- uses AO—not Bizar/Claude/Codex teams—for further parallel workers;
- sends a real blocker or cross-session request through `ao send`;
- runs the repository's targeted tests, `make check`, and applicable gates;
- reports changed files, verification evidence, and residual risks to AO.

AO workers must not mutate `.ok/` by default. OpenKan's tracked project state
would otherwise be a competing planner shared across parallel AO worktrees.

## OpenKan standalone mode

OpenKan remains fully supported for projects deliberately running Bizar without
AO. Use `bizar openkan`, `ok task`, `ok plan`, and `ok prd` in that mode. In an
AO session, use OpenKan only when the assigned task explicitly requires it and
the AO orchestrator has serialized the shared-state operation.

## Compatibility basis

This integration targets AO v0.13.0 and its documented local-daemon CLI:

- [AO CLI](https://github.com/Untrivial-ai/agent-orchestrator/blob/v0.13.0/docs/cli/README.md)
- [AO architecture](https://github.com/Untrivial-ai/agent-orchestrator/blob/v0.13.0/docs/architecture.md)
- [AO project configuration](https://github.com/Untrivial-ai/agent-orchestrator/blob/v0.13.0/backend/internal/domain/projectconfig.go)
- [AO Codex launch model](https://github.com/Untrivial-ai/agent-orchestrator/blob/v0.13.0/backend/pkg/agentruntime/command.go)
