# Claude Code hooks

All hooks read Claude Code JSON from stdin and emit either no decision, additional context, `deny`, or `ask` using the current event contract.

| Hook | Event | Purpose |
| --- | --- | --- |
| `pretooluse-bash.mjs` | PreToolUse Bash | deny/escalate dangerous shell commands; safe calls defer to permissions |
| `pretooluse-editwrite.mjs` | PreToolUse Write/Edit/MultiEdit | protect secrets and package-managed paths |
| `git-workflow-guard.mjs` | PreToolUse Bash | Git policy, publication approvals, and visual evidence |
| `content-style-guard.mjs` | PreToolUse writes/Bash | human-facing prose quality |
| `simplify-guard.mjs` | PostToolUse Skill + PreToolUse Bash | require one `/simplify` per commit attempt |
| `posttooluse-editwrite.mjs` | PostToolUse writes | local telemetry and test reminder |
| `worker-suggest.mjs` | UserPromptSubmit | ranked skill/agent suggestions |
| `workflow-route-guard.mjs` | UserPromptSubmit, PreToolUse, PostToolUse | requires a proven successful native workflow before substantive primary mutation; permits narrowly whitelisted, redirect-free Git inspection |
| `thinking-route.mjs` | UserPromptSubmit | slash and mental-model routing |
| `telemetry.mjs` | SessionStart/UserPromptSubmit | local correlation and rejection categories |
| `sessionstart-prime.mjs` | SessionStart | bounded project and handoff context |
| `sessionend-recall.mjs` | SessionEnd | bounded session record and handoff |
| `telemetry.mjs` | lifecycle/prompt events | fingerprint-only bounded correlation evidence |
| `precompact-priorities.sh` | PreCompact | atomically checkpoint bounded state and preserve questions, causes, exact evidence, decisions, and approvals |
| `advisor-context.mjs` | SubagentStart | bounded parent transcript for reviewers/debuggers |

Project hook commands use `$CLAUDE_PROJECT_DIR`. `cli/provision.mjs` writes user-level settings with absolute paths under `~/.claude/hooks`, so the same scripts work outside this checkout.

PreToolUse precedence is intentional: `deny` overrides `ask`, and both override a safe no-decision result. No safe-path hook returns `allow`, because that could suppress the operator's normal permission boundary.
