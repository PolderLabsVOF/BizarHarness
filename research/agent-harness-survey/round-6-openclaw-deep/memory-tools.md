# OpenClaw Memory + Tool Policy + Providers — Deep Dive

**Round:** 6 — OpenClaw deep dive (bonus)
**Scope:** The three orthogonal memory backends (Core / Wiki / LanceDB), the six-layer tool policy pipeline, the 30+ provider plugin manifest contract, MCP server integration, and subagent delegation.
**Repo:** `repos/openclaw/` (commit captured 2026-07-06).

---

## 1. Memory Backends

### 1.1 The Three Orthogonal Stores

OpenClaw's memory system has **three first-party backends** that the user can mix:

| Backend | Storage | Search | Primary use case |
|---------|---------|--------|------------------|
| `memory-core` (default) | Per-agent SQLite | FTS5 BM25 + vector + hybrid | Working/durable recall |
| `memory-wiki` | Obsidian-friendly markdown vault | wiki_search, wiki_get, wiki_apply | Provenance-rich knowledge vault |
| `memory-lancedb` | LanceDB | Vector search with auto-recall/capture | Long-term episodic memory |

`docs/concepts/memory.md:148-165` enumerates them as installable options. The brief is explicit (`docs/concepts/memory.md:178-179`): *"`memory-wiki` does not replace the active memory plugin; the active memory plugin still owns recall, promotion, and dreaming. `memory-wiki` adds a provenance-rich knowledge layer beside it."* The same pattern holds for `memory-lancedb`.

### 1.2 Memory Core — Default Engine

`extensions/memory-core/index.ts` registers two agent tools (`memory-core/index.ts:193-199`):

- `memory_search` — finds relevant notes via semantic + keyword search across `MEMORY.md` + `memory/*.md` + indexed session transcripts. The schema (`memory-core/index.ts:57-67`) accepts `query` (required), `maxResults`, `minScore`, and `corpus` (enum `"memory" | "wiki" | "all" | "sessions"`).
- `memory_get` — reads a specific memory file or line range. The schema (`memory-core/index.ts:69-79`) accepts `path` (required), `from`, `lines`, `corpus`.

Both tools are lazily created (`memory-core/index.ts:34-38`, `81-116`) so the cost of loading the search-manager stack is only paid when the agent actually calls them. The `hasMemoryToolContext` predicate (`memory-core/index.ts:44-55`) checks the agent's memory config before registering either tool — if no memory backend is configured, the tools simply don't exist.

The plugin also registers a `memoryCapability` (`memory-core/index.ts:181-191`) with `promptBuilder`, `flushPlanResolver`, and `runtime` — this is the contract that lets memory-core hook into the system prompt and pre-compaction flow.

`docs/concepts/memory.md:120-126` documents the user-facing surface:

> *"The agent has two tools for working with memory: `memory_search` — finds relevant notes using semantic search, even when the wording differs from the original. `memory_get` — reads a specific memory file or line range. Both tools are provided by the active memory plugin (default: `memory-core`)."*

### 1.3 Memory Core Internals

`extensions/memory-core/src/memory/` contains 85 files. Key components:

- **`hybrid.ts`** (`hybrid.ts:32-39`) — `buildFtsQuery(raw)` tokenizes input via the regex `/[\p{L}\p{N}_]+/gu` (Unicode letter/number/underscore) and joins quoted tokens with `AND`. `bm25RankToScore` (`hybrid.ts:41-50`) normalizes SQLite FTS5's `rank` (negative = more relevant) to a 0–1 score. `mergeHybridResults` (`hybrid.ts:52-60+`) combines vector + keyword hits with MMR (`mmr.ts`) and temporal decay (`temporal-decay.ts`) re-ranking.
- **`manager-db.ts`** (`manager-db.ts:1-60`) — SQLite schema management. Uses a dedicated schema `"memory_reindex"` (`manager-db.ts:21`) with the `memory_index_state` row. WAL maintenance helpers from the SDK. Loads the `sqlite-vec` extension for in-database vector queries.
- **`embeddings.ts`** — embedding-provider abstraction. 10+ providers documented at `docs/concepts/memory-builtin.md:67-79`:

| Provider | ID | Notes |
|----------|-----|-------|
| Bedrock | `bedrock` | Uses AWS credential chain |
| DeepInfra | `deepinfra` | Default: `BAAI/bge-m3` |
| Gemini | `gemini` | Supports multimodal (image + audio) |
| GitHub Copilot | `github-copilot` | Uses your Copilot subscription |
| LM Studio | `lmstudio` | Local/self-hosted |
| Local | `local` | `@openclaw/llama-cpp-provider` |
| Mistral | `mistral` | |
| Ollama | `ollama` | Local/self-hosted |
| OpenAI | `openai` | Default: `text-embedding-3-small` |
| OpenAI-compatible | `openai-compatible` | Generic `/v1/embeddings` endpoint |
| Voyage | `voyage` | |

- **`tokenize.ts`** — CJK trigram tokenizer. Per `docs/concepts/memory-builtin.md:18`: *"CJK support via trigram tokenization for Chinese, Japanese, and Korean."*
- **`watcher-config.ts`** / **`watch-pressure.ts`** / **`watch-settle.ts`** — file-watcher plumbing so memory re-indexing settles after the editor stops writing.
- **`qmd-manager.ts`** — alternative engine adapter (the QMD backend at `docs/concepts/memory-qmd` is a separate local-first sidecar with reranking and query expansion).
- **`vector-blob.ts`** — binary vector serialization.

The CJK support and the optional `sqlite-vec` acceleration are both pointed at in `docs/concepts/memory-builtin.md:18-19` — the engine is deliberately feature-rich in storage while remaining one tool surface to the agent.

### 1.4 Prompt Section

`extensions/memory-core/src/prompt-section.ts` is the system-prompt builder for the recall section. The logic at `prompt-section.ts:7-39` produces three variants depending on which tools are available:

- both `memory_search` and `memory_get` — full guidance: *"Before answering anything about prior work, decisions, dates, people, preferences, or todos: run memory_search on MEMORY.md + memory/*.md + indexed session transcripts; then use memory_get to pull only the needed lines."*
- only `memory_search` — search-only guidance
- only `memory_get` — read-only guidance

Citations are also controlled here: `citationsMode === "off"` strips the source attribution, otherwise the prompt tells the agent to include `Source: <path#line>` (`prompt-section.ts:28-36`).

This is the load-bearing prompt that makes `memory_search` *mandatory* before answering prior-work questions — the agent reads it on every session start.

### 1.5 Pre-Compaction Flush

`extensions/memory-core/src/flush-plan.ts` builds the **memory flush turn** that runs before compaction:

```ts
const DEFAULT_MEMORY_FLUSH_PROMPT = [
  "Pre-compaction memory flush.",
  MEMORY_FLUSH_TARGET_HINT,         // "Store durable memories only in memory/YYYY-MM-DD.md..."
  MEMORY_FLUSH_READ_ONLY_HINT,      // "Treat MEMORY.md, DREAMS.md, SOUL.md, TOOLS.md, AGENTS.md as read-only..."
  MEMORY_FLUSH_APPEND_ONLY_HINT,    // "APPEND new content only and do not overwrite..."
  "Do NOT create timestamped variant files (e.g., YYYY-MM-DD-HHMM.md); always use the canonical YYYY-MM-DD.md filename.",
  "If nothing to store, reply with NO_REPLY.",
].join(" ");
```

(`flush-plan.ts:27-34`)

The flush prevents context loss during compaction: *"If your agent has important facts in the conversation that are not yet written to a file, they are saved automatically before the summary happens."* (`docs/concepts/memory.md:212-216`). The flush turn uses `NO_REPLY` (`flush-plan.ts:33`) when there's nothing to write — the model's empty-reply token so the conversation log stays clean.

