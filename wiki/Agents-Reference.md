# Agents Reference

This page documents every agent in the BizarHarness pantheon. Each agent is a single Markdown file in `config/agents/`, with YAML frontmatter (name, model) and a Markdown body that defines its role, routing rules, and tool surface.

## The pantheon at a glance

| Agent | Rune | Model | Tier | Cost | Role |
|---|---|---|---|---|---|
| **Odin** | ᛟ | MiniMax M3 | 2 (mid) | $0.30/$1.20 per M in/out | Primary router — never executes, only delegates |
| **Frigg** | ᚠ | DeepSeek V4 Flash | 0 (free) | Free | Read-only Q&A — answers with file references, never modifies |
| **Vör** | ᛢ | DeepSeek V4 Flash | 0 (free) | Free | Clarifier — asks project-specific questions if ambiguous |
| **Quick** | ᛟ | DeepSeek V4 Flash | 0 (free) | Free | Single-shot fast path — no decomposition |
| **Mimir** | ᛗ | DeepSeek V4 Flash | 0 (free) | Free | Codebase research — Semble-first exploration |
| **Heimdall** | ᚹ | DeepSeek V4 Flash | 0 (free) | Free | File ops, mechanical edits, quick changes |
| **Hermod** | ᚱ | MiniMax M2.7 | 1 (low) | $0.30/$1.20 per M in/out | Git and GitHub operations |
| **Thor** | ᚦ | MiniMax M2.7 | 1 (low) | $0.30/$1.20 per M in/out | Moderate implementation, debugging, refactoring |
| **Baldr** | ᛒ | MiniMax M2.7 | 1 (low) | $0.30/$1.20 per M in/out | Design systems, visual audits, usability plans |
| **Tyr** | ᛏ | MiniMax M3 | 2 (mid) | $0.30/$1.20 per M in/out | Complex implementation, architecture, deep debugging |
| **Vidarr** | ᛉ | GPT-5.5 | 4 (last) | OpenAI subscription | Last-resort fallback when all else fails |
| **Forseti** | ᚨ | MiniMax M3 | 3 (auditor) | $0.30/$1.20 per M in/out | Adversarial plan review, edit-deny |

## Odin (orchestrator)

- **Rune:** ᛟ
- **Model:** `minimax/MiniMax-M3`
- **Cost:** $0.30/M input, $1.20/M output
- **Role:** Primary router. The default agent. Decomposes every request into parallel work streams and dispatches to subagents. **Never executes work itself.**
- **Tools:** `task`, `todowrite`, Hindsight MCP tools, Semble MCP tools. No `bash`, `glob`, `grep`, `edit`, `write`, or `question`.
- **When to use:** Any non-trivial request that isn't a single-shot question. The default for all free-form prompts.
- **Example:** `@odin implement the /api/export endpoint with tests`
- **Routing rule:** Always parallel. Fires 2+ `task` calls in a single message. Gates Tier 4/5 work via Forseti.

## Frigg (ask)

- **Rune:** ᚠ
- **Model:** `opencode/deepseek-v4-flash-free`
- **Cost:** Free
- **Role:** Read-only Q&A. Answers questions about the project with file references. Never modifies any files.
- **Tools:** `read`, `glob`, `grep`, Hindsight MCP tools, Semble MCP tools. No `edit`, `write`, or `bash`.
- **When to use:** "What does this project do?", "Where is X handled?", "How does Y work?"
- **Example:** `@frigg what does this project do`
- **Routing rule:** Direct invocation. No decomposition. Single-shot.

## Vör (clarify)

