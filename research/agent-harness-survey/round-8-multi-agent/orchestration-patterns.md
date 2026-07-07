# Multi-Agent Orchestration Patterns — The 2026 Survey

**Round 8 — Multi-Agent Deep Study**
**Scope:** Exhaustive analysis of multi-agent orchestration primitives across the four source repositories (Hermes, OpenFang, OpenClaw, best-of-Agent-Harnesses) and the curated best-of catalog (OpenAI Agents SDK, CrewAI, AutoGen, LangGraph, Microsoft Agent Framework, PraisonAI, agent-squad, MetaGPT).
**Date:** 2026-07-06
**Author:** @tyr (round 8 of the agent-harness survey)
**Companion:** `round-8-multi-agent/bizar-multi-agent-redesign.md` — applies these findings to Bizar.

This is the deepest survey yet of *how agents coordinate*. Rounds 4, 5, and 6 each profiled one repo's multi-agent story end-to-end; round 7 added eight more projects from the curated catalog. This round takes those sixteen projects and asks: *what primitives does the multi-agent landscape actually use, and how do they compose?*

Every claim is cited to a file or doc reference. The notation is `path:line` for code, `doc.md#section` for prose.

---

## Section 0 — Why a Multi-Agent Survey Now

By mid-2026 the multi-agent landscape has hardened into a small set of patterns. Looking at the eight framework projects from R7 alone, four primitives dominate: handoffs, roles, group chat, and graphs. The four "self-hosted harness" projects (Hermes, OpenFang, OpenClaw, Bizar itself) layer additional primitives on top — event buses, task boards, message-passing SOPs, gateway-mediated routing.

The point of this round is to name those primitives, trace each to its canonical implementation, and surface the cross-cutting patterns that the 2026 cohort has converged on. R7 said: *"Convergence on graphs."* R8 confirms it and adds: **the four production-grade frameworks (LangGraph, Microsoft Agent Framework, OpenClaw gateway, OpenFang kernel) are graph-shaped internally even when their user-facing API is role-shaped.** Bizar's tier-3+ dispatch should learn from this.

The structure below is intentionally cross-cutting. Section 1 names the five universal primitives. Sections 2 through 6 layer the *cross-cutting concerns* (coordination protocol, IPC, context sharing, failure, observability) that every system has to address regardless of which primitive it picks. Section 7 is the master matrix. Section 8 lists the universal anti-patterns that recur across all systems.

---

## Section 1 — The Five Universal Primitives

Across sixteen systems studied, five coordination primitives appear repeatedly. They are *not* mutually exclusive — most systems use two or three of them in combination. They are *primitives* in the sense that every higher-level pattern composes them.

### 1.1 — Handoffs

**Definition.** One agent transfers control of a conversation (or task) to another agent. The conversation thread, partial results, and any accumulated context move with the handoff. The receiving agent takes over from the sender.

**Canonical implementation.** OpenAI Agents SDK (`openai/openai-agents-python`). From the R7 profile: *"Handoffs are a first-class delegation primitive — an agent's `handoffs=[...]` list declares which other agents it may pass the conversation to, and the receiving agent sees the full conversation thread so far."* (`round-7-bestof-deep/multi-agent-memory.md:60`). The SDK supports two forms: (1) call another agent **as a tool** (synchronous return inline) or (2) **hand off** the conversation to another agent (the new agent takes over the thread).

**Strengths.**
- Cheapest framework to walk away from. The best-of catalog tags it the smallest adoption surface (`comparisons/multi-agent-orchestration.md:8`).
- Linear mental model — "I can't continue; pass it to someone who can."
- Easy to test. A handoff is a typed function call.

**Weaknesses.**
- No group conversation. Only one-to-one.
- Hard to recover from a misrouted handoff (no peer review).
- The receiver inherits the sender's conversation context — useful for state, costly for token budget.

**Best use case.** Call-center-style escalation. Tier-1 support can't solve, hands off to Tier-2 specialist. The conversation continues with the same history.

**Bizar relevance.** *Highest.* Bizar's Odin → Thor → Tyr → Vidarr dispatch is fundamentally a handoff pattern, even though it's named "dispatch." The receiving agent (e.g., Tyr) gets a fresh context — it does not inherit Odin's conversation. That's a *deliberate* divergence from OpenAI Agents SDK's handoff semantics. See R7 §1.5 for the trade.

**Variant: handoff with topic inheritance.** OpenAI Agents SDK passes the conversation. The "Handoff" pattern in agent-squad (`2FastLabs/agent-squad`, R7 §6) is similar but routing is classifier-driven: an LLM (or a deterministic classifier) picks the next agent, the orchestrator routes the message, the agent sees the user message and prior agent outputs but not the internal reasoning.

### 1.2 — Roles

**Definition.** Agents have fixed roles in a team (Product Manager, Engineer, Researcher). Each role has a system prompt and a tool set. Work is decomposed into tasks and assigned to roles. The team is an org chart.

**Canonical implementations.** CrewAI (`crewAIInc/crewAI`) and MetaGPT (`FoundationAgents/MetaGPT`).

CrewAI's R7 profile: *"The Crew layer is role-engineered. Every agent declares a role, goal, and backstory. Tasks declare a description, expected_output, optionally an agent= assignment, and a context= list of tasks whose outputs feed into this one. A Process selects the execution order — Process.sequential (default), Process.hierarchical (a manager agent delegates)."* (`round-7-bestof-deep/multi-agent-memory.md:89`).

MetaGPT's profile: *"Roles are sequential along an SOP; handoffs happen by the next role's Watch rule firing on a Message published by the upstream role. The closest analog is a real software company's waterfall process."* (`round-7-bestof-deep/multi-agent-memory.md:278`).

**Strengths.**
- Most readable to non-engineers. "I'm the researcher, I produce reports" is a familiar mental model.
- YAML-declarable. CrewAI's `crewai create` scaffold emits `agents.yaml` + `tasks.yaml`.
- Natural for waterfall / SOP-shaped work (MetaGPT).

**Weaknesses.**
- Roles are *system prompts*, not enforced personas. Two agents with the same role are behaviorally indistinguishable. R7: *"Roles are not behavior."*
- Hierarchical mode is undertested in practice; the LLM-as-manager loop frequently stalls.
- Process abstraction leaks — sequential is trivial, hierarchical is sticky, custom processes require reading framework internals.

**Best use case.** Software-company simulations. Pipelines where each step has a clear deliverable type (PRD → design → code → test).

**Bizar relevance.** *Low.* Bizar's agents are defined by *capability* (Thor implements, Mimir researches) rather than *role*. Baldr "the designer" is closer to a role; Tyr "the complex implementer" is closer to a tier. The lesson worth taking: **CrewAI's separation between "Crew" (autonomy) and "Flow" (deterministic control) maps cleanly to Bizar's separation between "subagent dispatch" (autonomy) and "approval gate" (deterministic control).** See R7 §2 "Bizar relevance".

### 1.3 — Group Chat

**Definition.** N agents converse in a shared channel. A speaker-selection mechanism (round-robin, LLM-driven, or hand-off rules) picks who speaks next. Messages are visible to all participants. Conversation continues until a termination condition.

**Canonical implementation.** AutoGen (`microsoft/autogen`). R7: *"The original AutoGen model is group chat: a GroupChat of agents + a GroupChatManager that selects the next speaker. Two sub-flavor patterns emerged: speaker selection by LLM (manager calls a model each turn to decide who speaks) and speaker selection by handoff rules (each agent declares conditions under which it passes to another)."* (`round-7-bestof-deep/multi-agent-memory.md:128`).

**Strengths.**
- Genuinely conversational problems. Brainstorming, debate, negotiation sims.
- Emergent behavior. No predetermined flow.
- Easy to extend — add a participant, the conversation adapts.

