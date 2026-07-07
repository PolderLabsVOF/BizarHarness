# Coding Harnesses: Round 7 — Deep Survey

*Agent Harness Survey — Round 7 (Best-of-Deep)*
*Date: July 2026*

---

This round surveys the most architecturally significant coding harnesses in active development. Twelve projects were evaluated across a shared rubric: agent loop design, tool surface, memory architecture, multi-agent coordination, long-horizon robustness, and what each system reveals about the broader state of harness engineering.

---

## Top Comparison Table

| # | Project | Stars | Language | Agent Loop | Tools | Memory | Multi-Agent | Long-Horizon | Standout | Bizar Take |
|---|---------|-------|----------|------------|-------|--------|-------------|--------------|----------|-------------|
| 1 | **OpenAI Codex CLI** | ~50K+ (repo) | Go/TypeScript | Single agent; headless pipe mode | Built-in file/bash; MCP | Session-scoped; no persistent memory | No native coordination | CLI-first; headless scripted | Free tier + Plus integration; minimal friction | Provenance harness for ChatGPT Plus |
| 2 | **Google Gemini CLI** | ~5K | TypeScript/Node | Single agent; OAuth + API key auth | File ops, shell, web fetch/search, MCP | GEMINI.md context files; checkpointing | No native coordination | Conversation checkpointing; session resume | 1M token context; free tier; MCP extensibility | State-of-the-art context window |
| 3 | **Cline** | ~60K+ | TypeScript | Plan/Act toggle; multi-turn with approval | File ops, bash, glob, grep, fetch; extensible MCP/plugins | Rules (.clinerules); skill-triggered context | Multi-agent teams; Kanban board; scheduled agents | Team state persists across sessions | SDK for custom agents; Slack/Telegram/Discord connectors | Most extensible multi-product harness |
| 4 | **OpenHands (Agent Canvas)** | ~30K+ | TypeScript/Node | ACP-compatible agent loop; local + remote backends | ACP tool protocol; Docker sandbox; web UI | Backend-scoped per host | Multi-backend switching; automation server; schedule + webhooks | Runs Claude Code, Codex, Gemini via ACP abstraction | ACP protocol abstraction; Docker sandbox isolation | Protocol-level agent interoperability |
| 5 | **Superpowers** | ~2K | Markdown/Skills | Skill-triggered phases: brainstorm → plan → execute → review → merge | Delegates to host harness (Claude Code, Codex, etc.) | Per-harness skill memory | Subagent-driven development within host harness | Persistent skills across sessions | Structured sprint workflow; TDD enforcement; git worktree isolation | Best structured development methodology |
| 6 | **ECC (Everything Claude Code)** | 211K | TypeScript/Node | 67 specialist agents; hook-based session lifecycle | File ops, bash, MCP; 84 legacy command shims | SQLite state store; session adapters; continuous learning v2 | Multi-plan/execute/backend/frontend/workflow orchestrators | 261 skills; instinct-based learning; cross-harness isolation | 211K stars; 12 language ecosystems; AgentShield security auditor | Largest skill ecosystem by orders of magnitude |
| 7 | **Anthropic Skills** | Org (~50+) | Markdown/SKILL.md | Skill-loading as dynamic context injection | Delegates to host (Claude Code, API) | Host-scoped | No native multi-agent | Skills persist as reusable instruction units | Canonical Agent Skills spec; document generation skills | Spec reference; not a harness itself |
| 8 | **gstack** | ~10K | Markdown/CLI | Think → Plan → Build → Review → Test → Ship → Reflect sprint | 23 specialists; 8 power tools; browse (Chromium); CDP | Learned patterns across sessions; GBrain persistent knowledge | Parallel sprints via Conductor; multi-agent via ACP | Continuous checkpoint mode; WIP commits; taste memory | YC-backed; Karpathy productivity framing; browser-first QA | Best browser-integrated workflow |
| 9 | **Claude Agent SDK (Python)** | ~5K | Python | query() async iterator; ClaudeSDKClient for bidirectional chat | Bundled Claude Code toolset; custom tools as in-process MCP | No persistent memory (session-scoped) | Programmatic subagents via SDK | Embeds Claude Code CLI; session forking | Python SDK wrapping Claude Code CLI; in-process MCP tools | Low-level SDK for Python integrations |
| 10 | **SWE-agent** | ~15K | Python | Single-task agent loop; yaml-configured tools | Bash, str_replace editing, ripgrep, web search | No persistent memory | No native multi-agent | Designed for SWE-bench; 1.0 achieves SoTA on SWE-bench verified | Yaml-driven configurability; research-grade evaluation | Benchmark harness; not for general use |
| 11 | **AutoHarness** | ~500 | Python | 3 pipeline modes (Core/Standard/Enhanced); 6–14 step governance | Tool governance pipeline; secret scanner; risk classifier | Per-call cost attribution; JSONL audit trail | Multi-agent profiles with role-based governance | YAML constitution; trace-based diagnostics | 958 tests; governance-first; 2-line wrap API | Governance/compliance harness layer |
| 12 | **OpenCode** | ~20K | Go | Multi-provider agent loop; session management | File ops, bash, grep, glob, patch; MCP; LSP; Sourcegraph | SQLite for sessions; auto-compact summarization | No native multi-agent | Auto-compact context summarization; custom commands; multi-provider | Go-based TUI; 20+ AI providers; Vim-style editing | Fast Go-based multi-provider harness |

