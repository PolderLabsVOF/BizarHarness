# Claude Code hooks

All hooks read Claude Code JSON from stdin and emit either no decision, additional context, `deny`, or `ask` using the current event contract.

## Static alias architecture

Bizar dispatches through **four native Claude Code aliases**: `haiku`, `sonnet`, `opus`, `fable`. The harness picks the alias; OmniRoute handles ordered failover between configured full IDs for that alias. Hooks must not load profile/health/budget/tier/registry state, must not construct `args.routing`, and must not pass raw gateway IDs. There is no model picker hook, no model sync hook, and no model-router gate: agent definitions, workflow scripts, and the team orchestrator name one of the four aliases and let OmniRoute translate.

| Hook | Event | Purpose |
| --- | --- | --- |
| `pretooluse-bash.mjs` | PreToolUse Bash | deny/escalate dangerous shell commands; safe calls defer to permissions |
| `pretooluse-editwrite.mjs` | PreToolUse Write/Edit/MultiEdit | protect secrets and package-managed paths |
| `git-workflow-guard.mjs` | PreToolUse Bash | Git policy, publication approvals, and visual evidence |
| `content-style-guard.mjs` | PreToolUse writes/Bash | human-facing prose quality |
| `simplify-guard.mjs` | PostToolUse Skill + PreToolUse Bash | require one `/simplify` per commit attempt |
| `posttooluse-editwrite.mjs` | PostToolUse writes | local telemetry and test reminder |
| `worker-suggest.mjs` | UserPromptSubmit | ranked skill/agent suggestions; routes to `haiku`/`sonnet`/`opus`/`fable` per alias policy |
| `workflow-route-guard.mjs` | UserPromptSubmit, PreToolUse, PostToolUse | records adaptive Bizar routing state without blocking Mike's selected coordination mode; workflow success clears the pending route record |
| `telemetry.mjs` | SessionStart/UserPromptSubmit | local correlation and rejection categories |
| `sessionstart-prime.mjs` | SessionStart | bounded project and handoff context |
| `sessionend-recall.mjs` | SessionEnd | bounded session record and handoff |
| `telemetry.mjs` | lifecycle/prompt events | fingerprint-only bounded correlation evidence |
| `precompact-priorities.sh` | PreCompact | atomically checkpoint bounded state and preserve questions, causes, exact evidence, decisions, and approvals |
| `advisor-context.mjs` | SubagentStart | bounded parent transcript for reviewers/debuggers |

Project hook commands use `$CLAUDE_PROJECT_DIR`. `cli/provision.mjs` writes user-level settings with absolute paths under `~/.claude/hooks`, so the same scripts work outside this checkout.

PreToolUse precedence is intentional: `deny` overrides `ask`, and both override a safe no-decision result. No safe-path hook returns `allow`, because that could suppress the operator's normal permission boundary.

## Removed surfaces (model-router/picker cutover)

The following hooks are gone as part of the static-alias migration:

- `agent-model-guard.mjs` — the picker/policy gate. The harness no longer reads `model-router.json#userSelected` or `disabledProviders`; agents pick one of the four native aliases and OmniRoute handles failover.
- `sessionstart-model-sync.mjs` — the picker reapply. `modelPicker`/`modelOverrides` are no longer written into `~/.claude/settings.json` because there is no picker to keep alive between sessions.
- `thinking-route.mjs` — a hint hook for the now-defunct `thinking-model-router` workflow skill. The thinking-skills catalog itself is unchanged (it is a framework, not a routing dep).
- `workflow-route-guard.mjs` is **kept** because it tracks workflow coordination state (not model routing).
