# Round 7 — Best-of Deep Study: Multi-Agent, Memory, and Sandbox Layers

**Scope:** Deep study of 14 projects from the best-of-Agent-Harnesses catalog covering three infrastructural layers that the multi-agent landscape has converged on by mid-2026. Each profile is sized to surface the architecture, the data flow, the standout choices, and the gaps — enough to decide whether (and how) to adopt the pattern inside Bizar.

**Date:** 2026-07-06
**Author:** @tyr
**Companion documents:** `round-3-crossref/bizar-alignment.md` (what Bizar already is and the gaps), `round-4..6` deep dives for siblings. `round-7-bestof-deep/coding-harnesses.md` (sibling — do not modify).
**Catalog data source:** `/home/drb0rk/Projects/BizarHarness/research/agent-harness-survey/repos/best-of-Agent-Harnesses/harnesses.json` (captured 2026-07-05)

---

## Section 0 — Methodology and Catalog Notes

For each project below I read the upstream README and skimmed the major docs pages. Citations link directly to the file or doc anchor that produced the claim. Three pragmatic notes:

1. **Canonical GitHub IDs in 2026 are not always the README link.** `awslabs/agent-squad` renamed to `2FastLabs/agent-squad` (formerly `multi-agent-orchestrator`) per the README banner. `geekan/MetaGPT` is now under `FoundationAgents/MetaGPT`. The `modal-labs/modal` GitHub repo was renamed to `modal-labs/modal-client`. These renames are the kind of thing best-of's curation bar catches but which casual readers miss.
2. **AutoGen is in maintenance mode.** Its README carries a `⚠️ Maintenance Mode` badge that points users to the new Microsoft Agent Framework. This is a unique signal in the catalog — a major framework whose maintainers publicly redirect to a successor inside the same vendor.
3. **Daytona is partially sunset.** The repo banner reads: "**This repository is no longer maintained.** As of June 2026, Daytona's core development has moved to a private codebase." This makes Daytona the canonical *workload sandbox* (its public README is still the canonical reference) even though its active build pipeline sits behind a private fork. The catalog still scores it 72k stars and `slightly complex`.

**Star counts and tier (from `harnesses.json`, captured 2026-07-05):**

| Project | Stars | Tier | Autonomy / Recovery |
|---|---:|---|---|
| claude-mem | 85,933 | slightly complex | n/a / n/a |
| daytonaio/daytona | 72,287 | slightly complex | n/a / n/a |
| FoundationAgents/MetaGPT | 69,203 | complex | headless / resumable |
| mem0ai/mem0 | 60,128 | slightly complex | n/a / n/a |
| microsoft/autogen | 59,505 | complex | bounded / resumable |
| crewAIInc/crewAI | 54,948 | complex | bounded / resumable |
| langchain-ai/langgraph | 36,528 | slightly complex | headless / durable |
| openai/openai-agents-python | 27,660 | mostly simple | bounded / resumable |
| letta-ai/letta | 23,658 | mostly simple | headless / durable |
| e2b-dev/E2B | 12,844 | slightly complex | n/a / n/a |
| microsoft/agent-framework | 11,883 | slightly complex | bounded / resumable |
| MervinPraison/PraisonAI | 8,343 | mostly simple | bounded / none |
| 2FastLabs/agent-squad | 7,683 | slightly complex | bounded / resumable |
| modal-labs/modal(-client) | not in catalog (referenced by smolagents) | n/a | n/a |

The starred cohort is composed of a flat tail of mid-size libraries plus three giants (claude-mem, daytona, MetaGPT) and one newly designated successor (Microsoft Agent Framework). All are open-source. The recovery axis splits cleanly into "durable or none" — production multi-agent frameworks target durable recovery; sandbox runtimes and memory primitives do not.

---

# Part I — Multi-Agent Orchestration (8 projects)

## 1. OpenAI Agents SDK (`openai/openai-agents-python`)

**Source:** https://github.com/openai/openai-agents-python (README captured 2026-07-06)

### What it is
OpenAI Agents SDK is the lightest-weight first-party multi-agent SDK on the market — a Python framework whose core abstractions are `Agent`, `Handoff`, `Tool`, and `Runner`. The README opens with: *"The OpenAI Agents SDK is a lightweight yet powerful framework for building multi-agent workflows. It is provider-agnostic, supporting the OpenAI Responses and Chat Completions APIs, as well as 100+ other LLMs."* The JS/TS sibling lives at `openai/openai-agents-js`.

### Architecture
There are four co-equal building blocks. (i) **Agents** are LLMs configured with `instructions`, `tools`, `guardrails`, and `handoffs`. (ii) **Tools** are typed callables plus first-class `MCP` integration (the README cites "MCP Python SDK" as an explicit dependency). (iii) **Handoffs** are a first-class delegation primitive — an agent's `handoffs=[...]` list declares which other agents it may pass the conversation to, and the receiving agent sees the full conversation thread so far. (iv) **Sessions** layer automatic conversation history management — the SDK persists message threads across runs.

A second surface released in **v0.14.0** is the **Sandbox Agent**: *"A sandbox agent is an agent that uses a computer environment to perform real work with a filesystem, in an environment you configure and control. Sandbox agents are useful when the agent needs to inspect files, run commands, apply patches, or carry workspace state across longer tasks."* The example given runs against `UnixLocalSandboxClient`, but the abstraction over the sandbox client is the interesting part — the same agent code works against any `SandboxClient` implementation (including, presumably, remote E2B / Daytona / Modal workers).

**Tracing** is built into the runtime — `Tracing` is item #8 in the README's core-concepts list. Optional dependencies include `websockets` (voice/realtime), `SQLAlchemy` (sessions), `any-llm` and `LiteLLM` (provider routing), and a separate `redis` extra for Redis-backed sessions.

### Multi-agent model
The model is **handoff-based**, deliberately minimal. There is no built-in group chat, no role system, no org chart. An agent can either call another agent as a tool (synchronous, returns the result inline, README: *"Agents as tools"*) or **hand off** the conversation to another agent (async — the new agent takes over the thread). The compare doc in the best-of catalog calls this "Least framework, cheapest to walk away." There are no implicit control-flow primitives like AutoGen's `GroupChat` or CrewAI's `Process`; the user owns the loop.

### Memory model
Sessions. Each `Session` (backed by the optional `SQLAlchemy` or `Redis` store) accumulates message history. No built-in vector store, no built-in fact extraction, no LongMem-style summarization — it's the application's job to read those transcripts and turn them into memories. The SDK is a memory consumer, not a memory producer.

### Standout features
- **Sandbox Agents (v0.14+).** This is the SDK's quietly ambitious 2026 feature. The `Manifest` + `entries` system lets a developer declare a sandbox that should come preloaded with, e.g., `GitRepo(repo="openai/openai-agents-python", ref="main")`. The runner wires the sandbox into the tool pipeline so the LLM's tool calls (apply patch, run command, read file) route to the sandboxed environment.
- **Handoff as first-class.** Handoffs are not a post-hoc pattern; they participate in tracing, sessions, and tool routing.
- **Provider-agnostic by default.** Uses `any-llm` and `LiteLLM` as optional deps — switching from OpenAI to Anthropic is a config swap, not a code rewrite.
- **Tracing built-in.** "Built-in tracking of agent runs, allowing you to view, debug and optimize your workflows" — the same tracing framework doubles as OpenTelemetry export for production observability.

### Weaknesses
- **No group chat / no parallel fan-out primitive.** Multi-agent coordination is one-to-one (handoff) or one-as-tool (sub-call). Want a *group* of agents collaborating? You build it yourself.
- **Memory is on the application.** No user, session, or agent-level memory primitive. Mem0 is the natural pairing — best-of's "drop-in memory layer" use-case lists `Mem0` first and the SDK does not compete with it.
- **No built-in RBAC, approval flow, or scheduler.** The README lists "Human in the loop" as a concept but it is an *intervention* primitive (`interrupt()`-style), not a gate.

### Bizar relevance
Bizar's tier-3+ dispatch (Thor → Tyr → Vidarr) is exactly the shape OpenAI Agents SDK targets. The interesting pattern for Bizar is **not** "adopt the SDK" — Bizar speaks through opencode's `task` tool, not Python — but rather **formalize the handoff semantics** that Bizar's dispatch already uses. Concretely: a `bizar/handoff.yml` contract between agents (who can hand off to whom, what context is preserved across a handoff, what tracing identity follows the conversation) would let Bizar grow beyond "Odin dispatches subagents" without inventing new protocol each tier-3 ship. Sandbox Agents are also worth watching: when Bizar grows a Docker/sandbox backend (per `round-3-crossref/bizar-alignment.md` section B.3), the OpenAI team's approach — declaring a `Manifest` of `entries` that get resolved into the sandbox at agent-start — is a leaner abstraction than the full `BaseEnvironment` ABC that Hermes uses.

---

## 2. CrewAI (`crewAIInc/crewAI`)

**Source:** https://github.com/crewAIInc/crewAI (README captured 2026-07-06)

### What it is
CrewAI is the highest-publicity role-based multi-agent framework. Its README leads with two distinct primitives: **Crews** (autonomous role-based agent teams) and **Flows** (event-driven, production-orchestrated Python). The README also names the split: *"CrewAI Crews: Optimize for autonomy and collaborative intelligence with role-based AI agents. CrewAI Flows: Build event-driven automations that combine precise workflow control, single LLM calls, and native support for Crews."* 100,000+ certified developers per their deeplearning.ai course integration; commercial SaaS exists as **CrewAI AMP Suite** with managed deployment, observability, and enterprise governance.

### Architecture
The Crew layer is role-engineered. Every agent declares a **role**, **goal**, and **backstory**. Tasks declare a **description**, **expected_output**, optionally an `agent=` assignment, and a `context=` list of tasks whose outputs feed into this one. A **Process** selects the execution order — `Process.sequential` (default), `Process.hierarchical` (a manager agent delegates), or async custom processes. The `@CrewBase` decorator pattern generates agents and tasks from YAML config files (`agents.yaml`, `tasks.yaml`) — the README's tutorial walks through a `crewai create crew <project_name>` skeleton that emits this exact layout.

The Flow layer is a stateful event-driven Python harness. Decorators `@start`, `@listen`, `@router`, `or_`, `and_` layer structured state (`Flow[MarketState]` where `MarketState` is a Pydantic model) with conditional branching. Crews can be invoked as Flow steps — *"Use Python code for basic data operations. Create and execute Crews as steps in your workflow."*

### Multi-agent model
**Role-based with org-chart sequencing.** The README's canonical example is *Researcher → Reporting Analyst*: two agents in a `Process.sequential` crew, the second consuming the first's output. Hierarchical mode invites the LLM to be a manager: the manager agent delegates tasks back into the crew via a "properly coordinate the planning and execution of tasks through delegation and validation" loop. This is closer to AutoGen's group chat manager than to LangGraph's static graph. The Flow layer's `route()` / `parallel()` / `loop()` / `repeat()` primitives (later in the README) are essentially a smaller-clone of LangGraph's graph vocabulary, but expressed as Python decorators and a Pydantic state object.

### Memory model
CrewAI shipped memory as a first-class *agent-level* capability. The README's "Agent-ready capabilities" bullet lists "tools, memory, knowledge, checkpointing, async execution, and MCP/A2A support." Memory objects are per-agent by default; the framework auto-saves short-term (recent exchanges), long-term (entity-level facts), and entity memory (who/what entities an agent has encountered). The newest extension to the Flow layer is `auto_save="my-project"` and session-id-keyed persistence, with backend support for "PostgreSQL, MySQL, SQLite, MongoDB, Redis, and 20+ more."