**Weaknesses.**
- **Maintenance mode.** AutoGen's README carries a `⚠️ Maintenance Mode` banner redirecting to Microsoft Agent Framework (`round-7-bestof-deep/multi-agent-memory.md:120`). Building on AutoGen in 2026 is choosing yesterday's best.
- **API churn.** v0.2 → v0.4 was a breaking rewrite (`round-7-bestof-deep/multi-agent-memory.md:143`).
- **Hard to test.** Conversations are emergent; reproducibility is poor.
- **Cost unpredictability.** A group chat can spin if no agent recognizes termination.

**Best use case.** Code review panels, adversarial red/blue teams, brainstorm sessions. Anywhere the *interaction* itself is the work.

**Bizar relevance.** *Low.* R7 framed Bizar as *"what Odin, Thor, Tyr, and Vidarr would be if they were chat participants. That is not the right model."* Bizar's strength is the gate (Forseti, tier enforcement), not free-form conversation. The patterns worth borrowing: `AgentTool` for agent-as-tool, and the explicit maintenance-mode banner (R7 §3 "Bizar relevance" item 2).

### 1.4 — State Machines (Explicit Graphs)

**Definition.** The "team" is a directed graph of nodes (functions or agents) and typed edges. The runtime ticks node-by-node, persisting state at each checkpoint. Edges can be conditional ("if classifier returned X, go to node Y") or parallel ("fan out from this node to N"). This is the *production-grade* primitive because it makes the workflow explicit, durable, and replayable.

**Canonical implementations.** LangGraph (`langchain-ai/langgraph`), Microsoft Agent Framework (`microsoft/agent-framework`), CrewAI Flows. R7's master synthesis: *"graph is winning... LangGraph, MAF, CrewAI Flows all talk the same graph vocabulary."* (`round-7-bestof-deep/multi-agent-memory.md:642`).

LangGraph's primitives are the smallest: **StateGraph** (typed state), **Nodes** (functions or agents), **Edges** (typed routing), **Checkpointer** (state persistence), **Interrupt** (human-in-the-loop primitive). R7: *"The runtime is a graph that ticks node-by-node, persisting state at each checkpoint so a crashed run can resume from the last good checkpoint."* (`round-7-bestof-deep/multi-agent-memory.md:309`).

Microsoft Agent Framework's `docs/agent-framework/README.md` describes workflows that are *"graph-based workflows supporting sequential, concurrent, handoff, and group collaboration patterns"* (`round-7-bestof-deep/multi-agent-memory.md:164`). The same library serves all four patterns under one API.

**Strengths.**
- **Durability.** Checkpoints let a workflow resume from any node after a crash.
- **Human-in-the-loop as a first-class primitive.** LangGraph's `Interrupt` pauses the graph and waits for human input (`round-7-bestof-deep/multi-agent-memory.md:315`).
- **Time-travel debugging.** Combined with LangSmith, you can replay a workflow with mutated state.
- **Statically inspectable.** You drew the graph; you can show it to a reviewer.

**Weaknesses.**
- Boilerplate. `StateGraph` + `add_node` + `add_edge` + `compile` + `invoke` is more setup than a CrewAI `crewai run`.
- Mental model barrier. NetworkX-style API is familiar to graph theorists, less so to web developers.
- Churn. LangGraph 0.x → 1.0 in 2025 produced breaking changes.

**Best use case.** Production deployments that must survive restarts, human approval checkpoints, or long durations. R7: *"If your 'multi-agent system' is honestly a workflow with LLM steps, this is the right honesty."* (`round-7-bestof-deep/multi-agent-memory.md:22`).

**Bizar relevance.** *Highest, long-term.* R7's biggest lesson: **"workflows are graphs."** Bizar's task dispatch should not be a tree; it should be a graph with edges for "depends on," "parallelizable with," and "audit-required before." Trajectory capture (B.6 in R3) plus graph state gives Bizar durable replay as a side effect. See R7 §8 "Bizar relevance" and §3 "Cross-cutting takeaway."

### 1.5 — Event Bus

**Definition.** Agents publish events to a shared bus; other agents subscribe to patterns and react when matching events arrive. Pub/sub decouples producers from consumers. Events can carry data, be replayed from a history buffer, and trigger cascading workflows.

**Canonical implementations.** OpenFang (`repos/openfang/crates/openfang-kernel/src/event_bus.rs`) is the strongest example in the source repos. The event bus is the central nervous system of OpenFang's kernel. From R5: *"Direct Hand-to-Hand communication is not implemented. There is no message-passing between Hand instances. However, three indirect channels exist: shared knowledge graph, event bus, and shared memory namespace."* (`round-5-openfang-deep/hands-system.md:280`).

The implementation: `EventBus { sender: broadcast::Sender<Event>, agent_channels: DashMap<AgentId, broadcast::Sender<Event>>, history: Arc<RwLock<VecDeque<Event>>> }` (`repos/openfang/crates/openfang-kernel/src/event_bus.rs:14-22`). The bus retains a 1000-event history ring buffer and supports four target modes: Agent (direct), Broadcast, Pattern (broadcast + match), System (`event_bus.rs:53-72`).

The trigger engine on top: `TriggerEngine::register(agent_id, pattern, prompt_template, max_fires)` (`repos/openfang/crates/openfang-kernel/src/triggers.rs:100-119`). When a matching event arrives, the trigger engine sends the event content as a message to the subscribing agent. This is event-driven automation.

Hermes has a related primitive in the `process_registry.completion_queue` (R4 §1.4): async background completions re-enter the conversation as fresh turns via a drain loop. Hermes's bus is simpler (no pattern matching, no broadcast) but solves the same problem: events cross agent boundaries.

**Strengths.**
- Decoupling. Producers don't know who consumes.
- Event history. The 1000-event ring buffer in OpenFang supports audit and replay.
- Cascading workflows. A trigger can fan out to N agents, each reacting differently.
- Pattern matching. Triggers can fire on substring, lifecycle, agent-spawned, agent-terminated, system keyword, memory update, memory key pattern, or wildcard (R5 `triggers.rs:40-58`).

**Weaknesses.**
- Ordering and causality are tricky. Event N may arrive before Event N-1 if they originate from different agents.
- No transactional guarantees. Two events firing in parallel may produce inconsistent state.
- Fan-out can amplify. A noisy publisher wakes every subscriber.
- Requires careful history retention. OpenFang caps at 1000; the boundary is arbitrary.

**Best use case.** Reactive automation. OpenFang's `event_publish` is the most idiomatic example: a Hand publishes "company X announced funding" and any other Hand subscribed to `ContentMatch { substring: "funding" }` wakes up to enrich the knowledge graph. The state-machine pattern handles sequential workflows; the event-bus pattern handles reactive ones.

**Bizar relevance.** *High, future.* Bizar currently has no event bus. Subagent dispatch is synchronous (`task` tool) or asynchronous via `bizar_spawn_background` (R3 §B.7), but there is no shared event stream. The architectural insight: an event bus would let Odin publish "Tyr dispatched for tier-4 implementation" and have Forseti auto-subscribe to audit completion. See Section C of `bizar-multi-agent-redesign.md`.

### 1.6 — The Other Primitives (Not Universal but Recurrent)

Three more primitives appear in three or more systems but did not crack the "universal" set:

**Classifier routing.** Agent Squad (`2FastLabs/agent-squad`) makes the classifier a first-class component. *"A Classifier (LLM-based by default; pluggable) picks the best agent for the turn from the registered pool... Crucially, the classifier picks from agent descriptions — so the agent roster is the explicit surface the developer authors."* (`round-7-bestof-deep/multi-agent-memory.md:237`). This is the "router with descriptions" pattern. Bizar's Odin is essentially a manual classifier (LLM picks the right agent from a routing table).