You can override the flush model locally (`docs/concepts/memory.md:196-210`):

```json
{
  "agents": {
    "defaults": {
      "compaction": {
        "memoryFlush": {
          "model": "ollama/qwen3:8b"
        }
      }
    }
  }
}
```

The override applies only to the flush turn — it does **not** inherit the active session's fallback chain.

### 1.6 Memory Wiki

`extensions/memory-wiki/index.ts:43-62` registers five wiki tools:

- `wiki_status` — inspect wiki state
- `wiki_lint` — validate wiki structure
- `wiki_apply` — apply a wiki edit
- `wiki_search` — search the compiled vault
- `wiki_get` — fetch a wiki page

The wiki plugin compiles durable knowledge into a markdown vault with deterministic page structure, structured claim/evidence metadata, contradiction tracking, freshness tracking, generated dashboards, and compiled digests (`docs/concepts/memory.md:170-178`). It runs **alongside** the active memory plugin — it adds a provenance layer, not a replacement.

The wiki plugin uses an Obsidian-friendly vault directory and emits `.openclaw-wiki/cache/` machine-readable digests so runtime consumers don't scrape markdown (`docs/concepts/memory.md:194-195` — referenced from R3).

### 1.7 Memory LanceDB

`extensions/memory-lancedb/index.ts` (the only file at the top level) is a single 2023-line entry point. It exposes `memory_recall` (the LanceDB-specific tool name — different from the Core `memory_search`/`memory_get` pair) and runs `auto-recall` and `auto-capture` lifecycle hooks (`extensions/memory-lancedb/index.ts:1-7`).

Tool surface (per R3): **`memory_recall`** — exposes the LanceDB-backed vector store. The tool surface changes per memory slot; the agent's available tools depend on which memory plugin is active.

### 1.8 Dreaming

`docs/concepts/memory.md:218-233` describes **dreaming** — an optional background consolidation pass. Properties:

- **Opt-in**: disabled by default
- **Scheduled**: when enabled, `memory-core` auto-manages one recurring cron job for a full dreaming sweep
- **Thresholded**: promotions must pass score, recall-frequency, and query-diversity gates
- **Reviewable**: phase summaries and diary entries are written to `DREAMS.md` for human review

There are two review lanes (`docs/concepts/memory.md:237-244`):

- **Live dreaming** — works from the short-term dreaming store under `memory/.dreams/`; the normal deep phase uses it to decide what graduates into `MEMORY.md`
- **Grounded backfill** — reads historical `memory/YYYY-MM-DD.md` notes as standalone day files and writes structured review output into `DREAMS.md`

The CLI surface is `openclaw memory rem-backfill [--path ./memory] [--stage-short-term] [--rollback] [--rollback-short-term]` (`docs/concepts/memory.md:248-265`).

### 1.9 Per-Agent Database Layout

Per `docs/concepts/multi-agent.md:9-25`, each agent has its own:

- Workspace (`~/.openclaw/workspace` for the default agent; `<stateDir>/workspace-<agentId>` for secondary agents)
- State directory `agentDir` (`~/.openclaw/agents/<agentId>/agent/`)
- Session store (`~/.openclaw/agents/<agentId>/sessions`)
- Auth profiles (`~/.openclaw/agents/<agentId>/agent/auth-profiles.json`)

Memory state lives in the per-agent SQLite database (`docs/concepts/memory-builtin.md:9-11`): *"The builtin engine is the default memory backend. It stores your memory index in a per-agent SQLite database and needs no extra dependencies to get started."*

OAuth credentials are per-agent with read-through to the main agent's credential for the same profile id (`docs/concepts/multi-agent.md:30-33`). The default agent gets `agentId = "main"`; sessions key as `agent:main:<mainKey>` (`multi-agent.md:55-58`).

