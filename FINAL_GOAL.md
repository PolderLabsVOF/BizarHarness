# Final Goal

> **Bizar is a fully autonomous AI agent development platform for long-running, long-horizon tasks with human-in-the-loop elements.**

This document is the "why" behind BizarHarness. It explains what we are ultimately building, who it is for, and the capabilities it must grow into. The companion `ROADMAP.md` turns this into a sequenced plan; the code is what exists today. If the three ever disagree, this document wins.

---

## 1. The Vision

A user submits a goal. They walk away. Bizar handles the work end-to-end, escalating to a human only when the decision is too expensive, too irreversible, or too uncertain to make on its own. When the user comes back, the work is either done, partially done with a clear handoff, or paused at a checkpoint that needs them.

That is the entire product. Everything else — the CLI, the dashboard, the memory vault, the 12 agent definitions, the SDK, the metrics endpoint — exists to make that sentence true.

Concretely, a goal looks like one of these:

- **"Refactor the auth module to use JWT."** Odin decomposes the work. Mimir investigates the current code and conventions. Tyr drafts the refactor with tests. Forseti reviews the plan. Thor applies it across the codebase. Hermod opens a PR. The user approves the merge in a single click from their phone.
- **"Build a complete iOS app from this spec."** Tyr designs the architecture and breaks it into 40 features. The orchestrator schedules features in dependency order, dispatches them to Thor in parallel waves, integrates the results, runs the test suite, fixes failures, and reports. The user reviews the weekly digest.
- **"Monitor this codebase for security issues and patch them."** A recurring background loop. Mimir watches for new CVEs against the dependency tree. When one matches, Tyr drafts a patch, Forseti reviews, the patch is applied, tests run, PR opened. The user only hears about it if a council decision is required.

The user personas are:

- **Indie developer.** Single-person shop, no staff engineer to delegate to, drowning in routine maintenance. Bizar is the junior they can afford.
- **Startup CTO.** Wearing ten hats. Needs to ship product, not babysit CI. Bizar is the team they haven't hired yet.
- **Platform team at a mid-size company.** Bounded headcount, unbounded backlog. Bizar takes the long tail — dependency upgrades, doc drift, test gaps, security patches — so the humans focus on the high-judgment work.
- **Enterprise IT.** Strict environments, audit trails, approval workflows. Bizar's council HITL pattern is the missing layer between "AI does the work" and "human signs off on the change."

What unifies these personas is the same shape of problem: too much work, not enough attention, and an asymmetric cost between *doing* the work and *checking* the work. Bizar's bet is that the asymmetry is large and that the right architecture makes it enormous.

And behind every judgment call is a question of fact — what are the current best practices, what has changed since we last looked, what do trusted sources actually say? Research agents are the layer that answers those questions reliably, at scale, and with citations — feeding evidence into councils, freshness into self-improvement, and answers into the hierarchy.

---

## 2. The Six Pillars

The vision decomposes into five concrete capabilities. Each pillar is a distinct technical and product bet. They are interdependent — the system is weaker without any one of them — but each can be developed, tested, and shipped on its own.

### Pillar 1: Loops

**Agents that run iteratively, not just one-shot.**

Most agent products today are one-shot: user prompts, model responds, conversation ends. Bizar is built around the assumption that the interesting work is recurrent. Three loop shapes cover the space:

- **Recurring loops** (cron-like). "Every Monday at 9am, run the dependency-audit agent and post results to Slack." "Every PR open, run the security review agent." Implemented as schedulable agent tasks with idempotency, last-run state, and clear failure modes.
- **Refinement loops** (self-critique). The agent produces a draft, reviews it against a rubric or test, identifies gaps, and redoes the work until the quality threshold is met. Bounded by max iterations, cost budget, and wall-clock time. The work is "good enough" by construction, not by hope.
- **Exploration loops** (research convergence). "Investigate why the test suite is flaky and report." The agent forms hypotheses, gathers evidence, updates its model, gathers more evidence, until it either converges or hits a stop condition. The output is a structured report, not a guess.

