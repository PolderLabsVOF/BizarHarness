# OMC-Informed Bizar Workflow Overhaul

**Status:** implementation design for F-129
**Research date:** 2026-08-02
**Decision:** reimplement selected orchestration patterns; do not fork or wholesale-copy the upstream runtime.

## Pinned research basis

The comparison target is [`yeachan-heo/oh-my-claudecode`](https://github.com/yeachan-heo/oh-my-claudecode), cloned to `/tmp/oh-my-claudecode-research` and inspected at commit [`41a4c0f77144c5beb5f5f000a89cff379c680606`](https://github.com/yeachan-heo/oh-my-claudecode/commit/41a4c0f77144c5beb5f5f000a89cff379c680606). That commit is the tree tagged [`v4.15.7`](https://github.com/yeachan-heo/oh-my-claudecode/releases/tag/v4.15.7), authored 2026-07-23T04:44:59Z; its annotated tag was created 2026-07-23T04:47:29Z. The package identifies itself as `oh-my-claude-sisyphus` 4.15.7 and uses the [MIT License](https://github.com/yeachan-heo/oh-my-claudecode/blob/41a4c0f77144c5beb5f5f000a89cff379c680606/LICENSE), copyright 2025 Yeachan Heo.

Relevant upstream evidence includes its [plugin manifest](https://github.com/yeachan-heo/oh-my-claudecode/blob/41a4c0f77144c5beb5f5f000a89cff379c680606/.claude-plugin/plugin.json), [hook manifest](https://github.com/yeachan-heo/oh-my-claudecode/blob/41a4c0f77144c5beb5f5f000a89cff379c680606/hooks/hooks.json), and [`autopilot` skill](https://github.com/yeachan-heo/oh-my-claudecode/blob/41a4c0f77144c5beb5f5f000a89cff379c680606/skills/autopilot/SKILL.md). MIT permits reuse, but any copied substantial portion must retain its notice. Bizar should instead preserve provenance here and implement a smaller runtime around its existing safety and task primitives.

## Official Claude Code constraints

The design follows current official documentation rather than treating upstream behavior as a platform contract:

- A shareable plugin is a self-contained directory with `.claude-plugin/plugin.json`; skills, agents, hooks, and MCP servers are plugin components. Project `.claude/` configuration remains appropriate for repository-specific behavior. See [Create plugins](https://code.claude.com/docs/en/plugins) and the [plugins reference](https://code.claude.com/docs/en/plugins-reference).
- Plugin hooks belong in `hooks/hooks.json` or the manifest. Installed marketplace plugins execute from a versioned cache, so scripts must resolve through `${CLAUDE_PLUGIN_ROOT}` rather than assume the source checkout. The plugin should be validated with `claude plugin validate`.
- Skills use `skills/<name>/SKILL.md`; plugin skills are namespaced. Flat `commands/` remain compatible, but skills are the preferred new surface. Skill precedence and live-reload rules are documented in [Extend Claude with skills](https://code.claude.com/docs/en/slash-commands).
- Hook commands receive JSON on stdin. Exit `0` is success, exit `2` is the blocking status, and exit `1` is normally only a non-blocking hook error. `UserPromptSubmit`, `UserPromptExpansion`, and `SessionStart` stdout can add model context. See [Hooks reference](https://code.claude.com/docs/en/hooks) and [Hooks guide](https://code.claude.com/docs/en/hooks-guide).
- A `Stop` hook receives `stop_hook_active`; it must use that flag or equivalent evidence to avoid an endless continuation loop. Claude Code ends the turn after eight consecutive Stop blocks. Persistent workflows therefore need bounded continuation and explicit state transitions, not repeated unconditional denial.
- `SubagentStart`/`SubagentStop` expose agent identity and final-message context. They can track claims and verify deliverables, but transcript prose alone is not proof that a phase succeeded.
- Subagent model resolution is environment override, per-invocation model, agent frontmatter, then parent model. `availableModels` can exclude a requested model. Nested Agent dispatch is supported within the configured depth, and `isolation: worktree` is the native boundary for edit isolation. See [Create custom subagents](https://code.claude.com/docs/en/sub-agents) and [Run agents in parallel](https://code.claude.com/docs/en/agents).
- Background subagents cannot interactively obtain missing approvals; permission-requiring calls are denied unless already allowed. Work must be partitioned so a background lane does not depend on a surprise approval.
- Anthropic documents gateways as an Anthropic-compatible protocol boundary but explicitly does **not** support routing Claude Code to non-Claude models. Bizar's `cx/gpt-*` and `bizar/MiniMax-*` identifiers therefore depend on 9Router compatibility and are not native Claude Code guarantees. See [Other LLM gateways](https://code.claude.com/docs/en/llm-gateway).

## Current Bizar baseline and gaps

Bizar already has a strong base: Mike coordinates a three-phase research/plan/implement pipeline; agent files carry explicit models and tools; `.claude/model-router.json` defines cost tiers; safety hooks protect shell, paths, Git, publication, and the simplify gate; task claims and worktree support reduce concurrent-edit collisions; `config/skills/` is canonical and `.claude/skills/` is verified as its project mirror.

The gaps are workflow-runtime gaps, not a need for another dashboard or knowledge store:

1. Mike is currently routed to `cx/gpt-5.6-terra`, not the requested fixed Sol model.
2. The router is descriptive. It does not freeze the resolved worker/model matrix per run or surface an unavailable gateway model as a first-class blocker.
3. There is no Bizar plugin manifest or portable plugin hook manifest.
4. There is no first-class `/autopilot`, `/cancel`, Ralph-style persistence, UltraQA loop, or mutually exclusive mode registry.
5. Current settings do not register `Stop`, `SubagentStop`, `PostToolUseFailure`, or `PermissionRequest`, so phase continuation, deliverable verification, and failure recovery are prompt conventions rather than durable runtime behavior.
6. User-prompt routing suggests agents and thinking skills but does not safely activate a persistent workflow from a bounded keyword grammar.
7. Session handoff exists, but there is no session/project-bound, atomic workflow state with compare-before-write protection against duplicate hooks.
8. Parallel agents can still interfere if work is not partitioned by file ownership or isolated in worktrees.

## Adopt, adapt, reject

| Upstream pattern | Decision | Bizar treatment |
|---|---|---|
| One coordinating authority | **Adopt** | Mike is the only general orchestrator. Worker agents execute or review bounded scopes and do not independently redesign the pipeline. |
| Complexity-based model routing | **Adopt** | Pin Mike to Sol; assign workers by role/difficulty; freeze the selected model matrix in each run. |
| Autopilot phase machine | **Adapt** | Use `research/spec -> consensus plan -> implementation waves -> QA/fix -> multi-perspective validation`, with Bizar evidence gates and approvals. |
| Ralph-style persistence | **Adapt** | Persist only bounded workflow control state. Continue from `Stop` while active, within attempt and hook-continuation limits. |
| UltraQA bounded repair loop | **Adopt** | Run fresh compile/test gates, classify failures, fix, and retry with same-failure and total-cycle ceilings. |
| Parallel execution | **Adopt** | Dispatch only independent scopes together. Use task leases plus `isolation: worktree` when edits could overlap. |
| Planner/critic consensus | **Adopt** | Paul drafts; Linda challenges requirements, risk, and test shape before implementation. |
| Multi-perspective final validation | **Adopt** | Functional, security/policy, code-quality, and test-evidence verdicts must all pass or return bounded fixes. |
| Keyword detector plus skill injection | **Adapt** | Parse explicit commands and a small normalized trigger registry; ignore quoted/code-fenced text and never execute text from tool/web output. |
| Durable mode registry | **Adopt** | Enforce one primary mode per session/project; start, resume, cancel, fail, and complete through compare-before-write transitions. |
| Session restoration and pre-compaction checkpoint | **Adopt** | Restore only active workflow metadata and checkpoint phase/evidence references before compaction. |
| Post-tool verification and failure recovery | **Adapt** | Record relevant results and repeated failure signatures without flooding context or treating command output as instructions. |
| Plugin packaging | **Adapt** | Add a native Bizar manifest and portable hook dispatcher while keeping the verified project surface and installer compatibility. |
| Automatic commit/merge/release | **Reject** | These remain hard human-approval actions. Autopilot may prepare and verify a diff, never publish it. |
| Memory, wiki, notepad, semantic note vault | **Reject** | The removed Bizar memory system stays removed. Workflow state is operational metadata, not user knowledge. |
| tmux controller or persistent daemon | **Reject** | Use in-process Claude Code Agent/SDK primitives and finite hook invocations only. |
| Arbitrary user-defined executable stages | **Reject for v1** | Begin with a closed phase enum and validated configuration; no command strings or callback injection in workflow config. |
| Bundled web control plane | **Reject** | OpenKan remains the optional presentation/control owner through `bizar control`. |
| Silent provider/model fallback | **Reject** | Missing requested models are reported. A deliberate configured fallback may be recorded, never hidden. |

## Target orchestration and model policy

`mike` becomes the fixed main orchestrator with `model: cx/gpt-5.6-sol`, routing-only tools, and the Agent tool. Sol is not a blanket worker tier. The initial worker policy is:

| Work shape | Preferred tier | Representative agents |
|---|---|---|
| Architecture, difficult implementation, adversarial review | `cx/gpt-5.6-terra` | senior engineer, principal engineer, QA reviewer, debug specialist |
| UI/design critique and medium synthesis | `cx/gpt-5.6-luna` | UI and brand design |
| General research, implementation, browser verification | `bizar/MiniMax-M3` | research analyst, support/implementation, browser tester |
| Mechanical implementation and test repair | `bizar/MiniMax-M2.7` | bounded executor lanes |
| Trivial lookup, formatting, coordination bookkeeping | `bizar/MiniMax-M2.5` | assistant and greeter lanes |

Routing is resolved once at run start from an audited registry and recorded with the run. The installer/audit command must check that configured IDs are discoverable from the selected gateway. `CLAUDE_CODE_SUBAGENT_MODEL` and per-invocation overrides have higher official precedence than frontmatter, so Bizar must detect conflicting global overrides and report that the promised routing cannot be enforced. It must not pretend that gateway-backed GPT or MiniMax models are Anthropic-supported.

Only Mike decomposes and fans out general work. Each worker receives a task ID, owned paths, prerequisites, acceptance checks, and a stop condition. Parallel lanes with potentially overlapping writes use isolated worktrees; lanes in the shared checkout require disjoint ownership. Integration is serialized after lane evidence is available.

## `/autopilot` state machine

The public command is `/autopilot <objective>` with `/autopilot resume` and `/cancel`. Natural-language activation may suggest the skill, but only an explicit, unquoted trigger starts durable state.

```text
inactive
  -> research_spec
  -> consensus_plan
  -> execution
  -> qa
  -> validation
  -> completed

Any active phase -> cancelled
Any active phase -> blocked -> same phase on explicit resume
QA/validation -> execution_fix -> QA/validation (bounded)
Exhausted budgets or invalid state -> failed
```

State is scoped to the real workspace path and Claude session. It includes a schema version, run ID, session ID, workspace hash, objective digest, current phase, revision counter, phase attempts, configured ceilings, resolved agent/model assignments, task/claim references, evidence references, and timestamps. It does not store a note corpus or unrestricted transcript. Writes use temporary-file plus atomic rename, restrictive permissions, symlink rejection, and compare-before-write revision checks.

Suggested ceilings mirror the useful shape rather than the upstream implementation size: ten orchestration iterations, five QA cycles, three occurrences of an identical failure signature, and three validation rounds. Completion requires an explicit revision-bound transition written after fresh evidence. A success-sounding assistant message or stale transcript line cannot complete a phase.

## Hook model

| Event | Responsibility |
|---|---|
| `UserPromptSubmit` | Sanitize trigger input; inject the selected skill context; route every ordinary primary request to Mike. |
| `SessionStart` | Validate workspace/session ownership; summarize an active run and its next phase. |
| `PreToolUse` | Preserve existing dangerous-command, protected-path, claim, Git, publication, and simplify gates. |
| `PermissionRequest` | Never auto-approve the hard list; optionally deny known-prohibited requests with a stable reason. |
| `PostToolUse` | Capture bounded evidence metadata for the active phase; never ingest arbitrary output as instructions. |
| `PostToolUseFailure` | Record normalized failure signatures and advise retry/escalation within the configured budget. |
| `SubagentStart` | Bind agent ID, task claim, model assignment, and owned paths. |
| `SubagentStop` | Release or update claims and verify the promised deliverable before Mike integrates it. |
| `PreCompact` | Atomically checkpoint the phase, open tasks, evidence references, and next action. |
| `Stop` | If a valid run is active, request the next bounded action using `additionalContext`; honor `stop_hook_active` and the platform's eight-continuation cap. |
| `SessionEnd` | Record a bounded handoff; do not launch a daemon or perform external mutations. |

Hook dispatch should share a single stdin/JSON/error-handling wrapper so every installed script returns schema-valid output, uses exit `2` only for intentional blocks, and resolves files from the plugin/install root. Each hook stays fast and deterministic; expensive reasoning remains in agents.

## Plugin and installer strategy

1. Add `.claude-plugin/plugin.json` with Bizar identity, version, repository, license, agents, skills, commands, hooks, and the retained stdio MCP server.
2. Add `hooks/hooks.json` as the portable lifecycle manifest. Commands use `${CLAUDE_PLUGIN_ROOT}` and a common Node dispatcher; no relative path may escape the installed bundle.
3. Keep `config/skills/` as the editable canonical source and `.claude/skills/` as the verified project mirror required by this repository. Package validation must prove the mirror and plugin-exported surface agree rather than introduce a third hand-maintained copy.
4. Install immutable versioned assets under the XDG data location (for example `$XDG_DATA_HOME/bizar/versions/<version>`), keep mutable configuration under `$XDG_CONFIG_HOME/bizar`, and point Claude's supported plugin/project configuration at the active version. Updates stage, validate, then atomically switch the active version; rollback retains the previous validated version.
5. Preserve project-local `.claude/` behavior for contributors and provide the plugin bundle for user-wide/distributed use. Provisioning must be idempotent and must not overwrite unrelated user agents, skills, commands, or hooks.
6. Validate with `claude plugin validate`, hook contract tests from installed paths, an install/update/rollback test, and a real Claude Code smoke test.

## Security and product boundaries

- Commits, pushes, pull-request mutation, releases, package publication, deployment, shared/production writes, credential changes, public exposure, and irreversible destruction remain human-approved. `/autopilot` cannot weaken these gates or use a bypass permission mode.
- Web and tool output are untrusted evidence. Keyword routing only examines the user's bounded prompt field; hook state never evaluates arbitrary strings as commands.
- Claims and path ownership protect the shared checkout. Worktree isolation protects overlapping edit lanes. Neither mechanism authorizes Git integration or publication.
- The runtime creates no persistent Claude daemon and no tmux control loop.
- No Bizar memory/note-vault, wiki, embeddings index, or semantic-search API is restored. Session handoff and workflow state are minimal operational records with retention and size limits.
- OpenKan remains optional and external. Bizar exposes machine-readable status, tasks, agents, sessions, and messages through `bizar control`; it does not add HTTP, WebSocket, or presentation code to the harness.

## Migration and verification plan

1. Lock current routing, permission, installer, task-claim, and session-handoff behavior with regressions.
2. Add the typed mode/state core and atomic transition tests before wiring hooks.
3. Pin Mike to Sol and convert the agent/model registry to one validated source. Test exact model assignment, override detection, unavailable-model failure, and frozen per-run routing.
4. Add `/autopilot`, `/cancel`, QA, verification, and consensus-plan skills plus their project mirrors. Test trigger sanitization and explicit-command precedence.
5. Add portable plugin and hook manifests, common dispatch, Stop/resume/cancel behavior, repeated-failure ceilings, SubagentStop deliverable checks, and installed-path tests.
6. Upgrade the provisioner to versioned XDG assets and atomic activation while retaining the supported project surface and user configuration merge.
7. Run targeted tests first, then `make verify-removed-surfaces`, `make verify-repo-structure`, `make check-arch`, `make test`, `make e2e`, `make clean-check`, `make check`, and `make vcr`.

Primary migration risks are duplicate hook execution when project and plugin surfaces are both enabled, stale or cross-session state, Stop-loop exhaustion, model overrides defeating routing, concurrent edits outside owned paths, installed-cache path mistakes, accidental auto-approval, and scope creep toward the retired memory/UI systems. Tests must exercise each failure mode, not only the happy path.

## Success criteria

F-129 is complete when every primary request enters one Sol Mike orchestrator; workers receive explicit GPT/MiniMax models appropriate to their roles and verified against the configured gateway; `/autopilot` starts, persists, resumes, runs bounded QA and validation, completes, fails safely, and cancels; parallel work has enforceable non-interference boundaries; plugin and project installs execute the same audited hooks; all hard approvals remain intact; no memory, daemon, or embedded web surface returns; and all repository gates pass with fresh evidence.