## 2. Memory Operations

### 2.1 The Three Memory Layers

Per `docs/concepts/memory.md:11-25`:

- **`MEMORY.md`** — long-term memory. Durable facts, preferences, decisions. Loaded at the start of a session.
- **`memory/YYYY-MM-DD.md`** (or `memory/YYYY-MM-DD-<slug>.md`) — daily notes. Running context and observations. Today's and yesterday's dated notes load automatically on a bare `/new` or `/reset`; slugged variants are picked up alongside.
- **`DREAMS.md`** (optional) — Dream Diary and dreaming sweep summaries for human review.

### 2.2 Semantic Search

`docs/concepts/memory.md:131-141`: *"When an embedding provider is configured, `memory_search` uses hybrid search: vector similarity (semantic meaning) combined with keyword matching (exact terms like IDs and code symbols). This works out of the box with an API key for any supported provider."*

Default embeddings: OpenAI `text-embedding-3-small` (`docs/concepts/memory-builtin.md:23-25`). Set `agents.defaults.memorySearch.provider` to one of the 10+ alternatives for Gemini, Voyage, Bedrock, etc.

### 2.3 Multimodal Memory

Gemini embeddings support multimodal (image + audio) per `docs/concepts/memory-builtin.md:73`. Other providers are text-only.

### 2.4 CLI

```bash
openclaw memory status          # check index status and provider
openclaw memory search "query"  # search from the command line
openclaw memory index --force   # rebuild the index
```

(`docs/concepts/memory.md:270-273`)

## 3. Tool Policy — The Six-Layer Pipeline

The agent's effective tool surface is built by composing **six policy layers**. Per R3 (citing OpenClaw architecture): **sandbox → profile → provider → sender → group → subagent**.

### 3.1 Pipeline Step Type

`src/agents/tool-policy-pipeline.ts:38-46`:

```ts
export type ToolPolicyPipelineStep = {
  policy: ToolPolicyLike | undefined;
  label: string;
  stripPluginOnlyAllowlist?: boolean;
  suppressUnavailableCoreToolWarning?: boolean;
  suppressUnavailableCoreToolWarningAllowlist?: string[];
  unavailableCoreToolReason?: string;
};
```

`ToolPolicyLike` (`src/agents/tool-policy.ts:21-26`):

```ts
export type ToolPolicyLike = {
  allow?: string[];
  deny?: string[];
  [IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW]?: true;
};
```

The `[IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW]` symbol is a marker that an `allow` policy implicitly injects `*` for sandbox compatibility — these implicit wildcards are filtered out when reporting explicit operator allow entries (`tool-policy.ts:91-106`).

### 3.2 The Six Layers

`buildDefaultToolPolicyPipelineSteps` (`src/agents/tool-policy-pipeline.ts:57-72+`) builds the pipeline from six sources:

| # | Layer | Source | Label (when set) |
|---|-------|--------|------------------|
| 1 | `tools.profile` | Profile-specific allow/deny | `tools.profile (<profileName>)` |
| 2 | `tools.profile.provider` | Profile × provider override | `tools.profile.<provider> (<profile>)` |
| 3 | `tools.defaults` / `agents.defaults` | Global / agent default | `tools.defaults` |
| 4 | `agents.list[].tools` | Per-agent override | `agents.list[<id>]` |
| 5 | `groups` | Per-group policy | `groups (<groupId>)` |
| 6 | `senders` / `subagent` | Per-sender / subagent policy | `senders` / `subagent` |

Each step is applied in order; later steps see the filtered tool list from earlier steps. The `filterToolsByPolicy` function (`tool-policy-pipeline.ts:6`) does the actual filtering per layer, with diagnostic events captured via `auditToolPolicyFilter` (`tool-policy-pipeline.ts:9`).

### 3.3 Plugin Tool Group Expansion