The interesting work combines loops. A "refactor the auth module" task might run an exploration loop (understand the code), a refinement loop (draft + critique), and a recurring loop (regression test on every subsequent change). The agent runtime must support all three natively.

**Example**: A weekly security audit. Schedule fires Monday 9am. Loop: pull latest CVE feed → match against project's lockfile → for each match, draft a patch → run patch through refinement loop (does it compile? does it pass tests? does it preserve API contract?) → if all green, open a PR; if any red, escalate to human. Reports weekly digest. Runs forever.

### Pillar 2: Multi-Agent Validation

**Multiple agents independently work on the same problem; results are compared, conflicting findings are surfaced, consensus is required before action.**

Single-agent output is hallucination-prone. No amount of prompt engineering fixes this — the model is sampling from a distribution, and any single sample is wrong sometimes. The fix is structural: get multiple independent samples, compare them, and act on the consensus rather than the median.

Three patterns:

- **Code review**. Three reviewers (a security-focused agent, a correctness-focused agent, and a style-focused agent) each independently review a diff. Their findings are unioned (any reviewer flags → must address), intersected (all reviewers flag → definitely a bug), and surfaced with provenance. The author sees a single review report that says "all three flagged X, two of three flagged Y, one of three flagged Z" — with reasoning.
- **Security audit**. The same question ("is this codebase vulnerable to SQL injection?") is independently investigated by three agents with different tool choices and different reasoning strategies. Their findings are cross-checked. High-confidence findings (all three agree) become a default-action set. Disagreements are escalated to a human.
- **Refactor proposals**. Two agents independently propose how to refactor a module. The proposals are compared on dimensions the user cares about (minimal-diff, maximal-clarity, fastest-runtime). The orchestrator either picks the Pareto winner or, if neither dominates, escalates the choice.

The principle: **agreement is signal, disagreement is information**. We don't average, we don't vote mechanically — we surface conflicts and let the consensus (or the escalation) drive action.

**Counter-example**: A trivial typo fix doesn't need three reviewers. The pillar is a primitive, not a constant. Loop guards determine when validation kicks in (see Pillar 4).

### Pillar 3: Agent Hierarchy

**Structured chains of delegation. Manager agent decomposes goal → worker agents handle subtasks → manager integrates results → reports up. Specialization at each level.**

The agent system is not a flat list of 12. It is a tree where each level is a different *kind* of work. The current Bizar pantheon already encodes this implicitly; making it explicit unlocks parallel work, clearer accountability, and cheaper failures.

```
                          [User goal]
                              │
                          Odin (M3)
                        strategic router
                              │
              ┌───────────────┼───────────────┐
              │               │               │
          Mimir (Flash)   Forseti (M3)    Tyr (M3)
            research        auditor      architect
                              │               │
                              │       ┌───────┴───────┐
                              │       │               │
                              │   Thor (M2.7)    Baldr (M2.7)
                              │   implement       design
                              │       │
                              │   Heimdall (Flash)
                              │   mechanical
                              │
                          Hermod (M2.7)
                            gitops
```

- **Odin** (strategic). Pure router. Reads the goal, decomposes it, assigns work, integrates. Never executes. Cost: medium. Permission: zero direct file edits.
- **Mimir / Frigg / Vör** (research, Q&A, clarification). Read-only. Cheap models. High volume.
- **Forseti** (auditor). Reviews plans and decisions. Never executes. The "second pair of eyes" before Tier 4/5 work.
- **Tyr** (architect). Designs the solution space. Decisions are reversible (design docs, plan canvases) but expensive (multi-hour downstream cost).
- **Baldr** (design). Aesthetic, UX, naming. The work that makes codebases not just work but feel finished.
- **Thor** (implementer). Modular implementation. Tests, integration, refactoring. The bulk of file edits.
- **Heimdall** (mechanical). Mechanical edits: rename, format, dependency upgrade, boilerplate. Cheapest model. Highest volume.
- **Hermod** (gitops). Branch, commit, push, PR, merge. Never edits application code.
- **Vidarr** (last resort). The hardest problems, with reasoning enabled. Expensive, slow, only when Tyr is stuck.