**SOP / message-passing.** MetaGPT's signature pattern. Roles pass structured `Message` objects along a `Watch`-rule graph. The closest analog is a real software company's waterfall process. Bizar's existing dispatch is *not* this — it's a flat fan-out to a tier.

**Auto-generated agents.** PraisonAI: *"The advanced model is 'I give it a goal; it generates the agents.' This is closer to CrewAI in spirit (role-based) but with more onboarding paths and fewer opinionated conventions."* (`round-7-bestof-deep/multi-agent-memory.md:207`). The `auto` mode is the opposite of Bizar's hand-curated agent roster.

**Gateway-mediated routing.** OpenClaw's pattern. *"The Gateway is OpenClaw's central control plane: a local HTTP/WebSocket server that owns authentication, routing, session management, channel lifecycle, plugin supervision, and cron scheduling."* (`round-6-openclaw-deep/gateway.md:11`). The gateway is a process-singleton that brokers all inter-agent traffic. Agents don't talk directly to each other; they go through the gateway.

---

## Section 2 — The Coordination Protocol Stack

A multi-agent system needs six layers of plumbing regardless of which primitive it picks. The sixteen systems differ less on *which* layers they have than on *how deep* each layer is.

### 2.1 — Discovery

**How do agents find each other?**

| System | Mechanism | Citation |
|---|---|---|
| **OpenAI Agents SDK** | Declarative `handoffs=[...]` list on each agent. The agent knows its peers at definition time. | `round-7-bestof-deep/multi-agent-memory.md:60` |
| **CrewAI** | Crew composition in YAML or Python. Agents are listed in the Crew. | `round-7-bestof-deep/multi-agent-memory.md:89` |
| **AutoGen** | `GroupChat(agents=[...])` constructor. All agents in the chat. | `round-7-bestof-deep/multi-agent-memory.md:128` |
| **LangGraph** | `StateGraph.add_node(node_id, fn)`. Nodes are registered in the graph. | `round-7-bestof-deep/multi-agent-memory.md:309` |
| **Microsoft Agent Framework** | Workflow graph constructor (same vocabulary). | `round-7-bestof-deep/multi-agent-memory.md:164` |
| **PraisonAI** | `Agents(agents=[...]).start()`. Explicit list, OR `auto` mode generates from goal. | `round-7-bestof-deep/multi-agent-memory.md:207` |
| **Agent Squad** | Orchestrator + Classifier. Agents register with descriptions; classifier routes. | `round-7-bestof-deep/multi-agent-memory.md:237` |
| **MetaGPT** | SOP graph. Each role declares `Watch` rules; the SOP wires them. | `round-7-bestof-deep/multi-agent-memory.md:278` |
| **Hermes** | `delegate_task` is the only entry. Subagent constructed fresh from parent's config + role. | `round-4-hermes-deep/subagent-rpc.md:25-50` |
| **OpenFang** | Static manifest at compile time (`bundled.rs:6-53`). All Hands known; activation is runtime. | `round-5-openfang-deep/hands-system.md:13` |
| **OpenClaw** | Gateway-mediated. Agents register with the gateway; channel bindings map inbound sources to agents. | `round-6-openclaw-deep/memory-tools.md:154-163` |
| **Bizar** | Static `config/opencode.json` (12 agents). Odin knows all agents at startup. | `config/opencode.json:60-271` |

**Pattern.** Most systems use static declaration (YAML, manifest, or config file). The dynamic systems are PraisonAI's `auto` mode and the event-bus triggers. Bizar's current static config is the most common pattern but it loses the ability to add agents at runtime without restart.

### 2.2 — Identity

**How are agents addressed?**

| System | Identity scheme | Citation |
|---|---|---|
| **OpenAI Agents SDK** | Python object identity (agent is a class instance). | `round-7-bestof-deep/multi-agent-memory.md:53` |
| **CrewAI** | Agent role name (string). | `round-7-bestof-deep/multi-agent-memory.md:89` |
| **LangGraph** | Node ID (string). | `round-7-bestof-deep/multi-agent-memory.md:309` |
| **Hermes** | `task_id` — `subagent-<index>-<uuid>` per child agent. | `round-4-hermes-deep/subagent-rpc.md:324` |
| **OpenFang** | `AgentId` — UUID. Plus optional instance name for multi-instance Hands. | `round-5-openfang-deep/hands-system.md:11` |
| **OpenClaw** | `agentId` string. Default is `"main"`; secondary agents have user-chosen IDs. Per-agent `agentDir` directory. | `round-6-openclaw-deep/memory-tools.md:163` |
| **Bizar** | Agent name (string key in `config/opencode.json`). The `default_agent` is `"odin"`. | `config/opencode.json:5, 60-271` |

**Pattern.** Stable string identifiers are universal. UUIDs are used where uniqueness across restarts matters (Hermes, OpenFang). Bizar's string-name convention is fine for static config but would break if agents could be added at runtime. The fix: keep string-name as the user-facing identity, add a UUID-via-hash as the runtime identity.

### 2.3 — Routing

**How does a message reach the right agent?**

The three most common patterns are:

**1. Hard-coded (the "table" pattern).** Bizar's `config/opencode.json` describes each agent's role in prose. Odin's routing heuristic table (`AGENTS.md` §"Routing Heuristic") maps task types to agent names. There is no dynamic routing — Odin reads the table and picks. Same pattern in `bizar audit` which routes to `forseti` (`config/opencode.json:273-277`).

**2. Model-driven (the "router LLM" pattern).** agent-squad's classifier is an LLM that picks the agent from descriptions. The classifier receives the user message + agent roster and emits an agent name. *"A Classifier (LLM-based by default; pluggable) picks the best agent for the turn from the registered pool."* (`round-7-bestof-deep/multi-agent-memory.md:237`).

**3. Graph-shaped (the "edge" pattern).** LangGraph routes via graph edges. Each node can have a conditional edge function that decides the next node based on the current state. *"Edges (typed routing)."* (`round-7-bestof-deep/multi-agent-memory.md:309`).

**4. Event-bus pattern.** OpenFang's triggers subscribe to event patterns. Routing is implicit — if your pattern matches, you wake up.

**Bizar relevance.** The current hard-coded routing table is the right v1 shape. The longer-term move is to make it capability-based: agents publish their *capabilities* (search, edit, plan, audit), Odin picks by capability match rather than by literal agent name. See Section D of the redesign document.

### 2.4 — State Sharing

**How do agents share context?**