`buildPluginToolGroups` (`src/agents/tool-policy.ts:131-150+`) buckets tools by their owning plugin, and `expandPolicyWithPluginGroups` (imported via `tool-policy-shared.js:1`) expands named groups like `plugin:myPlugin` into the actual tool names. The synthetic allowlist entry `__openclaw_default_plugin_tools__` (`tool-policy.ts:48`) means *"use the default plugin tools for this agent"* — it's how `plugins.allow` slots work without enumerating every tool.

### 3.4 Profile-Based Policy

`ToolProfileId` (`tool-policy.ts:18-19` re-export) is a typed profile identifier. `resolveToolProfilePolicy` (`tool-policy.ts:18` re-export) loads the named profile's allow/deny lists and folds them into the first pipeline step.

### 3.5 Provider-Specific Policy

The `providerProfilePolicy` step (`tool-policy-pipeline.ts:63-66`) handles `agents.list[].tools.<provider>` overrides — useful when one provider rejects certain tool schemas (e.g., some providers reject `anyOf` — the OpenClaw AGENTS.md warns: *"Provider tool schemas: prefer flat string enum helpers over `Type.Union([Type.Literal(...)])`; some providers reject `anyOf`."*).

### 3.6 Sandbox Layer

The first pipeline step interacts with the agent sandbox mode. The `IMPLICIT_ALLOW_ALL_FROM_ALSO_ALLOW` symbol (`tool-policy.ts:25-26`) signals that the sandbox has implicitly widened the allow list — a separate flag from explicit operator configuration.

### 3.7 Policy Audit

`auditToolPolicyFilter` (`tool-policy-pipeline.ts:9`) and `ToolPolicyAuditLogLevel` keep a bounded warning cache (`tool-policy-pipeline.ts:19-36`) — at most 256 entries with FIFO eviction. The cache prevents spamming logs when the same tool is filtered out repeatedly across thousands of turns.

## 4. The 30+ Provider Plugins

### 4.1 Plugin Manifest as Contract

`extensions/openai/openclaw.plugin.json:1-379` is the canonical example. The manifest declares:

```json
{
  "id": "openai",
  "activation": { "onStartup": false },
  "enabledByDefault": true,
  "providers": ["openai"],
  "modelSupport": { "modelPrefixes": ["gpt-", "o1", "o3", "o4"] },
  "providerEndpoints": [...],
  "modelCatalog": { "providers": { "openai": { "models": [...] } } },
  "providerAuthChoices": [...],
  "contracts": {
    "speechProviders": ["openai"],
    "realtimeTranscriptionProviders": ["openai"],
    "realtimeVoiceProviders": ["openai"],
    "memoryEmbeddingProviders": ["openai"],
    "mediaUnderstandingProviders": ["openai"],
    "imageGenerationProviders": ["openai"],
    "videoGenerationProviders": ["openai"],
    "usageProviders": ["openai"]
  },
  "configSchema": { ... }
}
```

(`extensions/openai/openclaw.plugin.json:1-378`)

The **`contracts`** block at `openai/openclaw.plugin.json:326-335` declares every capability this plugin implements — eight distinct provider types in one manifest. This is the multi-capability pattern that lets OpenAI be the speech, realtime voice, embedding, vision, image-gen, video-gen, and usage backend simultaneously.

### 4.2 The Capability Matrix

Per `extensions/openai/openclaw.plugin.json:326-335`, a single plugin manifest can declare membership in any subset of:

| Capability | Purpose |
|------------|---------|
| `speechProviders` | TTS (text-to-speech) |
| `realtimeTranscriptionProviders` | Streaming STT |
| `realtimeVoiceProviders` | Full-duplex realtime voice (Talk) |
| `memoryEmbeddingProviders` | Embeddings for memory search |
| `mediaUnderstandingProviders` | Image and audio understanding |
| `imageGenerationProviders` | Image generation |
| `videoGenerationProviders` | Video generation |
| `usageProviders` | Cost / token usage reporting |

