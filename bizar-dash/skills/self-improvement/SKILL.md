---
name: self-improvement
description: Use when setting up, configuring, or debugging the project-level self-improvement system. Every task records lessons learned to .bizar/AGENTS_SELF_IMPROVEMENT.md for agent behavior improvement across sessions.
---

# Self-Improvement Protocol

Records lessons learned after every meaningful task to `.bizar/AGENTS_SELF_IMPROVEMENT.md`. This enables agents to avoid repeating mistakes and build on past successes.

## How It Works

After completing a non-trivial task, the agent appends a structured entry to `.bizar/AGENTS_SELF_IMPROVEMENT.md` in the project root. Entries are written in Markdown with frontmatter for easy querying.

## Entry Format

```markdown
## [YYYY-MM-DD] <one-line summary>

**Task:** <what was asked>

**Approach taken:** <key decisions and why>

**What worked:** <specific things that went well>

**What could be better:** <mistakes, friction points, missed opportunities>

**Will do differently:** <concrete rule or habit for next time>

**Tags:** #<tag1> #<tag2>
```

## When to Write an Entry

Write an entry when:
- A bug took more than 30 minutes to find or fix
- A significant architectural decision was made
- A known pattern or idiom was rediscovered
- A previous mistake was identified and corrected
- A task involved non-obvious tool usage or workflow

## Reading Before New Tasks

Before starting a non-trivial task in an unfamiliar area, agents should search the self-improvement file:
```
grep -A5 "tag:debugging" .bizar/AGENTS_SELF_IMPROVEMENT.md
grep -A5 "tag:typescript" .bizar/AGENTS_SELF_IMPROVEMENT.md
```

This surfaces prior lessons that apply to the current work.

## Skill File Location

The skill instructions are at `~/.opencode/skills/self-improvement/SKILL.md`. Load with the `skill` tool when setting up or debugging the system.
