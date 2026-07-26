---
description: Plan work in Bizar. Routes drafting to @paul (cx/gpt-5.6-sol) and adversarial review to @linda. Manages visual plan canvases via the bizar plan MCP tool.
allowed-tools: Read, Write, Bash, WebFetch, Agent
---

# /plan — Plan work in Bizar

Two surfaces:

1. **Fresh plan / "design the approach"** — delegates to the `@paul` agent (premium tier, `cx/gpt-5.6-sol`) for the 6-phase plan, then to `@linda` for adversarial review before implementation.
2. **Visual plan canvas CRUD** — direct calls to the `bizar plan` MCP tool. Slugs live as collaborative canvases for structuring work across agents.

## Surface 1 — Plan drafting (DEFAULT for /plan with no args)

```
/plan                → invoke @paul, then @linda review
/plan draft <topic>  → invoke @paul only (skip review; user wants the draft)
/plan review <slug>  → invoke @linda on an existing plan slug
```

When `/plan` is called with no arguments:

1. Read the user's last message / request from context. If ambiguous, route to `@janet` for one clarifying question before drafting.
2. Spawn `@paul` (Agent tool, `subagent_type: paul`) with: the user's request, the project line from the briefing, and the rule that Paul produces the 6-phase plan format (Context → Goal → Plan → Files → DoD → Stop).
3. When Paul returns, spawn `@linda` (Agent tool, `subagent_type: linda`) with Paul's plan + the request + the rule "approve, demand changes, or reject based on completeness / correctness / consistency / feasibility / security".
4. If `APPROVED`: surface the plan to the user. They can `/sprint <feature-id>` to commit it or run `@mike` to dispatch implementation.
5. If `CHANGES REQUIRED`: send the corrections back to `@paul` and re-verify. Do NOT proceed to implementation with an unapproved plan.
6. If `REJECTED`: redesign from scratch via `@paul`. Do not argue.

Skip `@linda` for trivial single-file plans where the cost of review exceeds the cost of failure.

## Surface 2 — Visual plan canvas (slug-based MCP tool calls)

These map directly to the existing `bizar plan` MCP tool. Use when the user wants to manage an existing canvas, not draft a fresh plan.

```
/plan new <slug> [template]  — Create a new plan with a unique slug
/plan list                   — List all existing plans
/plan open <slug>            — Open a plan (returns the canvas URL)
/plan get <slug>             — Get full plan content as JSON
/plan add <slug> --title "..." — Add a new element to a plan
/plan update <slug> <id> ...  — Update an element's content/title/status
/plan delete <slug> <id>    — Delete an element from a plan
/plan comment <slug> [id] "..." — Add a comment to a plan or element
/plan comments <slug> [id]   — List comments on a plan or element
/plan status <slug> <status> — Set plan status (draft|approved|rejected|in-progress|done)
/plan wait <slug>            — Block until the plan receives feedback
```

## Routing

| User intent | Surface | Sub-agent |
|---|---|---|
| "plan this", "design the approach", no slug | 1 (default) | `@paul` → `@linda` |
| "draft this plan only", "skip review" | 1.draft | `@paul` |
| "review this plan", "audit <slug>" | 1.review | `@linda` |
| slug-based CRUD on a visual plan canvas | 2 | direct MCP calls |

The full arguments are available as `$ARGUMENTS`. Parse them and route to the matching subcommand above.

## Important

- `@paul` does NOT do initial research. If the request requires codebase exploration, route to `@greg` first and feed the research findings into Paul's plan brief.
- `@paul` does NOT implement. The plan is the deliverable. Implementation is `@mike`'s job, who dispatches `@todd` / `@karen` / `@brenda` per the plan.
- `@paul` and `@linda` are premium tier (`cx/gpt-5.6-sol`). Use with intent. Do not invoke them for trivial asks.