This is the topic of Section 4 below. The short version: most systems use a mix of (a) message passing (each message carries context), (b) shared memory store (facts extracted to a shared graph), and (c) parent-child inheritance (child sees parent's filtered context).

### 2.5 — Synchronization

**How do agents coordinate timing?**

| Mechanism | Used by | Notes |
|---|---|---|
| **Synchronous fan-out** | Bizar (`task` tool with `parallel: true`), Hermes (`delegate_task` batch mode) | Parent blocks until all children return. |
| **Async background + poll** | Bizar `bizar_spawn_background`, OpenClaw `subagent_spawn` | Parent gets an instance ID, polls later via `bizar_collect`. |
| **Group chat lockstep** | AutoGen | Group chat is naturally synchronized — one speaker at a time. |
| **Graph checkpoint** | LangGraph | State at each node is the synchronization point. |
| **Event-driven wake** | OpenFang triggers | No clock; events are the synchronization signal. |
| **Cron / schedule** | OpenClaw `cron.*`, Hermes `cron/scheduler.py`, OpenFang `CronScheduler` | Time-based sync. |

**Pattern.** Synchronous is simplest; async is necessary for long-running work; event-driven is the only way to do reactive automation. Bizar covers sync (task) and async (background) but not event-driven. The redesign proposes an event bus to close that gap.

### 2.6 — Failure Handling

This is its own section (Section 5). Briefly: every system has *some* failure handling, but coverage varies wildly. LangGraph is the gold standard (checkpoints + time-travel). Bizar's failure handling is partial (loop guard, plugin shutdown); the redesign proposes structured dead-letter handling.

---

## Section 3 — IPC Patterns

Inter-process communication is where the systems diverge most. The right IPC for a coding harness is not the right IPC for a personal-assistant OS.

### 3.1 — The IPC Catalog

**In-process function calls.** Hermes's `delegate_task` is "just a Python function call that blocks the parent on the child's full result, mediated by `ThreadPoolExecutor`/`DaemonThreadPoolExecutor`." (`round-4-hermes-deep/subagent-rpc.md:14`). The parent and child share the same Python interpreter, the same tool registry, the same SQLite store, the same file state. The IPC is a function call. The cost is zero (no serialization). The risk is shared failure modes — a child crash can corrupt parent's state.

**Unix domain sockets (UDS).** Hermes's PTC (Programmatic Tool Calling) uses UDS for local backend: *"Parent opens a Unix domain socket and starts an RPC listener thread; tool calls travel back to the parent for dispatch over UDS."* (`round-4-hermes-deep/subagent-rpc.md:431`). The protocol is newline-delimited JSON with an `rpc_token` for auth (`code_execution_tool.py:515-520`). The same pattern works for cross-language: UDS is a byte stream.

**File-based RPC.** Hermes's remote backend uses filesystem polling. *"Script writes req_NNNNNN request file in the sandbox's HERMES_RPC_DIR. Parent's polling thread (env.execute("ls -1 …/req_* 2>/dev/null") every 100ms) sees the request."* (`round-4-hermes-deep/subagent-rpc.md:651`). Slower than UDS but works across network boundaries. Used when the script runs on a remote host (Docker, SSH, Modal, Daytona).

**Shared knowledge graph.** OpenFang's inter-Hand communication is *not* message-passing. *"Direct Hand-to-Hand communication is not implemented. There is no message-passing between Hand instances. However, three indirect channels exist: shared knowledge graph, event bus, and shared memory namespace."* (`round-5-openfang-deep/hands-system.md:280`). Hand A stores an entity; Hand B queries it. Latency is the SQLite write/select round-trip (~ms).

**Event bus.** OpenFang's central nervous system. `event_publish` puts an event on the bus; `TriggerEngine` matches patterns; subscribers wake up. Latency is async (no blocking); ordering is best-effort.

**Task board.** OpenFang's `task_post` / `task_claim` / `task_complete` / `task_list` tools implement a shared queue in SQLite. *"All Hands have access to task_post, task_claim, task_complete, task_list. The shared task queue in SQLite (task_queue table) allows Hands to coordinate work."* (`round-5-openfang-deep/hands-system.md:297`). This is the classic producer/consumer pattern.

**Gateway-mediated routing.** OpenClaw. *"The actual AI agent runs downstream in the agent runtime, which connects to the gateway as a client. This separation means the gateway is always-on (surviving individual agent turns) while the agent runtime spins up and tears down per conversation."* (`round-6-openclaw-deep/gateway.md:11`). The gateway is a singleton Node process; agents are clients. IPC is HTTP/WS via 90+ RPC methods (`round-6-openclaw-deep/gateway.md:43-160`).

**Function-call handoffs.** OpenAI Agents SDK. The receiver gets the conversation thread; the handoff is a typed function call. Synchronous. Linear.

**Group-chat speaker selection.** AutoGen. Each turn, the manager picks the next speaker. All agents see the full transcript.

**Graph state with conditional edges.** LangGraph. State at each node is the shared memory; edges are routing functions. Per-node, synchronous within a tick.

**Typed message envelopes.** MetaGPT. *"Every agent interaction is a typed message with a Watch rule, not a chat."* (`round-7-bestof-deep/multi-agent-memory.md:295`). Strong typing + Watch rules = more structure than AutoGen's free chat.

### 3.2 — When to Use What

| IPC | Strength | Weakness | Best for |
|---|---|---|---|
| **In-process call** | Zero latency, shared state | Shared failure modes | Subagent in same language runtime |
| **UDS** | Fast, language-agnostic | Single host | Local cross-language (e.g. Bizar plugin ↔ subprocess) |
| **File-based RPC** | Cross-network | Polling latency | Remote backends (Docker, SSH, Modal) |
| **Shared graph** | Persistent, queryable | Stale data risk | Cross-session knowledge sharing |
| **Event bus** | Decoupled, async | Ordering issues | Reactive workflows |
| **Task board** | Producer/consumer, durable | Polling for new tasks | Work-queue style coordination |
| **Gateway RPC** | Strong contracts, audit | Latency, gateway = single point | Multi-channel agent OS (OpenClaw model) |
| **Function handoff** | Simple, typed | Linear only | Call-center escalation |
| **Group chat** | Emergent | Untestable | Brainstorm / review panels |
| **Graph state** | Replayable, durable | Boilerplate | Production workflows |
| **Typed message** | Structured | SOP-dependent | Software-company simulations |

**Bizar relevance.** Bizar currently uses two IPCs: the opencode `task` tool (synchronous, string-prompt / string-answer) and `bizar_spawn_background` (asynchronous, HTTP to dashboard). Neither carries structured state. The redesign proposes three additions: (1) a typed message envelope over the `task` tool (so Odin can pass `Message` instead of `string`), (2) an event bus (Section C.2 of the redesign), and (3) capability-based discovery so agents can find peers without knowing their names.

---

## Section 4 — Context Sharing Models

How agents share conversation state is the most consequential design decision in any multi-agent system. Get it wrong and you blow token budgets; get it right and you get efficient collaboration.

### 4.1 — The Five Models

**Model A: Fully isolated.** Each agent has its own context. The parent sees only the final summary. This is Hermes's default: *"The parent's context only sees the delegation call and the summary result, never the child's intermediate tool calls or reasoning."* (`round-4-hermes-deep/subagent-rpc.md:21-23`). Token-efficient; the parent does not pay for the child's exploration. Cost: the parent cannot validate the child's reasoning.

**Model B: Shared parent context.** Child sees parent's full message log. OpenAI Agents SDK handoff: *"the receiving agent sees the full conversation thread so far"* (`round-7-bestof-deep/multi-agent-memory.md:60`). The child has full context for its task. Cost: token budget compounds as conversation grows.

**Model C: Shared memory store.** A knowledge graph, FTS5 index, or key-value store that any agent can read/write. OpenFang's primary inter-agent channel. *"The knowledge graph (crates/openfang-memory/src/knowledge.rs) is backed by the shared SQLite database. Any Hand can query what another Hand has stored."* (`round-5-openfang-deep/hands-system.md:284`). The model is "store facts; retrieve facts." It is *not* a conversation log — it's a knowledge layer.

**Model D: Shared workspace (filesystem).** The OS filesystem as coordination surface. Hermes's `file_state` registry tracks per-task read/write stamps so parallel subagents don't clobber each other (`round-4-hermes-deep/subagent-rpc.md:356-368`). OpenFang's Hands write to `~/.openfang/hands/<id>/` directories. LangGraph's `BaseStore` API exposes a similar store pattern. The model is "write files; read files."

**Model E: Hybrid.** The dominant production pattern. CrewAI: per-agent memory + crew-wide Pydantic state. OpenClaw: per-agent session store + shared gateway state + per-agent LanceDB memory. Bizar: per-agent session (via opencode) + `.bizar/memory.json` + Obsidian + LightRAG + Graphify graph.

### 4.2 — What Each System Actually Does

| System | Default | Memory layer | Notes |
|---|---|---|---|
| **OpenAI Agents SDK** | Model A (isolated sessions) | Optional Sessions store via SQLAlchemy / Redis | The session is the only persistence layer. |
| **CrewAI** | Model E (per-agent memory + Pydantic state) | Per-agent short/long/entity memory; 20+ DB backends | `auto_save="my-project"` keys cross-session persistence. |
| **AutoGen** | Model A | Conversation logs | Long-term memory is delegated to Mem0 or Honcho. |
| **LangGraph** | Model C (StateGraph state) + Model C (Store API) | Pluggable Store: Postgres, Redis, in-memory | The StateGraph *is* the working memory; Store is the long-term. |
| **Microsoft Agent Framework** | Model C (graph state) | Skills (SKILL.md injection) | No built-in fact extraction; pairs with Mem0. |
| **PraisonAI** | Model E | File-based default; 20+ DBs upgradeable | Explicit Mem0 adapter integration. |
| **Agent Squad** | Model C (pluggable conversation store) | DynamoDB / Redis / SQLite / SwiftData | No fact extraction. |
| **MetaGPT** | Model D (workspace) | None | SOP messages pass through `Environment`. |
| **Hermes** | Model A + Model D (file_state) | SQLite `messages_fts` (FTS5) per session | Honcho / Mem0 optional providers. |
| **OpenFang** | Model C (knowledge graph) + Model C (memory_store) | SQLite per-agent `kv_store` + shared `entities`/`relations` | The knowledge graph is the dominant coordination surface. |
| **OpenClaw** | Model E (per-agent + shared gateway) | SQLite per-agent + Wiki + LanceDB + `MEMORY.md` + `memory/YYYY-MM-DD.md` | Most layered memory of any system studied. |
| **Bizar** | Model E (per-agent session + .bizar/memory.json + Obsidian + LightRAG + Graphify) | Working JSON + durable Obsidian + semantic LightRAG + code graph | `.bizar/AGENTS_SELF_IMPROVEMENT.md` is the write-only self-improvement layer. |

### 4.3 — The Tradeoff Matrix

| Model | Token cost | Cross-session | Replayable | Testable |
|---|---|---|---|---|
| **A: Isolated** | Low (per-child only) | No | Yes (each child transcript saved) | High (single function) |
| **B: Parent shared** | High (compounds) | Yes | Partial | Medium |
| **C: Memory store** | Medium (retrieval at query time) | Yes | No (queries are ephemeral) | Low (retrieval is fuzzy) |
| **D: Workspace** | Low (filesystem reads are not in LLM context) | Yes | Yes (filesystem snapshots) | High (file I/O is testable) |
| **E: Hybrid** | Variable | Yes | Partial | Variable |

**Bizar's current Model E is correct but lacks fact extraction.** As R7 put it: *"Bizar already has layers 1-2 (.bizar/memory.json) and 4 (Obsidian + .bizar/AGENTS_SELF_IMPROVEMENT.md); it is missing layer 3 — a fact extractor that runs at session end."* (`round-7-bestof-deep/multi-agent-memory.md:723`). The redesign proposes Mem0 as the canonical fact extractor, alongside the existing Obsidian archive.

---

## Section 5 — Failure Modes and Recovery

Every multi-agent system fails. The differences are in *which* failures are anticipated and *how* they recover.

### 5.1 — The Five Failure Modes

**1. Subagent crash.** A child agent raises an exception mid-task.

| System | Detection | Recovery | Citation |
|---|---|---|---|
| **Hermes** | `future.result()` raises in batch loop | Result entry with `status="error"`, `error=str(exc)` | `round-4-hermes-deep/subagent-rpc.md:378-393` |
| **OpenClaw** | `subagent-registry-lifecycle.ts` liveness timeout | Orphan recovery — resume, kill, or mark orphaned | `round-6-openclaw-deep/memory-tools.md:418-420` |
| **OpenFang** | (Not explicitly handled) | Agent terminated; knowledge graph retains prior state | `round-5-openfang-deep/scheduler.md` |
| **Bizar** | Loop-guard threshold-12; SSE error event | Instance marked `failed`; status surfaces to Odin | `.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:185-189` |

**Pattern.** The gold standard is OpenClaw's orphan recovery — the parent can crash too, and the system distinguishes "child crashed" from "parent died with child." Bizar's v0.4.2 plugin handles the child case well; the parent-crashes-with-child case is implicit but not documented.

**2. Deadlock (two agents waiting on each other).** A waits for B's output; B waits for A's output.

| System | Prevention | Detection |
|---|---|---|
| **Hermes** | `max_spawn_depth=1` default (flat). Orchestrator opt-in re-enables nesting. | No deadlock *detection*; the depth limit is the safety net. |
| **AutoGen** | Speaker selection — only one agent speaks at a time. | Implicit by construction. |
| **OpenClaw** | `subagent-depth.ts` default depth 2 (parent → child → grandchild, then reject). | Recursion guard. |
| **LangGraph** | Graph is acyclic by construction. | Compile-time check. |
| **OpenFang** | Triggers fire on events; no synchronous wait chain. | Implicit. |
| **Bizar** | No depth limit currently. Sync dispatch is one-shot; background is single-level. | Implicit. |

**Pattern.** Most systems prevent deadlock via construction (no cycles, no synchronous mutual waits). Bizar should add an explicit depth limit to `bizar_spawn_background` even though it's currently flat.

**3. Lost message.** A message is sent but never received.

| System | Reliability layer |
|---|---|
| **Hermes** | Daemon thread + `process_registry.completion_queue` polling |
| **OpenClaw** | `process_registry` + SSE event stream; orphans recovered |
| **OpenFang** | Event bus `broadcast::channel(1024)`; events go to history ring buffer |
| **Bizar** | SSE event subscription; missing events detected via `BackgroundState` field divergence |

**Pattern.** SSE event streams are the dominant pattern. Bizar's plugin uses SSE via `GET /event?directory=<worktree>` and filters in-memory by `sessionID` (`event-stream.ts:122`). OpenFang's broadcast channel is the Rust equivalent.

**4. Partial completion.** A multi-step workflow completes some steps and not others.

| System | Mechanism |
|---|---|
| **LangGraph** | Checkpoints at each node; resume from last good checkpoint |
| **Microsoft Agent Framework** | Time-travel via workflow checkpoints |
| **MetaGPT** | None — SOP is all-or-nothing |
| **Bizar** | None — `bizar_spawn_background` is single-instance; no workflow checkpoint |

**Pattern.** Graph-based systems win here. Bizar's gap is real. The redesign proposes a minimal workflow layer for tier-3+ dispatches.

**5. Conflict (two agents edit same file).** Two parallel agents both write to `/foo.py`.

| System | Detection | Resolution |
|---|---|---|
| **Hermes** | `file_state.check_stale()` warning on next write | Per-path `threading.Lock` for read-modify-write critical sections. The reminder surfaces in result: *"X was modified by sibling subagent Y at T."* | (`round-4-hermes-deep/subagent-rpc.md:357-368`) |
| **OpenClaw** | (No explicit mechanism) | Per-agent separate workspaces (`multi-agent.md:9-25`) — agents literally don't share the same files. |
| **OpenFang** | (No explicit mechanism) | Knowledge graph upserts (last-write-wins on entity update). |
| **Bizar** | (No explicit mechanism) | Sibling awareness protocol (parallel execution context); documented but not enforced. |

**Pattern.** Hermes's `file_state` registry is the best of the four. OpenClaw sidesteps by giving each agent a separate workspace. The lesson: **for a coding harness where agents share a filesystem, conflict detection is non-negotiable.**

### 5.2 — The Cross-Cutting Failure Architecture

Five layers of defense:

1. **Detection.** How does the system know something failed? (Loop guard, exception, heartbeat, timeout.)
2. **Capture.** How is the failure recorded? (Error in result, status field, audit log.)
3. **Recovery.** What happens next? (Retry, abort, escalate.)
4. **Notification.** How does the parent know? (Return value, event, log.)
5. **Prevention.** What stops it from happening again? (Depth limit, rate limit, type check.)

Bizar currently has strong detection (loop guard, plugin shutdown), weak capture (status field), good recovery (abort + killed/failed states), decent notification (event stream), and partial prevention (depth limits). The redesign hardens layers 2 and 4.

---

## Section 6 — Observability

**The 2026 production rule:** if you can't see what your agents are doing, you can't ship them.

### 6.1 — Observability Layers

**1. Logs.** Per-session log files. Bizar: `~/.cache/bizarharness/logs/<sessionId>.log` (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:337`). Hermes: same model. OpenFang: tracing crate + structured logs. OpenClaw: per-session + per-plugin logs via the gateway.

**2. Traces.** Distributed tracing across the agent dispatch tree. LangGraph's checkpoint files ARE the trace. Microsoft Agent Framework has OpenTelemetry built in (`round-7-bestof-deep/multi-agent-memory.md:170`). OpenAI Agents SDK has built-in tracing that doubles as OTel export (`round-7-bestof-deep/multi-agent-memory.md:69`). CrewAI ships CrewAI AMP as a paid control plane with tracing.

**3. Trajectories.** The raw message log of an agent run. Hermes's `trajectory.py` + `trajectory_compressor.py` produce JSONL with turn-by-turn structure (`round-4-hermes-deep/trajectory-pipeline.md:64-99`). LangGraph checkpoints can be replayed. Bizar's trajectory capture is in the plan per R3 §B.6 but not yet shipped.

**4. Metrics.** Token counts, tool call counts, latency. Bizar's `BackgroundState` carries `toolCallCount`, `durationMs` (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:325`). OpenFang's `AgentScheduler` tracks tokens/hour per agent (`round-5-openfang-deep/scheduler.md:32`). OpenClaw's `usage.status` RPC returns cost data.

**5. Dashboards.** Visualization. OpenFang has a Rust-built web dashboard. OpenClaw's Control UI is at the gateway root. Bizar's dashboard is the `bizar-dash` package. CrewAI AMP is the commercial version.

**6. Alerts.** Push notifications on failure. OpenClaw's `failureAlert` config in cron jobs (`round-7-bestof-deep/multi-agent-memory.md:540+`). OpenFang's `event_publish` for critical changes (`round-5-openfang-deep/knowledge-graph.md:327`). Bizar has no alerts layer.

### 6.2 — The Best-in-Class Stack

| Layer | Best implementation | Why |
|---|---|---|
| **Logs** | OpenFang tracing crate | Structured, queryable, low overhead |
| **Traces** | LangGraph + LangSmith | Time-travel via state inspection; production-grade |
| **Trajectories** | Hermes `trajectory_compressor.py` | Compression pipeline that protects head + tail, compresses middle |
| **Metrics** | OpenFang `AgentScheduler` + `MeteringEngine` | Token-hour AND cost-hour AND cost-day AND cost-month |
| **Dashboards** | OpenClaw Control UI | Real-time, multi-channel, lazy-loaded |
| **Alerts** | OpenClaw failureAlert + Hermes heartbeat | Both webhook and degradation-style alerts |

### 6.3 — Bizar's Current Observability Stack

- **Logs**: `~/.cache/bizarharness/logs/<sessionId>.log` per session.
- **Traces**: None shipped. Trajectory capture planned per R3 §B.6.
- **Trajectories**: Same as traces — planned, not shipped.
- **Metrics**: `toolCallCount`, `durationMs` per background instance; loop-guard thresholds 5/8/12 with warn/escalate/block.
- **Dashboard**: `bizar-dash` for memory + activity log + plans; missing trajectory visualization.
- **Alerts**: None.

**Gaps.** Trajectory capture (R3 §B.6), event-stream publish to subscribers, structured trace export, alert channels. The redesign addresses the trajectory gap; the others are out-of-scope for this round.

---

## Section 7 — Master Comparison Matrix

The full matrix. Dimensions are the ones a new project would care about when picking a framework or designing an in-house system.

| System | Primitive | Discovery | Identity | State sharing | Sync | Failure recovery | Observability | Open source | Production tier |
|---|---|---|---|---|---|---|---|---|---|
| **OpenAI Agents SDK** | Handoffs + tool-as-call | Static list | Object | Sessions store | Sync | Per-call error return | Built-in tracing + OTel | MIT, 27.7k stars | Resumable |
| **CrewAI** | Roles + Crews + Flows | YAML or Python | String role | Per-agent memory + Pydantic state | Sequential or async | Per-task error | AMP SaaS or manual | MIT, 54.9k stars | Resumable |
| **AutoGen** | Group chat | GroupChat constructor | String name | Conversation logs | Sync chat | Conversation-level | Manual | MIT, 59.5k stars (maintenance mode) | Resumable |
| **LangGraph** | State machine graph | Graph constructor | Node ID | StateGraph state + Store API | Graph tick | Checkpoint + resume + time-travel | LangSmith | MIT, 36.5k stars | Durable |
| **Microsoft Agent Framework** | Graph workflow | Workflow constructor | Workflow + node ID | Graph state + Skills | Graph tick | Checkpoint + time-travel | OpenTelemetry built-in | MIT, 11.9k stars | Resumable |
| **PraisonAI** | Roles + auto | Goal or list | String name | File + DB | Sync or async | Per-agent | Manual | MIT, 8.3k stars | None |
| **Agent Squad** | Classifier routing | Description list | String name | Conversation store | Sync | Per-call | Tracing built-in | Apache-2.0, 7.7k stars | Resumable |
| **MetaGPT** | SOP message-passing | SOP graph | Role name | Shared `Environment` message bus | Sequential | None | Manual | MIT, 69.2k stars | Resumable |
| **Hermes** | Subagent + PTC RPC | Static config | `task_id` UUID | File-state registry + FTS5 | Sync/async + cron | Heartbeat + interrupt | Trajectory pipeline + logs | MIT | Resumable |
| **OpenFang** | Hands + event bus + triggers | Compile-time manifest | `AgentId` UUID | Knowledge graph + KV | Cron + reactive triggers | (Not explicit) | Tracing + dashboard | MIT | Resumable |
| **OpenClaw** | Gateway-mediated + subagent | Gateway registry | `agentId` string | Per-agent + shared + Wiki + LanceDB | Sync + async + cron | Orphan recovery + liveness | Control UI + per-channel logs | MIT | Resumable |
| **Bizar** | Tier dispatch + background agents | Static config | Agent name (string) | .bizar/memory.json + Obsidian + LightRAG + Graphify | Sync + async (background) | Loop guard + plugin shutdown | Per-session log | MIT (BizarHarness repo) | Resumable (partial durable via plugin) |

**Reading the matrix.** Three things stand out:

1. **LangGraph is the only "durable" entry.** The graph checkpoint is the most mature durability mechanism in the cohort.
2. **Most production systems ship conversation logs + per-session state but not graph state.** The graph layer is an upgrade path, not a v1 feature.
3. **Observability is the wildcard.** The graph-based frameworks (LangGraph, MAF, OpenAI Agents SDK) ship tracing as a first-class feature; the role-based ones (CrewAI, MetaGPT, PraisonAI) leave it to the user.

**Bizar's position.** Mid-tier. The `task` dispatch is string-based (low observability); the background agent plugin is structured (`BackgroundState` JSON, SSE events). To reach LangGraph-class durability, Bizar needs (a) a typed message envelope over `task`, (b) graph-shaped dispatch with checkpoints, and (c) trajectory capture (R3 §B.6).

---

## Section 8 — Universal Anti-Patterns

These failures recur in *every* multi-agent system studied. Naming them is the first defense.

### 8.1 — Infinite Delegation Loops

**Symptom.** Agent A dispatches to B; B dispatches to A; both wait forever.

**Cause.** Recursive dispatch with no depth limit.

**Defense.** All serious systems enforce a depth limit: Hermes `max_spawn_depth=1` default (`round-4-hermes-deep/subagent-rpc.md:467-503`), OpenClaw `subagent-depth.ts` default depth 2 (`round-6-openclaw-deep/memory-tools.md:424`). Bizar has no explicit depth limit but is naturally flat (sync `task` doesn't recurse).

**Lesson for Bizar.** Add a `max_spawn_depth` config field. Default 2. Enforce at the plugin level so Odin can override per-dispatch.

### 8.2 — Context Blowup

**Symptom.** Parent agent's context grows unbounded as children return. Token budget exceeded.

**Cause.** Child summaries are not trimmed; intermediate tool results leak; no compaction.

**Defense.** Hermes: per-child summary budget `_parent_summary_char_budget` with `_MIN_SUMMARY_CHARS=2000` floor and `DEFAULT_MAX_SUMMARY_CHARS=24000` ceiling (`round-4-hermes-deep/subagent-rpc.md:292-298`). Bizar's plugin: `toolCallCount` cap (default 500) and `resultPreview` truncation to 200 chars (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:319`).

**Lesson for Bizar.** Adopt Hermes's summary budget math for the synchronous `task` tool, not just background. The current `task` tool returns the entire subagent output; add a `summary: "auto" | "first_n_chars" | "full"` parameter.

### 8.3 — Token Explosion

**Symptom.** A single dispatch fans out to N children, each consuming 50k tokens. Total = 500k tokens for one user request.

**Cause.** No per-call token cap; no global token budget.

**Defense.** OpenFang's `MeteringEngine` enforces `max_cost_per_hour_usd`, `max_cost_per_day_usd`, `max_cost_per_month_usd` at hourly/daily/monthly granularity (`round-5-openfang-deep/scheduler.md:84-90`). Bizar has no per-call cost cap; only the loop guard's implicit per-session cap via `toolCallCount`.

**Lesson for Bizar.** Add a per-dispatch cost cap. Models differ in price by 100x; an Odin dispatch to "research X" that hits Vidarr's M3-Reasoning is a $5 surprise. The cap should be configurable per agent tier.

### 8.4 — Deadlock

Already covered in §5.1. The lesson is: prevent by construction (no cycles, no synchronous mutual waits) rather than detect after the fact.

### 8.5 — Lost Work on Agent Death

**Symptom.** A subagent does 90% of the work, then the user kills the parent. The 90% is lost because nothing persisted it.

**Cause.** No checkpoints; in-memory state only.

**Defense.** LangGraph checkpoints (the gold standard). Bizar's background plugin persists `BackgroundState` to disk on every event (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:344-355`) but the synchronous `task` tool does not.

**Lesson for Bizar.** Add a `task` tool checkpoint mode. When enabled, the parent receives periodic snapshots that can be re-dispatched to recover from a kill.

### 8.6 — Permission Escalation

**Symptom.** A child subagent inherits the parent's full tool set, including tools it shouldn't have (e.g., `git push` while doing research).

**Cause.** Default inheritance with no narrowing.

**Defense.** Hermes's `DELEGATE_BLOCKED_TOOLS` frozenset removes `delegate_task`, `clarify`, `memory`, `send_message`, `execute_code`, `cronjob` from subagents (`round-4-hermes-deep/subagent-rpc.md:185-194`). OpenClaw's six-layer tool policy pipeline (sandbox → profile → provider → sender → group → subagent) achieves the same via additive policy layers (`round-6-openclaw-deep/memory-tools.md:196-241`).

**Lesson for Bizar.** Add a `tools` allowlist to the `task` tool's child-config. Odin's current dispatch grants the child the same tools as Odin. For tier-3+ dispatch, that should be a per-dispatch narrowing.

### 8.7 — Phantom Action Detection

**Symptom.** Agent claims it ran a command but the tool log shows no command was actually executed.

**Cause.** LLM hallucinates tool results; no verification.

**Defense.** OpenFang scans for LLM output claiming actions without tool calls. R3 §A.2: Bizar has no equivalent.

**Lesson for Bizar.** Add a phantom-action detector to the plugin. After every assistant turn, diff the claimed actions against the tool log; flag mismatches.

### 8.8 — Prompt Injection via Subagent

**Symptom.** A subagent reads an untrusted web page, the page contains instructions, the subagent obeys them.

**Cause.** Web content reaches the LLM as if it were user input.

**Defense.** Bizar's plugin warns about this: *"the `prompt` is sent verbatim to the LLM in the background session. Do not include untrusted external content."* (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:716`). The warning is in the Odin prompt, not code-enforced.

**Lesson for Bizar.** Wrap untrusted content in `<untrusted>...</untrusted>` tags that the plugin strips before forwarding to the LLM. Or run untrusted content in a separate prompt-isolation context (a subagent whose only job is to summarize the untrusted content into a clean Markdown bullet).

### 8.9 — Catastrophic Token Compression Death-Spiral

**Symptom.** Context window full; agent compresses; compression errors introduce garbage; garbage causes more errors; loop.

**Cause.** Hermes `round-4-hermes-deep/subagent-rpc.md:298-299` cites the issue/PR #9126 explicitly: *"The compression/429 death-spiral in issue/PR #9126 was specifically this."*

**Defense.** Hermes's `_SUMMARY_HEADROOM_FRACTION=0.5` and `_MIN_SUMMARY_CHARS=2000` floor (`round-4-hermes-deep/subagent-rpc.md:294-298`) — compression can't shrink below a usable size. Bizar has `compaction: { auto: true, threshold: 0.5, preserve_recent: 10, strategy: "summarize", model: "..." }` in `config/opencode.json:42-47` but the threshold and model are global, not per-context-class.

**Lesson for Bizar.** Adopt a per-context-class compaction policy. Code reviews compress aggressively (target 50%); research discussions preserve more (target 70%).

---

## Section 9 — The 2026 Convergence

The eight best-of-catalog projects, plus the four source repos, all converge on a small number of architectural choices.

### 9.1 — Graph as the Durable Substrate

Every production-grade framework in 2026 has an internal graph representation. LangGraph's `StateGraph` is the explicit one. Microsoft Agent Framework's workflows are graphs. CrewAI Flows is a smaller clone of LangGraph's vocabulary. Even OpenAI Agents SDK's handoffs can be drawn as a linear graph. MetaGPT's SOP is a graph.

Bizar's internal dispatch should be graph-shaped even if the user-facing API is role-shaped. This is R7's strongest takeaway and R8 confirms it.

### 9.2 — Tool Calls as the IPC

The cleanest inter-agent message has a return value. Tool calls have return values; messages do not. The systems that converge on tool-call-as-IPC (OpenAI Agents SDK's `AgentTool`, Microsoft Agent Framework's `Agent-as-Skill`, agent-squad's `SupervisorAgent`) are easier to test and trace than the systems that converge on free-form messages (AutoGen group chat, MetaGPT SOP messages).

Bizar's `task` tool should return a typed `BizarToolResult` object, not a string. R7 §5 "Pattern B" makes this point.

### 9.3 — External Memory Layer for Long-Term Facts

No production framework ships long-term fact extraction as a built-in. The pairing is universal: Mem0 or Letta outside, framework inside. Mem0's benchmarks (LoCoMo 91.6, LongMemEval 94.8 — `round-7-bestof-deep/multi-agent-memory.md:364-372`) make it the de-facto primitive.

Bizar's `.bizar/memory.json` + Obsidian + LightRAG stack is missing the fact extractor. Mem0 self-hosted is the recommended addition.

### 9.4 — OpenTelemetry as the Observability Standard

Microsoft Agent Framework ships OpenTelemetry built-in. LangGraph integrates with LangSmith (which is OTel-compatible). OpenAI Agents SDK's tracing exports to OTel. The non-graph frameworks (CrewAI AMP, MetaGPT) leave OTel to the user.

Bizar's plugin should emit OTel spans for every dispatch, every tool call, every checkpoint. The dashboard can render them via the existing observability stack.

### 9.5 — Hooks for Lifecycle, Not Code

The systems that get lifecycle integration right use hooks, not libraries. claude-mem's 5 hooks (SessionStart, UserPromptSubmit, PostToolUse, Stop, SessionEnd) are the canonical example. Hermes's hooks are similar. OpenFang's event bus + triggers are the same pattern at a higher level.

Bizar's plugin already has hooks (`experimental.chat.system.transform`, etc.). The redesign proposes more: `pre_subagent_dispatch`, `post_subagent_return`, `on_event_published`.

---

## Section 10 — Open Questions

These are the questions this round surfaced that don't have a clear answer yet.

**1. Who owns the graph?** Bizar's existing `.bizar/graph/` is the Graphify code-analysis graph (populated by build-time scan). The redesign proposes an agent-writeable domain graph (OpenFang-style). Are these one graph or two? OpenFang has them as separate SQLite tables (`entities` vs `relations` are one graph; Hand state is another). Bizar should probably have two graphs: `domain.sqlite` (agent-writeable) and `code.sqlite` (Graphify-populated).

**2. How deep is too deep?** Subagent depth of 1 (flat) is safe. Depth 2 (parent → child → grandchild) is where most systems draw the line. Depth 3+ is research territory. Bizar should not exceed depth 2 without a Forseti audit.

**3. What is the right unit of cancellation?** When a parent is killed, should the children die too? Hermes yes (default). OpenClaw no by default (orphan recovery). Bizar's plugin: SIGTERM marks all in-memory instances as `failed` (`.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:497-510`) — closer to Hermes. The trade-off: hermes-style is safer (no orphans), OpenClaw-style is more durable (children complete even if parent dies).

**4. Should agents know each other's names?** Hard-coded agent names (Bizar today) are simple but rigid. Capability-based discovery (publish "I can search", subscribe to "I need search") is flexible but harder to debug. The redesign proposes a hybrid: agents have canonical names but publish capabilities. Odin routes by capability match with a name fallback.

**5. What happens to the trajectory after capture?** R3 §B.6 plans trajectory capture but not what happens next. The honest answer: trajectories become training data (if user opts in), evaluation data (always), and self-improvement input (if Mem0 or a similar extractor runs over them). Bizar's `.bizar/AGENTS_SELF_IMPROVEMENT.md` is a write-only destination today; trajectories could feed a *proposed*-improvements file that the user reviews.

---

## Section 11 — Files Cited

| Source | File | Used for |
|---|---|---|
| Hermes | `tools/delegate_tool.py:44-54, 466-503, 1624-1717, 1719-2317` | Subagent blocked tools, depth limit, summary budget, lifecycle |
| Hermes | `tools/code_execution_tool.py:62-70, 487-620, 763-911` | PTC RPC, UDS, file-based transport |
| Hermes | `tools/file_state.py` | Cross-agent file-state registry |
| Hermes | `agent/curator.py`, `agent/trajectory.py`, `trajectory_compressor.py` | Learning loop, trajectories |
| Hermes | `batch_runner.py` | Multiprocessing architecture, checkpoints |
| OpenFang | `crates/openfang-kernel/src/event_bus.rs:14-99` | EventBus implementation |
| OpenFang | `crates/openfang-kernel/src/triggers.rs:83-119` | TriggerEngine |
| OpenFang | `crates/openfang-memory/src/knowledge.rs:16-188` | Knowledge graph |
| OpenFang | `crates/openfang-kernel/src/scheduler.rs`, `metering.rs` | Quota + cost enforcement |
| OpenFang | `crates/openfang-hands/src/lib.rs:325-456` | Hand registry, lifecycle |
| OpenFang | `crates/openfang-memory/src/substrate.rs:470-590` | Task board (`task_post`, `task_claim`) |
| OpenClaw | `src/gateway/server.ts`, `core-descriptors.ts`, `server-ws-runtime.ts` | Gateway + 90+ RPC methods |
| OpenClaw | `src/agents/subagent-spawn.ts`, `subagent-registry-lifecycle.ts`, `subagent-depth.ts` | Subagent delegation |
| OpenClaw | `src/agents/tool-policy-pipeline.ts:38-72` | Six-layer policy pipeline |
| OpenClaw | `src/agents/mcp-http.ts`, `src/plugin-sdk/mcp-http.ts` | MCP integration |
| OpenClaw | `extensions/openai/openclaw.plugin.json` | Plugin manifest contract |
| OpenClaw | `docs/concepts/multi-agent.md:1-566` | Multi-agent vs subagent distinction |
| Bizar | `config/opencode.json:5-271` | Agent roster |
| Bizar | `plugins/bizar/index.ts` | Plugin entry |
| Bizar | `plugins/bizar/src/background.ts:427-700` | Background instance manager |
| Bizar | `plugins/bizar/src/tools/bg-spawn.ts:50-120` | Background spawn, delegation wrapper |
| Bizar | `plugins/bizar/src/event-stream.ts:122-488` | SSE event subscription |
| Bizar | `.bizar/architecture/plugin-architecture-v0.4.1-background-agents.md:1-794` | Background agent spec |
| Bizar | `.bizar/PROJECT.md`, `.bizar/AGENTS_SELF_IMPROVEMENT.md` | Project state |
| Best-of | `repos/best-of-Agent-Harnesses/comparisons/multi-agent-orchestration.md:1-30` | Master comparison |
| Best-of | `repos/best-of-Agent-Harnesses/comparisons/memory-layers.md:1-30` | Memory comparison |
| Best-of | `repos/best-of-Agent-Harnesses/comparisons/how-to-pick-a-harness.md:1-37` | Six-question decision guide |
| Round reports | `round-3-crossref/bizar-alignment.md:67-264` | R3 alignment matrix (B.1-B.12) |
| Round reports | `round-4-hermes-deep/subagent-rpc.md:1-858` | Hermes subagent RPC |
| Round reports | `round-4-hermes-deep/trajectory-pipeline.md:64-99` | Trajectory format |
| Round reports | `round-4-hermes-deep/learning-loop.md:1-528` | Hermes closed learning loop |
| Round reports | `round-5-openfang-deep/hands-system.md:1-586` | OpenFang Hands |
| Round reports | `round-5-openfang-deep/knowledge-graph.md:1-513` | OpenFang KG |
| Round reports | `round-5-openfang-deep/scheduler.md:1-705` | OpenFang scheduler |
| Round reports | `round-6-openclaw-deep/gateway.md:1-556` | OpenClaw gateway |
| Round reports | `round-6-openclaw-deep/memory-tools.md:130-458` | OpenClaw memory + tool policy |
| Round reports | `round-7-bestof-deep/multi-agent-memory.md:1-814` | R7 deep study of 14 projects |

---

*End of orchestration-patterns.md. Word count target: 8000-9000. Companion document `bizar-multi-agent-redesign.md` applies these findings to Bizar.*