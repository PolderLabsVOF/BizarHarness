# Hook System

BizarHarness uses **behavioral hooks** — agent-level instructions that simulate hook behavior. Since opencode doesn't have a native hook runtime, all hooks are implemented as agent behavioral patterns.

## Available Hooks

| Hook | Type | Trigger | Behavior |
|------|------|---------|----------|
| `pre-tool-use` | Behavioral | Before any edit/write | Check for secrets, verify permissions |
| `post-tool-use` | Behavioral | After any edit/write | Auto-lint, auto-format, auto-test |
| `session-start` | Behavioral | On session start | Read .bizar/, Hindsight recall, stack detection |
| `session-end` | Behavioral | On task completion | Append to AGENTS_SELF_IMPROVEMENT.md |
| `pre-commit` | Behavioral | Before git commit | Check for console.log, .env leaks, lint |
| `post-implement` | Behavioral | After parallel implementation | Run test gate, verify both agents' outputs |

## How It Works

Each hook is enforced by agent instructions in the agent `.md` files:

- **Pre-tool-use**: All implementation agents check for exposed secrets before any `write` or `edit` call
- **Post-tool-use**: After file modifications, agents auto-run the linter and formatter
- **Session-start**: Odin reads `.bizar/PROJECT.md` and Hindsight; Heimdall runs `bizarharness init` if missing
- **Session-end**: Odin dispatches Heimdall to auto-extract self-improvement entries
- **Pre-commit**: Hermod checks for console.log and .env before allowing git commits
- **Post-implement**: After Thor+Tyr complete, Odin routes to Thor for test gate

## Customization

To disable a hook, remove its instruction from the relevant agent `.md` file(s) in `~/.config/opencode/agents/`.
