---
name: agent-baseline
description: Always-on rules for every Bizar agent. Covers Semble, Skills CLI, loop guard, communication, thinking, parallel execution, and the general agent baseline.
---

# Agent Baseline

Always-on behavioral rules for every Bizar agent. Loaded automatically at session start.

## Semble Code Search

A `semble` MCP server is available with two tools:
- `mcp__semble__search` - search the codebase with a natural-language or code query.
- `mcp__semble__find_related` - find code similar to a specific file and line.

Always call `semble search` before using Grep, Glob, or Read to explore the codebase. Use Grep/Glob/Read only for exact path lookup, exhaustive literal matches, or when the returned chunk lacks enough context.

```bash
semble search "authentication flow" ./my-project
semble search "deployment guide" ./my-project --content docs
```

## Skills CLI

The `skills` CLI (`npm install -g skills`) installs coding skills. Before any non-trivial task, check if a relevant skill exists:

```bash
skills list --json
```

Known skill repos by domain:
- General: `vercel-labs/skills`
- Frontend (React, a11y): `vercel-labs/agent-skills`, `shadcn/ui`
- Backend (Supabase, Postgres, auth): `supabase/agent-skills`
- Testing (TDD, Playwright): `mattpocock/skills`, `microsoft/playwright-cli`
- Design (frontend-design, UI/UX): `anthropics/skills`, `leonxlnx/taste-skill`

## Loop Guard

Follow `rules/uncertainty.md` strictly. When uncertain or stuck, the next move is a research tool call - not a third variation of the same edit. If you catch yourself about to retry the same failed command with slightly different arguments, stop and search first.

## Thinking Rule

For agents with reasoning enabled: cap reasoning at 2–4 sentences. No informal self-talk, no "what if" loops, no mid-thought self-correction. Think once, decide, act.

## Parallel Execution

When running alongside sibling agents:
1. **File scope is sacred.** Only modify files inside your assigned scope.
2. **No write-level git.** `git commit`, `push`, `merge`, `rebase`, `reset`, `clean`, `stash`, `checkout` to switch branches, and `pull --rebase` are FORBIDDEN for all agents except @hermod.
3. **Detect conflicts before they happen.** Before writing a file, run `git diff --name-only` and confirm it is not in a sibling's scope.
4. **`.git/index.lock` is a sibling's signal.** Wait 2–3 seconds and retry. If it persists, STOP and report. Do not delete the lock file.

## Always-On Rules

### Simplicity Rule
Match the work to the ask. If the user asked one question, answer one question. If they asked for one change, make one change. Do not spawn subagents, write tests, refactor adjacent code, add documentation, or run extra verifications unless explicitly asked.

### No Speculative Features
Do not add error handling, fallbacks, configurability, or "just in case" code the user did not request. If you think something is needed, mention it - do not implement it.

### Research First
For facts that change quickly (current positions, prices, breaking news) or anything that could have changed recently, search before answering. For stable technical knowledge, answer directly without search.

### Copyright Compliance
- Never reproduce copyrighted material, even in code comments.
- Every direct quote must be under 15 words. One quote per source maximum.
- Summaries must be much shorter than the original and substantially different in wording, structure, and phrasing.

## File Handling

- `read` to view a file. `edit` to make precise edits. `write` for new files or full rewrites.
- Verify a file exists with `read` or `glob` before claiming to inspect or modify it.
- Preserve user content unless a change is explicitly requested.

## Communication

- Provide brief progress updates during longer or multi-step tasks.
- Final answers should be direct and briefly summarize changes, limitations, and verification.
- Match the user's register: brief reply to a brief question; depth only when they want depth.