---

## Project Profiles

---

### 1. OpenAI Codex CLI

**Name & One-Line Positioning**
OpenAI's official local coding agent — a fast, minimal CLI that brings Codex to the terminal with OAuth ChatGPT integration or API key authentication.

**Architecture Summary**
Codex CLI is a compiled Go binary with a thin TUI layer. It communicates with OpenAI's cloud API (Codex Web for ChatGPT Plus users or direct API). The agent loop is single-threaded: user prompt → API call → tool execution → response. Headless mode pipes prompts via stdin and returns JSON, designed for CI/CD integration. No local model support; always cloud-first.

**Tool Surface**
Built-in tools: file read/write/edit, bash command execution, glob pattern matching, grep search. The tool interface is implicit and minimal — not MCP-based but follows a similar permission-approval model. No plugin system disclosed in the README; extensibility is limited to environment configuration.

**Memory / Context**
Session-scoped only. Each invocation is stateless unless run interactively in the same terminal session. No cross-session memory, no persistent context files. The `--app` desktop mode has broader session continuity but the CLI itself is stateless between runs.

**Multi-Agent**
No native multi-agent capability. The headless pipe mode can be scripted for parallel invocations, but this is orchestration at the shell level, not agent coordination.

**Long-Horizon Capability**
Limited. CLI-first workflows benefit from being run in short bursts. The desktop app mode handles longer sessions but the CLI tool itself has no summarization, compaction, or checkpointing mechanism. Not designed for multi-hour development sprints.

**Provider Model**
OpenAI-only (cloud). Supports ChatGPT Plus/Pro/Business/Edu/Enterprise plan via OAuth, or API key. Free tier includes 1000 requests/day with Gemini 3 (via API key path).

**Standout Feature**
Integration depth with ChatGPT plans — the OAuth flow maps directly to a user's existing ChatGPT subscription, making Codex effectively "free" for Plus users. The install script (`curl ... | sh`) is the fastest onboarding in the market.

**Weakness**
Single-provider lock-in; no multi-agent; no memory persistence; minimal extensibility. The feature surface is deliberately narrow, which is a strength for simplicity but a hard ceiling for complex workflows.

**Bizar Relevance**
Codex CLI is a provenance harness for ChatGPT — useful to understand as a baseline minimal implementation and as a comparison point for what Bizar's broader agent coordination needs that Codex doesn't address.

---

### 2. Google Gemini CLI

**Name & One-Line Positioning**
Google's official open-source CLI harness for Gemini — the highest-context mainstream model (1M tokens) with a free tier, MCP extensibility, and native Google Search grounding.

**Architecture Summary**
A Node.js/TypeScript CLI built on the Gemini API. Authentication supports OAuth (free tier via personal Google account), API key, and Vertex AI for enterprise. The agent loop runs single-agent with tool execution via the Gemini function-calling protocol. GEMINI.md files serve as project-level context injection. Conversation checkpointing enables session save/restore across restarts.

**Tool Surface**
Built-in: file system operations, shell command execution, web fetch, Google Search grounding (grounding attaches real-time search results to model context). MCP server integration is a first-class feature, configured in `~/.gemini/settings.json`. Custom extensions are supported via the MCP protocol.

**Memory / Context**
GEMINI.md files provide persistent project-specific context loaded at session start. Checkpointing allows saving and resuming conversations. Token caching is documented as an optimization feature. No session-summary or continuous learning system.

**Multi-Agent**
No native multi-agent coordination. MCP servers can serve as external tool providers but the core loop is single-agent.

**Long-Horizon Capability**
The 1M token context window is the primary long-horizon mechanism — agents can absorb very large codebases without summarization pressure. Checkpointing provides session continuity. The headless scripting mode (`gemini -p`) enables CI/CD integration.

**Provider Model**
Google Gemini exclusively. Three tiers: OAuth (free, 60 req/min, 1000 req/day), API key (free, 1000 req/day), Vertex AI (enterprise). No third-party model support.

**Standout Feature**
1M token context window + free tier + Google Search grounding. The combination of massive context and real-time search attribution is unique. The Gemini Code Assist licensing path also makes it enterprise-accessible.

**Weakness**
Gemini-only provider lock-in; no multi-agent; no structured development workflow (no plan/execute/review cycle). MCP extensibility is good but the skill system is shallow compared to Claude Code's.

**Bizar Relevance**
Gemini CLI's checkpointing and token caching are worth studying for Bizar's session persistence layer. The MCP integration pattern is also a clean reference.

---

### 3. Cline

**Name & One-Line Positioning**
An open-source coding agent available as CLI, VS Code extension, JetBrains plugin, and Kanban board — with a TypeScript SDK for building custom multi-agent integrations.

