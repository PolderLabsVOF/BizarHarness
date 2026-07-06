# BizarHarness Roadmap

**Last updated**: 2026-07-06
**Current version**: v5.0.1
**Reading order**: this file → `FINAL_GOAL.md` (the vision) → `.obsidian/projects/current-state-analysis-2026-07-06.md` (the baseline).

This is the **strategic** roadmap. Bug-fix lists, deployment notes, and per-release changelogs live in `CHANGELOG.md`. The "what works today / what's missing" inventory is in the current-state analysis. This document is about where we are going and how we get there.

---

## 1. TL;DR

- **What Bizar is**: a Norse-pantheon multi-agent platform for opencode. 12 agent definitions, a CLI, a dashboard, a memory service, and an opencode plugin — all in one npm package (`@polderlabs/bizar`).
- **Where it is**: v5.0.1, 566 tests passing, ~25k lines of code, mature CLI/dashboard/plugin subsystems. Solid for one-shot and short-horizon work. **L2 on the autonomy scale** (semi-autonomous, multi-step with checkpoints).
- **Where it's going**: **L4 by v6.x** (autonomous with HITL escalations), **L5 by v7.x** (fully autonomous long-horizon with strategic HITL), plus **Pillar 6: Specialist Research Agents** — a tier of research specialists (Mimir, Veritas, Codex, Praxis) with a dedicated dashboard tab for evidence-based work across all other pillars. See `FINAL_GOAL.md` §2 and `ROADMAP.md` §5.6.
- **Top 3 in flight**: (1) wrapping up the v5.x quality/polish line (issues #1-#8 fixed, MiniMax swap, dashboard layout pass); (2) designing the runtime agent orchestrator (the Tier 1 unlock); (3) growing the self-improvement loop into a measured, automated system.
- **Top 1 needing help**: distributed-systems / agent-runtime engineering. The runtime orchestrator is the bottleneck for everything in Tier 1+. See §9 Contributing.

---

## 2. Current State (v5.x)

Brief. For the full inventory, see `.obsidian/projects/current-state-analysis-2026-07-06.md` — this section is the executive summary.

**Shipped and working** (with file:line refs into the analysis):
- 12 agents defined in `config/agents/` (odin/frigg/vor/mimir/heimdall/hermod/thor/baldr/tyr/vidarr/forseti/quick) — analysis §4
- CLI: 15+ command modules, install/update/dash/service/bg/memory/plan/headroom/doctor/test-gate — analysis §3
- Dashboard server: v1 on `:4097`, v2 on `:4098`, 18 memory endpoints, structured logging, Prometheus `/metrics` — analysis §3
- Dashboard web: 17 views (Overview, Chat, Tasks, Memory, Doctor, …) with auto-save settings, kanban tasks, plan canvas — analysis §3
- Opencode plugin: 7 custom tools, background agent system (stall detection, loop guard, tool-call cap, 8-instance cap), 50% context compaction — analysis §3
- Memory service: 3 vault modes (off/local-only/managed/linked), 11 CLI subcommands, 18 REST endpoints, Obsidian-compatible Markdown, git-backed sync, secret scanning — analysis §3 / §7
- Self-improvement: `.bizar/AGENTS_SELF_IMPROVEMENT.md` (1,139 lines, 15 active rules) — analysis §7
- 566 tests (388 npm + 178 vitest), 0 failing

**The architectural gap** (analysis §12, eight gaps):
1. No runtime agent orchestrator — agents are prompts, not services.
2. No true parallel execution — `task` calls are sequential.
3. No long-horizon infrastructure — tasks timeout at 5-30 min, no checkpoint/resume, no session persistence.
4. No automated self-improvement loop — manual log, not a learning system.
5. No real HITL — plan approval is 2s polling, no in-chat, no interrupt.
6. No cross-session memory — memory is passive, not auto-injected.
7. No task planning / decomposition — decomposition is LLM-driven, no DAGs.
8. No cost enforcement — cost tiers are labels, not budgets.

These eight gaps define Tier 1 and Tier 2 of the roadmap below. Every other improvement ladders up to one of them.

---

## 3. Vision & Strategy

**The Final Goal** (verbatim from `FINAL_GOAL.md`):

> Bizar is a fully autonomous AI agent development platform for long-running, long-horizon tasks with human-in-the-loop elements.

The vision decomposes into **five pillars**:

1. **Loops** — agents that run iteratively (recurring, refinement, exploration).
2. **Multi-Agent Validation** — multiple agents independently work the same problem; consensus drives action.
3. **Agent Hierarchy** — structured delegation: Odin (strategic) → Tyr (architectural) → Thor (modular) → Heimdall (mechanical), with Hermod handling gitops and Forseti auditing.
4. **Agent Council** — N-agent vote for high-stakes decisions; size and rule vary by action class.
5. **Constant Self-Improvement** — closed-loop: outcomes → patterns → rules → applied rules → better outcomes.

Read `FINAL_GOAL.md` for the full treatment. The rest of this document is the execution plan.

**Strategy principles** (every tier in §4 is checked against these):

- **Long-horizon first.** The 5-minute task is already solved. Optimize for the 5-hour and 5-day tasks.
- **HITL as a primitive, not an afterthought.** Every autonomous capability must declare its HITL posture (strategic / blocking / observational / background).
- **Ladder up.** A feature either advances a pillar or it doesn't ship. We are ruthless about cutting what doesn't.
- **Ship the foundation, then the intelligence.** A runtime orchestrator without smart agents is a scaffold. Smart agents without a runtime is a demo. Build the runtime first (Tier 1-2), then the intelligence (Tier 3).

---

## 4. Roadmap Tiers

Organized by horizon: Now (Tier 0), Next (Tiers 1-2), Later (Tier 3), Future (Tier 4).

### Tier 0 — Now (v5.x in flight)

**Goal**: finish what's started. Polish, fix, and stabilize the v5.x line. No new architectural work.

**In flight** (active, targeted for v5.0.2 / v5.1):

- **Issues #1-#8** (`issues.md`) — all just shipped in v5.0.1 and v5.0.2 prep:
  - Settings sidebar styling + functional buttons
  - Marketplace differentiation from Overview
  - Schedules page button styling
  - Default memory vault path (`~/.local/share/bizar/memory` — `config/opencode.json` and `bizar-dash/src/server/memory-store.mjs`)
  - Headroom + LightRAG auto-start on dashboard boot (`bizar-dash/src/server/headroom.mjs`, `bizar-dash/src/server/server.mjs` startup hooks)
  - System service auto-start on install/update (`cli/provision.mjs` service install + `cli/commands/update.mjs` kill-update-redeploy sequence)
  - UI consistency audit pass on every page (32px top padding, 16-20px card gaps — `bizar-dash/src/web/styles/main.css`)
- **MiniMax swap** — 6 agent files updated from `opencode/deepseek-v4-flash-free` to `minimax/MiniMax-M2.7` / `MiniMax-M3` (see `config/agents/{tyr,odin,forseti,vidarr,quick,frigg,vor,heimdall,hermod,thor,baldr,mimir}.md`).
- **Doctor page stabilization** — 30s auto-refresh, 5 health panels (`bizar-dash/src/web/views/Doctor.tsx`).
- **Settings auto-save** — `useAutosave` hook + `<AutosaveField>` wired into General + Agent sections (`bizar-dash/src/web/components/hooks/useAutosave.ts`).

**Carry-over bugs (post-v5.0.1)** — see §6 Backlog for the full P0/P1/P2 list. Top three: B-M3 (`BacklogPanel` uses native `confirm()`), B-M7 (no WS message queue), B-MOBILE-1 (mobile bundle > desktop).

**Out of scope for Tier 0**: any new agent capability, any new HITL mechanism, any runtime work. Tier 0 is the closing of v5.

### Tier 1 — Next: Runtime Foundation (v6.0)

**Goal**: the big pivot. Replace "agents as prompts running sequentially in an opencode session" with "agents as services dispatched by a runtime orchestrator."

**Key deliverables** (all blocks the others):

- **Runtime agent orchestrator** — a lightweight Node.js service (`bizar-orchestrator/`) that:
  - Owns the agent definitions in `config/agents/`
  - Receives work requests (from CLI, dashboard, schedule, web)
  - Decomposes via Odin (LLM-driven decomposition) or accepts a pre-built plan
  - Dispatches to agents via the plugin's background spawn + persistent sessions
  - Tracks state across restarts (writes to `~/.local/share/bizar/orchestrator/`)
  - Exposes REST + WS APIs for dashboard visibility
  - Enforces the Forseti gate at Tier 4/5 dispatch
- **Session persistence for background agents** — `plugins/bizar/src/background.ts` writes active instance state to disk; orchestrator reloads on startup. Closes the "if you restart, you lose" gap (analysis §5).
- **In-chat plan approval** — replace `plugins/bizar/src/tools/wait-for-feedback.ts` 2s polling with WS push from plan server. Add approve/reject/comment buttons inline in `Chat.tsx`. Closes gap 5.
- **Task queue replacing 8-instance cap** — orchestrator owns the queue; 8 → 64 with priority + deadline awareness. Closes gap 3 partially.
- **Structured planning (DAGs)** — plans become graphs (`plans/<slug>/dag.json`) with explicit dependencies, parallel branches, per-step status. UI: re-render the plan canvas as a graph view. Closes gap 7.
- **Checkpoint / resume** — background agents checkpoint after each tool call (or every N steps); orchestrator resumes from last checkpoint on restart. Closes the rest of gap 3.
- **Research agent scaffolding** — `config/agents/` gets Veritas, Codex, and Praxis agent definitions (see `FINAL_GOAL.md` §2). Mimir is repurposed as the broad-research generalist with query-planning capability.
- **Research tab UI shell** — scaffold in `bizar-dash/src/web/views/Research.tsx`: query input, source panel stub, session list. Ships in Tier 1 as a non-functional shell; backend wiring is Tier 2.

**Exit criteria for Tier 1**:
- A 4-hour task can be submitted via CLI or dashboard and complete without any process restart killing it.
- A plan with 5 parallel branches executes with all 5 running concurrently (real fork-join, not sequential `task` calls).
- A plan approval flow uses push, not polling.
- The Forseti gate is enforced in code, not just in prompt text.

**Effort**: 8-12 weeks. The orchestrator is the single biggest piece of work in the project; everything else in Tier 1 hangs off it.

### Tier 2 — Next: Long-Horizon (v6.x)

**Goal**: the runtime works for hours. Make it work for days and weeks.

**Key deliverables**:

- **DAG-based planning execution** — the planner (Tier 1's DAG output) becomes the runtime's source of truth. Each DAG node is a background agent slot. Dependencies block execution; parallel branches run concurrently; failures propagate up.
- **Interruptible agents** — `bizar_pause` / `bizar_resume` / `bizar_interrupt` tools. Suspend a running background agent without losing state. The human can redirect mid-execution.
- **Durable result store** — background results don't disappear after `bizar_collect`. They land in `~/.local/share/bizar/orchestrator/results/<run-id>/` with structured metadata. UI: searchable history with diff/replay.
- **Multi-day task demonstrations** — three reference workflows shipped as defaults: a multi-PR refactor, a codebase migration, an ongoing security monitor. Each is a runnable example that proves the runtime.
- **Session replay** — every agent run can be replayed from its event log. Used for debugging, postmortem, and (in Tier 3) training data for self-improvement.
- **Specialist research agents live** — Veritas (primary-source verification), Codex (knowledge synthesis), and Praxis (live monitoring + recurring feeds) are operational. Mimir's query-planning capability is wired to the orchestrator.
- **Research → memory vault pipeline** — `~/.bizar_memory/research/<slug>.md` namespace with structured frontmatter (query, sources, confidence, date). "Save to memory" button on the Research tab writes here; Praxis reads from here for recurring feeds.
- **Scheduled research feeds** — Praxis runs on the schedule system (`bizar-dash/src/server/routes/schedules.mjs`). Users can turn any one-shot research into a periodic feed with a configurable interval.

**Exit criteria for Tier 2**:
- A user can submit a 3-day task, walk away, and come back to either a completed result or a clean handoff.
- A user can pause a running agent, give it new instructions, and resume.
- Every background result is replayable.
- Three reference long-horizon workflows are demonstrable end-to-end.

**Effort**: 6-8 weeks after Tier 1 lands.

### Tier 3 — Later: Intelligence (v7.x)

**Goal**: the runtime becomes self-improving. The agents get smarter with use.

**Key deliverables** (one per pillar — see §5 for the full breakdown):

- **Multi-agent validation as a primitive** — any task can opt into N-way validation. Cost-metered. Configurable per task class.
- **Agent council implementation** — the trigger rules from `FINAL_GOAL.md` §2.4 become runtime code. Solo execution, peer review, trio, or quorum depending on action class. All votes logged with reasoning.
- **Agent hierarchy enforcement** — the tree from `FINAL_GOAL.md` §2.3 is mechanically enforced. A Thor session cannot edit a file outside its task scope. A Tyr session cannot call implementation tools. Permissions are runtime checks, not prompt instructions.
- **Automated self-improvement loop** — outcomes recorded → patterns clustered → rules proposed → rules tested on past tasks → rules applied to future agents. The current `AGENTS_SELF_IMPROVEMENT.md` becomes the input, not the output.
- **Cross-session memory injection** — at session start, the orchestrator queries the memory service for relevant past decisions and injects the top-K. At session end, the orchestrator auto-writes a structured session summary.
- **Cross-council research verification** — when a council convenes (Pillar 4), each member runs an independent Veritas check on the claims in the proposal. Diverging source quality is surfaced as an additional axis of disagreement.
- **Automatic research trigger on stale knowledge** — the orchestrator flags when a decision depends on knowledge older than a configurable threshold (e.g., "CVEs older than 30 days for this library"). A Praxis feed is auto-spawned to refresh it before the council meets.

**Exit criteria for Tier 3**:
- A high-stakes action (merge to main) cannot be executed without a council vote.
- An agent that violates its hierarchy scope is rejected by the orchestrator, not by the prompt.
- A new rule promoted by the self-improvement loop demonstrably improves outcomes on a held-out test.
- A returning agent that worked on a related task 30 days ago has relevant context at session start.

**Effort**: 10-14 weeks. The self-improvement loop is the most research-y piece; expect iteration.

### Tier 4 — Future: Scale (v8.x+)

**Goal**: Bizar scales beyond a single user on a single machine.

- **Fork-join parallelism at scale** — orchestrator coordinates N concurrent agents across M machines. Work-stealing, resource-aware scheduling.
- **Cost-aware routing engine** — orchestrator tracks actual token costs per task, enforces budgets, routes to the cheapest capable model. Closes gap 8.
- **Public plugin registry** — ship `registry.json`, `bizar mod publish`, `bizar mod search`. Automated security review pipeline. Closes the "no public registry" gap in the mods system.
- **Enterprise multi-tenant** — workspace isolation, role-based access, audit log, SSO. The 5-config-roots problem (analysis §5.1) gets consolidated here.
- **Agent marketplace** — agents-as-a-service, with the same registry/security pattern as the mod marketplace. Users can publish and consume agent specializations.

**Effort**: TBD. None of this is in active development; it is the long arc.

---

## 5. The Six Pillars — Implementation Tracks

One section per pillar. Each section: what it means concretely, current state (file:line refs), target state, implementation milestones, open questions.

### 5.1 Pillar 1: Loops

**What it means**: agents run iteratively — recurring (cron), refinement (self-critique), exploration (convergent research). The system supports all three loop shapes natively.

**Current state**:
- Recurring: scaffolded but not generic. `bizar-dash/src/server/routes/schedules.mjs` and `bizar plan` exist, but no "schedule an agent" primitive. The `Schedules.tsx` view is partially built.
- Refinement: ad-hoc. Agents self-critique in prompts (`bizar plan` workflow has a Forseti review step in `odin.md:111-117` — prompt-level, not code).
- Exploration: not supported. Agents terminate when they decide to.

**Target state**:
- A `loop: { type: "recurring|refinement|exploration", ... }` config primitive consumed by the orchestrator.
- Loops have explicit stop conditions (max iterations, cost ceiling, wall-clock, convergence threshold).
- Loops emit structured events (start / tick / stop / abort) to the dashboard for visibility.

**Implementation milestones**:
1. **Loop primitive in orchestrator** — the `Loop` type, lifecycle, stop conditions. (Tier 1, ~1 week)
2. **Recurring loops in CLI** — `bizar loop add <cron> --agent <id> --prompt <p>` → orchestrator schedules. (Tier 1, ~1 week)
3. **Refinement loops as a wrapping pattern** — `bizar run --refine <task> --rubric <file>` runs a sub-task loop until rubric passes. (Tier 2, ~2 weeks)
4. **Exploration loops with convergence detection** — agent declares hypotheses, gathers evidence, score function determines convergence. (Tier 3, ~3 weeks)
5. **Loop dashboard view** — visibility into active loops, history, manual stop. (Tier 2, ~1 week)

**Open questions**:
- What does "convergence" mean for an exploration loop on qualitative research? Embedding similarity? LLM-as-judge? Both?
- Should loops be billed differently from one-shots (cost ceiling is critical)?

### 5.2 Pillar 2: Multi-Agent Validation

**What it means**: any task can opt into N-way independent execution. Results are compared; conflicts are surfaced; consensus drives action.

**Current state**:
- Not implemented. Single agent executes each task. Forseti reviews plans (prompt-level), not execution results.

**Target state**:
- A `validate: { reviewers: N, agreement_threshold: 0.6|0.8|1.0, conflict_escalation: "human|council" }` config primitive.
- The orchestrator spawns N parallel agents with the same input, compares structured outputs, and either proceeds (consensus) or escalates (conflict).
- Validation cost is metered and reported.

**Implementation milestones**:
1. **Validation primitive in orchestrator** — config schema, parallel spawn, result comparison framework. (Tier 1, ~2 weeks)
2. **Output comparison types** — exact match, JSON schema, embedding similarity, LLM-as-judge. (Tier 1, ~2 weeks)
3. **Validation as a default for high-stakes tasks** — security reviews, refactor proposals, schema migrations. (Tier 2, ~1 week)
4. **Validation dashboard** — see all N outputs side-by-side, diff view, escalation UI. (Tier 2, ~1 week)
5. **Validation telemetry** — measure catch rate, agreement distribution, cost. (Tier 3, ~2 weeks)

**Open questions**:
- Is "LLM-as-judge" a separate agent, or a model call? (Probably a model call — cheaper, faster, but lower quality.)
- What's the default N for validation? 3? Configurable per task class?
- How do we prevent N agents from making the same mistake? Diversity of tools, prompts, or both?

### 5.3 Pillar 3: Agent Hierarchy

**What it means**: the agent tree (Odin → Tyr → Thor → Heimdall; Hermod for gitops; Forseti for audit) is enforced at runtime, not just suggested in prompts. Lower-level agents cannot exceed their scope.

**Current state**:
- 12 agent definitions in `config/agents/` with YAML frontmatter for model + permission.
- The `task` tool allows one agent to invoke another, but permission enforcement is at the opencode level (tool whitelist), not the hierarchy level.
- The hierarchy is encoded in the prompts (`odin.md` says "you must dispatch to Tyr, not execute yourself") but not enforced.

**Target state**:
- An orchestrator-side check: when agent X dispatches agent Y, X must be a parent of Y in the hierarchy. Anything else is rejected.
- Permissions are inherited downward with constraints (a Tyr session can spawn Thor but not Heimdall; a Thor session can spawn Heimdall but not Vidarr).
- A Tyr session attempting to use a tool it shouldn't (e.g., a write tool when scoped to design) is rejected by the orchestrator, not the prompt.

**Implementation milestones**:
1. **Hierarchy schema** — `config/agents/hierarchy.yaml` declaring parent-child relationships. (Tier 1, ~3 days)
2. **Orchestrator enforcement** — dispatch validation, permission inheritance. (Tier 1, ~1 week)
3. **Per-agent scope declarations** — what files, what tools, what models each agent can touch. (Tier 1, ~1 week)
4. **Hierarchy violation telemetry** — log every rejection with reasoning. (Tier 1, ~3 days)
5. **Hierarchy dashboard** — visualize the current execution tree for any active session. (Tier 2, ~1 week)

**Open questions**:
- Should the hierarchy be hard (cannot dispatch outside it) or soft (warn but allow)?
- How do we handle ad-hoc agent invocations (user explicitly asks for `@vidarr` even when not in hierarchy)?
- What's the escape hatch for a real edge case where the hierarchy is wrong?

### 5.4 Pillar 4: Agent Council

**What it means**: for high-stakes decisions, N agents vote with structured reasoning. Decision is made by majority / consensus / quorum depending on action class. Disagreements are escalated, not averaged.

**Current state**:
- Forseti as a plan auditor is a prompt instruction (`odin.md:111-117`), not a runtime gate.
- No voting, no quorum, no escalation framework.

**Target state**:
- An `action_class` taxonomy: `trivial` (solo) / `standard` (peer review) / `significant` (trio, majority) / `critical` (quorum, unanimous-or-escalate).
- Every autonomous action declares its `action_class`. The orchestrator either executes solo or convenes a council.
- Councils are short-lived: members are spawned, vote, return. Votes + reasoning are logged.
- A disagreement is an escalation, not a failure. The human is consulted with the disagreement already framed.

**Implementation milestones**:
1. **Action class taxonomy** — `config/orchestrator/action-classes.yaml` with defaults. (Tier 1, ~1 week)
2. **Council primitive in orchestrator** — spawn N voters, collect structured votes, apply decision rule. (Tier 1, ~2 weeks)
3. **Council audit log** — every council's votes + reasoning in `~/.local/share/bizar/orchestrator/councils/`. (Tier 1, ~3 days)
4. **Default mappings** — which actions are trivial / standard / significant / critical? Defaults ship; users override. (Tier 2, ~1 week)
5. **Council escalation UI** — when a council escalates, the human sees a structured summary of the disagreement. (Tier 2, ~1 week)

**Open questions**:
- Should the council be a paid feature? (See §8 Open Questions.)
- What's the default N for a "significant" council — 3 or 5?
- How do we prevent rubber-stamp councils (all 3 agents trained the same way voting identically)?
- What's the tiebreaker for an even-numbered council? Escalate by default?

### 5.5 Pillar 5: Constant Self-Improvement

**What it means**: outcomes → patterns → rules → applied rules → better outcomes. Closed loop. The system gets measurably better with use.

**Current state**:
- `.bizar/AGENTS_SELF_IMPROVEMENT.md` is a 1,139-line append-only log. Agents read it at session start (per `odin.md` and `bizar` skill).
- No automatic extraction, no clustering, no rule validation, no automated promotion.

**Target state**:
- Every task outcome is structured: `{ task_id, agents_used, cost, duration, success, failure_reason, human_corrections }`. Stored in `~/.local/share/bizar/orchestrator/outcomes/`.
- A periodic pattern extractor clusters outcomes, identifies recurring lessons, and proposes rules.
- A rule validator tests proposed rules against a held-out corpus of past tasks. Rules that improve outcomes are promoted; rules that don't are dropped.
- Active rules are injected into agent context at session start, surfaced as warnings when relevant, and re-evaluated as new evidence arrives.

**Implementation milestones**:
1. **Structured outcome recording** — every orchestrator-spawned task emits a structured outcome record. (Tier 1, ~1 week — ships with the orchestrator)
2. **Pattern extractor** — clustering + topic modeling on outcomes. (Tier 3, ~3 weeks)
3. **Rule proposer + validator** — turns clusters into candidate rules, tests against held-out corpus. (Tier 3, ~4 weeks — most research-y piece)
4. **Active rules runtime** — promote / demote / inject / surface. (Tier 3, ~2 weeks)
5. **Self-improvement dashboard** — see active rules, see proposed rules, see rules under evaluation, see rules demoted with reason. (Tier 3, ~1 week)
6. **Regression tests for rules** — given a rule, can we construct a task where the rule is relevant and verify the agent applies it? (Tier 3, ~2 weeks)

**Open questions**:
- How do we prevent rules from accumulating forever? (Demotion criteria: usage, impact, conflicts.)
- What's the right evaluation metric for "better outcomes"? (Success rate? Human-correction rate? Cost? Latency?)
- Should active rules be visible to the user? (Yes — transparency is the point.)
- How do we avoid rules that game the metric? (Multiple metrics, periodic human review.)

---

### 5.6 Pillar 6: Specialist Research Agents

**What it means**: a tier of specialist agents — Mimir, Veritas, Codex, Praxis — whose primary capability is web search, source evaluation, and information synthesis. Research agents are not general-purpose assistants. They are deep specialists in finding, verifying, and synthesizing external knowledge. Every claim they make is cited; every citation is ranked; every synthesis flags when information may be stale.

**Current state**: Mimir exists in `config/agents/mimir.md` with basic websearch and webfetch capability. There are no specialist variants (Veritas, Codex, Praxis), no source ranking, no confidence scoring, no dashboard tab, no synthesis tooling, no `~/.bizar_memory/research/` namespace, and no recurring feed system. Mimir today is a prototype; Pillar 6 is the product.

**Target state**:
- Four research specialist agents, each with a defined role and toolbelt.
- A Research tab in the dashboard with query input, source panel, synthesis panel, save-to-memory, and schedule recurring.
- Structured research outputs in `~/.bizar_memory/research/<slug>.md` with frontmatter (query, sources, confidence, recency, date).
- Research agents usable by other pillars: councils query Veritas before voting; the orchestrator queries Praxis when knowledge is stale.
- Citation accuracy > 90%, source freshness < 6 months for "current best practice" queries.

**Implementation milestones**:

1. **Specialist agent definitions** — Veritas, Codex, and Praxis defined in `config/agents/`. Mimir is updated with query-planning capability. Each has YAML frontmatter (model, permissions, tools, trigger conditions). (Tier 1, ~1 week total — 2-3 days each)
2. **Research toolbelt in plugins** — shared research tools in `plugins/bizar/src/tools/`: `bizar_web_search` (parallel N-query execution), `bizar_fetch_and_extract` (fetch + content extraction from arbitrary URLs), `bizar_rank_sources` (relevance × recency × credibility scoring), `bizar_verify_claim` (cross-check a claim against N sources), `bizar_synthesize` (turn N ranked sources into a cited synthesis). (Tier 1, ~2 weeks)
3. **Research tab in dashboard** — `bizar-dash/src/web/views/Research.tsx` + components: query input, active session list, source panel with per-source confidence/relevance/recency, synthesis panel with inline citations, "Save to memory" button, "Schedule recurring" picker. Ships as shell in Tier 1; backend-wired in Tier 2. (Tier 1 shell, Tier 2 full)
4. **Backend route group `/api/research/*`** — REST endpoints for research sessions (create, status, result), sources (list with scores), claims (list with citations), and schedule (create/update/delete recurring feeds). Wires the Research tab to the orchestrator. (Tier 1, ~1 week)
5. **`~/.bizar_memory/research/` vault namespace** — directory structure with structured frontmatter. "Save to memory" writes here. Praxis reads here. Integrates with the existing memory service (`bizar-dash/src/server/memory-store.mjs`). (Tier 2, ~1 week)
6. **Recurring research feed scheduler** — Praxis runs on the existing schedule system (`routes/schedules.mjs`). Users set an interval per feed; the system schedules a Mimir/Codex research agent on that cron. Feeds write to `~/.bizar_memory/research/<slug>.md` with `last_checked` frontmatter updated each run. Stale feeds (no update in 2× interval) trigger an alert. (Tier 2, ~2 weeks)

**Open questions**:

- Should research always go through the agent hierarchy (Mimir → Veritas → Codex) or can users call a specialist directly? The hierarchy path adds rigor; direct access adds speed. Likely: direct for Tier 1, hierarchy-path as a mode for Tier 2+.
- How do we handle paywalled sources? Some of the best information (academic papers, premium APIs) is behind paywalls. Options: skip and note the gap; use cached/archived versions; integrate with a user's existing subscriptions. No decision needed for Tier 1 scaffolding, but the architecture should not assume all sources are freely accessible.
- How do we attribute conflicting sources? When Veritas finds three sources that say different things, the output should track the conflict with provenance — not pick a winner. The consumer (council, orchestrator, user) decides. This has implications for how claims are structured in the data model.
- What's the trust threshold for "verified" vs. "asserted"? A claim supported by 3 independent credible sources is verified. A claim supported by 1 blog post is asserted. What about 2 blog posts? 1 academic paper vs. 3 blog posts? We need a configurable threshold, not a hard rule.
- How does temporal awareness work in practice? "This was true in 2023 but superseded in 2025" requires Veritas to know the publication dates of sources and flag when a claim depends on an outdated source. This is a query-planning problem as much as a synthesis problem — and it is hard to automate fully.

---

## 6. Backlog (P0 / P1 / P2)

Carry-over bugs and small features from the current-state analysis. Tagged by which tier they block.

### P0 — Blocks Tier 1

These must be resolved before or as part of Tier 1 work.

| ID | Item | Source | Notes |
|---|---|---|---|
| B-H4 | `parseWithModsFlag` doesn't validate mod ID pattern | `cli/bin.mjs:1086-1095` | Bogus IDs reach the dashboard. 1 hour. |
| B-M7 | WebSocket has no message queue | `bizar-dash/src/web/lib/ws.ts` | Messages dropped while disconnected. Critical for orchestrator WS. |
| B-M6 | SSE/WS token in URL lands in browser history | `api.ts:74-91`, `auth.mjs:187-189`, `ws.ts:29` | Move to `document.cookie`. 2 hours. |
| B-MOBILE-1 | Mobile bundle (476 KB) > desktop (372 KB) | `vite.config.ts` + `mobile.tsx` | Investigate imports. 1 day. Block: orchestrator mobile UI. |
| B-M1 | `useAutoGrowTextarea` deps missing `value` | `bizar-dash/src/web/components/chat/useAutoGrowTextarea.ts` | Textarea doesn't grow on content change. 30 min. |

### P1 — Blocks Tier 2

| ID | Item | Source | Notes |
|---|---|---|---|
| B-M3 | `BacklogPanel` uses native `confirm()` | `bizar-dash/src/web/components/tasks/BacklogPanel.tsx` | Use `useModal().showConfirm(...)`. 1 hour. |
| B-M4 | `BacklogPanel` promote doesn't trigger refresh | same | 1 hour. |
| B-M5 | Schedules "Other..." timezone has no UI | `bizar-dash/src/web/views/Schedules.tsx:40-48` | Free-form input. 2 hours. |
| B-M8 | `/api/auth/reveal` returns token in plaintext | `bizar-dash/src/server/routes/auth.mjs:57` | Return only "abc...xyz" with copy UI. 1 hour. |
| B-M9 | 15 instances of `Math.random()` for IDs | various | Replace with `crypto.randomUUID()`. 1 hour. |
| B-L4 | Stale port file read in `bin.mjs:395` | `cli/bin.mjs:395` | PID liveness check. 1 hour. |
| B-L6 | 6 rate-limited empty catches remain in `memory-lightrag.mjs` | `bizar-dash/src/server/memory-lightrag.mjs` | Apply logger pattern. 1 hour. |

### P2 — Blocks Tier 3 / nice to have

| ID | Item | Source | Notes |
|---|---|---|---|
| B-M2 | `Providers._expanded` state lost on snapshot refresh | `bizar-dash/src/web/views/Providers.tsx` | Move to API or localStorage. 2 hours. |
| B-L1 | 228 KB CSS bundle — no tree-shaking verification | `vite.config.ts` | Run purgecss, audit selectors. 1 day. |
| B-L2 | No global `:focus-visible` ring | `bizar-dash/src/web/styles/main.css` | Add a global rule. 30 min. |
| B-L3 | `console.log` vs `console.error` mix | many | Full CLI-side convention. 2 hours. |
| B-H5 | v1 dashboard routes have no auth | `bizar-dash/src/server/server.mjs` | Deferred — Tailscale handles auth. Re-evaluate for Tier 3 enterprise. |
| (old) | OpenTelemetry export | `bizar-dash/src/server/server.mjs` | Skeleton in v4.9, not wired. 1 week. Block: Tier 3 telemetry. |
| (old) | WCAG 2.2 AA compliance gaps | various | Settings form labels, aria-live, color-only. Ongoing. |
| (old) | LightRAG index rebuild (`bizar memory reindex` returns stub) | `bizar-dash/src/server/memory-lightrag.mjs` | Wire the rebuild. 1 week. |
| (old) | Voice note auto-transcription (Whisper API only) | `bizar-dash/src/server/voice.mjs` | 1 week. |
| (old) | Settings inline styles → CSS classes | `bizar-dash/src/web/views/Settings.tsx` (1823 lines) | Refactor. 1 sprint. |
| R-P2-1 | Mimir research output lacks source ranking / credibility scoring | `config/agents/mimir.md` | Tier 1 scaffolding only; full ranking in §5.6 milestone 2. |
| R-P2-2 | No dashboard tab for active research sessions | `bizar-dash/src/web/views/` | Shell ships in Tier 1; full wiring in Tier 2. |
| R-P2-3 | No `~/.bizar_memory/research/` namespace for storing research outputs | `bizar-dash/src/server/memory-store.mjs` | Tier 2 deliverable; no namespace exists today. |

---

## 7. Out of Scope / Deprioritized

Items from the old `ROADMAP.md` §10 that no longer fit the new direction. The cut is ruthless — anything that doesn't ladder up to a pillar is deprioritized.

| Old item | Source | Reason for deprioritization |
|---|---|---|
| F-NEW-7: Multi-user / Team Workspaces | old §10 | Not a pillar. Punted to Tier 4 (enterprise). |
| F-NEW-8: Multi-Project Dashboards | old §10 | Tier 4. |
| F-NEW-11: Live cursors in artifact canvas | old §10 | Doesn't ladder up. Cutting. |
| F-NEW-12: Voice Notes → Transcripts | old §10 | Useful but not a pillar. Defer to P2 / community. |
| F-NEW-13: Screenshot → OCR + Note | old §10 | Same. |
| F-NEW-14: Web Clipper Extension | old §10 | Same. |
| F-NEW-16: Memory Graph Visualization | old §10 | Useful for browsing, but doesn't advance autonomy. Defer. |
| F-NEW-17: One-Click Deploy (Vercel/Cloudflare/Fly) | old §10 | Doesn't ladder up. Defer to community. |
| F-NEW-18: Self-Hosted Dashboard (Docker) | old §10 | Tier 4. |
| F-NEW-19: Backup / Restore | old §10 | Tier 4 / P2. |
| F-NEW-20: Multi-Project SaaS | old §10 | Tier 4. |
| F-NEW-21: React Native mobile app | old §10 | The mobile sub-app is sufficient. Defer. |
| F-NEW-22: Metrics endpoint | old §10 | **DONE in v4.7.0** (`/metrics`). |
| F-NEW-23: OpenTelemetry export | old §10 | P2 — keep on backlog. |
| F-NEW-24: Audit Log Viewer | old §10 | P2. |
| F-NEW-25: Sentry integration | old §10 | P2. |
| F-NEW-26: Custom Themes | old §10 | Cutting. |
| F-NEW-27: Keyboard Shortcut Customizer | old §10 | P2. |
| F-NEW-28: Plugin Marketplace | old §10 | Part of Tier 4. |
| F-NEW-29: Webhook Integrations | old §10 | P2. |
| F-NEW-30: CLI for Everything | old §10 | Tier 2 will close most gaps. |
| F-NEW-31/32/33: GitHub / Linear / Notion Sync | old §10 | Doesn't ladder up. Defer to community. |
| F-NEW-34/35: Slack / Discord Notifications | old §10 | P2. |
| v4.6+ `parseWithModsFlag` extraction (R12) | old §4 | Shipped as part of v4.5.2. Crossed out. |
| v4.6+ `cache detectState()` (R9) | old §4 | P2 perf cleanup. |
| v4.6+ R11 logging convention | old §4 | Mostly done in v4.7.0. Remaining: CLI side. |

**The discipline**: if a feature doesn't advance Loops, Multi-Agent Validation, Agent Hierarchy, Agent Council, or Constant Self-Improvement, it goes on the P2 backlog at best. The exception is work that unblocks Tier 1 (the v6.0 orchestrator); that work is P0 regardless of pillar.

---

## 8. Open Questions for Maintainers

These need human judgment. Listed so we can address them in order.

1. **Is the agent council a paid feature?** Tiers 1-2 of the council primitive are core; the enterprise version (audit log, custom rule sets, compliance reports) is a natural product boundary. Decision needed before v7.0 scope lock.
2. **Do we keep voice notes?** Shipped in v5.0.0. Not a pillar. Either (a) commit to a Tier 4 product wedge, (b) treat as community-maintained, or (c) deprecate.
3. **How aggressive should we be about auto-updates to agents?** Tier 1 makes agent definitions runtime-mutable. Tier 3 self-improvement mutates them automatically. What's the rollback story? Staged rollout? Human approval for rule promotion?
4. **What's the open-source vs. commercial split?** The runtime orchestrator and self-improvement loop are valuable IP. Do we open-source them? Offer a managed service? Both? Decision needed before v6.0 ships publicly.
5. **Should the dashboard become a desktop app?** Tauri/Electron would unlock notifications, file system access, and "always-on" behavior that web can't match. A long-running agent platform probably wants a desktop presence. Decision needed before Tier 2 dashboard work.
6. **Memory service — when does it graduate from a Bizar-specific system to a generic product?** Three vault modes, git sync, secret scanning — it's already a product-shaped thing. A v2 of the memory service could be a standalone offering.

---

## 9. Contributing

This roadmap needs help in specific areas. If any of these match your skills, the work is real and the path is clear.

**Most needed** (Tier 1 bottlenecks):

- **Distributed systems / agent runtime engineering.** The orchestrator is the Tier 1 unlock. Comfort with Node.js, persistent state machines, queue/scheduling, and the subtleties of LLM-driven control flow.
- **Prompt engineering at scale.** The 12 agent definitions are Tier 0 / Tier 1. Tier 3 needs validated, measurable prompts. Comfort with evaluation methodology, LLM-as-judge, and adversarial testing.
- **Eval framework design.** The self-improvement loop needs ground truth. Building the test suite that rules are validated against is its own discipline.
- **Web platform engineering.** The dashboard becomes the primary surface for visualizing long-running agent work. 17 views today; the orchestrator view alone is a major addition. React + TypeScript + WebSocket.

**Helpful but less critical** (Tier 2-3):

- **Knowledge graph / RAG.** The memory service grows up in Tier 3. LightRAG scaffolding exists; real index work is needed.
- **Security / sandboxing.** The mods system has a v1 security layer; Tier 3 wants a real `vm` sandbox. Work that requires careful adversarial thinking.
- **Observability.** OpenTelemetry export, correlation IDs, distributed tracing. Boring infrastructure; everyone needs it; few people love it.
- **Research engineering.** Search infrastructure, source ranking algorithms, citation management, temporal knowledge tracking, paywall handling. The Pillar 6 work is the most research-adjacent engineering in the project — good for people who want to work at the intersection of information retrieval and AI agents.

**Process for contributing**:

1. Read `FINAL_GOAL.md` and this file end to end.
2. Read `.bizar/AGENTS_SELF_IMPROVEMENT.md` for the active rules every agent follows.
3. Pick a P0 from §6 or a milestone from §5.
4. Read the relevant file:line refs.
5. Open a PR. The test gate is `npm test` + `npm run test:web` + `bizar test-gate`.

The self-improvement log is the project's living memory. If you find a lesson worth recording, add an entry. The format is in `.bizar/AGENTS_SELF_IMPROVEMENT.md`'s existing entries.

---

## 10. Changelog → Roadmap

**Note on the new structure.**

The old `ROADMAP.md` (1,549 lines) was a "findings document" oriented toward dashboard feature work. The 35 features in old §10, the 50+ bug entries in old §3, and the per-release retrospectives in old §13 were useful when the platform was small. They are not useful at the scale we are now operating.

The new structure splits these concerns:

- **`FINAL_GOAL.md`** — the vision. The why. Read this first.
- **`ROADMAP.md`** (this file) — the strategy. The what and when. Read this second.
- **`.obsidian/projects/current-state-analysis-2026-07-06.md`** — the baseline. What exists, what's missing. Read this when you need the gory details.
- **`CHANGELOG.md`** — what shipped in each release. The who/what/when of features and fixes.
- **`.bizar/AGENTS_SELF_IMPROVEMENT.md`** — the lessons learned. The institutional memory.

The old ROADMAP.md is preserved in git history. Detailed bug-fix lists and feature requests have moved to `CHANGELOG.md` and the issues tracker. New findings should be filed as issues with a tier tag (P0/P1/P2) and a pillar tag (loops/validation/hierarchy/council/self-improvement), not appended to this file.

If the three top-level documents (`FINAL_GOAL.md`, `ROADMAP.md`, this current-state analysis) ever disagree, `FINAL_GOAL.md` wins. The roadmap is execution; the goal is the truth.

---

## Appendix A: Tier Summary

| Tier | Version | Theme | Effort | Key unlock |
|---|---|---|---|---|
| **0** | v5.0.2 / v5.1 | Polish + close v5 | 2-3 weeks | Stable v5 |
| **1** | v6.0 | Runtime Foundation | 8-12 weeks | Orchestrator + persistence |
| **2** | v6.x | Long-Horizon | 6-8 weeks after T1 | DAG execution + interrupt + replay |
| **3** | v7.x | Intelligence | 10-14 weeks | Validation + Council + Self-Improvement |
| **4** | v8.x+ | Scale | TBD | Fork-join scale + cost + enterprise |

## Appendix B: Pillar-to-Tier Mapping

| Pillar | Tier 1 | Tier 2 | Tier 3 |
|---|---|---|---|
| Loops | Loop primitive | Refinement + exploration | Convergence detection |
| Multi-Agent Validation | Primitive + comparison types | Default for high-stakes | Telemetry + cost metering |
| Agent Hierarchy | Schema + enforcement | Dashboard tree view | Per-scope file/tool access |
| Agent Council | Action class taxonomy + primitive | Default mappings + escalation UI | Tiebreakers + audit-grade logging |
| Constant Self-Improvement | Outcome recording | Dashboard visibility | Pattern extractor + rule validator |
| Specialist Research | Agent definitions + toolbelt + Research tab shell | Live agents + vault pipeline + scheduled feeds | Cross-council verification + stale-knowledge auto-trigger |

## Appendix C: Key File References

For the implementer. The canonical locations for the work.

- **Orchestrator entry point**: `bizar-orchestrator/` (new, to be created in Tier 1)
- **Agent definitions**: `config/agents/*.md` (12 files)
- **Background agent system**: `plugins/bizar/src/background.ts` (1250 lines)
- **Loop guard**: `plugins/bizar/src/loop.ts`
- **Compaction gate**: `plugins/bizar/src/compaction.mjs` (192 lines)
- **Plan approval (to be replaced)**: `plugins/bizar/src/tools/wait-for-feedback.ts`, `plugins/bizar/src/tools/plan-action.ts`
- **Memory service**: `bizar-dash/src/server/memory-store.mjs`, `memory-lightrag.mjs`, `memory-obsidian.mjs`
- **Dashboard server**: `bizar-dash/src/server/server.mjs`, `routes/*.mjs`
- **Web app entry**: `bizar-dash/src/web/App.tsx`
- **CLI entry**: `cli/bin.mjs` (275 lines post-v4.7.0)
- **Self-improvement log**: `.bizar/AGENTS_SELF_IMPROVEMENT.md` (1,139 lines)
- **Config root**: `config/opencode.json`
- **Current-state baseline**: `.obsidian/projects/current-state-analysis-2026-07-06.md`