### 4.3 Provider Plugin Inventory

The R2 brief enumerated 30+ providers. The current extension tree (from `extensions/` listing) confirms the set: `anthropic`, `anthropic-vertex`, `openai`, `anthropic-cloudflare`, `google`, `google-gemini`, `google-vertex`, `minimax`, `moonshot`, `deepseek`, `xai`, `zai`, `azure-openai`, `aws-bedrock`, `amazon-bedrock`, `amazon-bedrock-mantle`, `github-copilot`, `groq`, `together`, `fireworks`, `perplexity`, `replicate`, `cohere`, `mistral`, `lmstudio`, `ollama`, `openrouter`, `custom-api`, `cloudflare-ai-gateway`, `chutes`, `stepfun`, `litellm`, `nvidia`, `cerebras`, `byteplus`, `alibaba`, `arcee`, `deepinfra`, `kilocode`, `kimi-coding`, `microsoft`, `microsoft-foundry`, `minimax`, `novita`, `tencent`, `qianfan`, `qwen`, `longcat`, `sglang`, `vllm`, `voyage`, `venice`, `vercel-ai-gateway`, `tokenjuice`, `huggingface`, `gmi`, `gmi`, `synthetic`, `inworld`, `volcengine`, `fal`, `pixverse`, `runway`, `comfy`, `llama-cpp`, `lobster`, `opencode`, `opencode-go`, `vydra`, `senseaudio`, `clickclack`, `bonjour`.

That's roughly 60+ provider plugins, well past the R2 "30+" count — the provider plugin ecosystem has continued to grow.

### 4.4 OAuth vs API Key

OpenClaw supports three auth patterns (`extensions/openai/openclaw.plugin.json:283-325`):

| Method | Example | Use case |
|--------|---------|----------|
| `oauth` | ChatGPT/Codex subscription sign-in | Use existing subscription |
| `device-code` | ChatGPT Device Pairing | Browser-based device flow |
| `api-key` | `OPENAI_API_KEY` env var | Direct API key |

Each auth choice has its own metadata block with `choiceId`, `choiceLabel`, `choiceHint`, `assistantPriority`, `groupId`, `groupLabel`, `groupHint`. The `assistantPriority` field controls ordering when the agent picks a provider automatically; `onboardingFeatured` flags choices that appear in the first-run wizard.

### 4.5 Model Routing

Per R2, `src/agents/model-selection.ts` selects the best model per turn based on channel capability, tool schema projections, provider availability (with failover), auth profile state, and cost. The provider plugin publishes its model catalog via `modelCatalog.providers.<provider>.models` (`openai/openclaw.plugin.json:36-274`) — each model entry declares:

- `id`, `name`, `reasoning` (boolean)
- `input` modalities (e.g., `["text", "image"]`)
- `contextWindow`, `maxTokens`
- `cost` (`{ input, output, cacheRead, cacheWrite }` per 1M tokens)
- `mediaInput.image.{ maxSidePx, preferredSidePx, tokenMode }` for vision models
- `thinkingLevelMap` for reasoning models
- `compat.supportsReasoningEffort` + `supportedReasoningEfforts` for reasoning-effort knobs

### 4.6 Suppressions

Some model × provider combinations are restricted by supply chain (`openai/openclaw.plugin.json:259-273`). For example, `gpt-5.3-codex-spark` is available only through ChatGPT/Codex OAuth; OpenAI API-key auth cannot use it. The suppression block lists these with the reason and the conditions that trigger them.

## 5. MCP Server Integration

### 5.1 OpenClaw as MCP Server

Per R2 (and confirmed in `src/plugin-sdk/mcp-http.ts`), the Gateway exposes **MCP-over-HTTP** so other MCP-aware clients can invoke OpenClaw's capabilities. The Gateway MCP transport lives at `src/gateway/mcp-http.ts` (referenced in R1's `src/gateway/` enumeration).

