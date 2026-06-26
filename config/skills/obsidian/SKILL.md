---
name: obsidian
description: Use the project's Obsidian vault (`.obsidian/`) for persistent project knowledge. Read it before decisions, write to it after work. Every Bizar agent follows this rule.
version: 1
---

# Obsidian Vault — Project Knowledge

**Project knowledge lives in `.obsidian/`. Read it before you start, write to it when you learn.**

Every Bizar project has an Obsidian vault at `.obsidian/` with index files (`index/`), agent-specific memory (`agents/`), bug postmortems (`bugs/`), design decisions, and ongoing work notes. The user has been working on this project — their notes contain the real context, the gotchas, the failed approaches, the preferred patterns. **Read the relevant vault entries before making any non-trivial decision.**

## When to read

- At the start of every session (skim the index)
- Before any non-trivial implementation decision
- When you're about to suggest something the user has already tried
- When the codebase feels like it's working around something you don't understand
- When you encounter a `// FIXME` or `// HACK` comment — there's probably a vault entry explaining it

## When to write

- After completing a meaningful piece of work
- On discovering a bug or postmortem
- When you find a pattern that should be reused
- When the user corrects you
- When you make a design decision that should be remembered

## What to write

Date-stamped entry under the appropriate category:

- `index/` — high-level project context, decisions, handoffs
- `bugs/` — bug postmortems, root-cause analyses
- `agents/<name>/` — per-agent memory (what you learned, what to do differently)
- `reference/` — external API docs, tool notes
- `workflows/` — multi-step procedures
- `daily/` — running log of what happened today

Each entry:

```markdown
---
title: "What happened"
date: 2026-06-26
tags: [tag1, tag2]
---

# Title

## Context
What was happening. What was the user trying to do.

## Lesson
What you learned. Why it matters.

## Pattern
What to do next time. Code examples welcome.

## Files changed
- path/to/file.ts (added, modified, removed)
```

Link to related entries with `[[wikilinks]]`.

## What NOT to write

- Secrets, API keys, tokens (use `auth.json`)
- Temporary scratch (use a TODO comment in code)
- Anything already obvious from reading the code
- Long code dumps (link to file with `path:line`)

## How to use the vault

### Via Obsidian CLI (preferred)

```bash
obsidian search "<query>"          # full-text search
obsidian read "<path>"             # read a file
obsidian create "<path>" "<content>"  # create a file
obsidian append "<path>" "<content>"  # append to a file
obsidian daily "<content>"          # append to today's daily note
obsidian tasks                     # list open tasks
obsidian backlinks "<path>"         # find what links to this file
```

### Via MCP server (if available)

The `obsidian` MCP server exposes tools like `obsidian_search`, `obsidian_read_file`, `obsidian_create_file`, `obsidian_append_content`, `obsidian_list_directory`, `obsidian_dataview_query`. Use whichever interface is available.

## The O in Odin

Odin always updates the vault after significant work, regardless of who did the work. The other agents read; Odin writes. This is a hard rule — if Odin completes a task without leaving a vault trace, that task isn't really done.

## See also

- [[AGENTS_SELF_IMPROVEMENT]] — project-specific lessons in `.bizar/AGENTS_SELF_IMPROVEMENT.md`
- [[Architecture]] — system structure (in `index/`)
- [[Dashboard]] — dashboard conventions
- [[Patterns]] — code patterns
- [[Tools]] — tool documentation
