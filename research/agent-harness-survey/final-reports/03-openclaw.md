# OpenClaw — The Personal AI Assistant You Run on Your Own Devices

**Project:** [openclaw/openclaw](https://github.com/openclaw/openclaw)  
**License:** MIT  
**Language:** TypeScript ESM (854K LOC across 142 packages)  
**Versioning:** `YYYY.M.PATCH` (e.g. `2026.6.11`)  
**Repo:** 382k+ GitHub stars  
**Date of this report:** 2026-07-06  
**Status:** Actively developed, 82 releases in the last year

---

## Executive Summary

OpenClaw is the most comprehensive open-source personal AI assistant harness available in 2026. Where Hermes Agent is a developer's tool with a million lines of Python, and OpenFang is an ambitious "Agent OS" in Rust, OpenClaw occupies the product-market fit center: an always-on personal AI that runs on your MacBook, iPhone, Android phone, or headless VPS, speaks to you on Telegram, Discord, WhatsApp, iMessage, and 25 other platforms, listens via real-time voice, and renders rich UIs through an agent-controlled Canvas. It is simultaneously the most accessible (zero dev setup, native apps for every major platform) and the most extensible (148 plugin extensions, 60+ provider plugins, a formal Plugin SDK with 538 typed interface files) harness in the survey.

OpenClaw's defining architectural insight is the **Gateway as control plane**: a long-lived HTTP/WebSocket server that owns authentication, session routing, channel lifecycle, cron scheduling, and plugin supervision — while the agent runtime itself is a downstream service that spins up and tears down per conversation turn. This separation means the agent can crash and restart without dropping a Telegram connection or cancelling a scheduled cron job. It also means the gateway can serve 28+ messaging channels simultaneously, route each to a different agent or the same agent, and persist memory and session history across all of them.

This report is the definitive single-document analysis of OpenClaw, synthesized from six rounds of deep-dive research covering gateway architecture, channel adapters, voice and Canvas systems, cross-platform distribution, memory subsystems, tool policy, and provider plugins — plus cross-cutting comparisons with Hermes Agent and OpenFang from the broader survey.

---

# Part I: Overview

## 1. Project Identity

OpenClaw is built by the OpenClaw organization and distributed from [openclaw.ai](https://openclaw.ai). The project motto is "the personal AI assistant you run on your own devices" — a deliberate contrast to cloud-hosted AI assistants that route your data through third-party servers. The gateway runs locally on the user's machine (Mac, Windows PC, Linux VPS, home server) or in a Docker container, and the native apps (macOS menu bar, iOS, Android) connect to the local gateway over the local network or a secure tunnel.

The MIT license means anyone can fork, modify, and self-host. The project maintains a stable release train (`stable`), a beta channel, an `extended-stable` channel for conservative deployments, and a `dev` channel that tracks `main` directly. The version format is `YYYY.M.PATCH` — calendar-month-bound but patch-level sequential within that month. Emergency patches do not consume the sequential patch number; a new beta train starts at `YYYY.M.PATCH-beta.1`.

## 2. Who Built It

The OpenClaw org maintains the core repo, the 142 extension packages, and the native apps (macOS, iOS, Android). Community contributions come through the plugin ecosystem — anyone can write a channel adapter, a provider plugin, or a memory backend by implementing the formal Plugin SDK interfaces. The project has a published AGENTS.md (the internal agent engineering guidelines) that all contributors must follow, covering code style, security review requirements, and architectural constraints.

## 3. Repo Statistics

| Dimension | Count |
|-----------|-------|
| Total packages | 142 |
| Extension plugins | 148 |
| Channel adapters (built-in + plugins) | 28+ |
| Provider plugins | 60+ |
| Core method RPC surface | 264 named methods |
| Tool policy pipeline layers | 6 |
| Security audit modules | 19 |
| Documentation pages | 130+ |
| Annual releases | ~82 |

The monorepo is organized as a pnpm workspace with 21 packages under `packages/` and 148 extensions under `extensions/`. The Plugin SDK (`src/plugin-sdk/`) exports 538 typed interface files that define the formal contract between core and plugins.

## 4. Killer Features

**28+ messaging channel integrations.** OpenClaw connects to Telegram, Discord, Slack, WhatsApp, Signal, iMessage (native macOS), SMS (via Twilio), Matrix, IRC, Google Chat, Microsoft Teams, and many more. The channel adapter interface is formally typed — adding a new channel means implementing five adapter interfaces (`ChannelMessagingAdapter`, `ChannelOutboundAdapter`, `ChannelPairingAdapter`, `ChannelSecurityAdapter`, `ChannelThreadingAdapter`) and registering them with the plugin SDK.

**Native cross-platform apps.** Unlike every other harness in the survey (which is CLI-only or Electron-based), OpenClaw ships native Swift/SwiftUI apps for macOS and iOS, a native Kotlin app for Android, and a native WinUI app for Windows. The macOS app is a menu bar companion with Voice Wake, Canvas, and local node tools. The iOS and Android apps are companion nodes that connect to the gateway over WebSocket — they do not host the gateway themselves.

**Real-time voice (Talk mode).** Full-duplex voice conversations with the agent through a WebRTC peer connection. The voice subsystem (`src/talk/`) supports four transport shapes (WebRTC SDP, Provider WebSocket, Gateway relay, Managed room), integrates with Deepgram for STT and ElevenLabs for TTS, and ships with a standalone wake daemon (Swabble) that runs on-device Speech.framework recognition with zero network usage.

**Agent-controlled Canvas (WKWebView + A2UI).** The Canvas system lets the agent render HTML/CSS/JS UIs in a floating panel on macOS, or in the app's WebView on iOS and Android. The agent drives Canvas through WebSocket commands (`canvas.present`, `canvas.hide`, `canvas.navigate`, `canvas.eval`, `canvas.snapshot`, `canvas.a2ui.push`). The A2UI v0.8 protocol defines a JSONL command stream for surface updates, data model changes, and component tree manipulation.

**Cron-on-exit for background jobs.** A novel scheduling primitive where cron jobs fire when the agent's CLI turn ends, not on a time schedule. The job runs under the gateway's process supervisor (immune to per-turn teardown), persist-before-fire ensures at-most-once semantics, and the design is fail-closed — if the store write or process wait rejects, the job does not fire.

**60+ provider plugins.** From OpenAI and Anthropic to Ollama and LM Studio for local models, from Voyage and DeepInfra for embeddings to ElevenLabs and Deepgram for voice, from GitHub Copilot to custom API endpoints. A single provider plugin can declare up to eight capability contracts simultaneously (chat, TTS, STT, realtime voice, embeddings, vision, image generation, video generation).

**Three-memory-backend architecture.** `memory-core` (default, SQLite + vector), `memory-wiki` (Obsidian-friendly structured vault), and `memory-lancedb` (LanceDB for long-term episodic memory). The three are orthogonal and composable — Wiki sits beside Core rather than replacing it, and LanceDB adds a vector-native episodic layer.

**Multi-agent with per-agent workspaces.** The gateway can host multiple isolated agents, each with its own workspace files (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`), session history, memory, and channel bindings. Channel accounts route to different agents or the same agent depending on configuration.

---

# Part II: Architecture

## 5. Gateway Architecture

The Gateway is OpenClaw's central control plane. It is a long-lived Node.js HTTP/WebSocket server that owns responsibilities that must survive per-conversation-turn teardown: authentication state, channel connections, cron schedules, the process supervisor, session history, and the plugin registry.

### 5.1 Process Model

The gateway runs as a **singleton process** managed by `getProcessSupervisor()` at `src/process/supervisor/index.ts:8`. The CLI entry point `openclaw.mjs` validates the Node.js version (requires ≥ 22.19.0, recommends 24), sets up the compile cache under `/tmp/node-compile-cache/openclaw/<version>/`, then spawns the actual gateway as a child process with forwarded signals and a 1-second grace period before force-killing.

This is architecturally important: the gateway survives individual agent turns. When the agent processes a message, produces a reply, and the turn ends, the gateway process continues running. Any long-lived connections (Telegram webhook, WhatsApp Baileys session, Discord gateway, cron watchers) are owned by the gateway and do not restart with the agent.

The key architectural constraint the cron-on-exit design addresses: CLI backends run each turn as a supervisor-spawned detached process group that is `SIGTERM→SIGKILL`'d at turn end. Any process the agent backgrounds via `exec` would die with the turn. The gateway's own supervisor tree is immune because the gateway process itself never exits during normal operation.

### 5.2 Startup Sequence

`openclaw.mjs` calls `ensureSupportedNodeVersion()` first, then computes the compile cache directory, then spawns the actual openclaw entry as a child process with `stdio: "inherit"` and forwarded signals. The gateway boots via `loadServerImpl()` at `src/gateway/server.ts:19-28`, which dynamically imports `server.impl.js`. This is lazy-loading: callers that only need types or lightweight helpers do not pay for the full dependency tree. Startup tracing fires when `OPENCLAW_GATEWAY_STARTUP_TRACE` is set, measuring the time to load `server.impl.js` (1,869 lines).

### 5.3 The 264 Core RPC Methods

The gateway exposes a flat RPC method namespace registered in two stages. **Core methods** are declared in `CORE_GATEWAY_METHOD_SPECS` at `src/gateway/methods/core-descriptors.ts:21-265` — a 265-entry readonly array covering health, diagnostics, channel management, TTS, config, execution approval, plugin approval, wizard/setup, Talk (voice session), commands, models, tools, audit, tasks, environments, worktrees, agents, sessions (22+ methods), heartbeat, wake/system events, node/device pairing (18 methods), cron, gateway identity, messaging, chat, terminal, skills (22 methods), usage/billing, update, secrets, voicewake, artifacts, attach/push, and misc.

**Auxiliary methods** in `GATEWAY_AUX_METHODS` (`src/gateway/server-aux-methods.ts:4-16`) add 11 more for approvals and secrets. **Plugin methods** are dynamically discovered from loaded channel plugins via `listLoadedChannelPlugins()`.

Every method has an explicit authorization scope: `operator.read`, `operator.write`, `operator.admin`, `operator.approvals`, `operator.pairing`, `dynamic`, or `node`. The guard at `core-descriptors.ts:338-344` throws if any handler lacks a policy entry — unclassified handlers cannot be registered. This is a failsafe: no silent permission leaks.

### 5.4 HTTP and WebSocket Surfaces

The HTTP server (`src/gateway/server-http.ts`, 948 lines) serves: the web-based Control UI dashboard, an OpenAI-compatible REST API for model and embedding endpoints, dynamic routes for plugin HTTP handlers, webhook receivers, auth (with three modes: token/password/Tailscale), WebSocket upgrades, a readiness probe for load balancers, and MCP-over-HTTP transport.

The WebSocket protocol surface is defined by the `GATEWAY_EVENTS` constant at `src/gateway/server-methods-list.ts:39-70`:

```
connect.challenge, agent, chat, session.message, session.operation,
session.tool, sessions.changed, presence, tick, talk.mode, talk.event,
shutdown, health, heartbeat, cron, task, node.pair.requested,
node.pair.resolved, node.invoke.request, device.pair.requested,
device.pair.resolved, voicewake.changed, voicewake.routing.changed,
exec.approval.requested, exec.approval.resolved, plugin.approval.requested,
plugin.approval.resolved, terminal.data, terminal.exit, update.available
```

Clients subscribe to specific event streams. WebSocket connections require a valid handshake token validated by `authorizeHttpGatewayConnect`; the upgrade handshake is handled by `connection-auth.ts`.

### 5.5 Multi-Layer Auth

The gateway supports three auth modes configured in `src/config/types.gateway.ts:198-214`:

- **`token`** (default): shared secret validated by `authorizeTokenAuth()` at `src/gateway/auth.ts:562`
- **`password`**: password-based for human operators
- **`Tailscale`**: identity header passthrough when serve mode is enabled

Per-IP rate limiting tracks bootstrap tokens, device tokens, and shared secrets in separate scopes (`src/gateway/auth-rate-limit.ts`). Each channel plugin handles its own authentication (OAuth flows, QR code scans, bot tokens). Device pairing (`device.pair.*`) and node pairing (`node.pair.*`) are separate systems with token rotation and revocation.

The auth profile system at `src/agents/model-auth.ts` maintains OAuth credentials per agent in `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`, with per-provider credential resolution and rotation support.

### 5.6 Lazy Loading Everywhere

The gateway uses `createLazyRuntimeModule()` (`src/shared/lazy-runtime.ts`) to defer expensive imports. Channels follow the same pattern: a lightweight `channel.ts` facade is loaded at startup, and the full `channel.runtime.ts` is loaded only when the channel is activated. This means a gateway configured only for Telegram and iMessage never loads the WhatsApp, Discord, Matrix, or Signal runtime code. Memory usage is proportional to active features.

---

## 6. Agent Runtime

### 6.1 Embedded Agent Runner

The agent runtime is the **embedded agent runner** — a TypeScript module that runs inside the gateway process (and also in CLI mode). The main entry point `runEmbeddedAgent()`:

1. Resolves tools and system prompt (three modes: full/minimal/none)
2. Calls the LLM via provider transport (`provider-transport-stream.ts` or `provider-transport-fetch.ts`)
3. Handles tool calls via `agent-tools.ts` (1,196 lines)
4. Manages context window (embed/compact/rotate)
5. Delivers the reply and waits for the next turn

### 6.2 System Prompt Assembly

`src/agents/system-prompt.ts` (1,425 lines) assembles the system prompt programmatically with three modes: `"full"` (main agent), `"minimal"` (subagents), and `"none"` (identity only). Key composition elements:

- `SYSTEM_PROMPT_CACHE_BOUNDARY` markers split prompt into cache-before/after sections
- Section ordering: Runtime → Tooling → Workspace → Memory → Delegation → Channels → Heartbeat
- Context file priority queue with explicit ordering: `agents.md (10) > soul.md (20) > identity.md (30) > user.md (40) > tools.md (50) > bootstrap.md (60) > memory.md (70)` (`core-descriptors.ts:126-134`)
- Provider-specific contributions via `ProviderSystemPromptContribution` interface
- Dynamic sections from heartbeat prompts and skill workshops

### 6.3 Tool Policy Pipeline

`agent-tools.ts` (1,196 lines) assembles the tool surface in layers:

1. **Gather**: core tools + shell tools + channel tools + OpenClaw tools + plugin tools + MCP tools + Tool Search tools
2. **Apply 6 policy layers**: sandbox → profile → provider → sender → group → subagent

The policy layers at `tool-policy-pipeline.ts`:

| Layer | Source | Label |
|-------|--------|-------|
| `tools.profile` | Profile-specific allow/deny | `tools.profile (<profileName>)` |
| `tools.profile.<provider>` | Profile × provider override | `tools.profile.<provider> (<profile>)` |
| `tools.defaults` / `agents.defaults` | Global / agent default | `tools.defaults` |
| `agents.list[].tools` | Per-agent override | `agents.list[<id>]` |
| `groups` | Per-group policy | `groups (<groupId>)` |
| `senders` / `subagent` | Per-sender / subagent policy | `senders` / `subagent` |

Subagent blocked tools at `agent-tools.policy.ts:50-61`: `gateway`, `agents_list`, `session_status`, `cron`, `sessions_send` are always blocked for child agents.

### 6.4 Subagent Delegation

The subagent system (`subagent-*.ts`, ~30 files) allows the main agent to spawn child sessions:

- **Spawning** — `subagent-spawn.ts` creates subagent sessions with configurable model, workspace, context
- **Registry** — `subagent-registry.ts` persists state in SQLite, tracks lifecycle
- **Lifecycle** — completion, errors, timeout, orphan recovery
- **Delivery** — `subagent-announce-*.ts` delivers results back to the main agent
- **Depth control** — `subagent-depth.ts` limits nesting depth (default cap: 2 levels)
- **Liveness monitoring** — `subagent-run-liveness.ts`, `subagent-run-timeout.ts`

Subagents can use a **different model** than the parent via the `model` parameter. The tool policy pipeline applies to subagents via the `subagent` layer — the parent sees a narrower tool surface.

---

## 7. Channel Adapters (28+ Channels)

### 7.1 The Adapter Interface Architecture

Every OpenClaw channel plugin implements five primary adapter interfaces defined in `src/channels/plugins/types.core.ts` and `src/channels/plugins/types.adapters.ts`:

**`ChannelMessagingAdapter`** (`types.core.ts:494-657`) — the largest interface, handling how the channel handles inbound/outbound message routing, target normalization, session conversation parsing, threading, formatting, and capability discovery.

**`ChannelOutboundAdapter`** (`types.adapters.ts:24-33`) — message delivery: `send()`, `sendPoll()`, `typing()`.

**`ChannelPairingAdapter`** (`types.adapters.ts:47`) — device/account pairing, approval notification, allowlist normalization.

**`ChannelSecurityAdapter`** (`types.adapters.ts:849-885`) — DM policy enforcement, inbound security audit.

**`ChannelThreadingAdapter`** (`types.core.ts:400-454`) — thread/topic management, reply transport resolution.

Plus 10 supporting adapters: `ChannelConfigAdapter`, `ChannelStatusAdapter`, `ChannelDirectoryAdapter`, `ChannelHeartbeatAdapter`, `ChannelApprovalAdapter`, `ChannelLifecycleAdapter`, `ChannelDoctorAdapter`, `ChannelAllowlistAdapter`, `ChannelGroupAdapter`, and `ChannelStreamingAdapter`.

Each channel advertises its capabilities via `ChannelCapabilities`: `chatTypes`, `polls`, `reactions`, `edit`, `unsend`, `reply`, `effects`, `groupManagement`, `threads`, `media`, `tts.voice`, `nativeCommands`, `blockStreaming`.

### 7.2 Major Channels

**Telegram** (`extensions/telegram/`): Bot API with webhook + long polling, inline keyboards, commands, reply keyboards, file uploads, message editing, pinned messages, polls. One of the most fully-featured channels.

**WhatsApp** (`extensions/whatsapp/`): WhatsApp Web via Baileys library + WhatsApp Business API. QR login, media support, group policy, voice notes (transcribed via STT), status updates. Session reconnection with exponential backoff.

**Discord** (`extensions/discord/`): Bot API with WebSocket gateway + REST. Slash commands, message components, embeds, threads, reactions, roles/permissions, guild settings.

**Slack** (`extensions/slack/`): Web API + Event API webhook receiver. Block Kit messages, thread support, slash commands, views (modals, home tabs), scheduled messages, file uploads. Request signature verification for webhook authenticity.

**iMessage** (built-in, `src/channels/imessage/`): Native macOS iMessage via Private.framework (AppleScript/IPC). No bot token required — works with personal Apple ID. CAF audio format preference for Apple's voice memo format. No group chat (iMessage limitation).

**Signal** (`extensions/signal/`): Signal Messenger protocol with sealed sender, group management, note-to-self, voice messages.

**Matrix** (`extensions/matrix/`): Decentralized federated protocol with E2E encryption (Megolm/Olm), room management, threading via `Relation` events, bridge support.

**Google Chat** (`extensions/googlechat/`): REST API + webhooks, space-based model, card messages, threaded replies.

**Microsoft Teams** (`extensions/msteams/`): Bot Framework + Teams API, Adaptive Cards, proactive messaging, Graph API integration.

**SMS** (`extensions/sms/`): Telephony provider bridge (Twilio), text-only.

**Voice Call** (`extensions/voice-call/`): Telephony bridge for phone calls — agent receives transcribed audio and responds via TTS.

**Niche channels**: Feishu (ByteDance), LINE, Mattermost, Nextcloud Talk, Nostr (NIP-01/NIP-04/NIP-28), Synology Chat, Tlon (Urbit), Twitch (IRC), Zalo, QQ Bot, Raft (consensus-based for distributed deployments).

### 7.3 Message Routing

The routing chain for an inbound message:

1. Channel plugin receives message → protocol-specific parsing
2. Session key derivation — `resolveSessionConversation()` maps protocol-specific conversation ID to OpenClaw's session key format: `channel:accountId:conversationId`
3. Binding resolution — `binding-routing.ts` looks up `AgentBinding` for the channel account
4. Agent route resolution — `src/routing/resolve-route.ts:47-70` produces `ResolvedAgentRoute`
5. Session creation/retrieval — gateway creates new session or resumes existing
6. Agent invocation — message added to session history, embedded agent runner produces response

Cross-channel continuity: the agent is identified by `agentId`, not by channel. A user messaging on Telegram and WhatsApp talks to the same agent with access to the same workspace, session history, and memory. The workspace files (`SOUL.md`, `USER.md`, `AGENTS.md`, `memory/`) are shared across all channels for a given agent.

---

## 8. Provider Plugin System

### 8.1 Plugin Manifest as Capability Contract

Provider plugins declare their capabilities in `openclaw.plugin.json`. The `contracts` block at `extensions/openai/openclaw.plugin.json:326-335` declares eight distinct provider capability types:

| Capability | Purpose |
|-----------|---------|
| `speechProviders` | TTS (text-to-speech) |
| `realtimeTranscriptionProviders` | Streaming STT |
| `realtimeVoiceProviders` | Full-duplex realtime voice (Talk) |
| `memoryEmbeddingProviders` | Embeddings for memory search |
| `mediaUnderstandingProviders` | Image and audio understanding |
| `imageGenerationProviders` | Image generation |
| `videoGenerationProviders` | Video generation |
| `usageProviders` | Cost / token usage reporting |

This means a single provider plugin like OpenAI can simultaneously be the chat, TTS, STT, embeddings, vision, image-gen, video-gen, and usage backend — with one OAuth/API-key credential entry.

### 8.2 Provider Inventory

~60 provider plugins exist: `anthropic`, `anthropic-vertex`, `openai`, `google-gemini`, `azure-openai`, `aws-bedrock`, `minimax`, `moonshot`, `deepseek`, `xai`, `groq`, `together`, `fireworks`, `perplexity`, `cohere`, `mistral`, `lmstudio`, `ollama`, `openrouter`, `nvidia`, `cerebras`, `deepinfra`, `voyage`, `voyage`, `huggingface`, and many more. OpenAI-compatible endpoints cover an additional set of custom APIs.

### 8.3 Auth Patterns

Three auth patterns per provider (`extensions/openai/openclaw.plugin.json:283-325`):

| Method | Use case |
|--------|----------|
| `oauth` | ChatGPT/Codex subscription sign-in |
| `device-code` | Browser-based device flow (ChatGPT Device Pairing) |
| `api-key` | Direct API key via `OPENAI_API_KEY` env var |

### 8.4 Model Selection

`src/agents/model-selection.ts` selects the best model per turn based on channel capability requirements, tool schema projections, provider availability with failover, auth profile state, and cost awareness. The provider plugin publishes its model catalog with: `id`, `name`, `reasoning` (boolean), input modalities, `contextWindow`, `maxTokens`, `cost` per 1M tokens, media input specs, and `thinkingLevelMap` for reasoning models.

---

## 9. Memory Subsystem

### 9.1 Three Orthogonal Backends

OpenClaw's memory system has three independent backends:

| Backend | Storage | Search | Primary use case |
|---------|---------|--------|------------------|
| `memory-core` (default) | Per-agent SQLite + vector | FTS5 BM25 + vector + hybrid | Working/durable recall |
| `memory-wiki` | Obsidian-friendly markdown vault | wiki_search, wiki_get, wiki_apply | Provenance-rich knowledge vault |
| `memory-lancedb` | LanceDB | Vector search with auto-recall/capture | Long-term episodic memory |

`memory-wiki` does **not** replace the active memory plugin — it adds a provenance-rich knowledge layer beside it. The same holds for `memory-lancedb`. The three are explicitly non-overlapping.

### 9.2 Memory Core Internals

`extensions/memory-core/src/memory/` contains 85 files. Key components:

- **`hybrid.ts`**: BM25 + vector hybrid search with MMR re-ranking and temporal decay
- **`manager-db.ts`**: SQLite schema management with dedicated schema `"memory_reindex"` and WAL maintenance
- **`embeddings.ts`**: Abstraction over 10+ embedding providers (OpenAI `text-embedding-3-small` default; Bedrock, DeepInfra, Gemini, GitHub Copilot, LM Studio, Mistral, Ollama, Voyage, OpenAI-compatible)
- **`watcher-config.ts` / `watch-pressure.ts` / `watch-settle.ts`**: File-watcher plumbing for re-indexing after editor stops writing
- **`qmd-manager.ts`**: Alternative engine adapter for the QMD backend

The user-facing tools are `memory_search` (semantic + keyword hybrid) and `memory_get` (specific file or line range read). Both are lazily created — the search-manager stack is only loaded when the agent actually calls them.

### 9.3 Pre-Compaction Flush

Before session compaction, `extensions/memory-core/src/flush-plan.ts` builds a **memory flush turn** that runs automatically:

```
"Pre-compaction memory flush. Store durable memories only in memory/YYYY-MM-DD.md..."
```

The flush ensures important facts are saved before context is compressed. `NO_REPLY` is the signal when nothing needs to be stored — the model's empty-reply token so the conversation log stays clean. You can override the flush model per-agent:

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

### 9.4 Dreaming

An optional background consolidation pass (`docs/concepts/memory.md:218-233`): opt-in, scheduled via cron, thresholded by score/recall-frequency/query-diversity gates. Phase summaries and diary entries written to `DREAMS.md` for human review. Two review lanes: **Live dreaming** (from `memory/.dreams/` short-term store) and **Grounded backfill** (from historical `memory/YYYY-MM-DD.md` day files).

---

## 10. Tool Policy Pipeline

### 10.1 Six-Layer Pipeline

The tool surface is built by applying six policy layers in order (`buildDefaultToolPolicyPipelineSteps` at `src/agents/tool-policy-pipeline.ts:57-72`):

1. **Sandbox policy**: allowlist/denylist enforcement for sandboxed execution
2. **Profile policy**: per-user `ToolProfileId` configuration
3. **Provider policy**: `tools.profile.<provider>` overrides
4. **Sender policy**: who is sending the message (DM pairing, allowlist)
5. **Group policy**: group chat restrictions
6. **Subagent policy**: depth limits, blocked tools for child agents

Each step sees the filtered tool list from earlier steps. `filterToolsByPolicy` does the actual filtering per layer with diagnostic events captured via `auditToolPolicyFilter`. The bounded audit cache (256 entries, FIFO eviction) prevents log spam when the same tool is filtered out repeatedly across thousands of turns.

### 10.2 Plugin Tool Group Expansion

`buildPluginToolGroups` buckets tools by their owning plugin. The synthetic allowlist entry `__openclaw_default_plugin_tools__` means "use the default plugin tools for this agent" — it expands at policy application time, so `plugins.allow` slots work without enumerating every tool.

### 10.3 Provider-Specific Restrictions

Some model × provider combinations are restricted by supply chain. For example, `gpt-5.3-codex-spark` is available only through ChatGPT/Codex OAuth; API-key auth cannot use it. The suppression block in the model catalog lists these with the reason and conditions.

---

## 11. Process Supervisor

### 11.1 Supervisor Interface

`ProcessSupervisor` (`src/process/supervisor/types.ts`) is a singleton managing long-running child processes:

```typescript
type ProcessSupervisor = {
  spawn(input: SpawnInput): ManagedRun;
  wait(runId: string): Promise<RunExit>;
  kill(runId: string, gracefulMs?: number): Promise<void>;
  list(scopeKey?: string): ManagedRun[];
};
```

Two adapters at `src/process/supervisor/adapters/`: **`child.ts`** (raw child process for CLI backends, cron jobs) and **`pty.ts`** (PTY-based terminal for interactive shell sessions, Unix pseudoterminal or Windows ConPTY).

### 11.2 Cron-on-Exit

This is OpenClaw's most architecturally novel feature (`DESIGN-cron-on-exit.md`). The problem: CLI backends kill their per-turn process tree at turn end. Any process the agent backgrounds via `exec` dies with the turn.

The solution: `CronSchedule` gains `{ kind: "on-exit"; command: string; cwd?: string }`. The `computeNextRunAtMs()` returns `undefined` for on-exit — time-based timers never fire it. `createCronExitWatchers()` (at `src/gateway/cron-exit-watchers.ts`) owns the watcher lifecycle, backed by `getProcessSupervisor()`. On reconcile, each enabled on-exit job reserves a watcher slot, then spawns via `supervisor.spawn({ mode:"child", scopeKey:"cron-exit:<jobId>", replaceExistingScope:true, captureOutput:true })`. The watcher lives under the **gateway** supervisor tree — immune to per-turn teardown. `await run.wait()` → persist-before-fire (job disabled in store) → then fire via the existing cron run pipeline. **Fail-closed**: if the store write or `wait()` rejects, the job does NOT fire — preventing double-fire on gateway restart.

### 11.3 Scope Keys and Cleanup

Processes are scoped by `scopeKey`: `"cron-exit:<jobId>"` for cron-on-exit watchers, `"shell:<sessionId>"` for interactive shell sessions, `"exec:<sessionId>"` for agent exec calls. The supervisor's scope key system allows cleanup of all processes belonging to a given scope in one call.

---

# Part III: Cross-Platform Distribution

## 12. macOS App

The macOS app is **native Swift/SwiftUI** — not Electron, not Tauri. It lives under `apps/macos/` with a `Package.swift` declaring SwiftPM products. The app is a **menu bar companion**: no Dock icon by default, status menu with notifications, health monitoring, WebChat, voice input, Canvas, and Mac-hosted node tools.

Key capabilities owned by the macOS app: TCC permission prompts (screen, microphone, speech, automation, accessibility), local node tools (Canvas, camera/screen capture, notifications, `system.run`), exec approval prompts for Mac-hosted commands, remote-mode SSH tunnels or direct gateway connections, and Sparkle auto-update.

The bundled gateway runs under a **per-user launchd service** (`ai.openclaw.gateway` label). Quitting the app does **not** stop the gateway — launchd keeps it alive. Logging goes to `~/Library/Logs/openclaw/gateway.log`.

Sparkle auto-update: the appcast feed is at the repo root. `<sparkle:version>` is integer-encoded `YYYYMMDDHHMM` build number; `<sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>` — **macOS 15.0+ required**.

## 13. Windows Hub

Windows gets a **native WinUI app** — `OpenClawCompanion-Setup-x64.exe` and `OpenClawCompanion-Setup-arm64.exe`. Positioned as the recommended Windows entry point.

Features: system tray + launch-at-login, first-run setup for a local WSL gateway, native chat window, Command Center diagnostics, local MCP server mode for MCP clients (Claude Desktop, Claude Code, Cursor), Windows node mode with Canvas, screen, camera, notifications, device status, Talk, and `system.run`.

**WSL2 is recommended** for the gateway on Windows. The guidance includes `dbus-launch true` instead of `/bin/true` to keep WSL ≥ 2.6.1.0 distros alive after the last client exits, and `/ru "$env:USERNAME"` instead of `/ru SYSTEM` because per-user WSL distros are not visible to the SYSTEM account.

Local MCP server mode on loopback: Windows Hub can run as a local MCP server so Claude Desktop or Cursor can drive Windows capabilities without running an OpenClaw gateway.

## 14. iOS and Android Apps

Both the iOS and Android apps are **companion nodes** — they connect to the gateway over WebSocket, they do not host the gateway themselves.

**iOS app** (`apps/ios/`): Swift + WKWebView. Capabilities: Canvas, Screen snapshot, Camera capture, Location, Talk mode, Voice wake, `node.invoke` commands, read-only Agents Files browser, small offline session cache, durable per-gateway outbox (50 messages, 48-hour expiry), "Listen" long-press action for TTS playback. Discovery: Bonjour on `local.` for same-LAN gateways, Tailnet via unicast DNS-SD, manual host/port fallback. iOS Talk mode opens directly to OpenAI Realtime via WebRTC by default (`TalkRealtimeWebRTCSession.swift:23` default offer URL = `https://api.openai.com/v1/realtime/calls`).

**Android app** (`apps/android/`): Native Kotlin. Connection via direct WebSocket to gateway. Foreground service (`FOREGROUND_SERVICE_CONNECTED_DEVICE`) keeps the connection alive. Android 14+ requires `FOREGROUND_SERVICE_MICROPHONE` + `RECORD_AUDIO` for Talk Mode. Voice wake is **implemented in source but forced to `off`** on connect in the shipping app — no user-facing toggle today. Talk Mode uses native speech recognition by default, with Gateway relay available when configured.

**Android notification forwarding**: The Android app can forward device notifications to the gateway as `node.event` items with allowlist/blocklist filtering, quiet hours, and per-minute rate limits.

## 15. Node Mode

A node is a companion device (macOS/iOS/Android/headless) that connects to the gateway WebSocket with `role: "node"` and exposes a command surface via `node.invoke`. The gateway host runs the model; the node host executes the commands.

```bash
openclaw node run --host <gateway-host> --port 18789 --display-name "Build Node"
```

Node commands are gated by platform allowlists: iOS gets `camera.list`, `location.get`, `device.info`, `contacts.search`, `calendar.events`, `reminders.list`, `photos.latest`; Android adds `notifications.list`, `notifications.actions`, `device.apps`, `callLog.search`; macOS gets the full set; Linux gets only `system.notify`. Privacy-heavy commands (`camera.snap`, `camera.clip`, `screen.record`, `contacts.add`, `calendar.add`, `reminders.add`, `sms.send`) require explicit `gateway.nodes.allowCommands` opt-in.

Approval binding: node exec runs prepare a canonical `systemRunPlan` before approval; once granted, the gateway forwards that stored plan (not any later caller-edited fields) and re-validates the working directory before running. The gateway accepts authenticated node clients across an **N-1 protocol window** — current v4 gateway accepts v3 nodes.

## 16. Docker and Nix Deployment

**Docker**: Four-stage build (`Dockerfile:1-358`) targeting `node:24-bookworm-slim`. Multi-stage: workspace-deps → bun-binary → build → runtime-assets → final runtime. Base images pinned to SHA256 digests. Ports: 18789 (gateway), 18790 (bridge), 3978 (MS Teams). Supports `OPENCLAW_INSTALL_DOCKER_CLI=1` for Docker-in-Docker sandbox and `OPENCLAW_INSTALL_BROWSER=1` for Chromium (~300MB). Non-root `node` user. GHCR primary (`ghcr.io/openclaw/openclaw`), Docker Hub mirror.

**Nix**: First-party `nix-openclaw` repo via Home Manager. When `OPENCLAW_NIX_MODE=1` is set, OpenClaw enters deterministic mode: auto-install/self-mutate disabled, `openclaw.json` treated as immutable, config writers refuse to edit. Rollback via `home-manager switch --rollback`. Service PATH auto-discovery from Nix profiles.

---

# Part IV: Voice + Canvas

## 17. Realtime Voice Pipeline

### 17.1 Talk Session Architecture

The Talk / voice subsystem lives under `src/talk/` plus five provider plugins: `extensions/talk-voice/`, `extensions/deepgram/`, `extensions/elevenlabs/`, `extensions/gradium/`, `extensions/tts-local-cli/`.

The architecture:

```
User audio
  → Transport (native app: macOS/iOS/Android)
    → Talk Session Controller
      → RealtimeVoiceBridge (provider plugin)
        → audioSink (transport-side playback)
        → transcript / tool-call events
      → Agent Consult (background agent invocation)
        → TTS synthesis (provider plugin)
          → audioSink → playback → User
```

Four orthogonal transport shapes (`src/talk/provider-types.ts:179-183`):

- **WebRTC SDP** — browser / iOS native, peer-connection media + data channel
- **Provider WebSocket with JSON-over-PCM** — browser-only
- **Gateway relay** — PCM audio via Gateway WebSocket, used for headless clients
- **Managed room** — LiveKit-style rooms

The provider capability table (`RealtimeVoiceProviderCapabilities`) advertises the union of supported transports plus flags for `supportsBrowserSession`, `supportsBargeIn`, `supportsToolCalls`, `supportsVideoFrames`, `supportsSessionResumption`.

### 17.2 Bridge Session Lifecycle

`createRealtimeVoiceBridgeSession(params)` (`src/talk/session-runtime.ts:75-158`) is the factory for one realtime voice session. The facade returned is stable while blocking use until the bridge is returned — callbacks may fire during `createBridge()`. The audio sink (`RealtimeVoiceAudioSink`) is the boundary between provider audio and transport playback; a closed sink swallows provider events rather than crashing the session.

Mark-strategy is centralized at the bridge boundary with three modes: `transport` (let transport ack), `ack-immediately` (call `acknowledgeMark()` synchronously), or `ignore` (drop the mark entirely). This keeps provider implementations transport-agnostic.

### 17.3 Agent Consult Runtime

`src/talk/agent-consult-runtime.ts` (368 lines) bridges realtime voice into the agent runtime. When the realtime provider calls the `openclaw_agent_consult` tool, the consult runtime forks a child session and runs the agent against a transcript slice.

Two modes: **`isolated`** (fresh session for the consult, default for cross-agent/cross-user) and **`fork`** (fork from the requester's session, preserving context). Delivery-context resolution walks three candidate keys in order: requester session key, base thread key, voice consult session key.

### 17.4 Gateway Realtime Relay

`src/gateway/talk-realtime-relay.ts` (1,039 lines) is the gateway-side bridge for browser-side `gateway-relay` sessions. Key constants:

| Constant | Value | Purpose |
|----------|-------|---------|
| `RELAY_SESSION_TTL_MS` | 30 minutes | Idle expiry per relay session |
| `MAX_AUDIO_BASE64_BYTES` | 512 KB | Hard cap per audio chunk |
| `MAX_RELAY_SESSIONS_PER_CONN` | 2 | Concurrency cap per WebSocket connection |
| `MAX_RELAY_SESSIONS_GLOBAL` | 64 | Global concurrency cap |
| `FORCED_CONSULT_FALLBACK_DELAY_MS` | 200 ms | Delay before forcing an agent consult |
| `FORCED_CONSULT_RESULT_MAX_CHARS` | 1800 | Length cap on forced-consult tool text |

## 18. STT/TTS Plugins

**Deepgram** (`extensions/deepgram/`): Batch transcription (POST to `https://api.deepgram.com/v1/listen` with `nova-3` model) and realtime WebSocket streaming with encoding normalization (aliases `pcm`, `pcm_s16le`, `linear16` → `linear16`; `ulaw`, `g711_ulaw` → `mulaw`).

**ElevenLabs** (`extensions/elevenlabs/`): TTS with defaults — voice ID `pMsXgVXv3BLzUgSXRplE`, model `eleven_multilingual_v2`. Supported models: `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`, `eleven_flash_v2`, `eleven_turbo_v2_5`, `eleven_turbo_v2`. Streaming latency tier 0–4; auto-disabled for `eleven_v3` since that model doesn't support streaming.

**macOS MLX TTS** (`apps/macos-mlx-tts/`): Separate SwiftPM target exposing Apple-Silicon-local TTS via `TalkMLXSpeechSynthesizer`. Bundled into the macOS app rather than exposed as standalone because MLX runtime is private to Apple Silicon.

## 19. Voice Wake

### 19.1 macOS Voice Wake

macOS voice wake constants at `docs/platforms/mac/voicewake.md:19-27`:

| Constant | Value |
|----------|-------|
| `triggerPauseWindow` | 0.55 s — minimum gap between wake word and first captured word |
| `silenceWindow` | 2.0 s — silence timeout while speech is flowing |
| `triggerOnlySilenceWindow` | 5.0 s — silence timeout if only wake word heard |
| `captureHardStop` | 120 s — hard stop to prevent runaway sessions |
| `debounceAfterSend` | 350 ms — debounce between sessions after a send |

Voice Wake and push-to-talk require **macOS 26+**. The recognizer runs on-device via Speech.framework — zero network usage. The audio tap on `VoiceWakeManager` enqueues `AVAudioPCMBuffer.deepCopy()` copies onto a thread-safe `AudioBufferQueue` because the tap callback fires on a realtime audio thread. The push-to-talk hotkey (`.flagsChanged` monitor on keyCode 61 with `.option` flag) observes but never swallows events — it activates while the wake overlay is up and preserves the wake text.

### 19.2 Swabble — Standalone Wake Daemon

`apps/swabble/` is a separate Swift package shipping a CLI wake daemon and shared library. Default wake word: `clawd` with alias `claude`. Local-only: *Speech.framework on-device models; zero network usage.* Pipeline: `AVAudioEngine` → `SpeechAnalyzer` → `SpeechTranscriber`. The `WakeWordGate` library (`apps/swabble/Sources/SwabbleKit/WakeWordGate.swift:21-35`) implements the shared wake-gating library: match trigger → wait post-gap → accept command of at least one character. Same `SwabbleKit` is consumed by the macOS app's voice overlay and iOS's `VoiceWakeManager`.

### 19.3 iOS Voice Wake

`apps/ios/Sources/Voice/VoiceWakeManager.swift` mirrors the macOS lifecycle. However, the **Android shipping app forces Voice Wake to `off`** on connect — *"Voice wake is implemented in source (`VoiceWakeMode`) but the shipping app runtime always forces it to `off` on connect — there is no user-facing toggle today"* (`docs/platforms/android.md:281`). The source exists; the toggle does not.

## 20. Canvas System

### 20.1 What Canvas Is

Canvas is an agent-controlled HTML/CSS/JS rendering surface embedded in the native apps. The macOS app uses WKWebView; iOS and Android use their platform WebView equivalents. The agent drives Canvas through WebSocket commands registered by the `canvas` plugin:

```
canvas.present  canvas.hide     canvas.navigate  canvas.eval
canvas.snapshot  canvas.a2ui.push  canvas.a2ui.reset
```

Canvas files live at `~/Library/Application Support/OpenClaw/canvas/<session>/` on macOS. The panel is borderless, resizable, anchored near the menu bar, remembers size/position per session, and auto-reloads when local Canvas files change.

### 20.2 URL Scheme and A2UI

Custom URL scheme `openclaw-canvas://<session>/<path>` maps to local files without hitting the network. Directory traversal is blocked. A2UI v0.8 is the JSONL command protocol the agent uses to push UI updates to the Canvas. The Canvas plugin registers three HTTP routes: `/__openclaw__/a2ui`, `/__openclaw__/canvas`, and `/__openclaw__/ws` (WebSocket for live reload).

### 20.3 macOS Canvas Window

`CanvasWindowController.swift` sets `developerExtrasEnabled`, registers a `WKURLSchemeHandler` for `openclaw-canvas://` URLs, and injects a bridge script that listens for `a2uiaction` events on the page and forwards them via `webkit.messageHandlers.openclawCanvasA2UIAction.postMessage(...)`. The bridge falls back gracefully when `globalThis.openclawA2UI` or `<openclaw-a2ui-host>` is present; it fails **closed** when neither native handler nor bundled shell is available — preventing unattended deep-link credential exposure.

### 20.4 Canvas + Voice Combined

The agent can drive both Canvas and voice in the same turn because both are first-class node commands in the same WebSocket surface. Combined patterns:

- **Voice-controlled UI**: `talk.speak` reads a UI affordance aloud while `canvas.present` shows it
- **Live transcription display**: transcript events pushed to Canvas `<div>` via `canvas.eval`
- **Interactive voice agent with visual feedback**: agent speaks through Talk, captures input via Voice Wake, pushes next UI state via `canvas.a2ui.push`
- **Canvas → Agent deep links**: Canvas HTML can call `openclaw://agent?message=...` to trigger a new agent run (macOS app prompts for confirmation unless valid key provided)

### 20.5 Platform Comparison

| Layer | macOS | iOS | Android |
|-------|-------|-----|---------|
| Renderer | WKWebView | WKWebView | Platform WebView |
| URL scheme | `openclaw-canvas://` | Hosted at gateway:18789 | Hosted at gateway:18789 |
| A2UI | Bundled + remote | Bundled + remote (render-only remote) | Bundled + remote (render-only remote) |
| Live reload | WebSocket `/__openclaw__/ws` | Same injected snippet | Same injected snippet |
| File watcher | `CanvasFileWatcher` | Gateway-side | Gateway-side |
| Background | Always foreground | Foreground only | Foreground only |

---

# Part V: Operational Characteristics

## 21. Strengths and Killer Features

**Most complete consumer-facing harness.** OpenClaw is the only harness in the survey with native apps on four platforms (macOS, Windows, iOS, Android), 28+ channel integrations, real-time voice, and an agent-controlled visual canvas. This is not a developer tool — it is a product.

**The Gateway as control plane.** The architectural separation of concerns (gateway owns long-lived state, agent runtime is per-turn) is the correct design for an always-on system. It enables the gateway to survive agent crashes, maintain 28+ channel connections simultaneously, and serve as the single source of truth for auth, routing, and scheduling.

**Plugin SDK with formal contracts.** 538 typed interface files define the plugin contract. The `openclaw/plugin-sdk/*` subpath import rule is enforced by import cycle checks. This is not a "we hope plugin authors read the source" SDK — it is a first-class, type-safe, 500+-file typed API surface.

**Multi-layer tool policy.** Six stacked policy layers (sandbox → profile → provider → sender → group → subagent) applied in order, with explicit scope enforcement on every RPC method. The policy pipeline is the most sophisticated permission system in the survey.

**Three-memory-backend architecture.** Core (embedding + SQLite), Wiki (provenance-rich vault), LanceDB (long-term episodic). The explicit non-overlapping roles prevent the "which memory backend am I using?" confusion that plagues single-memory-layer systems.

**Cron-on-exit.** The most architecturally novel scheduling primitive in the survey. Solving the "background job dies with the CLI turn" problem with a gateway-supervisor-owned watcher is elegant, correct, and not replicated elsewhere.

**60+ provider plugins with eight-capability manifests.** A single OpenAI plugin simultaneously declaring speech, STT, realtime voice, embeddings, vision, image-gen, video-gen, and usage contracts is a more disciplined multi-capability declaration than any other system.

## 22. Weaknesses

**Package sprawl.** 142 packages, 148 extensions, 60+ provider plugins. The `src/plugin-sdk/` directory alone has 538 files. This is the cost of the "formal SDK with typed contracts" approach — every interface, every helper, every adapter type must be declared, exported, and maintained. The update burden for plugin authors is significant; the maintenance burden for the core team is presumably full-time.

**82 releases/year.** At roughly one release every 4-5 days, the update train is relentless. The `YYYY.M.PATCH` versioning strategy and multi-channel update system (stable, beta, extended-stable, dev) provide knobs, but the volume of updates creates a moving target for documentation and community support.

**iOS/Android Voice Wake gated.** Voice wake is in source for iOS and Android but not exposed in the shipping apps. Android explicitly forces `off` on connect. This creates a feature discrepancy between macOS (fully functional) and mobile (implemented but unavailable).

**No WASM sandboxing.** OpenFang's WASM dual-metered sandbox (fuel + epoch) provides stronger isolation for untrusted tool code than OpenClaw's sandbox modes. OpenClaw's sandbox is configuration-level (`mode: "all"`), not execution-level.

**No autonomous learning loop.** Unlike Hermes (which has a full Curator-driven skill improvement system), OpenClaw has skill workshops but no background review, no usage tracking per skill, no auto-transition between skill states. The infrastructure exists; the autonomous loop does not.

**Windows WSL2 dependency.** The recommended path for Windows users is WSL2 for the gateway. While this is reasonable for developers, non-technical users who just want the native companion app may not have WSL2 set up, and the onboarding complexity is higher than on macOS (where the app installs its own runtime silently).

## 23. Target Audience

OpenClaw targets **general users who want an always-on personal AI across all their messaging platforms and devices**. It is the harness for someone who wants to message their AI on Telegram while commuting, ask it to set a reminder via iMessage, check something on WhatsApp while at a computer, and control their smart home — all from the same AI that knows their preferences and memory.

It is less suited for developers who want a coding harness (see SWE-agent, Cline, or OpenHands for that use case), for teams who need organizational multi-agent coordination (see LangGraph or CrewAI for that), or for researchers who want a benchmark harness (see SWE-agent for that).

## 24. Production Readiness

OpenClaw is the most **production-ready consumer-facing** harness in the survey. The 19 security audit modules cover channel security, exec safety, config safety, plugin code safety, SSRF protection, and secrets masking. The multi-layer tool policy with explicit scope enforcement on every RPC method is defense in depth, not theater.

The 264-method RPC surface with per-method scope declarations means every entry point has an explicit permission check. The fail-closed cron-on-exit design prevents double-firing. The per-channel security adapter with `resolveDmPolicy` means WhatsApp DMs are not open to the world by default.

However: the 82 releases/year create an upgrade cadence that is aggressive for production deployments. The `extended-stable` channel helps, but organizations that pin versions tightly may find the update velocity challenging.

---

# Part VI: Bizar Application

## 25. Top 5 Patterns to Adopt from OpenClaw

### 1. Gateway-Mediated Separation of Long-Lived and Per-Turn State

OpenClaw's architectural insight — the gateway owns auth, routing, channel connections, and cron; the agent runtime spins up per turn — is the correct design for an always-on system. Bizar's current architecture (single process, always-on CLI) does not need this separation for CLI-only use, but the **Bizar Gateway** recommendation from Round 3 (`bizar-alignment.md` §B.2) should adopt this pattern: a long-lived gateway process that owns auth and routing, with agent dispatch as a downstream per-turn service.

### 2. Multi-Layer Tool Policy Pipeline

OpenClaw's six-layer tool policy pipeline (sandbox → profile → provider → sender → group → subagent) applied in order, with explicit scope enforcement, is the most sophisticated permission system in the survey. Bizar's current per-agent permission rules in `config/opencode.json` are a single-layer allowlist/denylist. The multi-layer pipeline pattern should be adopted: apply sandbox constraints first, then user profile, then provider restrictions, then sender identity, then group policy, then subagent depth.

### 3. Cron-on-Exit for Background Jobs

The cron-on-exit design (`DESIGN-cron-on-exit.md`) solves a real problem: background jobs spawned by an agent turn die when the turn ends because the CLI backend tears down its process group. The gateway-supervisor-owned watcher pattern (persist-before-fire, fail-closed) is the correct solution and should be adapted for Bizar's scheduler when implemented.

### 4. Three-Orthogonal-Backend Memory Architecture

OpenClaw's explicit rule that `memory-wiki` sits **beside** `memory-core` rather than replacing it, and that `memory-lancedb` adds a third independent layer, is a cleaner mental model than "one memory backend to rule them all." Bizar's existing memory stack (`.bizar/memory.json` working memory, Obsidian vault durable, LightRAG semantic) maps to this pattern already — the lesson is to make the separation explicit in the documentation and to resist the pressure to unify them.

### 5. Plugin SDK with Formal Typed Contracts

OpenClaw's 538-file Plugin SDK with enforced import boundaries (`openclaw/plugin-sdk/*` only) is the right model for Bizar's planned SDK (`packages/sdk/`). The key insight is that the SDK must be **typed, enforced by tooling** (import cycle checks), and cover every capability surface (channels, providers, memory backends, tools). Bizar's SDK should follow the same entry-point discipline: `bizar/sdk/core`, `bizar/sdk/agent`, `bizar/sdk/tool`, `bizar/sdk/channel`.

## 26. Top 3 Things to Avoid

### 1. OpenClaw's Package Sprawl

OpenClaw's 142 packages and 538 SDK files are the cost of its comprehensive typed contract system. Bizar should adopt the **typed contract discipline**, not the package count. A SDK with 20-30 files covering the core interfaces (agent definition, tool registration, hook lifecycle, channel contract) is sufficient. Adding packages for every minor capability creates maintenance burden that compounds over time.

### 2. 82 Releases per Year

OpenClaw's release cadence is aggressive — one release every 4-5 days. For a consumer product with native apps requiring store review, this may be necessary. For a coding harness that users install via npm and expect to be stable for months, this cadence is destabilizing. Bizar should target a **monthly stable train** (matching OpenClaw's `YYYY.M.PATCH` convention but with one patch per month, not one every 4-5 days) and communicate that clearly.

### 3. Platform-Specific Feature Gaps

Android forcing Voice Wake to `off` despite having the source implemented is a pattern to avoid: feature parity across platforms should be a first-class concern, not a deferred item. If a feature is implemented, it should be available on all platforms; if it cannot be available, the source should not include it (or it should be behind an explicit compile-time flag). Shipping implemented-but-hidden features creates maintenance burden and user confusion.

## 27. Migration Considerations

Bizar adopting OpenClaw patterns should be gradual and phased:

**Phase 1** (0-3 months): Adopt the tool policy pipeline (multi-layer, explicit scopes) and the three-backend memory model documentation. These are architectural patterns that cost little to adopt and clarify existing Bizar code.

**Phase 2** (3-9 months): Build the Bizar Gateway (long-lived process for auth + routing, with CLI dispatch as downstream), adopt the cron-on-exit pattern for the scheduler, and formalize the Plugin SDK with typed contracts.

**Phase 3** (9-18 months): Build the multi-channel gateway (Telegram + Discord as v1), adopt the trajectory capture pattern, and implement the knowledge graph as an agent-writeable tool.

**What not to adopt**: 148 extensions, 60+ providers, 538 SDK files, the 82-release/year cadence, or the native app ecosystem. Bizar's scope as a coding harness is narrower than OpenClaw's scope as a personal assistant OS — that narrowing is a feature, not a limitation.

---

## Source References

All claims in this report are verified against the captured OpenClaw source snapshot (commit 2026-07-06). Key file references:

| Claim | Source |
|-------|--------|
| Gateway entry + Node version check | `openclaw.mjs:11-58` |
| Process supervisor singleton | `src/process/supervisor/index.ts:8` |
| Lazy server import with tracing | `src/gateway/server.ts:19-28` |
| Server impl (1,869 lines) | `src/gateway/server.impl.ts:1-1869` |
| Core method specs (264 methods) | `src/gateway/methods/core-descriptors.ts:21-265` |
| Gateway events (WebSocket) | `src/gateway/server-methods-list.ts:39-70` |
| Auth modes | `src/config/types.gateway.ts:198-214` |
| Cron-on-exit design | `DESIGN-cron-on-exit.md:1-29` |
| System prompt (1,425 lines) | `src/agents/system-prompt.ts:1-1425` |
| Agent tools (1,196 lines) | `src/agents/agent-tools.ts:1-1196` |
| Tool policy pipeline | `src/agents/tool-policy-pipeline.ts:1-263` |
| Session routing | `src/routing/resolve-route.ts:47-70` |
| Plugin SDK entry points | `src/plugin-sdk/AGENTS.md` |
| Channel adapter interfaces | `src/channels/plugins/types.adapters.ts:1-885` |
| Memory Core plugin | `extensions/memory-core/index.ts:1-228` |
| Memory Wiki | `extensions/memory-wiki/index.ts:1-79` |
| Memory LanceDB | `extensions/memory-lancedb/index.ts:1-2023` |
| Talk session runtime | `src/talk/session-runtime.ts:75-158` |
| Gateway realtime relay | `src/gateway/talk-realtime-relay.ts:1-1039` |
| macOS voice wake | `docs/platforms/mac/voicewake.md:19-27` |
| Canvas plugin | `extensions/canvas/index.ts:1-145` |
| A2UI validation | `extensions/canvas/src/a2ui-jsonl.ts:1-95` |
| Canvas macOS doc | `docs/platforms/mac/canvas.md:1-116` |
| Cross-platform summary | `docs/platforms/macos.md`, `docs/platforms/windows.md`, `docs/platforms/ios.md`, `docs/platforms/android.md` |
| Node mode | `docs/nodes/index.md:1-494` |
| Docker | `Dockerfile:1-358`, `docker-compose.yml:1-129` |
| Nix deployment | `docs/install/nix.md:1-109` |
| Provider manifest | `extensions/openai/openclaw.plugin.json:1-379` |
| Subagent blocked tools | `src/agents/agent-tools.policy.ts:50-61` |

---

*This report was synthesized from six rounds of deep-dive research across the OpenClaw codebase and cross-referenced with Hermes Agent and OpenFang from the broader agent harness survey. It represents the state of the OpenClaw project as of commit 2026-07-06.*