### 5.2 OpenClaw as MCP Consumer

The agent invokes MCP servers through the plugin SDK's `mcp_http` transport (`src/agents/mcp-http.ts`, per R1). MCP servers appear as tools to the agent — the model sees a `tool_use` block and the runtime forwards to the configured MCP server.

### 5.3 Bundled and External MCP Servers

MCP servers can ship as bundled or external plugins. The plugin manifest can declare MCP surfaces via `api.registerMcpServer(...)` (per R1), and the runtime discovers them the same way it discovers channels and providers.

### 5.4 Tools Surfaced From MCP

When an MCP server is configured, the runtime:

1. Connects to the server via stdio or HTTP transport
2. Lists the server's tools
3. Adds them to the agent's tool surface with a `mcp_<servername>_<toolname>` naming convention
4. Filters them through the same six-layer tool policy pipeline

This is what lets `mcp_filesystem`, `mcp_github`, `mcp_postgres`, and similar community servers become first-class tools.

## 6. Subagent Delegation

### 6.1 Spawn Lifecycle

Per R2 (`src/agents/subagent-spawn.ts`, `src/agents/subagent-registry.ts`, `src/agents/subagent-registry-lifecycle.ts`):

1. **Spawn** — `subagent_spawn` tool creates a child session with configurable model, workspace, context
2. **Persist** — registry persists subagent state in SQLite, tracks lifecycle
3. **Lifecycle** — completion, errors, timeout, orphan recovery
4. **Announce** — `subagent-announce-*.ts` delivers results back to main agent with structured output
5. **Depth control** — `subagent-depth.ts` limits nesting depth
6. **Liveness** — `subagent-run-liveness.ts`, `subagent-run-timeout.ts` health monitoring
7. **Context** — `subagent-active-context.ts` context management

### 6.2 Model Override

Subagents can use **different models** than the parent. The `subagent` tool accepts a `model` parameter that overrides the inherited model from the parent's session.

### 6.3 Capability Inheritance

The tool policy pipeline applies to subagents via the `subagent` layer. A subagent starts with the parent's effective tool surface, then has its own `agents.list[].tools` and `subagent` policies applied as additional pipeline steps.

This is the same pattern as Hermes' `DELEGATE_BLOCKED_TOOLS` frozenset (`tools/delegate_tool.py:45` per R3): structural isolation through the tool policy pipeline, not prompt instructions.

### 6.4 Delegation vs Multi-Agent

Per `docs/concepts/multi-agent.md:9-13`, OpenClaw's multi-agent model is different from subagent delegation:

- **Multi-agent** — multiple isolated agents in one Gateway process. Each has its own workspace, auth, sessions. A binding maps a channel account (Slack workspace, WhatsApp number) to one of those agents.
- **Subagent** — a child session of the parent agent, with optional model override and narrower tool scope. Same agentId, same workspace; isolated session.

Multi-agent is for organizational deployments (multiple personas); subagent delegation is for parallel work tracks within one agent.

## 7. Acp — Agent Communication Protocol

`src/acp/` (per R1) implements the Agent Communication Protocol — a wire format for inter-agent messages. This is what lets external agents (Codex, Claude Code) interoperate with OpenClaw agents when both speak ACP. The protocol covers tool-call envelopes, streaming messages, and result aggregation.

## 8. Subagent Flow

A typical subagent invocation:

