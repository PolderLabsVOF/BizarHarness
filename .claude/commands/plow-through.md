---
description: Autonomous mode — work fully independently, make all decisions, complete the task end-to-end without asking the user anything.
---

# Plow Through — Autonomous Mode

You are in `/plow-through` mode. The user has invoked this command to tell you: **work autonomously, don't ask, decide things yourself, complete the task end-to-end.**

## Contract

- **No clarifying questions.** If the request is ambiguous, use the most reasonable interpretation based on project context. If you genuinely cannot proceed without user input (e.g., a destructive action requiring explicit authorization), log the blocker in your final report and continue with everything else.
- **Decide things yourself.** Use your judgment. Read `.bizar/PROJECT.md`, `FINAL_GOAL.md`, `ROADMAP.md`, and search the memory vault (`bizar memory search "<topic>"`) for prior context before deciding.
- **Split into parallel work streams.** Always dispatch 2+ subagents in parallel when the work is decomposable. Each stream must have a disjoint file scope. Use the **Agent tool** to spawn subagents — name them after the Bizar agent they represent (`thor`, `tyr`, `mimir`, `hermod`, etc.) so the audit trail stays readable.
- **Work to completion.** Don't stop at "I did X, should I continue?". The task is complete when: the deliverable exists, tests pass, changes are committed and pushed (where applicable).
- **Report at the end.** Summarize what was done, what tests ran, any blockers encountered.

## Background agents for long-running work

Use the **Agent tool** with `run_in_background: true` (or the
dashboard UI) to spawn background agents for tasks that span more
than a few minutes. Check on them later via the dashboard's
Background Agents panel or by sending a message to the teammate
agent.

## When to use

- Multi-file refactors that don't require user approval
- Bug-fix sweeps across a known surface area
- Implementing a clearly-spec'd feature from the roadmap
- Migration tasks (e.g., "migrate all CSS from @apply to vanilla")
- Cleanup work (rename X, delete dead code Y, etc.)

## When NOT to use

- Anything that touches auth, billing, or destructive operations on user data
- Architectural decisions with multiple valid approaches (use `/plan` first)
- Tasks where you genuinely need user input on a key decision
- Anything where being wrong has high consequences (merges to main, security patches)

## Execution pattern

1. Read project context (`.bizar/PROJECT.md`, `FINAL_GOAL.md`, `ROADMAP.md`)
2. Search memory for prior context (`bizar memory search "<topic>"`)
3. Decompose into independent work streams
4. Dispatch streams via the **Agent tool** in parallel, naming them `thor` and `tyr` (or whichever Bizar agents fit the scope)
5. After streams return: run test gate (`bizar test-gate` or `/test`)
6. Fix any test failures
7. Update self-improvement log (`.bizar/AGENTS_SELF_IMPROVEMENT.md`)
8. Commit + push (delegate to the `hermod` subagent)
9. Report final outcome