- **Rune:** ᛢ
- **Model:** `opencode/deepseek-v4-flash-free`
- **Cost:** Free
- **Role:** Clarifies ambiguous or incomplete requests. Uses a **research-first protocol** — reads `.bizar/PROJECT.md` and the project's Hindsight bank before asking any questions. Asks only when research has been exhausted, and questions must reference actual project files, frameworks, or patterns.
- **Tools:** `read`, `glob`, `grep`, Hindsight MCP tools, Semble MCP tools, `question`. No `edit`, `write`, or `bash`.
- **When to use:** Open-ended requests that lack a clear target. Routes for you once the request is well-defined.
- **Example:** `@vör build me a thing` (Vör will ask what the thing is)
- **Routing rule:** Odin cannot ask questions. Ambiguous requests are routed here.

## Quick (quick)

- **Rune:** ᛟ
- **Model:** `opencode/deepseek-v4-flash-free`
- **Cost:** Free
- **Role:** Single-shot fast path. Skips decomposition and delegation. Good for trivial asks that don't need parallel work.
- **Tools:** Full read/write tool surface, including `bash`, `edit`, `write`.
- **When to use:** One-line changes, single-file edits, "what's the answer to this specific question." Faster than Odin for tasks you know don't need decomposition.
- **Example:** `@quick delete the unused import in src/main.ts`
- **Routing rule:** Direct invocation. Does not dispatch to subagents.

## Mimir (research)

- **Rune:** ᛗ
- **Model:** `opencode/deepseek-v4-flash-free`
- **Cost:** Free
- **Role:** Deep codebase research. Uses Semble as its primary search tool and falls back to `grep` only when Semble is unavailable. Produces structured findings with file:line references.
- **Tools:** `read`, `glob`, `grep`, Semble MCP tools, Hindsight MCP tools. No `edit` or `write`.
- **When to use:** "Research how X is implemented", "find every place that touches Y", "compare the auth flow across versions."
- **Example:** `@mimir research how authentication flows through the request lifecycle`
- **Routing rule:** Direct invocation or dispatched by Odin for the research leg of a larger task.

## Heimdall (simple)

- **Rune:** ᚹ
- **Model:** `opencode/deepseek-v4-flash-free`
- **Cost:** Free
- **Role:** File operations, mechanical edits, quick changes. The "do the boring thing fast" agent.
- **Tools:** Full read/write tool surface.
- **When to use:** Renames, formatting fixes, simple CRUD, generating boilerplate, single-file edits.
- **Example:** `@heimdall rename getUserById to findUserById across the repo`
- **Routing rule:** Direct invocation or dispatched by Odin for mechanical work.

## Hermod (git)

- **Rune:** ᚱ
- **Model:** `minimax/MiniMax-M2.7`
- **Cost:** $0.30/M input, $1.20/M output
- **Role:** Git and GitHub operations. Commits, pushes, merges, rebase, branch management, pull requests, GitHub issue and release management.
- **Tools:** `bash`, `read`, `glob`, `grep`, `gh` CLI. No `edit` or `write` (modifies the working tree via git, not via direct file writes).
- **When to use:** Any git operation. Any GitHub API call (issues, PRs, releases, labels).
- **Example:** `@hermod commit the staged changes with a conventional commit message`
- **Routing rule:** Direct invocation or dispatched by Odin. PR review uses `/pr-review` mode with Mimir (research) and Forseti (audit).

## Thor (medium)

- **Rune:** ᚦ
- **Model:** `minimax/MiniMax-M2.7`
- **Cost:** $0.30/M input, $1.20/M output
- **Role:** Moderate-complexity implementation. Features that span a few files, debugging tasks, code review, refactoring of contained scopes.
- **Tools:** Full read/write tool surface plus all MCP tools.
- **When to use:** "Add a /healthz endpoint", "fix the bug in the rate limiter", "extract the validation logic into a separate module."
- **Example:** `@thor add a /healthz endpoint that returns 200 OK`
- **Routing rule:** Direct invocation or dispatched by Odin. Always run in parallel with Tyr on Tier 4 work.

## Baldr (design)