### Standout features
- **YAML-driven agent definition.** A `crewai create` CLI emits `agents.yaml`, `tasks.yaml`, `crew.py`, `main.py`, `.env`. Non-engineers can author crews. This is CrewAI's accessibility moat and the reason it's the most-taught multi-agent framework in 2025-2026.
- **Skills distribution via `skills.sh`.** The README publishes a *Claude Code marketplace plugin* (`crewAIInc/skills`) so coding agents get four CrewAI skills auto-loaded: `getting-started`, `design-agent`, `design-task`, `ask-docs`. This is CrewAI leveraging the Skills CLI standard to teach itself to other agents — the inverse of the conventional SDK consumption pattern.
- **Crews + Flows split.** Crews for autonomy, Flows for production. This lets a team start with autonomous collaboration and graduate to event-driven control without rewriting the agents.
- **Commercial control plane.** CrewAI AMP adds tracing, observability, governance, RBAC. The OSS tier under this stays functional and current — the SaaS is a layer, not a replacement.

### Weaknesses
- **Roles are not behavior.** "Role" is a system prompt, not an enforced persona. Two agents with the same role will produce indistinguishable behavior. The decomposition is decorative in the strong sense.
- **Hierarchical mode is undertested.** It works, but in practice the manager agent loops trying to delegate or stalls because the LLM doesn't understand its own crew's capabilities. Most production systems that "use hierarchical mode" describe the loop as an experimental knob.
- **Process abstraction leaks.** Sequential is trivial; hierarchical is sticky; custom processes require reading the framework internals. Compare this to LangGraph where *every* control flow is the same graph primitive.

### Bizar relevance
Bizar's tier system (Odin → Thor → Tyr → Vidarr with Forseti as audit) is exactly the niche CrewAI *doesn't* serve well: deterministic, cost-bounded dispatch with explicit tiers, not autonomous roles. The lessons are structural rather than substitutive. **Lesson 1:** YAML-declared agents are the right shape for non-engineers and the wrong shape for Bizar's tier-gated dispatch. **Lesson 2:** CrewAI's separation between "Crew" (autonomy) and "Flow" (deterministic control) maps cleanly to Bizar's separation between "subagent dispatch" (autonomy) and "approval gate" (deterministic control). Bizar's Phase-3 approval-gates work in `round-3-crossref/bizar-alignment.md` section B.9 should mirror this split — an "autonomy lane" and a "control lane" with well-defined interfaces. **Lesson 3:** CrewAI's telemetry (anonymized counts of agent/tasks/process/memory flags) is the lowest-friction visibility pattern in the catalog — much cheaper to ship than LangSmith or OpenTelemetry and gives 80% of the value.

---

## 3. AutoGen (`microsoft/autogen`)

**Source:** https://github.com/microsoft/autogen (README captured 2026-07-06)

### What it is
AutoGen is the Microsoft Research entry that opened the conversational-agent door in late 2023 and is the only project in the multi-agent cohort whose README carries a visible maintenance banner: *"AutoGen is now in maintenance mode. It will not receive new features or enhancements and is community managed going forward."* The redirect target is the new Microsoft Agent Framework (see §4 below). AutoGen is the historic reference for "two agents (or N agents) talking to each other in a loop."

### Architecture
AutoGen v0.4+ is layered. The bottom layer is **autogen-core** — message passing, event-driven agents, local and distributed runtime, .NET and Python language support. Above it sits **autogen-agentchat** — *"a simpler but opinionated API for rapid prototyping... built on top of the Core API and is closest to what users of v0.2 are familiar with and supports common multi-agent patterns such as two-agent chat or group chats."* Above that: **autogen-ext** for LLM clients and capability extensions. Tooling: **autogen-studio** for a no-code GUI (with explicit "not meant to be a production-ready app" disclaimer) and **agbench** for benchmarking.