The hierarchy is a *runtime* structure, not just a prompt convention. When Odin dispatches to Tyr, the orchestrator opens a Tyr session, hands it the brief, awaits completion, and only then returns. When Tyr delegates to Thor, the same happens one level down. Each level has a clear contract (what it consumes, what it produces, what it costs) and the orchestrator enforces the contract.

### Pillar 6: Specialist Research Agents

**Agents whose primary capability is web search, source evaluation, and information synthesis. Not general-purpose — specialists with a deep toolbelt for finding and verifying external knowledge.**

Today's Mimir does basic websearch and webfetch. That is the prototype, not the product. Research agents do *much* more:

- **Query planning**: decompose a vague question into N targeted searches. "What's the current best practice for auth in 2026?" becomes 4-6 specific queries covering different angles, time ranges, and source types.
- **Source ranking**: relevance × recency × credibility. Not just "found something" but "found the *right* thing" — academic papers over blog posts, official docs over tutorials, recent sources over canonical-but-stale ones.
- **Primary-source verification**: cross-check claims against multiple authoritative sources. When three independent sources say the same thing, it becomes a claim. When they disagree, it becomes a tracked conflict with provenance.
- **Synthesis**: turn 20 sources into a coherent, cited answer. The output is not a list of links — it is a structured synthesis with inline citations and a confidence assessment.
- **Temporal awareness**: research has a shelf life. "This was the best practice in 2023 but superseded in 2025." Research agents flag when information is likely stale and note when newer evidence may have changed the picture.
- **Provenance tracking**: every claim links back to its source. The user can audit where the answer came from, not just trust the answer.

**Specialist roles** (agent definitions to be added in ROADMAP implementation):

- **Mimir** (existing, repurposed) — broad web research, query planning, source discovery. The generalist in the research family.
- **Veritas** (new) — primary source verification, fact-checking, claims validation. The agent you call when you need to know if something is actually true.
- **Codex** (new) — knowledge base synthesis. "Explain this domain to me", literature review, building a mental model of an unfamiliar area from primary sources.
- **Praxis** (new) — live monitoring. "Tell me when X happens", recurring research feeds, watchlists for changes in a monitored domain.

**Dashboard tab**: a dedicated Research view in the sidebar with:

- Query input (natural language goal)
- Active research sessions (multiple parallel research agents visible simultaneously)
- Source panel with confidence / relevance / recency scoring per source
- Synthesis panel (the agent's findings with inline citations — each claim is clickable to the source)
- "Save to memory" button — writes to `~/.bizar_memory/research/<slug>.md` with structured frontmatter (query, sources, confidence, date)
- "Schedule recurring" — turns a one-shot research into a periodic feed; Praxis wires it into the schedule system
- Research history with replay (every past research session is replayable from its event log)

**Why this enables everything else**: Agent Council needs evidence-based deliberation — a council that votes without sources is just opinions. Agent Hierarchy needs a research specialist at the top — Mimir feeds Tyr the facts that Tyr needs to design. Multi-Agent Validation needs independent research agents to cross-check each other's work. Constant Self-Improvement needs fresh information about new techniques, new CVEs, and changing best practices. Research is the substrate that feeds all other pillars.

### Pillar 4: Agent Council

**For high-stakes decisions, convene a council of N agents, each votes with reasoning, the decision is made by majority / consensus / quorum depending on the action class.**

Not every decision needs a council. Trivial actions (format a file, run a test) execute solo. But for actions that are expensive, irreversible, or high-stakes, Bizar convenes a temporary council.

**Trigger rules** (initial draft, refined over time):

| Action class | Council size | Decision rule | Examples |
|---|---|---|---|
| **Trivial** (reversible, low cost) | 0 (solo) | N/A | File edit, test run, dependency query |
| **Standard** (reversible, moderate cost) | 1 (peer review) | Reviewer approves or rejects | New file in well-trodden area, dependency bump |
| **Significant** (irreversible or high cost) | 3 (trio) | Majority | Refactor of > 100 LOC, schema migration, security patch |
| **Critical** (irreversible + high blast radius) | 5 (quorum) | Unanimous or escalate | Merge to main, prod config change, data deletion |

Each council member independently investigates the proposal and submits a vote with structured reasoning. The decision is logged with all votes and reasoning, available for audit and postmortem. A council that disagrees is not a failure — it is a *signal* that the human should weigh in. Bizar escalates to the human with the disagreement already framed, not raw.

**Why this matters**: The cost of a wrong autonomous action is asymmetric. A bad commit is cheap to revert; a deleted production database is not. The council pattern lets Bizar take autonomous action on the cheap cases and earn human trust for the expensive ones.

### Pillar 5: Constant Self-Improvement

**The system learns from every interaction. Closed-loop: agents record outcomes → patterns are extracted → rules are updated → future agents apply them. Not append-only logs but a living knowledge base.**

Today, Bizar's self-improvement is a markdown log. Agents append a "lesson learned" entry. The next agent, if told to read it, benefits. This is better than nothing but it is not a learning system — it is a passive archive.

The closed loop looks like this:

```
   ┌──────────────────────────────────────────┐
   │                                          │
   ▼                                          │
[Agent runs task]                             │
   │                                          │
   ▼                                          │
[Outcome recorded: success/failure + reason]  │
   │                                          │
   ▼                                          │
[Pattern extractor: cluster similar outcomes] │
   │                                          │
   ▼                                          │
[Rule proposer: candidate rule for the pattern]
   │                                          │
   ▼                                          │
[Rule validator: test against past tasks]     │
   │                                          │
   ▼                                          │
[Active rules: now applied to all agents]     │
   │                                          │
   ▼                                          │
[Agent runs next task with updated rules] ────┘
```

Three properties distinguish this from "just a log":

1. **Automatic extraction**. No agent needs to be told to write a lesson. Outcomes are observed, patterns are clustered, rules are proposed — without prompting.
2. **Rule validation**. A candidate rule is tested against a corpus of past tasks. "Did agents following this rule produce better outcomes than agents ignoring it?" If yes, the rule is promoted. If no, it is dropped.
3. **Active application**. Promoted rules are not buried in a markdown file. They are injected into agent context at session start, surfaced as warnings when relevant, and re-evaluated as new evidence arrives.

The data flywheel: more tasks → more outcomes → better rules → better tasks → more tasks. The system gets cheaper, faster, and more reliable with use, without explicit retraining.

---

## 3. What "Fully Autonomous" Means

Autonomy is not a binary. Bizar operates on a spectrum, and we name the levels so we can talk about progress concretely.

| Level | Name | Description | Where Bizar is |
|---|---|---|---|
| L0 | **Manual chat** | User types, model types back, no action. | — |
| L1 | **Assistant** | Model can call tools, but asks before any consequential action. | — |
| L2 | **Semi-autonomous** | Multi-step task with checkpoints. User approves plan, model executes, user reviews. | **Where Bizar is today** (plan-based HITL, kanban tasks, background agents) |
| L3 | **Autonomous for defined task classes** | For some task classes (dependency upgrades, test maintenance, doc updates), Bizar runs end-to-end with no human in the loop. | **Partially here** (background agents for some flows, but no formal task classes) |
| L4 | **Autonomous with HITL escalations** | Most task classes run autonomously. Human is escalated to only for council-triggered decisions. Daily time-in-HITL: minutes. | **Target for v6.x** |
| L5 | **Fully autonomous long-horizon** | Goals submitted days/weeks in advance complete without human input unless a council escalates. User reviews digests and approves outliers. | **Target for v7.x+** |

The honest current state: Bizar sits at L2, reaching into L3 for the narrow case of background agent spawns that complete cleanly. The platform's architecture (12 agent definitions, plan canvas, task board, memory vault) is set up for L4, but the runtime is not. The runtime is the work.

The v6.x line is the move from L2 to L4. The v7.x line is the move from L4 to L5.

---

## 4. What "Long-Horizon" Means

A long-horizon task is one that exceeds human attention span. Concretely:

- Spans more than one human working session (≥ 4 hours)
- Survives process restarts (server crash, machine reboot, model upgrade)
- Has a clear definition of done that can be checked automatically
- May have partial deliverables that are useful on their own
- May encounter surprises that require a different plan

Concrete requirements for long-horizon support:

| Requirement | Why it matters |
|---|---|
| **Checkpoint / resume** | A 4-hour task that crashes at 3h55m must not restart from zero. |
| **Session persistence across restarts** | The dashboard, server, and Claude Code runtime can all be killed. Work must survive. |
| **Decoupled human availability** | The human can be offline for hours or days. The system cannot block. |
| **Budget enforcement** | Long tasks can burn through money. A budget ceiling is mandatory. |
| **Deadline management** | Some tasks have soft deadlines. The system needs to know which. |
| **Dependency tracking** | Multi-step work has dependencies. Steps that depend on failed steps should not start. |
| **Partial-result durability** | A task that completes 7/10 sub-tasks must keep the 7. |

**Examples of long-horizon tasks**:

- **Multi-PR refactor**. A 5-PR refactor of an authentication module, where each PR has its own review cycle, tests, and merge. Total wall time: 3-5 days. Bizar opens, reviews, and merges each in sequence, pausing for human review at the architecture-changing PRs.
- **Codebase migration**. "Migrate this 200k-line Java codebase to Kotlin." Estimated 200 agent-hours. Bizar runs the migration in waves, with the human reviewing the weekly digest.
- **Ongoing security monitoring**. An always-on background loop. The task never completes; it just keeps running. Bizar owns the lifecycle.

The current Bizar architecture supports short-horizon work well (a 5-minute task that fits in one context window). Long-horizon is the gap. The runtime orchestrator, session persistence, and checkpoint/resume are the three legs of the table; without them, every long task is a prayer.

---

## 5. What "Human-in-the-Loop" Means in 2026+

HITL is not a single thing. It is a spectrum from "the human approves every keystroke" to "the human reads the weekly digest." Bizar's HITL model has four modes:

- **Strategic HITL**. The human is consulted on decisions that shape the direction of the work — architecture, scope, prioritization. Triggered by council decisions (Pillar 4). Low frequency, high signal.
- **Blocking HITL**. The human must approve before the action executes. Used for irreversible operations (merge to main, prod config change, data deletion). The system stops and waits. Always paired with a clear summary of what will happen if approved.
- **Observational HITL**. The human is watching — a dashboard, a notification, a feed. They can intervene at any time but don't have to. The system runs, the human is informed.
- **Background HITL**. The system runs, the human is asynchronously notified. No blocking, no live watching. The notification is the artifact (a digest, a PR, a summary).

The principle: **minimize blocking, maximize signal-to-noise for the human.** A HITL checkpoint that fires every 5 minutes and requires approval is not HITL — it is a babysitter. A HITL checkpoint that fires once a day with a clear summary of "here's what I did, here's what's pending your call" is HITL.

Target metrics for an active Bizar user:

- < 5 minutes of blocking HITL per day
- < 30 minutes of observational HITL per day (reading digests, skimming notifications)
- 1 strategic HITL decision per week (the council escalations that actually matter)
- Zero background HITL interruptions during deep-work blocks (notifications batched)

This is a UX target, not a current state. The current plan-approval polling (2-second poll, separate viewer) is closer to "babysitter" than "informant." Replacing it is a Tier 1 priority.

---

## 6. The Roadmap Trajectory

The journey from L2 to L5 is structured as three phases. The companion `ROADMAP.md` details the specific deliverables per tier; this section explains the arc.

### Phase 1: Foundation (now → v6.x; v6.3.0 Claude Code migration complete)

**Status: shipped.** Bizar at v6.3.0 has a complete CLI, dashboard, Claude Code MCP server, memory service, 12 agent definitions, and 656+ plugin + 71+ SDK + 27+ E2E + 73/73 audit tests. The platform is usable for one-shot and short-horizon work. Long-horizon is the gap.

What is in place:
- CLI (15+ command modules, `install/update/dash/service/bg/memory/plan/doctor/test-gate/...`)
- Dashboard server (v1 on `:4097`, v2 on `:4098`, 18 memory endpoints, mods loader with security layer, task delegator, background agent retry loop, structured logging, Prometheus metrics)
- Dashboard web (17 views, kanban tasks, plan canvas, settings with auto-save, memory tab with 5 panels, doctor page, 178 vitest tests)
- Claude Code MCP server (22 tools, background agent system with stall detection, loop guard, compaction gate at 50% context; plugin rewired from Cline `AgentExtension` to Claude Code `@anthropic-ai/claude-agent-sdk` MCP tool registration in v6.3.0)
- Memory service (3 vault modes, 11 CLI subcommands, 18 REST endpoints, Obsidian-compatible Markdown, git-backed sync, secret scanning)
- Self-improvement log (1,139 lines of lessons learned, read by agents at session start)

What is missing for the long-horizon promise:
- A runtime agent orchestrator (today's "routing" is LLM-driven prompt text)
- True parallel execution (today's `task` calls are sequential)
- Session persistence (background agents die on restart)
- Checkpoint/resume (a 4-hour task that crashes starts over)
- Real HITL (today's plan approval is polling, not push)

### Phase 2: Long-Horizon (v6.x)

**The big pivot.** v6.x is the line where Bizar transitions from "a tool that helps with one task" to "a platform that runs a multi-day project." The deliverables:

- **Runtime agent orchestrator**. A service that owns work-in-progress, dispatches to agents, tracks state, and survives restarts.
- **Session persistence**. Background agents write their state to disk; on restart, the orchestrator picks up where they left off.
- **DAG-based planning**. Plans become executable graphs with explicit dependencies, parallel branches, and per-step status.
- **True fork-join parallelism**. A parent agent dispatches N children, awaits all or any, and merges results.
- **Queue and scheduling**. The current 8-instance hard cap becomes a configurable queue with priority and deadline awareness.
- **In-chat HITL**. Plan approval moves into the chat surface, replacing the polling viewer.
- **Interruptible agents**. Pause, resume, and redirect mid-execution.

The result: tasks that span hours run end-to-end. Tasks that span days run with daily human checkpoints. Tasks that span weeks become plausible.

### Phase 3: Intelligence (v7.x+)

**The platform becomes self-improving.** v7.x layers the intelligence on top of the runtime:

- **Automated self-improvement loop**. Outcomes are observed, patterns clustered, rules proposed, rules tested, rules applied — without prompting.
- **Agent council implementation**. The trigger rules from Pillar 4 become runtime code, not aspirational docs.
- **Agent hierarchy enforcement**. The tree from Pillar 3 is mechanically enforced. Lower-level agents can't exceed their scope.
- **Multi-agent validation as a primitive**. Any task can opt into N-way validation. The cost of validation is metered and bounded.
- **Persistent task memory as context**. Completed task results are auto-injected into relevant future tasks. The system remembers what it has done.
- **Cost-aware routing**. The orchestrator tracks actual token costs per task and routes to the cheapest capable model within budget.

The result: Bizar gets cheaper, faster, and more reliable with use. A user who has been running Bizar for 6 months has a measurably better system than one who just installed it yesterday.

---

## 7. Success Metrics

Twelve to twenty-four months from now, the metrics that would tell us the Final Goal is being met:

**Operational:**
- **Tasks running 24+ hours with no human intervention.** Count and average duration. Target: 50+ such tasks/week for an active user.
- **Multi-day tasks completing end-to-end.** Target: 80% completion rate (vs. ~0% today).
- **Background agents surviving process restarts.** Target: 95% of in-flight agents resume successfully after a dashboard restart.

**Decision quality:**
- **Agent council catching bad decisions.** Measure: of decisions the council flagged as risky, what % would have caused real harm if executed solo? Target: > 70% catch rate.
- **Solo execution error rate on reversible work.** Target: < 5% post-hoc corrections needed.
- **HITL escalation accuracy.** Of council escalations, what % did the human agree with the council's recommendation? Target: > 80% agreement (low = councils are wrong; high = councils are over-escalating).

**Self-improvement:**
- **Rules actually changing agent behavior.** Measurement: regression tests where a rule is "applied" vs. "not applied" and we score the difference. Target: 5+ rules with measurable positive impact.
- **Active rules count and decay rate.** Target: 20-50 active rules, with rules demoted when invalidated.
- **Time from "lesson learned" to "rule applied"**. Target: < 1 week.

**User experience:**
- **Time spent in HITL checkpoints per day** (active user). Target: < 5 minutes blocking, < 30 minutes observational.
- **Long-horizon task completion rate, 90th percentile.** Target: > 80% (autonomous, no human needed).
- **Council escalations per week** (active user). Target: 1-3 (low enough to not annoy, high enough to demonstrate the system is making real decisions).

**Cost:**
- **Cost per task, autonomous vs. human-comparable.** Target: autonomous cost < 10% of human-comparable cost for the same task class.
- **Model cost distribution.** Target: 80%+ of token spend on the cheapest capable model per task.

**Adoption:**
- **Active Bizar users running 10+ agent tasks/week.** Target: growing month-over-month.
- **Tasks that complete via the full pipeline (orchestrator → multiple agents → council → done).** Target: 100+ such tasks/week for an active user.

**Research pillar:**
- **Research agent citation accuracy.** Of claims made by research agents, what % are verified against cited sources? Target: > 90%.
- **Source freshness score.** For "current best practice" queries, median age of cited sources. Target: < 6 months.
- **Research → Action conversion rate.** What % of research outputs lead to a subsequent agent action (a plan, a council deliberation, a patch)? Target: > 40%.
- **Scheduled research feed coverage.** % of monitored topics with data fresher than their update interval. Target: > 85%.

These are not promises — they are targets. If twelve months from now we cannot measure progress against them, the Final Goal is not being met.

---

## 8. Non-Goals

Bizar is a focused platform. The things we are **not** building:

- **A RAG-only product.** Memory is a tool, not the product. We do not sell "vector search for your docs."
- **An agent framework for end users.** Bizar is the platform we use to ship Bizar. We are not building a low-code agent builder for non-developers.
- **A replacement for an IDE.** Bizar orchestrates work; humans still write code in their preferred editor. We integrate with Claude Code; we do not replace it.
- **A general-purpose AI assistant.** Bizar is for engineering work. It is not a chatbot.
- **A model provider.** We use existing models. We do not train or fine-tune our own (though the self-improvement loop may *suggest* fine-tuning data — a different thing).
- **AGI.** We are not building a generally intelligent system. We are building a focused platform that does engineering work well, with human escalation when judgment is needed.

These non-goals are not apologies for what is missing. They are boundaries that keep the platform sharp. A platform that tries to be everything is a platform that is bad at one thing.

---

## 9. The Closing Statement

The interesting work in software is not the typing — it is the judgment. The design choices, the trade-off calls, the "do we refactor this or leave it" decisions, the "is this a bug or a feature" calls. The typing can be delegated. The judgment cannot.

But judgment is expensive. It is the bottleneck on every team. A senior engineer's day is 80% waiting for the right moment to apply judgment, and 20% applying it. If the waiting can be eliminated — if the typing, the tests, the dependency upgrades, the security patches, the doc updates, the refactors of well-understood code, the migrations of well-trodden patterns, are all handled by an autonomous system that knows when to escalate — then the senior engineer's day becomes 80% judgment and 20% of the rest. That is a 4x leverage on the most expensive person in the room.

That is what Bizar is for. Not to replace engineers. To make their judgment the dominant activity of their work.

The six pillars — loops, multi-agent validation, agent hierarchy, agent council, constant self-improvement, specialist research — are the mechanisms. The levels — L2 to L5 — are the stages. The roadmap is the path. The success metrics are how we know we got there. And running underneath all of them is research — the layer that keeps every other pillar's knowledge fresh, cited, and current. Councils deliberate better with evidence; hierarchies make better decisions with verified facts; self-improvement learns from the latest techniques, not last year's.

The future we are building toward is a world where a single engineer with Bizar can ship what a team of ten ships today, where the routine work is a background process and the high-judgment work is the only thing the human does. That world is not AGI. It is a focused platform that knows its limits and earns the trust to operate within them.

That is the Final Goal. Everything else is execution.