- **Rune:** ᛒ
- **Model:** `minimax/MiniMax-M2.7`
- **Cost:** $0.30/M input, $1.20/M output
- **Role:** Design system creation, DESIGN.md authoring, visual audits, usability planning. **Plans only — does not implement.** A Baldr plan is the design contract; Thor or Tyr executes it later.
- **Tools:** `read`, `glob`, `grep`, `write` (to DESIGN.md and design files), MCP tools. Limited `bash`.
- **When to use:** "Build out a design system for the marketing site", "audit the visual consistency of the dashboard", "plan the color tokens for dark mode."
- **Example:** `@baldr plan a DESIGN.md for the marketing site`
- **Routing rule:** Direct invocation. The plan is handed off to Thor or Tyr for execution.

## Tyr (complex)

- **Rune:** ᛏ
- **Model:** `minimax/MiniMax-M3`
- **Cost:** $0.30/M input, $1.20/M output
- **Role:** Highest-complexity implementation. Architecture decisions, cross-cutting refactors, deep debugging, multi-step engineering. Always run in parallel with Thor on Tier 4 work.
- **Tools:** Full read/write tool surface plus all MCP tools.
- **When to use:** "Refactor the auth system to use a session token", "design the migration plan for the schema change", "trace the source of the memory leak."
- **Example:** `@tyr plan the migration from REST to tRPC`
- **Routing rule:** Direct invocation or dispatched by Odin for complex legs. **Always gated by Forseti** before execution.

## Vidarr (last)

- **Rune:** ᛉ
- **Model:** `openai/gpt-5.5`
- **Cost:** OpenAI ChatGPT subscription
- **Role:** Last-resort fallback. Invoked when Tyr stalls, debugging is stuck, or the problem is genuinely novel and the opencode model tiers have all failed. **Default disabled** — must be explicitly enabled in `opencode.json`.
- **Tools:** Full read/write tool surface.
- **When to use:** When nothing else has worked. Postmortem of failed attempts. Novel problem domains.
- **Example:** `@vidarr figure out why the binary segfaults under load`
- **Routing rule:** Direct invocation or dispatched by Odin. **Always gated by Forseti** before execution.

## Forseti (audit)

- **Rune:** ᚨ
- **Model:** `minimax/MiniMax-M3`
- **Cost:** $0.30/M input, $1.20/M output
- **Role:** Adversarial plan reviewer. Audits completeness, correctness, consistency, feasibility, and security of plans from Tyr and Vidarr. **Edit permission: denied** — runs in audit-only mode.
- **Tools:** `read`, `glob`, `grep`, MCP tools. No `edit`, `write`, or `bash`.
- **When to use:** Never invoked directly. Auto-runs before any Tier 4 or Tier 5 implementation. Also runs `bizarharness audit` for a security review of agent config.
- **Example:** Not directly invokable by users; auto-triggered by Odin.
- **Routing rule:** Auto-dispatched by Odin for plans involving Tyr or Vidarr. Returns approve, request-changes, or reject.

## Permissions summary

| Agent | Read | Write | Bash | Edit | Question | Task (dispatch) |
|---|---|---|---|---|---|---|
| Odin | yes | no | no | no | no | yes |
| Frigg | yes | no | no | no | no | no |
| Vör | yes | no | no | no | yes | no |
| Quick | yes | yes | yes | yes | no | no |
| Mimir | yes | no | no | no | no | no |
| Heimdall | yes | yes | yes | yes | no | no |
| Hermod | yes | no | yes | no | no | no |
| Thor | yes | yes | yes | yes | no | no |
| Baldr | yes | yes | limited | yes | no | no |
| Tyr | yes | yes | yes | yes | no | no |
| Vidarr | yes | yes | yes | yes | no | no |
| Forseti | yes | no | no | no | no | no |

Odin and Forseti are the only agents with the `task` tool (dispatch). All other agents are leaf nodes — they execute the work they're given and return. Vör is the only agent with the `question` tool — it's the system's only way to ask the user.

## Next steps

Next: [Model Routing](Model-Routing) — the 5-tier model architecture, per-agent configuration, and how to override models per task.
