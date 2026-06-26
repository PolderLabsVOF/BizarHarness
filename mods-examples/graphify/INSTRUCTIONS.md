---
name: graphify-instructions
description: Always-on rules installed by the Graphify mod. When the graph view is in use, prefer the project knowledge graph (`.bizar/graph/`) over grepping the source tree for cross-module questions.
---

# Graphify — Installed Instructions

These rules apply whenever the **graphify** mod is enabled. The graph lives at `.bizar/graph/` in the project root.

## When to Use the Graph

**Use `bizar graph query`, `path`, or `explain`** for:

- "What calls function X?"
- "What depends on module Y?"
- "What's the shortest path from A to B in the code?"
- "What would break if I changed Z?"
- Any cross-module question where grep would give you 30 results and you'd have to read 30 files.

**Use `semble search` or `grep` for:**

- "Find the line that defines function X" (single-file lookup).
- "Does the string `TODO` appear anywhere?"
- Any single-file, single-symbol lookup where the graph is overkill.

## Rules by Agent

### @mimir (research)
- Before deep-diving into a question with 20+ tool calls, check `bizar graph query "<concept>"` first. The graph often points you at the right file in 1-2 calls instead of 10-20.
- If the graph is stale (last `bizar graph update` was >24h ago, or major files were edited since), run `bizar graph update` before relying on it.

### @thor (medium-complexity implementation)
- Before changing a function's signature, run `bizar graph explain "<function>"` to see what calls it. If 5+ files call it, the change is not local — re-plan.
- Before deleting a file, run `bizar graph explain "<file>"` to see what depends on it.

### @tyr (complex implementation)
- Default to graph-first exploration. Grep is the fallback when the graph doesn't have the concept you're looking for (rare for well-indexed projects).

### @frigg (read-only Q&A)
- For "how does X work" questions that span modules, query the graph first. You can answer in 2-3 sentences instead of reading 10 files.

### @odin (router)
- When dispatching cross-module research or refactors, mention in the prompt: "Graphify is enabled — query `.bizar/graph/` for cross-module context."

## Build Triggers

The graph is rebuilt (or incrementally updated) when:

- `bizar graph build` — full rebuild. Run once after a major refactor or initial setup.
- `bizar graph update` — incremental rebuild. Fast (5-30s), safe to run before each session.
- The mod's `autoBuildOnOpen` config option is `true` — the dashboard runs `bizar graph update` when opened.

If the graph is missing or empty, run `bizar graph build` before relying on it. The first build can be slow on large projects (1-10 min).

## Conflict Resolution

If the graph and grep disagree, the graph is more likely to be stale (it was built from a snapshot). grep sees the current truth. When they conflict, trust grep — but file a note to rebuild the graph: "Graph showed X, grep showed Y — rebuilt via `bizar graph update`."

## Caching and Performance

- The graph cache is at `.bizar/graph/cache/`. Safe to delete to force a rebuild.
- The interpreter path (Python with graphify installed) is gitignored — each machine resolves it locally.
- For air-gapped or offline use, the graph builder can fall back to a code-only AST build (no LLM required). This is the default and works without any API keys.