1. Parent agent invokes `subagent_spawn` with a goal, context, model, and tools
2. Runtime creates a child session with the parent's workspace but a fresh session id
3. Child runs through the same embedded-agent-runner as the parent
4. Child's tool surface is filtered through the parent's tool policy plus the subagent layer
5. Child emits progress events; parent can subscribe via `subagent.onProgress` (R1's `subagent-registry-lifecycle.ts`)
6. Child returns a structured `announce` payload via `subagent-announce-*.ts`
7. Parent consumes the announce payload and continues

### 8.1 Orphan Recovery

`subagent-registry-lifecycle.ts` handles orphan recovery — if the parent crashes while a child is running, the child is detected (via liveness timeout) and either resumed, killed, or marked as orphaned depending on configuration. The state is persisted in SQLite so the recovery survives a Gateway restart.

### 8.2 Recursion Guard

`subagent-depth.ts` enforces a maximum nesting depth (default 2 — parent → child → grandchild, then reject). This prevents accidental exponential fan-out where a child spawns a child that spawns a child.

## 9. Cross-References

- **Memory overview** — `docs/concepts/memory.md:1-287`
- **Memory builtin engine** — `docs/concepts/memory-builtin.md:1-156`
- **Memory Wiki** — `extensions/memory-wiki/index.ts:24-79`
- **Memory LanceDB** — `extensions/memory-lancedb/index.ts:1-2023`
- **Memory Core plugin** — `extensions/memory-core/index.ts:24-228`
- **Memory Core prompt section** — `extensions/memory-core/src/prompt-section.ts:4-39`
- **Memory Core flush plan** — `extensions/memory-core/src/flush-plan.ts:1-142`
- **Hybrid search** — `extensions/memory-core/src/memory/hybrid.ts:32-60`
- **Memory DB manager** — `extensions/memory-core/src/memory/manager-db.ts:1-60`
- **Multi-agent routing** — `docs/concepts/multi-agent.md:1-566`
- **Tool policy** — `src/agents/tool-policy.ts:1-303`
- **Tool policy pipeline** — `src/agents/tool-policy-pipeline.ts:1-263`
- **Provider manifest example** — `extensions/openai/openclaw.plugin.json:1-379`
- **Appcast (release feed)** — `appcast.xml:1-443`
- **Talk realtime relay** — `src/gateway/talk-realtime-relay.ts:1-1039`
- **Realtime voice provider types** — `src/talk/provider-types.ts:1-207`
- **Realtime voice provider registry** — `src/talk/provider-registry.ts:1-83`

## 10. Summary

OpenClaw's memory + tool policy + provider system is **deliberately orthogonal**:

- **Three independent memory backends** (Core / Wiki / LanceDB) with explicit non-overlapping roles. Wiki sits beside Core rather than replacing it.
- **Six-layer tool policy** (sandbox → profile → provider → sender → group → subagent) with a synthetic `__openclaw_default_plugin_tools__` allowlist marker and bounded audit-cache. The same pipeline applies to MCP-sourced tools, so a community MCP server's tools go through the same policy gates as core tools.
- **Eight-capability provider manifest** (`contracts`) so a single provider like OpenAI can simultaneously be the chat, TTS, STT, embeddings, vision, image-gen, video-gen, and usage backend. This is more disciplined than the typical one-provider-one-purpose split.
- **Subagent delegation through the same tool policy pipeline** rather than a separate `DELEGATE_BLOCKED_TOOLS` allowlist — the structural isolation comes for free from the policy layers.
- **Multi-agent routing as a separate concern** — channel accounts bind to agents, but agents share the same runtime, tool SDK, and memory providers.

The trade-off: OpenClaw ships **60+ provider plugins and 142 extension packages** to cover this surface. The benefit: an operator can mix-and-match providers per capability (e.g., Voyage for embeddings, Deepgram for STT, ElevenLabs for TTS, OpenAI for chat, Ollama for local fallback) without writing integration code.

This is the last of the three round-6 documents. Combined with `voice-canvas.md` and `cross-platform.md`, the survey now covers the realtime voice + Canvas + A2UI surface, the cross-platform distribution surface, and the memory + tool policy + provider surface — the three orthogonal layers that turn the OpenClaw agent from "another chat client" into a full multi-platform, multi-modal, multi-provider personal assistant OS.