---
name: self-improvement
description: Use when setting up, configuring, or debugging the project-level self-improvement system. Every task records lessons learned to .bizar/AGENTS_SELF_IMPROVEMENT.md for agent behavior improvement across sessions. Triggers when appending/updating self-improvement entries or reading active rules.
---

# Self Improvement

Project-level learning system. Every task records what worked, what didn't, and what patterns to follow next time — stored in `.bizar/AGENTS_SELF_IMPROVEMENT.md` at the project root.

## How It Works

1. **Session start**: Odin reads `.bizar/AGENTS_SELF_IMPROVEMENT.md` from project root and factors active rules into routing
2. **During work**: Agents follow documented patterns and avoid previously-caught mistakes
3. **Task completion**: Odin dispatches @heimdall to append a structured entry to the file
4. **Next session**: The cycle repeats — agents get smarter over time

## File Format

The file lives at `<project-root>/.bizar/AGENTS_SELF_IMPROVEMENT.md`. Structure:

```markdown
# Self Improvement

## Active Rules
<!-- Keep top 5-10 actionable patterns here. Extract from recent entries. -->

## Log

### 2026-06-16: Brief descriptive title
- **Context**: What was the task
- **Lesson**: What we learned
- **Pattern**: What to do next time
- **Files**: src/foo.ts, src/bar.ts
- **Agent**: thor, tyr
```

## Entry Rules for Agents

When writing an entry:

- **File per project** — `.bizar/AGENTS_SELF_IMPROVEMENT.md` at the root of whatever project you're working in
- **If file doesn't exist**, create it with the header template
- **Entry format**: H3 date header, bullet list with Context, Lesson, Pattern, Files, Agent
- **Active Rules**: At the top, keep 5-10 distilled patterns from recent entries. If adding a new entry makes it necessary, add a rule too or promote a pattern from an entry.
- **Deduplicate**: Don't repeat the same lesson. If the same lesson comes up again, update the existing entry's date instead.
- **Be specific**: "Always use strictNullChecks" not "TypeScript is good"
- **Agent tag**: Use the subagent name (thor, tyr, heimdall, mimir, etc.)

## Setup

For a new project where no such file exists yet, create the initial file:

```
# Self Improvement

Template for project-specific agent learning. Entries are auto-appended by Odin
at task completion and read at session start.

## Active Rules

<!-- Top 5-10 actionable patterns extracted from recent entries -->

## Log
```