**Architecture Summary**
Cline is a multi-surface product: a CLI (`npm i -g cline`), a VS Code extension, a JetBrains plugin, and a Kanban web UI for parallel multi-agent task management. The core agent engine is shared across all surfaces. A TypeScript SDK (`@cline/sdk`) exposes the agent loop programmatically. Plan/Act mode toggling gives users a deliberate exploration phase before execution. Auto-approve mode enables fully autonomous operation.

**Tool Surface**
Built-in: file read/write/edit, bash execution, glob, grep, web fetch. MCP servers are first-class (community servers and on-the-fly custom tool generation). The SDK enables programmatic tool registration via `createTool()`. Plugins can register tools and lifecycle hooks. The Kanban board runs agents in isolated git worktrees with auto-commit and dependency chains.

**Memory / Context**
Rules defined in `.clinerules` files (project-specific guidelines picked up automatically). Skills trigger model-loaded rule subsets when needed. No persistent cross-session memory beyond what the host harness provides.

**Multi-Agent**
Cline has the richest multi-agent story in this survey. `cline --team-name` launches a coordinator agent that breaks work into subtasks and delegates to specialist agents. Kanban runs many agents in parallel on a web-based task board with per-card worktrees and dependency chains. Scheduled agents run on cron. Slack, Telegram, Discord, and Google Chat connectors enable messaging-platform interaction. Headless CLI mode pipes JSON for scripting.

**Long-Horizon Capability**
Multi-agent teams and scheduled agents enable long-horizon workloads. The Kanban board provides visual progress tracking across parallel sprints. Team state persists across sessions.

**Provider Model**
The most provider-flexible harness surveyed: Anthropic, OpenAI, Google, OpenRouter (200+ models), Vercel AI Gateway, AWS Bedrock, Azure, GCP Vertex, Cerebras, Groq, Ollama, LM Studio, any OpenAI-compatible endpoint.

**Standout Feature**
The SDK + multi-surface (CLI/VS Code/JetBrains/Kanban) + multi-provider + multi-agent combination is unmatched. Cline is both an end-user product and a platform for building agent integrations.

**Weakness**
Complexity. The multi-surface/multi-provider/multi-agent feature set creates a large product surface with corresponding documentation and onboarding complexity. The Kanban board adds infrastructure requirements.

**Bizar Relevance**
Cline's SDK architecture (shared engine across surfaces) and multi-agent team model are directly relevant to Bizar's agent coordination layer. The Kanban parallel sprint pattern is also applicable.

---

### 4. OpenHands (Agent Canvas)

**Name & One-Line Positioning**
A self-hosted developer control center that runs any ACP-compatible agent (Claude Code, Codex, Gemini, or OpenHands) across local, remote, and cloud backends via a web UI.

**Architecture Summary**
OpenHands Agent Canvas separates the frontend (web UI at localhost:8000) from the agent backend (Agent Server, a REST API that runs on a host machine). Multiple Agent Servers can be connected and switched between from the same UI. Sandboxed execution runs in Docker by default, isolating the agent from the host filesystem. An Automation Server handles scheduled and webhook-triggered workflows. The ACP (Agent-Client Protocol) is the interoperability layer enabling any ACP-compatible agent to run on the platform.

**Tool Surface**
ACP tool protocol defines the tool interface. Docker sandbox provides filesystem isolation while granting the agent access to project directories mounted from the host. Built-in automations connect to Slack, GitHub, Linear, and Notion via webhook triggers.

**Memory / Context**
Backend-scoped per host. The Agent Server maintains session state per backend. Switching backends from the UI is seamless but each backend maintains its own context.

**Multi-Agent**
The core value proposition. Agent Canvas orchestrates multiple agents: different backends can run different agents simultaneously; the web UI switches between them. The Automation Server handles scheduled and event-triggered multi-agent workflows. Multiple team members can share the same Agent Server.

**Long-Horizon Capability**
Strong. Docker sandbox + always-on server configuration means agents can run continuously in the background. Automation Server handles cron schedules and webhook triggers. The agent continues running even when the developer's laptop is shut.

**Provider Model**
ACP-compatible: OpenHands, Claude Code, Codex, Gemini, or any agent implementing ACP. Bring-your-own-model: any LLM via ACP abstraction.

**Standout Feature**
ACP protocol abstraction over multiple agent backends. The ability to switch between local (Docker), VM, and cloud backends without losing session context is unique. Docker sandbox is the gold-standard isolation model.

**Weakness**
Self-hosting burden. Requires Node.js, `uv`, Docker, and some infrastructure know-how. The ACP protocol is custom — native MCP tool compatibility is not a stated feature.

**Bizar Relevance**
OpenHands' backend/frontend separation architecture is a strong model for Bizar's distributed agent execution. ACP is a direct competitor to Bizar's own protocol design.

---

### 5. Superpowers

**Name & One-Line Positioning**
A structured software development methodology delivered as a cross-harness skill pack — installed as a plugin in Claude Code, Codex, Cursor, and 8 other agents.

**Architecture Summary**
Superpowers is not a standalone harness — it's a skill layer that runs inside any supported host harness. The system defines mandatory skill-triggered workflow phases: brainstorming (Socratic design refinement), git worktree setup, plan writing (2–5 minute tasks), subagent-driven execution with two-stage review (spec compliance then code quality), TDD enforcement, code review, and branch finishing. Skills are Markdown files that the host harness loads when the agent detects relevant triggers.