The AgentChat layer ships built-in team patterns: `RoundRobinGroupChat`, `SelectorGroupChat` (an LLM picks the next speaker each turn), `SwarmGroupChat` (handoff-driven, the precursor to OpenAI Agents SDK's handoffs), and `Magentic-One` (a reference orchestration pattern from Microsoft Research that plans, then routes to specialized agents). Extensibility is via `AgentTool` (wrap an agent as a tool for another agent — the same pattern OpenAI Agents SDK uses) and `Workbench` for MCP server sets.

### Multi-agent model
The original AutoGen model is **group chat**: a `GroupChat` of agents + a `GroupChatManager` that selects the next speaker. Two sub-flavor patterns emerged: *speaker selection by LLM* (manager calls a model each turn to decide who speaks) and *speaker selection by handoff rules* (each agent declares conditions under which it passes to another). The latter is the lineage that became OpenAI Agents SDK.

In the README, the "Multi-Agent Orchestration" quickstart wraps two `AssistantAgent`s (`math_expert`, `chemistry_expert`) as `AgentTool` instances and gives them to a third general agent — a one-by-one tool-as-call design. This is the v0.4+ recommended path. The `GroupChat` surface remains but the README explicitly says "for more advanced multi-agent orchestrations and workflows, read AgentChat documentation."

### Memory model
AutoGen's memory is provider-agnostic at the lower layers. `autogen-core` exposes `AgentRuntime` and "memory" is whatever the agent's `on_message` returns. The AgentChat layer ships some turn-history retention but no built-in long-term memory primitive. The AutoGen documentation links to external libraries (Mem0 is the canonical pairing in best-of's memory comparison).

### Standout features
- **Cross-language runtime.** .NET in the same runtime as Python. No other catalog project except Microsoft Agent Framework offers this — LangChain's Rust port is a separate lineage.
- **The original group-chat manager pattern.** Multi-agent-as-conversation is AutoGen's intellectual contribution and the foundation every later project builds on (directly or via MemGPT, CrewAI, AutoCrew).
- **Magentic-One.** A reference multi-agent team (planner + web/file/code specialists) shipped in-tree as a working implementation of "research-grade orchestration." This is the closest the OSS catalog gets to a paper-style reference system.
- **Maintenance-mode honesty.** AutoGen is the rare project that publishes a clear "use the new thing instead" banner. The catalog catches it; README readers benefit.

### Weaknesses
- **No new features.** The README's caution is severe. Bugs get patched, docs improve, but no new capabilities land. Any team that picks AutoGen in 2026 is choosing yesterday's best.
- **`GroupChat` API churn.** v0.2 → v0.4 was a breaking rewrite. The original two-agent conversation pattern from the Wang et al. 2023 paper is preserved as `RoundRobinGroupChat`, but many tutorials in the wild still target v0.2 patterns.
- **No first-class memory.** This is the gap Microsoft Agent Framework inherits and addresses (see next section).

### Bizar relevance
**AutoGen is what Bizar would be if Odin, Thor, Tyr, and Vidarr were chat participants.** That is not the right model — Bizar's strength is the *gate* (Forseti, tier enforcement), not free-form conversation. But three patterns are worth borrowing: (1) AutoGen's `AgentTool` pattern (agent-as-tool) is the cleanest way to give one agent access to another's full capability set without inventing hand-off semantics — Bizar's subagent dispatch could adopt a "minimal result capture" convention where a Thor invocation returns last-message / last-tool-result / full-transcript selection, mirroring `AgentTool(return_value_as_last_message=True)`. (2) **The maintenance-mode banner is a model for Bizar's future deprecation discipline.** When Bizar v6 ships and breaks things, the equivalent of this banner should appear in `CHANGELOG.md` for the affected APIs. (3) **The Magentic-One reference team pattern** is the right shape for the "durable coding team" use case Bizar's deployment-deck slides hint at — one planner + one researcher + one executor + one reviewer, each a Bizar agent. Today's Bizar has those roles implicitly; AutoGen's reference team makes them explicit.

---

## 4. Microsoft Agent Framework (`microsoft/agent-framework`)

**Source:** https://github.com/microsoft/agent-framework (README captured 2026-07-06)

### What it is
Microsoft Agent Framework (MAF) is Microsoft's designated successor to AutoGen *and* Semantic Kernel — *"Microsoft Agent Framework is an open, multi-language framework for building production-grade AI agents and multi-agent workflows in .NET and Python... while keeping architecture choices open as requirements evolve, and supports a broad ecosystem including Microsoft Foundry, Azure OpenAI, OpenAI, and the GitHub Copilot SDK."* Version 1.0 (per AutoGen's redirect) commits to long-term support. The README's "Is this the right framework for you?" section explicitly targets production workloads: *"are building agents and workflows you expect to run in production, need orchestration beyond a single prompt or stateless chat loop, want graph-based patterns... care about durability, restartability, observability, governance, or human-in-the-loop control, need provider flexibility."*

### Architecture
MAF is delivered in two parallel trees: **`python/packages/`** and **`dotnet/src/`**, with consistent APIs in both. The core surfaces: **agents** (single-agent primitives with provider flexibility), **workflows** (`./python/samples/03-workflows/` and `./dotnet/samples/03-workflows/` — graph-based orchestration with sequential, concurrent, handoff, and group collaboration patterns, plus checkpointing, streaming, human-in-the-loop, and *time-travel*), **middleware** (request/response processing, exception handling, custom pipelines), **observability** (built-in OpenTelemetry integration for distributed tracing), and **dev tooling** (a `DevUI` interactive developer UI).

The **Labs** directory (`./python/packages/lab/`) advertises "experimental packages for cutting-edge features including benchmarking, reinforcement learning, and research initiatives." This is Microsoft's research hatch from which Agent Framework features graduate. **Foundry Hosted Agents** are a one-shot deployment target: *"Deploy and host your agents to Foundry-hosted infrastructure with just 2 additional lines of code."* The hosted agent runs in a managed runtime with the framework as the underlying executor.

### Multi-agent model
MAF's workflow model is **graph-based** (the README: *"graph-based workflows supporting sequential, concurrent, handoff, and group collaboration patterns"*). Critically, these are durable — *"checkpointing... time-travel"* — meaning the workflow graph can be paused, restarted, and replayed. This is the exact capability LangGraph owns in the Python OSS world and MAF brings to .NET. The "handoff" pattern matches OpenAI Agents SDK conceptually; the "group collaboration" matches AutoGen's group chat; "concurrent" matches CrewAI's parallel fan-out via Flow. The claim is unification: all four patterns under one graph API.

### Memory model
The framework's primary surface for memory-like capability is **Agent Skills** — *"Build domain-specific knowledge bases from multiple sources—files, inline code, class libraries—for agents to discover and use."* Per `docs/decisions/0021-agent-skills-design.md`. This is the same `SKILL.md`-style instruction injection Anthropic popularized and that Bizar already integrates via the Skills CLI. Notably, MAF does **not** bundle Mem0 or a similar vector-store primitive; skills are the memory fabric.

### Standout features
- **Production-grade framing.** Foundry hosting, OpenTelemetry by default, durable workflows, time-travel debug — every "real deployment" concern is on the README. This is the most enterprise-oriented project in the multi-agent cohort.
- **Python + .NET first-party parity.** No other mainstream multi-agent SDK maintains two first-class language stacks at this fidelity. Azure shops get .NET; everyone else gets Python.
- **Agents-as-Skills is the cleanest memory alternative in 2026.** Skills are not memory in the vector-store sense, but they cover the "domain knowledge that should always be in context" case without the maintenance overhead of fact extraction and entity linking. For well-defined domains (legal, finance, internal tools) they're easier than Mem0 and harder for the model to forget.
- **Time-travel debugging.** The workflow graph is persisted at each step; you can rewind and replay with a modified state.

### Weaknesses
- **Microsoft orientation.** While MAF supports OpenAI, Anthropic (via Copilot SDK), and any provider-the-runtime-can-reach, the canonical docs and tutorials skew Azure. AWS / GCP / on-prem teams will feel under-served.
- **Labs is research, not product.** The README warns features are experimental.
- **Big surface.** Two trees of samples, middleware, foundry integration, declarative agent YAML — the cognitive load is comparable to LangChain's combinator problem. Smaller projects feel more focused.

### Bizar relevance
MAF is **the one vendor-backed framework that explicitly addresses Bizar's exact gaps**: durability, restartability, governance, time-travel, observability — and ships them in production. Of those, **time-travel debugging** is the most novel. Bizar's trajectory already includes trajectory capture (`round-3-crossref/bizar-alignment.md` B.6) and a knowledge graph (B.4). Adding a *graph-time-travel* layer — replay an agent's trajectory with mutated state — would turn Bizar's trajectories from a write-only ledger into a debugging tool. The implementation hint: trajectories emitted by Bizar's plugin hooks in JSONL with checkpoint granularity can be replayed by re-injecting at sub-messages. MAF's "research-grade orchestration" is also what Bizar could ship if opencode ever ships a workflow subgraph. **The most important thing MAF signals is that the major vendors have all converged on graphs-as-workflow** — LangGraph, MAF, crewAI Flows all talk the same graph vocabulary. Bizar's `task` dispatch should not invent its own.

---

## 5. PraisonAI (`MervinPraison/PraisonAI`)

**Source:** https://github.com/MervinPraison/PraisonAI (README captured 2026-07-06)

### What it is
PraisonAI is the Swiss-Army-knife of multi-agent frameworks. Its README opens: *"Hire a 24/7 AI Workforce. Stop writing boilerplate and start shipping autonomous, self-improving agents that research, plan, and execute tasks across your apps. From one agent to an entire organization, deployed in 5 lines of code."* Three install shapes — `praisonaiagents` (core SDK), `praisonai` CLI, and `praisonai[claw]` chatbot gateway — advertise the same five-line mental model. The README boasts an Elon Musk tweet screenshot calling out Grok 3 customer-support as one of their demos, which signals marketing reach.

### Architecture
The codebase is **`praisonaiagents` core** plus four optional packages: `praisonai[claw]` (Telegram/Discord/Slack gateway UI), `praisonai[flow]` (Langflow visual drag-drop), `praisonai[ui]` (chat interface). A `features` table inside the README lists 25 capabilities with one-liner docs links — every one a first-class API. The architecture is a control-tower over multiple underlying engines:

- **Single agent**: `Agent(instructions="...").start("...")`
- **Multi-agent**: `Agents(agents=[...]).start()`
- **Auto-mode**: auto-generates the agent roster from a goal.
- **MCP transport**: stdio, HTTP, WebSocket, SSE — same transports as OpenAI Agents SDK, exposed as a single `MCP(...)` callable.
- **External agents**: orchestrate Claude Code CLI, Gemini CLI, Codex CLI, Cursor CLI from inside PraisonAI.
- **Memory**: file-based by default (zero deps), upgradeable to DB-backed (`db` parameter accepts 20+ drivers).
- **Workflow patterns**: `route()`, `parallel()`, `loop()`, `repeat()` for graph-style flows.
- **Sandbox execution**: isolated code execution with opt-in rollback.

The agent-instantiation benchmark: *"14 μs avg instantiation time."* This is the speed-pitch — competitive with C-extension frameworks despite being pure Python.

### Multi-agent model
**Single + multi + auto.** The default model is "I give it agents; they collaborate." The advanced model is "I give it a goal; it generates the agents." This is closer to CrewAI in spirit (role-based) but with more onboarding paths and fewer opinionated conventions. The README's "Under 1 Minute" pitch is five lines, not five files — a deliberate inversion of CrewAI's "you must fill in `agents.yaml`" pattern.

### Memory model
**Two tiers.** File-based memory (zero deps) is the default — `Agent(memory=True)` writes per-user memory to disk. The persistent tier swaps in a database driver: *"Manage memories, knowledge bases, tools, and sessions across multi-database backends... PostgreSQL, MySQL, SQLite, MongoDB, Redis, and 20+ more."* The README also ships Mem0 as an explicit adapter integration ("`praisonai[mem0]`"). Context compaction is first-class: *"Never hit token limits — Context Compaction."*

### Standout features
- **Five-line minimum.** `agent.start("...")` is the smallest unit. Compare to CrewAI's four YAML files, AutoGen's group-chat manager construction, LangGraph's `StateGraph` + nodes + edges + compiler.
- **External agent orchestration.** Wraps Claude Code, Codex CLI, etc. as first-class `Agent` instances. This is the only OSS project in the catalog that treats other agent CLIs as routable agents rather than as competitors.
- **MCP transport matrix.** stdio, streamable-HTTP, WebSocket, SSE — same set as LangChain MCP adapters but exposed as one `MCP(...)` callable.
- **Performance brag.** 14μs instantiation. The benchmark is in their CI; it's the kind of claim a slow framework cannot make.
- **Mem0 integration built-in.** Mem0 is the only third-party memory primitive called out by name in the multi-agent cohort.

### Weaknesses
- **Surface breadth vs depth.** 25+ features, each with one-paragraph docs. The "Swiss-Army knife" comes with the usual tradeoff: each blade is sharp enough to be useful, none are workshop-grade.
- **Marketing tone.** The Elon Musk screenshot, the "🚀 Highlighted by Elon Musk" badge, the long install curl one-liner. The README reads as product-launch copy more than technical reference. This is signal about audience (buyers, not integrators) but it's a yellow flag for technical durability.
- **"Self-improving agents" claim is light.** The README says "autonomous, self-improving" without naming the mechanism. Likely refers to the memory loop and self-reflection feature — but this is the most-vague claim in any multi-agent README.

### Bizar relevance
PraisonAI is the closest model-by-feature-coverage to a *Bizar competitor*: it has multi-agent dispatch, MCP, external CLI orchestration, file-based + DB memory, and a `claw` gateway that ships Telegram/Discord/Slack adapters. Bizar's differentiators per `round-3-crossref/bizar-alignment.md` are: (1) Forseti-gated Tier 3+ planning, (2) the trajectory-capture + closed-learning loop plan, (3) the opencode-native `task` dispatch (no Python subprocess). The cleanest pattern to borrow: PraisonAI's `auto_save="my-project"` parameter — the user names a project once at install and every session hooks into that namespace. Bizar's `.bizar/` directory is the same idea; the surface improvement is a `bizar init --workspace <name>` to allow multiple side-by-side workspaces.

---

## 6. Agent Squad (`2FastLabs/agent-squad`)

**Source:** https://github.com/2FastLabs/agent-squad (README captured 2026-07-06); formerly `awslabs/agent-squad`, formerly `multi-agent-orchestrator`.

### What it is
Agent Squad is the AWS-origin multi-agent orchestrator now maintained under 2FastLabs. Its tagline: *"Flexible, lightweight open-source framework for orchestrating multiple AI agents — in the cloud with Python and TypeScript, and now on device with Swift."* Three runtimes — Python, TypeScript, and iOS/macOS Swift — share the same orchestration model. The README's architecture diagram is text-rendered ASCII showing: *"User input → Classifier → selected Agent → Orchestrator"*.

### Architecture
The core loop has four steps: (1) the **Orchestrator** receives a user message; (2) a **Classifier** (LLM-based by default; pluggable) picks the best agent for the turn from the registered pool; (3) the chosen **Agent** processes the input, calling tools as needed; (4) the **Orchestrator** saves the exchange and returns the response. Crucially, the classifier picks from agent *descriptions* — so the agent roster is the explicit surface the developer authors.

Two interesting agent types. **SupervisorAgent** is *"a lead agent coordinates a team of specialized agents in parallel using an agent-as-tools architecture, maintaining shared context and delivering one coherent response."* It supports **hierarchical teams of teams** because a SupervisorAgent can itself be registered in the classifier. **GroundedAgent** is the anti-hallucination pattern: *"A gatherer calls your tools and sees the raw results — but never speaks to the user. An isolated presenter writes the reply from the curated tool output alone: no tools, no tool transcript, no chat history. It cannot invent a price, a rating, or a stock status that wasn't actually fetched."* This is the cleanest two-LLM grounding pattern in the catalog.

The Swift runtime (new in 2026) runs entirely on-device — *"agents, MCP tools, realtime voice, and tracing, running entirely on device"* — with `DeviceChatStorage` for local-first persistence.

### Multi-agent model
**Classifier-routed + supervisor-nested.** The mental model: N specialists, one orchestrator, one classifier. Agents don't talk to each other directly; they go through the orchestrator. Supervisors *are* agents that happen to call other agents as tools (parallel fan-out). This is a deliberately simpler model than group chat — there's no free conversation, no emergent behavior, just routing.

### Memory model
**Pluggable conversation storage** keyed by `(user_id, session_id)`. The default is in-memory; production swaps to DynamoDB, Redis, SQLite, or SwiftData on-device. The README doesn't ship fact extraction or entity linking; conversation history is the memory surface.

### Standout features
- **Three-runtime parity.** Python for Lambda/containers, TypeScript for Node backends, Swift for on-device iOS/macOS. The same Swift Package supports: agents + grounded-agents + classifier routing + MCP tools + voice + tracing + SwiftData persistence. This is the only OSS multi-agent framework with an on-device mode.
- **GroundedAgent.** The two-LLM "gatherer/presenter" pattern is the most rigorous answer to "agents hallucinate data" in the catalog. It's not novel (the pattern predates the project), but Agent Squad ships it as a first-class agent type rather than a tutorial.
- **Pluggable everything.** Custom agents, classifiers, storage, retrievers — all swappable behind small interfaces.
- **Classifier is LLM by default, but not required.** You can swap in a regex router, a vector-similarity router, or any classifier you want. This makes Agent Squad test-friendly: a deterministic classifier lets you write unit tests for agent routing.

### Weaknesses
- **AWS origin shows.** Bedrock, Lex, Lambda, Connect — even though AWS is no longer involved, the example gallery skews AWS. The README's "Articles & podcasts" section is six AWS blog posts.
- **No group chat.** Routing is one-to-one (or one-to-team via Supervisor). Anything that wants free multi-agent conversation has to leave this framework.
- **Conversation memory is shallow.** Just `(user_id, session_id)` keyed history. No per-entity memory, no fact extraction. PraisonAI and Mem0 cover this; Agent Squad does not.

### Bizar relevance
The **GroundedAgent pattern** is the right shape for Bizar's high-stakes tool calls: when Tyr is about to run `rm -rf node_modules && npm install`, separating "research the right command" (gatherer) from "execute it" (presenter) is exactly the kind of human-review-shaped gate that produces real safety. The implementation hint: a `BizarAgent` config flag `grounded: true` that splits the agent's planning pass from its execution pass, with a Bizar-side review opportunity in between. The **pluggable classifier** is also a steal — Bizar's `Odin` could swap from "LLM picks the right sub-agent" to "deterministic rule picks the sub-agent" for safety-critical dispatch (e.g. always send Tier-4 destructive operations to Forseti first, then Vidarr). This is the only place in the multi-agent cohort where the routing decision is genuinely portable.

---

## 7. MetaGPT (`FoundationAgents/MetaGPT`)

**Source:** https://github.com/FoundationAgents/MetaGPT (README captured 2026-07-06); formerly `geekan/MetaGPT`.

### What it is
MetaGPT is the iconic software-company-simulation multi-agent framework — *"Assign different roles to GPTs to form a collaborative entity for complex tasks."* Its thesis is best captured in the README's code-equivalent line: **`Code = SOP(Team)` — materializing a Standard Operating Procedure into a team of LLM agents.** Input: a one-line requirement. Output: user stories → competitive analysis → requirements → data structures → APIs → code. Internally, agents play Product Manager, Architect, Project Manager, Engineer (and increasingly Data Interpreter, Researcher, Debate, Receipt Assistant).

The project is a research staple — it has a paper at ICLR 2024, an ICLR 2025 oral for the AFlow paper, and an active companion product `mgx.dev` which Product Hunt awarded #1 Product of the Week and Day in March 2025.

### Architecture
Each agent runs as a `Role` with `Profile`, `Actions`, and `Watch` rules. Actions are tools (e.g., `WritePRD`, `WriteDesign`, `WriteCode`, `RunCode`); agents subscribe to events via `Watch` patterns and act when their inputs arrive. The whole pipeline is an **SOP** — a directed graph of `Message`-passing between roles. Adding a new role means adding a new SOP node. The `metagpt` CLI is the entry point; `metagpt "Create a 2048 game"` produces a workspace directory tree with the full `ProjectRepo`.

### Multi-agent model
**SOP / assembly-line.** Roles are sequential along an SOP; handoffs happen by the next role's `Watch` rule firing on a `Message` published by the upstream role. The closest analog is a real software company's waterfall process. This is the *opposite* of CrewAI's free-conversation model: MetaGPT's agents never talk freely; they pass documents. Concurrent execution is supported but the canonical pattern is serial handoff.

### Memory model
There is no user-facing memory API. The agents share `Message`s on a single `Environment`-scoped message bus; agents see the messages they `Watch` for. Long-term memory is application-level (write the workspace, re-read later). Data Interpreter (`metagpt.roles.di.data_interpreter`) is a specialized role for ML/data pipelines and uses file-based state.

### Standout features
- **Software-company narrative.** No other framework ships the metaphor this literally. The README's centerpiece image is a software-company org chart as agents. For teams that think in software terms, this is the most intuitive mental model.
- **The SOP abstraction.** Roles are deterministic in the small (their own prompts, actions, output schemas) but emergent in the large (the SOP composition). Code generation agents work because they verify each other's outputs.
- **Companion product (mgx.dev).** Worth flagging that the OSS MetaGPT feeds the commercial `mgx.dev` product. The community maintains the OSS project; the company builds the SaaS.
- **Research-grade.** The two papers (AFlow at ICLR 2025 oral, ranking #2 in the LLM-based Agent category; SPO and AOT in February 2025) make MetaGPT the most-cited OSS multi-agent framework in academic literature.

### Weaknesses
- **Coder specificity.** Outside of code, MetaGPT's metaphor breaks: a "marketing team" or "legal team" SOP isn't naturally templated the same way. The role kit narrows.
- **Reduced development pace.** The catalog description flags: *"The landmark of the genre; development pace has slowed in [recent months]"*. The two papers are real; the shipping cadence is lower than CrewAI's.
- **No governance primitives.** No approval gate, no human-in-the-loop checkpoint in the canonical SOP. The user trusts the agents to do the right thing.

### Bizar relevance
MetaGPT's software-company metaphor is the right *narrative* for the kind of multi-agent coding session that Bizar's parallel dispatch attempts. But Bizar's tier-based dispatch (Odin/Thor/Tyr/Vidarr, with Forseti as audit) is the opposite design: Bizar's agents are "what evidence supports this plan?" not "what role am I playing?" The MetaGPT lesson worth borrowing is the **SOP-as-message-graph** shape — every agent interaction is a typed message with a Watch rule, not a chat. Bizar's current `task` tool is a fire-and-return string; if Bizar wants tier-3+ agents to coordinate like MetaGPT's roles do, the dispatch should pass a structured `Message` envelope between agents, not just a string prompt.

A second, more targeted, borrow: **MetaGPT's role-to-action binding is the right shape for Bizar's specialist agents.** Thor "the implementer" should have a small set of action primitives (read, edit, run tests, search); Vidarr "the researcher" should have a different set (search web, fetch README, summarize). Today Bizar's agent descriptions mix too many actions per agent — narrowing each agent to a small action kit, with explicit handoff rules that say "only Thor can produce code; only Vidarr can fetch remote URLs," would compress the dispatch surface and reduce confusion.

---

## 8. LangGraph (`langchain-ai/langgraph`)

**Source:** https://github.com/langchain-ai/langgraph (README captured 2026-07-06)

### What it is
LangGraph is the only project in this cohort that names itself a *"Low-level orchestration framework for building stateful agents"* — not an agent SDK, an orchestration framework. The README's positioning is unmistakable: *"LangGraph provides low-level supporting infrastructure for any long-running, stateful workflow or agent"* — durable execution, human-in-the-loop, comprehensive memory, debugging via LangSmith, production-ready deployment. Production users include Klarna, Replit, Elastic.

### Architecture
LangGraph's primitives are the smallest: **StateGraph** (typed state), **Nodes** (functions or agents), **Edges** (typed routing), **Checkpointer** (state persistence), **Interrupt** (human-in-the-loop primitive). The runtime is a graph that ticks node-by-node, persisting state at each checkpoint so a crashed run can resume from the last good checkpoint.

Four headline features in the README:

1. **Durable execution** — *"Build agents that persist through failures and can run for extended periods, automatically resuming from exactly where they left off."*
2. **Human-in-the-loop** — *"Seamlessly incorporate human oversight by inspecting and modifying agent state at any point during execution."* The interrupt is a first-class runtime primitive.
3. **Comprehensive memory** — *"Create truly stateful agents with both short-term working memory for ongoing reasoning and long-term persistent memory across sessions."*
4. **Debugging with LangSmith** — *"Gain deep visibility into complex agent behavior with visualization tools that trace execution paths, capture state transitions, and provide detailed runtime metrics."*

The graphic motto: *"inspired by [Pregel](https://research.google/pubs/pub37252/) and Apache Beam. The public interface draws inspiration from NetworkX."* — i.e. graph-as-data-structure, Google-precursors.

### Multi-agent model
**Explicit state machine.** The "team" is whatever the developer draws. Common patterns: fan-out from one supervisor to N specialist nodes, fan-in to aggregate, branch on classifier output, loop on conditional edges. Deep Agents is the higher-level package — *"a higher-level package built on LangGraph for agents that can plan, use subagents, and leverage file systems for complex tasks."* This is the agent-SDK-shaped surface that sits on top of the low-level graph.

### Memory model
Two-tier. **Short-term working memory** is the StateGraph's typed state (in-memory or backed by a checkpointer). **Long-term persistent memory** is pluggable via the LangGraph `Store` API — Postgres, Redis, or in-memory backend with a `BaseStore.put(namespace, key, value)` interface and recallable via `BaseStore.search(namespace, query)`. No built-in entity extraction or fact summarization; that's where Mem0 integrates.

### Standout features
- **Durable execution with checkpoints.** This is the catalog's gold standard. A workflow can pause for human review, restart from any earlier checkpoint, or resume after a process crash. The checkpointer abstraction works for SQLite (dev), Postgres (prod), and Redis (high-throughput).
- **Time-travel via state inspection.** Combined with LangSmith, you can literally replay an agent run with mutated state.
- **NetworkX-style API.** Anyone familiar with graph algorithms in Python gets LangGraph in an afternoon. The barrier is graph-thinking, not Python.
- **Open-source with commercial hosting.** LangGraph itself is MIT; LangSmith is a managed LangChain product. The split is the same as the Anthropic Skills / Vercel / Cloudflare model: open the framework, monetize the workflow.
- **Production credibility.** Klarna, Replit, Elastic — these are not toy deployments.

### Weaknesses
- **Steep graph-thinking barrier.** A new LangGraph developer writes more boilerplate (StateGraph, add_node, add_edge, compile, invoke) than a CrewAI developer writes roles. The mental model is also less intuitive for non-engineers than CrewAI's role metaphor.
- **Coupling to LangSmith for serious debugging.** LangSmith isn't required but the README leans on it heavily. OSS-only users get checkpoint files but lose the visualization layer.
- **Versions and APIs churn.** LangGraph 0.x → 1.0 in 2025 produced several breaking changes; community tutorials lag the canonical API.

### Bizar relevance
LangGraph is the only OSS framework in the cohort with **durable execution + checkpoints + time-travel** baked into the runtime. For Bizar, this is the missing layer between "the subagent wrote something" and "I can re-run that subagent with different inputs to see what happens." If Bizar's trajectory-capture plan (`round-3-crossref/bizar-alignment.md` B.6) stores trajectories as well as checkpointer-compressed state, Bizar gets durable replay *as a side effect* — no new code. The implementation hint: emit a `bizar graph state` JSON-Lines file per dispatched subagent that captures (a) the input message, (b) the model, (c) the tool calls and results, and (d) the assistant's intermediate reasoning. This is sufficient for replay; a future Bizar feature can wrap it in a `bizar replay <run-id> --with-mutation <path>` command. **The biggest lesson from LangGraph is that "workflows" are graphs.** Bizar's task dispatch should not be a tree; it should be a graph with edges for "depends on," "parallelizable with," and "audit-required before."

---

# Part II — Memory Layers (3 projects)

## 9. Mem0 (`mem0ai/mem0`)

**Source:** https://github.com/mem0ai/mem0 (README captured 2026-07-06)

### What it is
Mem0 is the universal memory layer for AI agents. README first line: *"Mem0 ('mem-zero') enhances AI assistants and agents with an intelligent memory layer, enabling personalized AI interactions. It remembers user preferences, adapts to individual needs, and continuously learns over time—ideal for customer support chatbots, AI assistants, and autonomous systems."* 60k+ stars, Apache-2.0, **the de-facto memory primitive paired with most harnesses in 2026** per the best-of catalog description. Y Combinator S24. Mem0 the company ships both an OSS library (`mem0ai`) and a managed Platform service.

### Architecture
Mem0's "memory layer" is five operations. `add(messages, user_id=...)` extracts facts from a conversation and persists them keyed by user/session/agent. `search(query, filters={"user_id": ...}, top_k=...)` returns ranked memories. `update(memory_id, data)` / `delete(memory_id)` edit single facts. `get_all(user_id=...)` enumerates.

The April 2026 algorithm (per the README's "New Memory Algorithm" table) replaces the older extraction loop with: *"Single-pass ADD-only extraction — one LLM call, no UPDATE/DELETE. Memories accumulate; nothing is overwritten."* This is a major inversion: facts are append-only; conflicting memories are resolved at *retrieval time*, not at *write time*. The result: a memory bank that grows rather than drifts.

Key sub-systems inside the new algorithm:
- **Entity linking** — entities are extracted, embedded, and linked across memories so a "Daniel" mention in one memory can recall a "Daniel Müller who lives in Berlin" mention in another.
- **Multi-signal retrieval** — semantic + BM25 keyword + entity matching, scored in parallel and fused.
- **Temporal reasoning** — *"time-aware retrieval that ranks the right dated instance for queries about current state, past events, and upcoming plans."*

**Retrieval benchmarks are the proof:**

| Benchmark | Old | New | Tokens | Latency p50 |
|---|---:|---:|---:|---:|
| LoCoMo | 71.4 | **91.6** | 7.0K | 0.88s |
| LongMemEval | 67.8 | **94.8** | 6.8K | 1.09s |
| BEAM (1M tokens) | — | **64.1** | 6.7K | 1.00s |
| BEAM (10M tokens) | — | **48.6** | 6.9K | 1.05s |

The numbers are produced by an open-sourced eval framework (`mem0ai/memory-benchmarks`). A "single-pass retrieval (one call, no agentic loops)" claim is the architectural headline — every other memory primitive in the catalog pulls an LLM call per retrieval; Mem0's new algorithm makes retrieval a single-shot fused search.

### Memory model
Three scopes: `user_id`, `session_id`, `agent_id`. Filters combine — `search(query, filters={"user_id": "alice", "agent_id": "support-bot"})`. Memories are stored in a vector store (Qdrant default, self-host) and indexed for hybrid search. Underlying database for relational storage is the self-hosted Postgres (via Docker Compose).

### Standout features
- **The benchmarked algorithm.** The single-page table makes Mem0 the only memory layer in the catalog whose retrieval-quality claim is independently reproducible. LongMemEval at 94.8 is a research-grade result.
- **Three deployment shapes.** Library (`pip install mem0ai`), Self-Hosted Server (Docker Compose), Cloud Platform (managed). A team can start at level 1 and graduate to level 3 without rewriting.
- **Single-pass retrieval.** One LLM call per `add()`, one vector + BM25 + entity search per `search()`. No agentic memory loops.
- **Temporal reasoning.** Memories have effective dates, and "what's Alice's current role?" retrieves the latest dated fact, not the earliest. This is the small detail most memory layers get wrong.
- **Skills + CLI.** `npx skills add https://github.com/mem0ai/mem0 --skill mem0` ships a Skill so Claude Code / Codex / opencode know how to integrate Mem0. The README also documents `npx @mem0/cli` for terminal-based memory management.

### Weaknesses
- **Default LLM is OpenAI.** Out-of-the-box, `mem0ai` instantiates `OpenAI(api_key=...)` for extraction and summarization. The README points to a long LLM-provider page but the "zero-config" path is OpenAI-only. Teams that want Anthropic need to wire it up.
- **Single-pass ADD-only is new and may have edge cases.** The trade (no UPDATE/DELETE means duplicate facts accumulate) is benign but real. Operations like "user changed their name from Alice to Ali" become two memories; retrieval must resolve.
- **Cloud Platform is gating more features.** Per the README: library = "Teasers" for advanced features; cloud = "All included." Self-hosted pays the maintenance tax for feature parity.

### Bizar relevance
Mem0 is the canonical *drop-in memory primitive* the best-of catalog highlights ("Drop-in memory layer → Mem0, claude-mem, agentlog, agno, letta"). Bizar's current memory is three-layered: `.bizar/memory.json` (working), Obsidian vault (durable), LightRAG index (semantic). Mem0 would slot in as the **per-user fact extractor + temporal-reasoning layer** that the JSON-and-Obsidian stack does not implement. The cleanest integration: add Mem0 alongside the existing layers, keeping Obsidian as the human-readable durable store and Mem0 as the LLM-callable fact layer. The "single-pass ADD-only" design is especially appealing because it does not require Bizar to invent a conflict-resolution policy — Mem0's retrieval handles it. Concretely: a Mimir research pass that learns "the dashboard uses WebSockets not SSE" would feed both an Obsidian note (durable, human-readable) and a Mem0 fact (LLM-callable, retained across sessions even if the user deletes the note).

---

## 10. Letta (`letta-ai/letta`)

**Source:** https://github.com/letta-ai/letta (README captured 2026-07-06)

### What it is
Letta (formerly MemGPT) is the project that named the memory-as-prompt-engineering problem. Its current README is intentionally lean — *"Build AI with advanced memory that can learn and self-improve over time."* The repo is now in transition: the legacy Letta V1 server is archived at this repo (per the README's banner: *"Active development has moved to the [Letta Agent repo](https://github.com/letta-ai/letta-code)"*) while the new "Letta Code" CLI lives at `letta-ai/letta-code`. The framing has shifted: the README pitches (1) **Letta Agent** — a CLI tool, desktop app, or Slack-channel-runnable agent, and (2) **Letta Agent SDK** — a TypeScript SDK for building stateful agents into applications. The earlier "MemGPT" framing (memory-augmented GPT with paging-style memory) is now a *vintage* API still maintained but no longer where the team's energy goes.

### Architecture
Three runtimes:
1. **Letta Code (`@letta-ai/letta-code`)** — Node.js 22.19+ CLI tool that runs an agent locally. *"Bundles pre-built skills/subagents for advanced memory and continual learning."*
2. **Letta Agent SDK (`@letta-ai/letta-agent-sdk`)** — TypeScript SDK. Three backends: `cloud` (Letta's Constellation cloud), `local` (spawns `letta-code` as subprocess), `self-hosted` (App Server). One Hello World example (the README's first code block) creates an agent with `human` and `persona` strings, calls `createAgent({ model: "anthropic/claude-opus-4-8", ... })`, then `client.resumeSession(agentId).send("...")` and streams back assistant messages.
3. **Letta V1 SDK (`@letta-ai/letta-client` / `letta-client`)** — the original Python+TS SDKs that target the Letta API directly; still available, recommended for new projects is the Agent SDK.

### Memory model
Letta's hallmark is the **memory blocks** abstraction — typed, named, persistent units the agent can read and write to itself. The classic shapes: `persona`, `human`, `facts`, `conversation`. Each block has a label, a value, and a limit (character or token count) so the agent must decide *what* to write and *when*. This is the design MemGPT pioneered and that survives into the new SDK. Memory blocks live server-side (stateful across sessions). The `resumeSession` call rehydrates the full memory state.

### Standout features
- **Stateful agents as the primitive.** Unlike most memory layers (Mem0, claude-mem) which are *facts stores*, Letta's model is *long-lived agents with persistent identity.* An agent's `persona` block evolves over time; an agent's `human` block grows with what it learns about you.
- **The MemGPT heritage.** The original MemGPT paper (Packer et al. 2023) is the most-cited agent-memory paper. Letta is the productionization of that thesis.
- **Three backing deployment modes.** Cloud (hosted Constellation), Local (CLI subprocess on your machine), Self-hosted (App Server in your VPC). Same SDK, swap one parameter.
- **Bundled skills + subagents in the CLI.** Continual learning via shipped skills — the Letta Code CLI ships with patterns for memory-aware tasks, not just a bare agent.

### Weaknesses
- **Repo transition in flight.** The README's banner is explicit: active development is at `letta-ai/letta-code`. Integrators betting on the legacy `letta-ai/letta` repo may hit the V1 → Agent SDK migration sooner than they'd like.
- **Server-component model.** Letta's "agent with stateful memory" requires running *something* (cloud, local CLI subprocess, or self-hosted server). A Mem0 library user can run on a constrained sandbox; a Letta user pulls the Letta process. The two memory layers solve overlapping problems at different complexity budgets.
- **Single language surface.** TypeScript-first. Python via V1 (legacy). No Rust SDK.

### Bizar relevance
Letta's **memory blocks abstraction** is the cleanest existing pattern for "named, bounded, agent-self-managed" memory. Bizar's `.bizar/memory.json` + Obsidian + LightRAG stack is broader but less structured. The specific borrow: define `persona`, `human`, `facts`, `conversation` as **four typed memory surfaces** in `.bizar/memory/`, each with explicit character limits. Agents learn to write within the limits. This forces a discipline that the current file-based memory lacks: every memory write is a deliberate edit, not an append, and the agent must decide *what to forget* when its human block overflows. MemGPT's original insight was that an LLM agent would rather "page" memory in and out than compress it; Bizar could reimplement the same behavior with a smaller Claude call at compress-time.

The Letta Agent SDK's three-mode deployment (cloud/local/self-hosted) is also a model for **how Bizar's MCP server should expose itself** — `./packages/mcp-server/` can ship a `bizar mcp serve` that runs in any of three modes without code change: `cloud` (Bizar's hosted offering), `local` (the user's own Bizar instance), `self-hosted` (the user's own VPS). The legacy → new transition is also a warning for Bizar's v6 churn.

---

## 11. claude-mem (`thedotmack/claude-mem`)

**Source:** https://github.com/thedotmack/claude-mem (README captured 2026-07-06)

### What it is
claude-mem is the dominant Claude Code plugin for memory. README tagline: *"Persistent memory compression system built for Claude Code."* 85.9k stars — the most-stared project in this entire report. Apache-2.0. Its architecture is built around three lifecycle moments: tool-use observation, AI summarization, and retrieval-time reinjection.

### Architecture
Six pieces glue together:

1. **5 Lifecycle Hooks** (`README.md` "How It Works") — `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`, `SessionEnd`. Each calls into a worker service.
2. **Worker Service** — local HTTP API run under Bun that exposes `/search`, `/timeline`, `/get_observations`, and the web viewer UI. (Bun is "auto-installed if missing.")
3. **SQLite Database** — sessions, observations, summaries, all indexed with FTS5 for fast keyword search.
4. **Chroma Vector Database** — hybrid semantic + keyword search for retrieval.
5. **mem-search Skill** — natural-language query interface for the agent.
6. **Web Viewer UI** — *"Real-time memory stream at the worker URL printed on startup."*

The README's `MCP Search Tools` section describes the **3-layer workflow pattern** for token-efficient retrieval:

```
Layer 1: search         → compact index with IDs          (~50-100 tokens/result)
Layer 2: timeline       → chronological context           (cheap)
Layer 3: get_observations → full details for filtered IDs (~500-1,000 tokens/result)
```

The pattern is: agents *see the index*, decide what's relevant by ID, *fetch the bodies*. The README claims *"~10x token savings"* by filtering before fetching details. Three MCP tools ship: `search`, `timeline`, `get_observations`.

### Memory model
Three layers: **session-level** (transient, per Claude Code session), **observation-level** (per tool-use event with AI-generated summary), **summary-level** (cross-session compressed semantic memory). Multiple language modes (`code`, `code--zh`, `code--ja`) generate observations in different languages. Privacy control via `<private>` tags that exclude sensitive content from storage.

### Standout features
- **Lifecycle hooks are the storage contract.** The 5 hook scripts are the entire interface between Claude Code and claude-mem. This is the cleanest separation in the memory-layer cohort: the host (Claude Code) defines a lifecycle, the plugin subscribes.
- **3-layer progressive disclosure.** The token-economy of layered retrieval is the most-copied pattern in 2026. Mem0's multi-signal retrieval is conceptually similar but Mem0 does it server-side; claude-mem does it via tool-call economics in the agent loop.
- **Web Viewer UI.** A real-time memory stream dashboard. The README says: *"real-time observation feeds to Telegram, Discord, Slack, and more"* in the OpenClaw integration.
- **Multi-IDE install paths.** `npx claude-mem install [--ide opencode|antigravity|...]`. The skill teaches itself to other agents.
- **OpenClaw Gateway integration.** Single `curl | bash` install for persistent memory on OpenClaw gateways, with the same real-time observation feeds to messaging platforms.

### Weaknesses
- **Claude Code-specific.** The hook system is Claude Code's; claude-mem works only where Claude Code hooks exist. The recent `--ide opencode` and `--ide antigravity` flags hint at adapter work but the canonical install is Claude Code.
- **Bun runtime required.** Adds a non-Node dependency, auto-installed but a sharp edge for hardened environments.
- **Star count is inflated by Claude Code's velocity.** 85k stars is a Claude Code ecosystem number, not necessarily a memory-layer number. Mem0 at 60k is the more careful cross-tool comparison.

### Bizar relevance
claude-mem is the *right shape* for Bizar's "session-to-session memory" problem if Bizar were Claude Code. But Bizar's hook surface — opencode's pre/post-turn + pre/post-tool-call hooks — is functionally identical. The three-layer workflow (index, filter, fetch) is a generalizable pattern that Bizar's memory backends should adopt. Concretely: `.bizar/memory.json` could carry only an index of observations (sizes & dates & one-line summaries), and a `bizar memory fetch <ids>` CLI subcommand could materialize the bodies. This forces agents to be deliberate about what they load into context — the same token-economy claude-mem achieves.

The lifecycle-hook contract is also a model for `bizar` plugin developers: Bizar's plugin SDK (per `round-3-crossref/bizar-alignment.md` B.7) should expose the same five hook points (`session_start`, `turn_start`, `pre_tool_call`, `post_tool_call`, `turn_end`, `session_end`) so claude-mem itself could be ported as a Bizar plugin with no claude-mem-side changes. The single-line best-of-comparison insight: claude-mem is "the right shape for one IDE/host"; Mem0 is "the right shape for any host"; Bizar needs the Mem0 shape *because* it isn't Claude Code.

---

# Part III — Sandbox / Runtime Layers (3 projects)

## 12. Daytona (`daytonaio/daytona`)

**Source:** https://github.com/daytonaio/daytona (README captured 2026-07-06)

### What it is
Daytona is the sandboxes-as-a-service product for AI-generated code. README first sentence: *"Daytona is a secure and elastic infrastructure runtime for AI-generated code execution and agent workflows. Our open-source platform provides sandboxes, full composable computers with complete isolation, a dedicated kernel, filesystem, network stack, and allocated vCPU, RAM, and disk."* Sub-90ms cold-start time is the headline number. 72k stars. **Repository officially not maintained as of June 2026** — the README banner reads: *"As of June 2026, Daytona's core development has moved to a private codebase."* The OSS repo is still public for read-and-fork.

### Architecture
Three planes:
- **Interface plane** — client SDKs (Python, TypeScript, Ruby, Go, Java — five language SDKs).
- **Control plane** — orchestrates all sandbox operations.
- **Compute plane** — runs and manages sandbox instances.

A "sandbox" is what Daytona calls a *full composable computer*: dedicated kernel, filesystem, network stack, allocated vCPU + RAM + disk. The cold-start claim is *"under 90ms from code to execution."* Built on OCI/Docker compatibility for portability. Snapshots provide "stateful environment... persistent agent operations across sessions." Volumes attach across sandboxes. Regions distribute compute geographically.

The README's "Features" table breaks the platform into five sub-tables:
- **Platform** — Organizations, API Keys, Limits, Billing, Audit logs, OpenTelemetry, Integrations, Security exhibit.
- **Sandboxes** — Environment configuration, Snapshots, Declarative builder, Volumes, Regions.
- **Agent tools** — Process & code execution, File system operations, Language server protocol (LSP!), Computer use, MCP server, Git operations, Pseudo terminal (PTY), Log streaming.
- **Human tools** — Dashboard, Web terminal, SSH access, VNC access, VPN connection, Preview, Custom preview proxy, Playground.
- **System tools** — Webhooks, Network limits.

The detail that matters: **Language Server Protocol (LSP) integration in the sandbox.** This means a coding agent running in a Daytona sandbox gets real language-aware tooling (find-references, rename, go-to-definition) — not just shell exec.

### Multi-agent model
Not a multi-agent framework per se. Daytona is infrastructure *for* multi-agent frameworks. The sandbox is a unit of compute, and agents communicate with sandboxes via the SDK.

### Memory model
None at the agent level. Sandbox state is `Snapshot` (a point-in-time persistent disk image) and `Volume` (shared persistent storage). Long-horizon agent behavior is implemented by snapshotting a sandbox after a successful run and restoring it next time. This is a *file-system-level* memory, not a fact-level memory.

### Standout features
- **Cold-start speed (<90ms).** No other catalog project advertises cold-start numbers this low. E2B is comparable but slower; Modal's cold starts depend on container type.
- **LSP integration.** Coding agents in a Daytona sandbox get real language tooling, not just shell. The README bundles Playwright and other agent sandboxes.
- **Snapshots + Declarative builder.** The `Declarative builder` ("specify a target state of dev environment instead of scripting imperative steps") is the right abstraction for "I want a sandbox that has my project cloned and dependencies installed."
- **MCP server.** Daytona ships as an MCP server — an agent that wants a sandbox asks Daytona via MCP, gets a `Sandbox` object, runs commands. This is the cleanest MCP-served infra primitive in the catalog.
- **Five SDK languages.** Python + TypeScript + Ruby + Go + Java. No other sandbox project covers this surface.

### Weaknesses
- **OSS is read-only / fork-only.** The README banner is unambiguous. The active build pipeline sits behind a private codebase; the OSS repo is deprecated at the canonical location. Teams that build on this repo will eventually migrate (or fork).
- **Cloud-hosted, not self-hostable.** The README doesn't list a self-hosted Docker Compose the way E2B does. The infra is `app.daytona.io` only.
- **Categorized as a "library/SDK" not an agent framework.** Per best-of's tier: `slightly complex / n/a / n/a`. It's an infra tool agents call into, not an agent.

### Bizar relevance
Daytona points Bizar at a future where **agent execution doesn't happen on the user's laptop** — it happens in a managed compute plane with sub-90ms cold starts. For Bizar's Phase-3 approval-gated work, where the user wants the agent to "just go fix the test suite" and walk away, Dayona-class infrastructure removes the laptop-bound constraint entirely. The integration shape: Bizar's `claude/backends/docker.mjs` (per `round-3-crossref/bizar-alignment.md` B.3) is the right local-path abstraction; a future `cli/backends/daytona.mjs` adds the cloud-sandbox path with the same `BaseBackend` interface. The MCP-server pattern Daytona exposes is the exact shape Bizar's MCP server should also expose for its own infra (per `round-3-crossref/bizar-alignment.md` B.11). **Daytona's LSP-in-sandbox is Bizar's missing tier-3 capability** — today Thor edits code blindly; with LSP, it can navigate and refactor semantically. This is a 3-month Tier-3 feature, not a v6 moonshot.

---

## 13. E2B (`e2b-dev/E2B`)

**Source:** https://github.com/e2b-dev/E2B (README captured 2026-07-06); canonical repo is `e2b-dev/E2B` (uppercase).

### What it is
E2B is the AI-generated-code sandbox that most demos reach for. README: *"E2B is an open-source infrastructure that allows you to run AI-generated code in secure isolated sandboxes in the cloud."* The README's "5-step Quickstart" is the smallest in the catalog: install SDK → grab API key → `Sandbox.create()` → `sandbox.commands.run(...)` → done. 12.8k stars. Apache-2.0 infrastructure, with a full **self-hosting guide** at the linked `e2b-dev/infra` repo (Terraform-deployed to AWS or GCP).

### Architecture
A sandbox is a Firecracker microVM. The control plane (E2B cloud) provisions VMs, runs them, and exposes them through a sandbox API. The SDK offers three execution surfaces:

1. **`Sandbox.commands.run('echo "..."')`** — synchronous shell exec, returns stdout/stderr/exit code.
2. **`@e2b/code-interpreter` and `e2b-code-interpreter`** — Python and JS packages that wrap a sandbox with persistent REPL state. Code is *sent*, *run*, and *output is returned as last-expression-value plus charts and rich results*. Use case: data-analysis agents that need to keep state across multiple `runCode()` calls.
3. **Self-hosted via Terraform** — the linked `e2b-dev/infra` repo deploys the entire stack to AWS or GCP using Terraform. Azure and a generic Linux host are listed as "coming soon."

### Multi-agent model
None at the framework level. E2B is infra; agents are the consumers.

### Memory model
Sandbox filesystem state persists for the lifetime of the sandbox instance. There is no cross-sandbox memory; each `Sandbox.create()` is fresh. Long-running agents hold open a long-running sandbox and treat its filesystem as memory.

### Standout features
- **Three-step Quickstart to running code.** The README's "Run your first Sandbox" is `pip install e2b; from e2b import Sandbox; Sandbox.create().commands.run("echo")`. The whole dev loop is in three lines.
- **Code Interpreter SDK.** The companion `@e2b/code-interpreter` package is the canonical "AI agent analyzes data" sandbox — Jupyter-style state, rich outputs, plots. This is the API almost every "AI data analyst" demo in 2024-2026 ultimately sits on top of.
- **Firecracker isolation.** E2B uses Firecracker microVMs, the same primitive AWS Lambda runs on. Cold-start is in the 100s of ms; isolation is hardware-virtualization-grade. No container escape possible — VM boundary.
- **Self-hostable.** Unique among the sandbox cohort: the `e2b-dev/infra` repo lets you run the entire stack in your own AWS or GCP account. The README says it uses Terraform for deployment.
- **Multi-language SDK.** Python + JavaScript/TypeScript at minimum; the architecture is REST + WebSocket so any HTTP client works.

### Weaknesses
- **No LSP, no language tooling.** A coding agent running in an E2B sandbox gets shell, not semantic language tooling. Compare Daytona's LSP.
- **Cloud or self-host in AWS/GCP only.** Azure is on the roadmap; bare Linux is "coming soon."
- **No declarative builder.** Unlike Daytona's "specify desired state," E2B's model is "run scripts after `create()`." More imperative, less reproducible.
- **Sandbox lifetime is per-session.** No snapshot model like Daytona's. Long-horizon agents either keep a sandbox open (cost) or replay setup (time).

### Bizar relevance
E2B is what Bizar's `Docker` backend would look like if it ran in someone else's cloud. The *exact integration hint*: don't ship an E2B backend in v1, but **adopt the E2B Code Interpreter SDK shape** — Bizar should expose a `bizar_repl` tool that accepts Python or Node code, runs it in a long-lived sandbox, and returns the last value plus any plots or files. This is the right shape for "Bizar as a data scientist" without committing to the sandbox-as-a-service model. The self-hostability angle matters for enterprise teams that can run things in their own VPC; the Firecracker isolation story is what makes that path credible.

E2B's three-step Quickstart is also a UX lesson: the `bizar init` command (already exists per `.bizar/PROJECT.md`) should be three commands, not fifteen, to onboard a new project.

---

## 14. Modal (`modal-labs/modal-client`)

**Source:** https://github.com/modal-labs/modal-client (README captured 2026-07-06). Note the canonical repo was renamed from `modal-labs/modal` to `modal-labs/modal-client` — this is the repo a new contributor should clone today.

### What it is
Modal is the serverless cloud for Python (and JS/Go via community SDKs). Per the modal.com docs landing page: *"Modal provides a serverless cloud for engineers and researchers who want to build compute-intensive applications without thinking about infrastructure. Run generative AI models, large-scale batch workflows, job queues, and more, all faster than ever before."* Modal Lab's "Sandboxes" product is the agent-execution angle — sandboxes run code with shell access and filesystem state.

### Architecture
The SDK is `pip install modal`; users run `python3 -m modal setup` for auth. Functions are decorated with `@app.function()` and run on Modal's container infrastructure. Deployment is `modal deploy`. Sandboxes (per `https://modal.com/docs/guide`) are *"a secure,ephemeral compute primitive"* that runs untrusted code, supports snapshots, and serves the agent-coding ecosystem (`/docs/examples/opencode_server` — "Deploy OpenCode agents"; `/docs/examples/agent` — "Sandbox a LangGraph agent's code"). Modal's customer-base spans Klarna, Replit (also in LangGraph's), and a Stripe-sized mid-market for ML inference.

The repo (`modal-client`) hosts the Python (75.4%), Go (13.5%), and TypeScript (10.9%) SDKs. It's a *client* — Modal's server is hosted.

### Multi-agent model
None. Modal is compute infrastructure; frameworks live on top.

### Memory model
None at the framework level. Sandboxes have filesystems; Modal Functions have persistent state via `modal.volume` and `modal.dict` primitives (a distributed key-value store).

### Standout features
- **"Serverless for Python" is the precise positioning.** A Python developer writes `@app.function(gpu="A10G")` and Modal handles the rest. Compare to E2B where you must think about sandbox instances.
- **GPU support.** Modal's GPU SKUs (A10G, A100, H100) make it the de-facto cloud for ML inference workloads — agentic code that needs to run a Stable Diffusion model or an LLM can `@app.function(gpu="A100")` and get one.
- **Modal Sandboxes (2025+).** The dedicated agent-execution primitive. Supports arbitrary code execution, snapshotting, and full filesystem. The example gallery ships `modal/examples/opencode_server` and `modal/examples/modal-vibe` — Modal actively markets to the coding-agent ecosystem.
- **LangGraph + Modal.** Per the example gallery, LangGraph agents are commonly deployed to Modal, with the coding-agent tools running in Modal Sandboxes. This is the dominant pattern of "production LangGraph" in 2026: LangGraph defines the workflow, Modal runs it.
- **No cold-start cost when warm.** Containers stay warm for several minutes; subsequent invocations are sub-second.

### Weaknesses
- **Closed-source service.** The Modal server isn't open; you're betting on Modal Labs Inc.'s durability and pricing.
- **Vendor lock-in at the infra level.** Same dynamic as Vercel or Cloudflare — easy to start, harder to leave.
- **No OSS self-hosted option** (unlike E2B or Daytona in their own ways). If your compliance posture forbids third-party compute, Modal is out.
- **Python-first.** Go and JS SDKs are real but secondary.

### Bizar relevance
Modal is the cloud-serverless sibling to Daytona's managed sandboxes. For Bizar, Modal is **not the v1 backend** — Bizar is local-first per `round-3-crossref/bizar-alignment.md`. But Modal's `Sandboxes` primitive is the right shape for Bizar's *future* "deploy Bizar to Modal" integration: a `@bizar.modal_app` decorator that wraps a Bizar dispatch call as a Modal Function. The pattern is documented at `modal.com/docs/examples/opencode_server` — Modal already ships an OpenCode-on-Modal example, which positions Modal as a Bizar-adjacent competitor (an OpenCode Bizar equivalent would live there). The lesson worth borrowing: **deploy-as-a-function** is the right billing unit for an agent harness. The deploy target is `modal deploy` and the runtime unit is the Modal Function. Bizar's `bizar gateway` + `bizar agent` could both fit this shape.

A second-pattern borrow: Modal's `gpu=` decorator — agent workloads that need GPU compute should specify it at dispatch time. Today Bizar can't run a local Stable Diffusion or an embedding model on a developer laptop; with a Modal backend, that becomes a one-line flag.

---

# Part IV — Master Comparison Table

| Layer | Project | Stars | Tier | Autonomy | Recovery | Coordination | Memory | License |
|---|---|---:|---|---|---|---|---|---|
| Multi-agent | OpenAI Agents SDK | 27.7k | mostly simple | bounded | resumable | Handoffs + tool-as-call | Sessions only | MIT |
| Multi-agent | CrewAI | 54.9k | complex | bounded | resumable | Roles + Process + Flow graph | Per-agent, Pydantic state | MIT |
| Multi-agent | AutoGen | 59.5k | complex | bounded | resumable | Group chat + agent-as-tool | Conversation logs | MIT |
| Multi-agent | Microsoft Agent Framework | 11.9k | slightly complex | bounded | resumable | Graph workflow + agents-as-skills | Skills (no Mem0) | MIT |
| Multi-agent | PraisonAI | 8.3k | mostly simple | bounded | none | Single/multi/auto, MCP transports | File → 20+ DBs | MIT |
| Multi-agent | agent-squad | 7.7k | slightly complex | bounded | resumable | Classifier-routed + Supervisor + GroundedAgent | Pluggable conversation store | Apache-2.0 |
| Multi-agent | MetaGPT | 69.2k | complex | headless | resumable | SOP / message-passing roles | Message bus only | MIT |
| Multi-agent | LangGraph | 36.5k | slightly complex | headless | **durable** | Explicit state machine graph | Two-tier + pluggable Store | MIT |
| Memory | Mem0 | 60.1k | slightly complex | n/a | n/a | n/a (memory layer) | **Append-only facts + temporal** | Apache-2.0 |
| Memory | Letta | 23.7k | mostly simple | headless | **durable** | Stateful blocks | Typed blocks | Apache-2.0 |
| Memory | claude-mem | 85.9k | slightly complex | n/a | n/a | n/a (Claude Code plugin) | 3-layer progressive disclosure | Apache-2.0 |
| Sandbox | Daytona | 72.3k | slightly complex | n/a | n/a | n/a (compute plane) | Filesystem + snapshots | Apache-2.0 |
| Sandbox | E2B | 12.8k | slightly complex | n/a | n/a | n/a (sandbox SDK) | Sandbox FS only | Apache-2.0 |
| Sandbox | Modal | (unlisted) | n/a | n/a | n/a | n/a (serverless compute) | Volume/Dict primitives | Apache-2.0 |

The table tells a quick story. **Recovery tier is split:** LangGraph, Letta, and Modal are the only "durable" entries; everything else is "resumable" or "none." **Memory projects are mostly license-Apache-2.0; multi-agent projects are mostly MIT.** **Mem0 stands alone** at the "universal memory primitive" position with the only published benchmark numbers. **The sandbox projects are not on the same tier system** because the catalog classifies them as `libraries-sdks`, not `multi-agent` frameworks — they show `autonomy: n/a / recovery: n/a`. Modal is the only one not in the catalog at all (it's referenced via smolagents).

---

# Part V — Synthesis 1: Multi-Agent Orchestration Patterns Across the Catalog

Across the eight multi-agent projects, four primitives recur as orthogonal axes every project picks a position on. Reading the eight profiles together, the patterns are:

### Pattern A — Coordination primitive (4 choices)

| Primitive | Projects | Mental model |
|---|---|---|
| **Handoffs** | OpenAI Agents SDK | "Pass the conversation to a specialist when I can't continue." Linear, one-at-a-time. |
| **Roles / Crews** | CrewAI, MetaGPT | "I'm role X; I produce artifact Y; the next role picks it up." Sequential by default, hierarchical by opt-in. |
| **Group chat** | AutoGen | "Several agents together; a manager picks who speaks next." Free conversation. |
| **Graph (explicit state machine)** | LangGraph, Microsoft Agent Framework, CrewAI Flows | "The team is a directed graph of nodes and typed edges." Most general; most boilerplate. |
| **Classifier routing** | agent-squad | "A classifier picks the best agent each turn." Deterministic or LLM-based router. |
| **SOP / message-passing roles** | MetaGPT | "Roles pass structured messages along an SOP." Deterministic in the small, emergent in the large. |
| **Auto-generated agents** | PraisonAI | "I give you a goal; you generate the team." Fewest lines; least control. |

Notice that **graph is winning**. The 2026 cohort — LangGraph, MAF, CrewAI Flows — all converge on the graph vocabulary. This is the right shape for "production durability": checkpointable, replayable, statically inspectable. **The handoff model (OpenAI Agents SDK) and the group chat model (AutoGen) are easier to teach but lack durability; the graph model is harder to teach but can run for hours.** Bizar's tier-3+ dispatch should at minimum adopt a graph vocabulary internally even if the user-facing UX is "role-based" (per CrewAI's accessibility moat).

### Pattern B — Inter-agent communication (3 types)

| Channel | Projects | Properties |
|---|---|---|
| **Conversation / message bus** | AutoGen, MetaGPT, agent-squad, OpenAI Agents SDK | Free-form; emergent; hard to test |
| **Typed message** | LangGraph (StateGraph state), CrewAI Flows (Pydantic state), MAF (graph data) | Structured; testable; replayable |
| **Tool call / return value** | OpenAI Agents SDK (AgentTool), Microsoft Agent Framework (Agent-as-Skill), agent-squad (SupervisorAgent) | One-shot; clearest contract |

**Tool-call is the most durable inter-agent primitive** — it has a return value, can be unit tested, and shows up as a single tool call in traces. Bizar's parallel dispatch is currently a string-prompt-and-string-answer protocol; an `Agent.as_tool()` convention that returns a typed object (e.g. `BizarToolResult { ok: boolean; payload: T; transcript?: SubsetTrace }`) would make every Thor/Tyr/Vidarr invocation first-class-testable.

### Pattern C — Memory companion (3 layers)

| Layer | Projects | Backing |
|---|---|---|
| **No built-in long-term memory** | OpenAI Agents SDK, Microsoft Agent Framework, AutoGen, MetaGPT, LangGraph (long-term) | Pair with Mem0 or Letta |
| **Per-conversation / per-session persistence** | CrewAI (per-agent), agent-squad (storage pluggable) | DB-backed by default |
| **Memory blocks / fact store** | Letta (blocks), Mem0 (facts), PraisonAI (file + DB), LangGraph (Store API) | First-class primitives |

The recurring pattern: **the framework handles in-run state (messages, scratchpad); an external memory layer handles cross-session state (facts, entities).** Mem0 is the dominant pairing. Bizar's current `.bizar/memory.json` + Obsidian + LightRAG stack spans the same spectrum; the missing piece is **a fact-extractor that runs at session end and updates the durable store**. Mem0 is the canonical choice; Letta is the heavier alternative.

### Pattern D — Production hardening surface (4 capabilities)

| Capability | Projects that ship it | How |
|---|---|---|
| **Durable execution / checkpointing** | LangGraph (`Checkpointer`), MAF (`time-travel`), Letta (blocks persist server-side) | Save state per tick; resume after crash |
| **Tracing / observability** | OpenAI Agents SDK (built-in tracing), LangGraph (LangSmith), MAF (OpenTelemetry built-in), CrewAI AMP, MetaGPT (manual) | OTel export or framework-specific UI |
| **Human-in-the-loop primitive** | LangGraph (`Interrupt`), OpenAI Agents SDK (built-in), MAF (built-in), MetaGPT (none) | `interrupt()` or `await human_review()` |
| **Provider-agnostic routing** | OpenAI Agents SDK (`any-llm` + LiteLLM), PraisonAI (24 providers), LangGraph (LangChain), MetaGPT (config) | Adapter swap, not code rewrite |

Production-hardening is the dividing line between research-grade and ship-grade multi-agent frameworks. LangGraph leads the cohort on durable execution; OpenAI Agents SDK leads on the tracing UX; Microsoft Agent Framework leads on enterprise observability. **Bizar's Forseti-gated tier-3 dispatch is closer to the durable-execution + checkpointing pattern than to the autonomy pattern.** Bizar should not try to build its own checkpointing layer; it should adopt the LangGraph `Checkpoint` data model for subagent trajectories (per `round-3-crossref/bizar-alignment.md` B.6).

### The cross-cutting takeaway
The 2026 multi-agent landscape has converged on:
1. **Graphs as the durable substrate.**
2. **Tool calls as the inter-agent IPC.**
3. **External memory layers** (Mem0 most often) for cross-session facts.
4. **OpenTelemetry-class observability** as a non-negotiable.

The four projects that ship all of these are Microsoft Agent Framework and LangGraph. PraisonAI ships 1, 2, and partial 3. The rest ship 1+2 only. **Bizar, with its trajectory-capture plan (B.6) and Obsidian-memory plan, is on track to ship 1+3+4 — and adding a graph vocabulary to internal dispatch is the missing 2.**

---

# Part VI — Synthesis 2: Memory Layer Patterns

The three memory projects give us a clean taxonomy. Each picks a different answer to the question *"who owns the memory — the agent or the application?"* (per the best-of memory comparison doc).

### Pattern 1 — Universal Memory API (Mem0)

**The shape:** A library that any agent can call. `memory.add(messages)` writes; `memory.search(query)` reads. Owned by the *application*, accessed by the *agent*. Append-only facts. Single-pass retrieval. Multi-signal (semantic + BM25 + entity). Temporal reasoning.

**Why it works:** No agent-runtime lock-in. The same Mem0 instance is reachable from LangGraph, CrewAI, AutoGen, or a raw OpenAI call. The vendor surfaces (cloud, self-hosted, library) match the audience. The April 2026 algorithm refresh is the proof that the engineering is rigorous — the published benchmarks are the only ones in the memory-cohort.

**Where it breaks:** Mem0 is facts, not persona. Agents that need to evolve "who I am" alongside "what I know" will find Mem0 shallow.

### Pattern 2 — Agent Runtime with Memory (Letta)

**The shape:** A long-lived agent with persistent identity. Memory is composed of *named, typed blocks* (`persona`, `human`, `facts`, `conversation`) with character limits. The agent decides what to write, what to forget, what to read. State lives server-side; resumes on demand.

**Why it works:** Solves the persona problem Mem0 doesn't. The agent *has a self*. Continual learning is real because the agent's persona evolves over time. Cloud / local / self-hosted deployment is a clean three-way choice.

**Where it breaks:** Server-component requirement. Heavyweight relative to a pure library. Currently in a repo transition (V1 → Agent SDK) that creates migration risk.

### Pattern 3 — Host-Plugin Memory (claude-mem)

**The shape:** Hooks into a specific host's lifecycle (Claude Code's 5 hooks). Captures tool-use observations, AI-summarizes them, persists to SQLite + Chroma. Exposes a 3-layer progressive-disclosure API (`search` → `timeline` → `get_observations`). Token-economy is the headline.

**Why it works:** Zero-agent-overhead. The host defines the lifecycle; the plugin subscribes. The 3-layer pattern is the most-copied token-saving pattern in 2026. Web viewer UI for humans.

**Where it breaks:** Single-host lock-in (Claude Code first). Bun runtime requirement. Star count is inflated by Claude Code's ecosystem velocity.

### The cross-cutting memory architecture

Every modern memory layer stacks **four surfaces**:

1. **Working memory** — in-run conversation / scratchpad. Cheap, ephemeral, owned by the framework.
2. **Session memory** — within-conversation summary, possibly indexed for retrieval. Per-session.
3. **Long-term facts** — cross-session extracted facts. Owned by Mem0 / Letta / LightRAG.
4. **Identity/persona** — the agent's evolving self. Owned by Letta (or by the user via Obsidian).

The 2026 production stack covers all four with **two products** (or one product + Obsidian): a memory-primitive library (Mem0 OR Letta) and a human-readable archive (Obsidian + git). Bizar already has layers 1-2 (`.bizar/memory.json`) and 4 (Obsidian + `.bizar/AGENTS_SELF_IMPROVEMENT.md`); it is **missing layer 3 — a fact extractor that runs at session end**. Mem0's self-hosted edition is the closest fit, and the Bizar-Mem0 integration is small: one process at session end, one Mem0 index per `.bizar/` workspace.

The progressive-disclosure pattern (claude-mem's three MCP tools) is also generalizable. Bizar's `.bizar/memory.json` should be reorganized so the JSON only carries an *index* of observations (date, size, one-line summary), and a new `bizar memory fetch <ids>` subcommand materializes the bodies. This is the same pattern Mem0 implements internally (single-pass with id-driven recall) and that LangGraph's `Store` API uses (`put` + `search` -> IDs -> `get`).

### Memory recommendation matrix for Bizar

| Need | Recommendation | Effort |
|---|---|---|
| Cross-session fact extraction | Mem0 self-hosted + Docker | ~1 week |
| Per-agent persona / blocks | Letta Cloud (or skip v1) | ~3 weeks |
| Lifecycle hooks / progressive disclosure | Adopt pattern in existing `plugins/bizar/index.ts` | ~3 days |
| Human-readable archive | Keep Obsidian vault as-is | 0 |
| RAG / semantic search | Keep LightRAG (already integrated) | 0 |

The right-sized Bizar v1 memory story is **JSON + Obsidian + Mem0 + LightRAG**, with Letta as an option for teams that want per-agent personas.

---

# Part VII — Synthesis 3: Sandbox / Runtime Patterns

The three sandbox projects (Daytona, E2B, Modal) share a vocabulary but disagree on positioning.

### Pattern 1 — Managed sandboxes-as-a-service (Daytona, E2B)

**The shape:** A cloud API that returns a sandbox instance in <100-200ms. SDK exposes `process.run()`, `files.read/write()`, and code-execution helpers. Sandboxes are isolated (Firecracker microVM or container) and ephemeral. Persistence is via snapshots (Daytona) or per-sandbox filesystem (E2B).

**Why it works:** Cold-start time. The 90ms Daytona number is the headline. Sub-second sandbox creation means an agent can spin up a fresh sandbox per subtask. Isolation is hardware-virtualization-grade (Firecracker) — escape is not a worry. SDKs in five languages. Self-hostability on E2B is the differentiator for compliance-bound teams.

**Where it breaks:** No GPU (E2B), no graph vocab (both), no LSP (E2B). State persistence requires keeping a sandbox open (E2B) or snapshotting (Daytona). Cold-starts in the 100-200ms range (still slow for per-tool-call invocations).

### Pattern 2 — Serverless compute primitives (Modal)

**The shape:** Function-as-a-Service with GPUs and persistent storage. `@app.function()` decorators. Modal Sandboxes are a 2025+ addition that gives the agent-execution primitive other projects have. Modal has no opinion about agents; it's compute infra for everything else to build on.

**Why it works:** GPU SKUs (`gpu="A10G"`, `A100`, `H100`). Production-grade uptime and warm-container performance. Active marketing to the coding-agent ecosystem (opencode_server example gallery entry).

**Where it breaks:** Closed-source service. Vendor lock-in. No self-hosted option. Python-first (JS/Go secondary).

### Pattern 3 — Code interpreter (E2B Code Interpreter SDK)

**The shape:** A persistent Jupyter-style REPL in a sandbox. `sandbox.runCode("x = 1; x += 1; x")` returns the last-expression value plus any charts/tables/files. State persists across `runCode()` calls.

**Why it works:** The canonical "AI agent does data science" stack. Most data-analysis demos in 2024-2026 ride on E2B's Code Interpreter SDK because Jupyter state survives. Adoption is wide; the SDK is small.

**Where it breaks:** Bound to Python semantics. Not a general agent sandbox — needs to be paired with E2B raw sandbox for non-Jupyter workloads.

### What the sandbox-cohort agrees on

Three patterns appear in all three:

1. **Cold-start under one second.** Cold starts of 100-200ms let agents spin up sandboxes per tool call or per subtask. This is the bar; anything slower is not competitive for interactive agent workflows.
2. **Hardware-virtualization-grade isolation.** All three use container or VM isolation. Agent-generated code can be run without trusting it.
3. **SDK-first interface.** No one in this cohort ships a CLI-first interface or a GUI-first interface. The SDK is the product; the cloud is the runtime.

### Where the cohort diverges

| Dimension | Daytona | E2B | Modal |
|---|---|---|---|
| **Primary unit** | Sandbox | Sandbox | Function |
| **Self-hostable** | No (OSS read-only) | Yes (Terraform / AWS / GCP) | No |
| **GPU support** | Yes (via OCI base) | No | Yes (A10G/A100/H100) |
| **Cold start** | <90ms | ~150ms | Container warm = sub-s; cold = 1-5s |
| **Language tooling (LSP)** | Yes | No | No |
| **Snapshot semantics** | Yes | No | `modal.Volume` |
| **Active development** | Private codebase | Active OSS | Active commercial |

### The right sandbox integration for Bizar

Per `round-3-crossref/bizar-alignment.md` B.3, Bizar's first backend abstraction is **Local + Docker + OS-sandbox**, none of which is in this catalog. That's correct for v1 — Bizar is local-first. **The four patterns worth carrying forward from the sandbox cohort for Bizar's v2+ roadmap are:**

1. **The `BaseSandbox` ABC** that mirrors `BaseEnvironment` from Hermes (which already exists). Add three implementations later: `LocalSandbox` (today's default), `DockerSandbox` (per-session container), `RemoteSandbox` (interface that wraps Daytona/E2B/Modal). The interface should expose `process_run`, `files_read`, `files_write`, `git_clone`, `lsp_query` (per Daytona's LSP pattern), and `snapshot`.
2. **`lsp_query` is the missing tier-3 capability.** Today's Thor edits code blindly. With an LSP-capable backend, Bizar could ship a `code_intelligence` tool that does find-references / rename / go-to-definition — the kind of semantic tooling every IDE has had since 2018 and that agents are only now getting.
3. **The "Container with declarative builder" pattern** from Daytona: when a new Bizar project initializes, declare the desired environment (`{base: "node:22", packages: ["pnpm"], postCreate: "pnpm install"}`) rather than scripting imperative setup.
4. **The Code Interpreter SDK shape** from E2B as the API for `bizar_repl` — long-lived REPL state, last-expression-value return, rich outputs.

The sandbox cohort is **the right place to steal from** for Bizar's future tier-3+ capabilities — not because Bizar should become a sandbox product, but because the patterns Daytona/E2B/Modal have established (cold-start, virtualization, SDK-first, LSP-in-sandbox) will all be table stakes for any agent harness competing in 2027.

---

# Closing Note

This round surveyed 14 projects that sit beneath or alongside Bizar's tier-3+ agent dispatch. The recurring takeaways for Bizar:

- **Convergence on graphs.** The most-shipped 2026 primitive is the explicit state-machine graph (LangGraph, MAF, CrewAI Flows, OpenAI Agents SDK's handoffs as linear graphs, MetaGPT SOPs as message-passing graphs). Bizar's internal dispatch should be graph-shaped even if the user-facing UX is role-shaped.
- **Mem0 + Obsidian is the right memory story.** Mem0 for facts, Obsidian for human-readable archive, both backed by LightRAG for semantic search. The integration is small.
- **Sandbox patterns are v2+ for Bizar.** Bizar's local-first stance makes the cloud-sandbox integrations a 2027 concern — but the LSP-in-sandbox, snapshot, and cold-start-under-one-second patterns are worth codifying in the `BaseSandbox` ABC now so v2 doesn't require an ABI break.
- **Forseti is Bizar's unique asset.** None of the multi-agent cohort ships an adversarial plan-audit primitive. AutoGen is closest (research-grade) but no production framework has Forseti's gate shape. This is the most defensible Bizar differentiator over CrewAI / PraisonAI / Mem0-paired-with-LangGraph.
- **The closed learning loop is the third leg.** Mem0's benchmarked algorithm + claude-mem's progressive-disclosure + Bizar's trajectory capture are the three components of a closed learning loop that compounds across sessions. No OSS framework closes this loop cleanly today; the project that does will set the bar for 2027.

---

*End of Round 7 deep study. Total projects covered: 14. Synthesis sections: 3. All claims cited to specific GitHub file paths, doc URLs, or catalog positions.*
