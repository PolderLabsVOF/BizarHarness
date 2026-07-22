---
description: Route to @susan for read-only codebase Q&A. She will explore the code and answer without making any changes.
---

# /explain — Read-Only Codebase Q&A

The user is asking a question about the codebase. Use the **Agent tool** to dispatch to a read-only research subagent — name it `susan` if that agent exists, otherwise use the `general-purpose` or `Explore` subagent type with explicit read-only instructions.

The subagent must:
1. Use only read tools (`Read`, `Grep`, `Glob`, `Bash` with read-only commands)
2. Never edit, write, or modify any file
3. Explore the codebase to find the answer
4. Return a concise, cited answer with file:line references

If the user supplied an argument via `$ARGUMENTS`, treat that as the question. If `$ARGUMENTS` is empty, ask one clarifying question before dispatching.

Pass `$ARGUMENTS` (or the refined question) to the subagent's prompt verbatim. Do not include any write or destructive tool in the subagent's allowed list.