**Tool Surface**
Delegates entirely to the host harness. Superpowers provides the workflow methodology and skill definitions; the underlying tool execution is handled by whichever harness hosts it (Claude Code's tools, Codex's tools, etc.).

**Memory / Context**
Skill persistence across sessions via the host harness's skill-loading mechanism. Superpowers' own session-start hook activates the skills system on first message. The brainstorming skill saves a design document that downstream skills read.

**Multi-Agent**
Subagent-driven development is core. The `subagent-driven-development` or `executing-plans` skill dispatches a fresh subagent per task with two-stage review. The `dispatching-parallel-agents` skill handles concurrent subagent workflows. Git worktree isolation enables parallel development branches.

**Long-Horizon Capability**
Designed for multi-hour autonomous sprints. The structured workflow (design → plan → execute → review → merge) prevents scope drift over long sessions. Subagent task granularity (2–5 minutes per task) provides natural checkpointing.

**Provider Model**
Runs inside: Claude Code, Antigravity, Codex App/CLI, Cursor, Factory Droid, GitHub Copilot CLI, Kimi Code, OpenCode, Pi. No direct model dependency — delegates to host harness.

**Standout Feature**
The structured sprint methodology: mandatory skill triggers enforce RED-GREEN-REFACTOR TDD, git worktree isolation, detailed task plans, and two-stage review. The workflow is harness-agnostic — it works across 10+ coding agents without modification.

**Weakness**
Superpowers is a methodology layer on top of a host harness — it has no standalone tool surface, no memory persistence, and no multi-agent orchestration beyond subagent dispatch. Its value is entirely in the workflow enforcement.

**Bizar Relevance**
Superpowers is the most rigorous structured development methodology in the survey. Bizar should study its skill-trigger mechanism and mandatory workflow phase enforcement as models for process-hardened agent execution.

---

### 6. ECC (Everything Claude Code)

**Name & One-Line Positioning**
The largest coding harness ecosystem in the survey: 211K GitHub stars, 261 skills, 67 specialist agents, 12 language ecosystems, and a complete cross-harness install system.

**Architecture Summary**
ECC is a Claude Code plugin (installed via `/plugin install ecc@ecc`) with a companion manual install path for rules. The system has five layers: agents (67 specialist subagents: reviewers, resolvers, planners), skills (261 workflow and domain skill definitions), commands (93 legacy slash-command shims), hooks (session lifecycle, memory persistence, continuous learning), and rules (language-specific coding standards). The v2 Rust control-plane prototype (`ecc2/`) adds a daemon with dashboard, sessions, and status commands. A Tkinter desktop dashboard provides GUI access to the component catalog.

**Tool Surface**
ECC's 67 agents each carry specialized tool knowledge. The core tools are the host harness's (file ops, bash, MCP). 84 legacy command shims provide compatibility. The AgentShield security auditor (`npx ecc-agentshield scan`) runs 1282 tests against CLAUDE.md, settings.json, MCP configs, hooks, and agent definitions. MCP server configs cover GitHub, Supabase, Vercel, Railway, and more.

**Memory / Context**
SQLite state store under `~/.claude/ecc/` tracks installed components. Session adapters record structured session data. Continuous Learning v2 uses an instinct-based system: patterns extracted from sessions are scored by confidence, imported/exported as files, and evolved into skills via `/evolve`. Hooks inject learned instincts on session start (up to 6 by default, confidence threshold 0.7).

**Multi-Agent**
The `multi-*` command family (`/multi-plan`, `/multi-execute`, `/multi-backend`, `/multi-frontend`, `/multi-workflow`) orchestrates multiple Claude Code instances across services. PM2 integration manages the process lifecycle. The `/pm2` command provides service management. The `ccg-workflow` runtime provides `codeagent-wrapper` and prompt templates for the multi-agent orchestration layer.

**Long-Horizon Capability**
Strongest in the survey for session persistence. Memory persistence hooks save context on session end and reload on session start. Strategic compaction suggestions prevent context explosion. Session retention is configurable (default 30 days). Instinct-based learning compounds pattern knowledge across sessions. WIP commit mode (`ECC_HOOK_PROFILE`) auto-commits work in progress.

**Provider Model**
Claude Code (Anthropic) as the primary host harness. ECC is harness-specific, not model-specific — its value is in the Claude Code plugin layer.

**Standout Feature**
Ecosystem scale: 261 skills, 67 agents, 12 languages, cross-harness packaging, AgentShield security auditor, continuous learning v2, and a 211K-star community. The install wizard (`npx ecc consult`) advises on component selection.

**Weakness**
Complexity ceiling: 261 skills and 67 agents is a vast surface. Plugin install cannot distribute `rules` (Claude Code limitation) — rules must be copied manually. The `multi-*` commands require `ccg-workflow` runtime to be installed separately.

**Bizar Relevance**
ECC's instinct-based continuous learning system (session patterns → confidence-scored instincts → evolved skills) is the most mature learning mechanism in the survey. Bizar should study this for its own memory and learning architecture.

---

### 7. Anthropic Skills

**Name & One-Line Positioning**
The canonical reference implementation of the Agent Skills specification — a repository of reusable skill definitions that teaches models how to complete specialized tasks.

**Architecture Summary**
Anthropic Skills is a GitHub repository (`anthropics/skills`) containing skill definitions as folders with `SKILL.md` files. Each skill has YAML frontmatter (`name`, `description`) and markdown body with instructions, examples, and guidelines. Skills are registered as plugins in Claude Code via marketplace. The repository also contains the Agent Skills specification (`spec/`) and a template (`template/`). Document generation skills (docx, pdf, pptx, xlsx) are source-available.

**Tool Surface**
No independent tool surface. Skills delegate to the host harness's tools. The document skills (docx, pdf, pptx, xlsx) are the most sophisticated — they use structured tool sequences to produce formatted documents.

**Memory / Context**
Skills are loaded dynamically by Claude Code when relevant. The skill definition itself serves as persistent context (the skill's instructions are injected into the model context when the skill is activated).

**Multi-Agent**
No native multi-agent capability. Skills are individual units of agentic behavior.

**Long-Horizon Capability**
Skills persist as reusable instruction units across sessions. The same skill definition applies in any session where it's relevant, providing long-horizon behavioral consistency.

**Provider Model**
Works in Claude Code (plugin marketplace), Claude.ai (paid plans), and the Claude API (via Skills API). Not model-specific — the skill format is model-agnostic.

**Standout Feature**
The Agent Skills specification is the industry-standard skill definition format. 50+ example skills demonstrate domain-specific agent behaviors (art, music, testing, enterprise workflows). The document skills are production-grade.

**Weakness**
Not a harness itself — it's a skill library and spec reference. No independent agent loop, no tool surface, no memory persistence beyond the skill definition file.

**Bizar Relevance**
The SKILL.md format (YAML frontmatter + markdown body) is the canonical agent skill specification. Bizar should adopt this format for its own skill definitions to ensure cross-harness compatibility.

---

### 8. gstack

**Name & One-Line Positioning**
Garry Tan's (YC President) personal software factory — 23 specialist skills plus 8 power tools for Claude Code, framed as a virtual engineering team that a solo builder operates like a CEO.

**Architecture Summary**
gstack is a Claude Code skill pack plus standalone binaries. The core workflow is a sprint: `/office-hours` (YC-style product interrogation), `/plan-ceo-review` (strategic challenge), `/plan-eng-review` (architecture lock), `/review` (staff engineer audit), `/qa` (QA lead with real browser), `/ship` (release engineer), `/retro` (weekly retrospective). Continuous checkpoint mode auto-commits WIP work with structured context. GBrain provides persistent cross-session knowledge. Conductor runs 10–15 parallel sprints across Claude Code instances. The browser (`/open-gstack-browser`) is a Chrome DevTools Protocol client with anti-prompt-injection ML classifier, sidebar agent, cookie import, and anti-bot stealth.

**Tool Surface**
23 specialist slash-command skills and 8 power tools. The browser tool (`$B browse`, CDP escape hatch) is the standout — real Chromium with 100ms/command latency, anti-bot stealth, cookie import, and a sidebar AI agent. Security layer: 22MB ML classifier + DeBERTa-v3 ensemble for prompt injection defense. Domain skills save per-site knowledge that auto-fires on revisit. iOS QA via USB CoreDevice. `/design-shotgun` generates AI mockup variants; `/design-html` converts them to production CSS.

**Memory / Context**
GBrain (persistent knowledge base) stores indexed code and searchable pages. `/learn` manages learned patterns per-project. Taste memory in `/design-shotgun` biases future variant generation toward user preferences. Cross-session continuity via continuous checkpoint WIP commits. Memory sync pushes state to a private git repo across machines.

**Multi-Agent**
`/pair-agent` coordinates multiple agents (OpenClaw, Hermes, Codex, Cursor) through a shared Chromium browser — scoped tokens, tab isolation, rate limiting, domain restrictions. Conductor runs 10–15 parallel Claude Code sprints. GBrain federated sources allow cross-machine memory.

**Long-Horizon Capability**
Continuous checkpoint mode keeps WIP commits current across crashes and context switches. `/retro` provides weekly team-aware retrospectives. Canary monitoring post-deploy. GBrain persists knowledge permanently.

**Provider Model**
Claude Code (primary), OpenAI Codex CLI (via `/codex` second-opinion review), Gemini (via gstack setup for other agents). Designed to work across 10 AI coding agents via `./setup --host <name>`.

**Standout Feature**
The YC productivity framing — "virtual engineering team" — is the clearest articulation of the agent-as-multi-specialist metaphor in the survey. The browser QA layer (`/qa` + GStack Browser + sidebar agent) is the most sophisticated live browser integration. Anti-prompt-injection ML defense is unique.

**Weakness**
Heavily Claude Code-centric despite multi-agent packaging aspirations. The 23 specialist skills are all slash commands with specific invocation patterns — learnability overhead. GBrain adds Supabase as a dependency for cloud sync.

**Bizar Relevance**
gstack's browser-first QA approach (real Chromium, sidebar agent, anti-injection defense) is the most mature live browser integration in the survey. Bizar's browser automation should study gstack's CDP layer and security model.

---

### 9. Claude Agent SDK (Python)

**Name & One-Line Positioning**
Anthropic's official Python SDK for programmatically invoking Claude Code — embedding the full Claude Code toolset and agent loop inside Python applications.

**Architecture Summary**
The SDK ships a bundled Claude Code CLI and exposes it via two Python APIs: `query()` (async iterator for single prompts) and `ClaudeSDKClient` (bidirectional conversational client with hooks and custom tool support). Custom tools are implemented as in-process MCP servers via `@tool` decorator — no subprocess overhead. Hooks intercept PreToolUse and PostToolUse events for deterministic processing and automated feedback. Session forking enables programmatic subagents.

**Tool Surface**
The full Claude Code toolset (Read, Write, Edit, Bash, Glob, Grep, etc.) is available by default. `allowed_tools` acts as a permission allowlist; `disallowed_tools` blocks specific tools. Custom tools are in-process Python functions registered via `@tool` decorator and served by an SDK MCP server. External MCP servers are also supported alongside SDK tools.

**Memory / Context**
Session-scoped. No persistent memory between Python script invocations. The SDK itself is stateless — state lives in the Claude Code CLI session that the SDK manages.

**Multi-Agent**
Programmatic subagents via `ClaudeSDKClient` session forking. Multiple `ClaudeSDKClient` instances can be instantiated in a Python process, each with its own tools and context. The Python process itself orchestrates — no native agent-to-agent protocol.

**Long-Horizon Capability**
Limited by the Claude Code CLI session lifetime. Long-running applications need explicit session management in Python. The SDK does not include summarization, checkpointing, or compaction — these would need to be implemented in the calling Python application.

**Provider Model**
Anthropic Claude models only (via bundled Claude Code CLI). The SDK does not abstract model providers — it wraps the Claude Code CLI which handles model routing internally.

**Standout Feature**
In-process MCP servers — custom tools run in the same Python process as the SDK, eliminating IPC overhead. The `HookMatcher` provides deterministic PreToolUse/PostToolUse intercepts. Bundled CLI means `pip install` is the entire dependency.

**Weakness**
Claude Code CLI dependency is bundled but still substantial. No model provider abstraction. No built-in memory persistence. The SDK is a thin wrapper — significant application logic must be built around it for complex workflows.

**Bizar Relevance**
The Claude Agent SDK's in-process MCP server pattern (decorators, `create_sdk_mcp_server`) is a clean reference for Bizar's Python SDK design. The `allowed_tools` permission model is also worth studying.

---

### 10. SWE-agent

**Name & One-Line Positioning**
A research-grade coding agent from Princeton/Stanford that achieves state-of-the-art results on SWE-bench — configured via a single YAML file and designed for hackability.

**Architecture Summary**
SWE-agent runs a single-task agent loop: the model (configured via yaml) receives a bug report or issue, uses tools to explore the codebase, and produces a fix. The tool interface is defined in yaml: `Bash`, `str_replace` editing, `Ripgrep` (for searching), and `WebSearch`. A bash sandbox provides isolation. SWE-agent 1.0 + Claude 3.7 Sonnet achieved SoTA on SWE-bench verified. The project has since shifted focus to mini-SWE-agent (65% on SWE-bench verified in 100 lines of Python). The EnIGMA variant applies the same architecture to offensive cybersecurity CTF challenges.

**Tool Surface**
Narrow and research-focused: `Bash`, `str_replace` (elastic string replacement for file edits), `Ripgrep` (search), `WebSearch`. All tools configured in a single yaml file. No MCP, no plugin system, no extensibility beyond yaml reconfiguration.

**Memory / Context**
No persistent memory. Each SWE-agent run is isolated and stateless beyond the current task context. Designed for single-task evaluation, not multi-session development.

**Multi-Agent**
No native multi-agent capability. Designed as a single-agent evaluator.

**Long-Horizon Capability**
Designed for bounded single-task sessions (fix one issue, submit one PR). No session persistence, no checkpointing, no summarization. The mini-SWE-agent successor is even more minimal.

**Provider Model**
Any LLM: GPT-4o, Claude Sonnet 4, and others are tested. The yaml configuration specifies the model. No provider lock-in.

**Standout Feature**
Research-grade evaluation infrastructure: SWE-bench is the canonical software engineering agent benchmark. SWE-agent 1.0 + Claude 3.7 Sonnet achieved SoTA on SWE-bench verified. The yaml-driven tool configuration is elegant and hackable.

**Weakness**
Narrow scope — designed for single-issue fixing, not general development. No multi-agent, no memory persistence, no structured development workflow. The benchmark success has not translated to general-purpose harness features.

**Bizar Relevance**
SWE-agent's yaml-driven tool configuration and evaluation infrastructure are models for Bizar's configuration system. The SWE-bench evaluation harness is the industry's most rigorous agent benchmarking framework.

---

### 11. AutoHarness

**Name & One-Line Positioning**
A governance-first Python harness framework — wrapping any LLM client in 2 lines to add tool governance, cost attribution, and compliance-grade audit trails.

**Architecture Summary**
AutoHarness wraps an LLM client (`OpenAI()`, Anthropic Claude, etc.) in an `AutoHarness.wrap()` call. Three pipeline modes: Core (6-step governance: parse/validate, risk classify, permission check, execute, output sanitize, audit log), Standard (8-step adds risk classifier pre-hooks and basic multi-agent profiles), Enhanced (14-step adds turn governor, alias resolution, failure hooks, fork/swarm/background profiles). A YAML constitution file defines the governance rules. A CLI (`autoharness init`, `autoharness audit summary`, `autoharness install --target claude-code`) manages the harness lifecycle.

**Tool Surface**
The governance pipeline operates on tool calls — every tool call is parsed, risk-scored, permission-checked, executed, output-sanitized, and logged. Built-in risk patterns detect dangerous operations (rm -rf, DROP TABLE), secret exposure, path traversal. Risk pattern matching is configurable via YAML.

**Memory / Context**
JSONL audit log persists every decision with full provenance. Per-call cost attribution with model-aware pricing. Session persistence with cost tracking. No session summarization or learning system.

**Multi-Agent**
Multi-agent profiles with role-based governance (different permission sets for different agent roles). Enhanced mode adds fork/swarm/background multi-agent profiles. Role-based governance is the coordination mechanism.

**Long-Horizon Capability**
Enhanced mode's turn governor prevents infinite loops. Failure hooks provide retry and escalation logic. JSONL audit trail enables post-hoc analysis of long sessions. Cost tracking prevents runaway spend.

**Provider Model**
OpenAI, Anthropic, Google, and any OpenAI-compatible API. No vendor lock-in. The 2-line `wrap()` API is provider-agnostic.

**Standout Feature**
Governance-first design: 958 tests, the most rigorous test coverage in the survey. The 6-step governance pipeline (parse, risk classify, permission check, execute, sanitize, audit) is a complete tool call lifecycle model. YAML constitution makes governance rules explicit and auditable.

**Weakness**
AutoHarness is a governance layer, not a development workflow system. It doesn't provide plan/execute/review cycles, multi-agent coordination beyond role profiles, or memory persistence beyond audit logs. The value is in wrapping existing agents with compliance controls.

**Bizar Relevance**
AutoHarness's 6-step governance pipeline and YAML constitution model are directly applicable to Bizar's tool call lifecycle and policy enforcement. The 958-test coverage is a benchmark for Bizar's own test quality.

---

### 12. OpenCode

**Name & One-Line Positioning**
A Go-based terminal AI assistant with the broadest model provider support in the survey (20+ providers), Vim-style editing, and a TUI built with Bubble Tea.

**Architecture Summary**
OpenCode is a Go CLI application (Go 1.24+, no runtime dependency). The TUI is built with Charm's Bubble Tea framework. A SQLite database persists conversations and sessions. The auto-compact feature automatically summarizes conversations at 95% of the model's context window and creates a new session with the summary. Custom commands are Markdown files in `~/.config/opencode/commands/` (user-level) or `.opencode/commands/` (project-level). MCP servers are configured in `opencode.json`. LSP integration (gopls, typescript-language-server) provides diagnostics. Sourcegraph integration enables code search across public repositories.

**Tool Surface**
File ops (`view`, `write`, `edit`, `patch`), bash execution, glob, grep, fetch, Sourcegraph (public repo search), diagnostics (LSP-driven). Custom commands are parameterized Markdown prompts. MCP servers are first-class. The `agent` tool runs sub-tasks with the AI agent.

**Memory / Context**
SQLite-backed session persistence. Auto-compact summarizes and forks the conversation when context approaches the model's limit. Sessions are named and switchable via `Ctrl+A`. No continuous learning or instinct system.

**Multi-Agent**
No native multi-agent coordination. The `agent` tool runs sub-tasks but these are single-agent sub-invocations, not coordinated team agents.

**Long-Horizon Capability**
Auto-compact is the primary long-horizon mechanism — it prevents context overflow by proactively summarizing. Session persistence means conversations can be resumed. No structured development workflow (plan/execute/review) is built in.

**Provider Model**
Broadest in the survey: OpenAI, Anthropic Claude (3.x and 4.x), GitHub Copilot, Google Gemini, AWS Bedrock, Groq, Azure OpenAI, Google Cloud VertexAI, OpenRouter (200+ models), self-hosted (any OpenAI-compatible endpoint). Model selection is per-conversation via `Ctrl+O`.

**Standout Feature**
20+ AI provider support in a single Go binary. Auto-compact context summarization. Vim-style editor keybindings in the TUI. The `./setup --host <name>` pattern for multi-agent support (gstack style). Sourcegraph integration for public code search.

**Weakness**
No structured development workflow. No multi-agent team coordination. No continuous learning or instinct system. The Go-based TUI has excellent performance but the skill ecosystem is minimal compared to Claude Code/ECC.

**Bizar Relevance**
OpenCode's auto-compact design is the cleanest session-forking implementation in the survey. Bizar should study the SQLite session schema and the auto-compact trigger logic. The Go architecture also demonstrates that high-performance harnesses don't need to be JavaScript/TypeScript.

---

## What Coding Harnesses Teach Bizar

### 1. The Tool Call Lifecycle Is a First-Class Design Problem

AutoHarness's 6-step governance pipeline (parse/validate → risk classify → permission check → execute → output sanitize → audit log) is the most complete explicit model of a tool call lifecycle in the survey. Most harnesses treat tools as a simple try/catch wrapper. AutoHarness shows that making the lifecycle explicit and configurable enables governance, compliance, and debugging at production scale. Bizar should model its own tool call lifecycle with explicit phases rather than ad-hoc tool invocation.

### 2. Skill Triggering Must Be Automatic, Not Manual

Every effective harness (Superpowers, gstack, ECC, Cline) uses automatic skill triggering — the agent detects the current task phase and activates the relevant skill without user invocation. The pattern is: trigger condition → inject skill context → execute → release context. The alternative (manual slash-command invocation) works but requires the user to know which skill to call. Bizar's agent should carry an internal skill router that monitors task phase and self-activates relevant skills.

### 3. Memory Architecture Divides the Field

Three distinct memory models emerged: (a) session-scoped with no persistence (Codex CLI, Gemini CLI, SWE-agent), (b) hook-based session lifecycle with selective persistence (ECC's hooks, gstack's checkpoint mode), and (c) explicit knowledge bases with retrieval (gstack's GBrain, ECC's instinct system). The critical insight is that "memory" is not a single feature — it's a stack of mechanisms (session summaries, learned skills, indexed codebases, domain knowledge) that operate at different granularities. Bizar needs all three layers.

### 4. Multi-Agent Coordination Is the Hard Problem

Cline's Kanban board, OpenHands' multi-backend ACP switching, gstack's Conductor parallel sprints, and ECC's `multi-*` orchestrators all approach multi-agent coordination differently. The common thread: coordination requires a higher-level protocol than the agent loop itself. Whether it's a visual board with per-card worktrees (Cline), a REST API over multiple hosts (OpenHands), a session orchestrator (ECC), or a shared browser with tab isolation (gstack), the coordination layer must be strictly separated from the agent loop. Bizar needs an explicit coordination protocol design.

### 5. Structured Development Workflows Enforce Quality at Scale

Superpowers' mandatory phase system (brainstorm → plan → execute → review → merge) is the most rigorous methodology in the survey. The key insight: each phase has a deliverable (design doc, task list, code with tests, review report), and the next phase cannot begin until the current phase's deliverable is complete. This is red-green-refactor applied at the sprint level, not just the test level. gstack's sprint (think → plan → build → review → test → ship → reflect) follows the same pattern. Bizar should implement a mandatory phase system with explicit deliverables.

### 6. Configuration Should Be Declarative, Not Programmatic

SWE-agent's yaml-driven tool configuration and AutoHarness's YAML constitution are the two cleanest examples of declarative harness configuration. Both separate the governance/tooling policy from the execution engine. This has two benefits: the policy is auditable and version-controllable, and the policy can be changed without touching the agent code. Bizar should expose its core policies (tool permissions, memory limits, coordination protocols) as declarative configuration files.

### 7. The Browser Is Becoming a Primary Development Surface

gstack's GStack Browser (Chromium with CDP, sidebar agent, anti-injection ML, cookie import, anti-bot stealth) represents a new category: browser-as-agent-tool. The traditional terminal-based harness is being extended with live web interaction for QA, design exploration, and authenticated workflow automation. Bizar should treat browser automation as a first-class tool alongside file ops and bash.

### 8. Benchmark Infrastructure Defines Credibility

SWE-agent's SWE-bench evaluation framework is what makes the project credible — it's not just a coding agent, it's a reproducible evaluation system. ECC's 958 tests, AutoHarness's 958 tests, and AgentShield's 1282 tests all follow the same principle: quantitative evaluation is what separates "impressive demo" from "production system." Bizar should build its evaluation infrastructure (test suites, benchmark harnesses, eval rubrics) alongside the agent, not after it.

### 9. Extensibility Through MCP Is Table Stakes

Gemini CLI, Cline, OpenHands, OpenCode, and the Claude Agent SDK all treat MCP as a first-class extension mechanism. The days of custom tool definition formats are numbered — MCP is becoming the industry standard for tool discovery and invocation. Bizar should implement MCP server support as a core feature, not an add-on.

### 10. The Solo Builder Is the Primary User Archetype

gstack's framing (YC President's personal software factory), Karpathy's quote ("I haven't typed a line of code since December"), and ECC's "first-time Claude Code users" positioning all point to the same conclusion: the primary user of a coding harness in 2026 is a solo technical builder using AI to operate at team scale. This has design implications: the harness should feel like a well-managed team member, not a powerful IDE plugin. The workflow should be self-documenting (WIP commits, retros, design docs), the agent should have a coherent voice (specialist personas in gstack), and the system should compound knowledge over time (GBrain, instinct learning). Bizar should design for the solo technical founder archetype.

---

*End of Round 7 Survey. Total projects: 12. Next round: TBD.*
