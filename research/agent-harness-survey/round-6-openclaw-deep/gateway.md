# OpenClaw Gateway — Deep Architecture Analysis

**Round:** 6 of 15 (OpenClaw Deep Dive)  
**Scope:** Gateway architecture, RPC methods, HTTP/WS surfaces, auth, process supervisor, plugin SDK  
**Sources:** `src/gateway/`, `src/plugin-sdk/`, `src/process/`, `src/agents/embedded-agent-runner/`, `DESIGN-cron-on-exit.md`  
**Date:** 2026-07-06

---

## 1. The Gateway — What Is It?

The Gateway is OpenClaw's **central control plane**: a local HTTP/WebSocket server that owns authentication, routing, session management, channel lifecycle, plugin supervision, and cron scheduling. The actual AI agent runs downstream in the **agent runtime**, which connects to the gateway as a client. This separation means the gateway is always-on (surviving individual agent turns) while the agent runtime spins up and tears down per conversation.

### 1.1 Process Model

The gateway runs as a **single Node.js process** (`getProcessSupervisor()` is a singleton at `src/process/supervisor/index.ts:8`). It is started by `openclaw.mjs` (the CLI entry point at `openclaw.mjs:1`), which validates the Node.js version (requires ≥22.19.0, recommends 24), sets up the compile cache, and spawns the actual gateway child process with forwarded signals. The gateway process itself never exits during normal operation — it persists across agent turns.

The key insight from `DESIGN-cron-on-exit.md:5` is that CLI backends (which run each agent turn) **kill their own detached process group at turn end** via `SIGTERM→SIGKILL`. The gateway is immune to this because it owns its own long-lived supervisor tree. Any process the gateway spawns (including cron-on-exit watchers) survives per-turn teardown.

### 1.2 Startup Sequence

`openclaw.mjs` at line 61 calls `ensureSupportedNodeVersion()` first. The launcher then:
1. Computes a compile cache directory under `/tmp/node-compile-cache/openclaw/<version>/`
2. Spawns the actual openclaw entry as a child process with `stdio: "inherit"`
3. Forwards `SIGTERM`, `SIGINT`, `SIGHUP`, `SIGQUIT` (or `SIGTERM`, `SIGBREAK` on Windows) to the child
4. Applies a 1-second grace period before force-killing, then another 1-second hard-exit grace

The actual gateway boots via `loadServerImpl()` at `src/gateway/server.ts:19-28`, which dynamically imports `server.impl.js`. This is the lazy-loading pattern: callers that only need types or lightweight helpers do not pay for the full dependency tree.

### 1.3 What the Gateway Owns

The gateway owns these responsibilities that must survive per-turn CLI teardown:
- **Auth state** — token validation, device pairing, session identity
- **Channel connections** — long-lived WebSocket connections to Telegram bots, Discord webhooks, WhatsApp sessions
- **Cron scheduling** — time-based and event-based job triggers
- **Process supervisor** — the singleton `ProcessSupervisor` at `src/process/supervisor/index.ts:8`
- **Session store** — SQLite-backed session history across turns
- **Plugin registry** — loaded plugin state and configuration

---

## 2. The 90+ RPC Methods

The gateway exposes a flat RPC method namespace. The canonical registry is built in two stages:

1. **Core methods** — declared in `CORE_GATEWAY_METHOD_SPECS` (`src/gateway/methods/core-descriptors.ts:21-265`), a 265-entry readonly array
2. **Auxiliary methods** — listed in `GATEWAY_AUX_METHODS` (`src/gateway/server-aux-methods.ts:4-16`), 11 additional methods for approvals and secrets
3. **Plugin methods** — dynamically discovered from loaded channel plugins via `listLoadedChannelPlugins()` (`src/gateway/server-methods-list.ts:18-28`)

### 2.1 Method Categories

The 264 named core methods in `CORE_GATEWAY_METHOD_SPECS` (`core-descriptors.ts:21-265`) fall into these categories:

**Health & Diagnostics (4 methods)**
`health`, `diagnostics.stability`, `doctor.memory.*` (7 methods), `logs.tail` — read-only system health

**Channel Management (5 methods)**
`channels.status`, `channels.start`, `channels.stop`, `channels.logout` — admin-only lifecycle control for messaging channels

**TTS (Voice) (11 methods)**
`tts.status`, `tts.providers`, `tts.personas`, `tts.enable`, `tts.disable`, `tts.convert`, `tts.setProvider`, `tts.setPersona`, `tts.speak` — full TTS pipeline control

**Config (8 methods)**
`config.get`, `config.set`, `config.patch`, `config.apply`, `config.schema`, `config.schema.lookup`, `config.openFile` — gateway and agent configuration

**Execution Approval (11 methods)**
`exec.approval.get`, `exec.approval.list`, `exec.approval.request`, `exec.approval.waitDecision`, `exec.approval.resolve`, `exec.approvals.get`, `exec.approvals.set`, `exec.approvals.node.get`, `exec.approvals.node.set` — interactive approval for dangerous tool calls

**Plugin Approval (4 methods)**
`plugin.approval.list`, `plugin.approval.request`, `plugin.approval.waitDecision`, `plugin.approval.resolve`

**Plugin Management (1 method)**
`plugins.uiDescriptors`, `plugins.sessionAction`

**Wizard / Setup (5 methods)**
`wizard.start`, `wizard.next`, `wizard.cancel`, `wizard.status`, plus Crestodian (`crestodian.chat`, `crestodian.setup.detect`, `crestodian.setup.activate`)

**Talk (Voice Session) (18 methods)**
`talk.catalog`, `talk.config`, `talk.client.create`, `talk.client.toolCall`, `talk.client.steer`, `talk.session.create`, `talk.session.join`, `talk.session.appendAudio`, `talk.session.startTurn`, `talk.session.endTurn`, `talk.session.cancelTurn`, `talk.session.cancelOutput`, `talk.session.submitToolResult`, `talk.session.steer`, `talk.session.close`, `talk.speak`, `talk.mode` — full voice session lifecycle

**Commands (1 method)**
`commands.list`

**Models & Providers (5 methods)**
`models.list` (startup: true), `models.authStatus`, `models.authLogout` — model discovery and auth management

**Tools (3 methods)**
`tools.catalog`, `tools.effective` (startup: true), `tools.invoke`

**Audit (1 method)**
`audit.list`

**Tasks (3 methods)**
`tasks.list`, `tasks.get`, `tasks.cancel`

**Environments (2 methods)**
`environments.list`, `environments.status`

**Worktrees (5 methods)**
`worktrees.list`, `worktrees.create`, `worktrees.remove`, `worktrees.restore`, `worktrees.gc` — git worktree management for multi-agent repo work

**Agents (8 methods)**
`agents.list`, `agents.create`, `agents.update`, `agents.delete`, `agents.files.list`, `agents.files.get`, `agents.files.set`, `agents.workspace.list`, `agents.workspace.get` — multi-agent workspace management

**Sessions (22+ methods)**
`sessions.list`, `sessions.subscribe`, `sessions.unsubscribe`, `sessions.messages.subscribe`, `sessions.messages.unsubscribe`, `sessions.preview`, `sessions.describe`, `sessions.compaction.list`, `sessions.compaction.get`, `sessions.compaction.branch`, `sessions.compaction.restore`, `sessions.create`, `sessions.send`, `sessions.abort`, `sessions.patch` (dynamic scope), `sessions.pluginPatch`, `sessions.cleanup`, `sessions.reset`, `sessions.delete`, `sessions.compact`, `sessions.get`, `sessions.resolve`, `sessions.usage`, `sessions.usage.timeseries`, `sessions.usage.logs` — full session lifecycle and persistence

**Heartbeat (2 methods)**
`last-heartbeat`, `set-heartbeats`

**Wake / System Events (2 methods)**
`wake`, `system-presence`, `system-event`

**Node/Device Pairing (18 methods)**
`node.pair.request`, `node.pair.list`, `node.pair.approve`, `node.pair.reject`, `node.pair.remove`, `node.pair.verify`, `node.rename`, `node.list`, `node.describe`, `node.pluginSurface.refresh`, `node.pending.drain`, `node.pending.enqueue`, `node.invoke`, `node.pending.pull`, `node.pending.ack`, `node.invoke.result`, `node.event`; plus `device.pair.list`, `device.pair.approve`, `device.pair.reject`, `device.pair.remove`, `device.token.rotate`, `device.token.revoke`, `device.pair.setupCode`

**Cron (6 methods)**
`cron.get`, `cron.list`, `cron.status`, `cron.add`, `cron.update`, `cron.remove`, `cron.run`, `cron.runs`

**Gateway Identity (2 methods)**
`gateway.identity.get`, `gateway.restart.preflight`, `gateway.restart.request`

**Messaging / Send (3 methods)**
`message.action`, `send`, `agent` — agent invocation and message dispatch

**Chat (8 methods)**
`agent.wait`, `chat.history`, `chat.startup`, `chat.metadata`, `chat.message.get`, `chat.abort`, `chat.send`, `chat.inject`

**Terminal (8 methods)**
`terminal.open`, `terminal.input`, `terminal.resize`, `terminal.close`, `terminal.attach`, `terminal.list`, `terminal.text`, plus PTY surfaces

**Skills (22 methods)**
Full skill lifecycle: `skills.status`, `skills.search`, `skills.detail`, `skills.securityVerdicts`, `skills.skillCard`, `skills.bins`, `skills.upload.begin`, `skills.upload.chunk`, `skills.upload.commit`, `skills.install`, `skills.update`, `skills.proposals.*` (8 proposal methods)

**Usage / Billing (2 methods)**
`usage.status`, `usage.cost`

**Update (2 methods)**
`update.status`, `update.run`

**Secrets (2 methods)**
`secrets.reload`, `secrets.resolve`

**Voicewake (4 methods)**
`voicewake.get`, `voicewake.set`, `voicewake.routing.get`, `voicewake.routing.set`

**Artifacts (4 methods)**
`artifacts.list`, `artifacts.get`, `artifacts.download`

**Attach / Push (5 methods)**
`attach.grant`, `attach.revoke`, `push.web.vapidPublicKey`, `push.web.subscribe`, `push.web.unsubscribe`, `push.web.test`, `push.test`

**Misc (8 methods)**
`connect`, `web.login.start`, `web.login.wait`, `nativeHook.invoke`, `controlUi.githubPreview`, `system.info`, `assistant.media.get`

### 2.2 Method Scope System

Every core method has an authorization scope. The scopes are defined at `src/gateway/methods/descriptor.ts` and applied at registration time (`createCoreGatewayMethodDescriptors` at `core-descriptors.ts:317-346`). The scopes enforce that handlers are only callable by principals with the right authorization level:

- `operator.read` — authenticated operators can read
- `operator.write` — operators can write
- `operator.admin` — admin-only
- `operator.approvals` — approval queue participants
- `operator.pairing` — device/node pairing flows
- `dynamic` — scope resolved by handler at call time (e.g., `sessions.patch`)
- `node` — reserved for authenticated node clients

The key guard at `core-descriptors.ts:338-344` throws if any handler lacks a policy entry — unclassified handlers cannot be registered.

---

## 3. HTTP and WebSocket Surfaces

### 3.1 HTTP Server (`src/gateway/server-http.ts`, 948 lines)

The HTTP server (`server-http.ts:1-80+`) handles these route categories:

**Control UI** — Serves the web-based control panel (`control-ui.ts`) at the gateway root. This is the dashboard users interact with.

**OpenAI-Compatible API** — Endpoints at `openai-http.ts`, `models-http.ts`, `embeddings-http.ts` provide OpenAI-compatible REST endpoints for models and embeddings, enabling OpenClaw to act as a local proxy.

**Plugin HTTP Surfaces** — Dynamic routes for plugin-owned HTTP handlers. Plugin code can expose HTTP endpoints that run inside the gateway process.

**Webhooks** — `server/hooks-request-handler.ts` handles incoming webhooks from external services.

**Auth** — HTTP-level authentication via `auth.ts`, `connection-auth.ts`, `http-auth-utils.ts`.

**WebSocket Upgrades** — Upgrade HTTP connections to the gateway WebSocket protocol for real-time bidirectional communication.

**Readiness** — Health check endpoint (`server/readiness.ts`) for load balancer probes.

**MCP HTTP** — `mcp-http.handlers.ts`, `mcp-http.request.ts` implement the MCP HTTP transport.

### 3.2 WebSocket Protocol (`src/gateway/server-ws-runtime.ts`)

The gateway WebSocket surface is defined by the `GATEWAY_EVENTS` constant at `src/gateway/server-methods-list.ts:39-70`:

```
connect.challenge, agent, chat, session.message, session.operation, session.tool,
sessions.changed, presence, tick, talk.mode, talk.event, shutdown, health,
heartbeat, cron, task, node.pair.requested, node.pair.resolved, node.invoke.request,
device.pair.requested, device.pair.resolved, voicewake.changed, voicewake.routing.changed,
exec.approval.requested, exec.approval.resolved, plugin.approval.requested,
plugin.approval.resolved, terminal.data, terminal.exit, update.available
```

Clients subscribe to specific event streams. The WebSocket handler at `server-ws-runtime.ts` manages the full client lifecycle including auth handshake, capability negotiation, and event dispatch.

### 3.3 Auth on Each Surface

**HTTP Auth** — The gateway supports three auth modes configured in `src/config/types.gateway.ts:198-214`:
- `token` — shared secret token (default)
- `password` — password-based
- `Tailscale` — identity header passthrough when serve mode is enabled

Rate limiting on auth attempts is handled by `src/gateway/auth-rate-limit.ts`, which tracks per-IP failures with distinct scopes for bootstrap tokens, device tokens, and shared secrets.

**WebSocket Auth** — WebSocket connections require a valid handshake token validated by `authorizeHttpGatewayConnect` at `server-http.ts:23`. The `connection-auth.ts` handles the upgrade handshake.

**Per-Method Scopes** — Every RPC method has an explicit scope (`core-descriptors.ts:21-265`). The authorization layer (`method-scopes.ts`) resolves the caller's granted scopes and compares against the method's required scope before dispatch.

---

## 4. The Lazy-Loaded Pattern

### 4.1 `createLazyRuntimeModule()`

The gateway uses `createLazyRuntimeModule()` (`src/shared/lazy-runtime.ts`) to defer expensive imports. The pattern appears throughout the codebase:

```typescript
// src/gateway/server-http.ts:73-79
const getIdentityAvatarModule = createLazyRuntimeModule(
  () => import("../agents/identity-avatar.js"),
);
const getControlUiModule = createLazyRuntimeModule(() => import("./control-ui.js"));
const getEmbeddingsHttpModule = createLazyRuntimeModule(() => import("./embeddings-http.js"));
```

This means `server-http.ts` (the HTTP server) only loads `identity-avatar`, `control-ui`, and `embeddings-http` when those modules are actually needed at runtime — not at import time.

### 4.2 Gateway Server Lazy Loading

The gateway server itself (`server.ts:19-28`):

```typescript
async function loadServerImpl() {
  const startupStartedAt = performance.now();
  const before = performance.now();
  try {
    return await import("./server.impl.js");
  } finally {
    const now = performance.now();
    emitStartupTrace("gateway.server-impl-import", now - before, now - startupStartedAt);
  }
}
```

Startup tracing fires when `OPENCLAW_GATEWAY_STARTUP_TRACE` is set, measuring the time to load `server.impl.js` (1,869 lines of gateway implementation).

### 4.3 Dual Channel Facade/Runtime

Channels follow the same pattern: a lightweight `channel.ts` facade is loaded at startup, and the full `channel.runtime.ts` is loaded only when the channel is activated. This is described in `src/channels/AGENTS.md` and `extensions/AGENTS.md`.

### 4.4 Memory Implications

The lazy loading means memory usage is proportional to active features. A gateway that only has Telegram and iMessage configured never loads the WhatsApp, Discord, Matrix, or Signal runtime code. The compile cache (`/tmp/node-compile-cache/openclaw/`) also means repeated startup of the same version hits cached bytecode rather than re-compiling TypeScript.

---

## 5. Multi-Layer Auth

### 5.1 Auth Modes

The gateway config (`src/config/types.gateway.ts:198-214`) defines three auth modes:

**Token Mode** (`mode: "token"`) — A shared secret token validated by `authorizeTokenAuth()` at `src/gateway/auth.ts:562`. This is the default when no explicit mode is set.

**Password Mode** (`mode: "password"`) — Password-based authentication for human operators.

**Tailscale Mode** (`allowTailscale: true`) — Passes Tailscale identity headers through when the gateway is served over Tailscale.

### 5.2 Auth Rate Limiting

`src/gateway/auth-rate-limit.ts` implements per-IP rate limiting with distinct scopes:
- `bootstrap-token` — the pre-auth bootstrap verify path, serialized with a lock (`auth-rate-limit.ts:51-60`)
- `hook-auth` — webhook auth attempts
- Browser origin rate limiting via `browser-origin:` prefix keys
- Identity-based rate limiting via `identity:` prefix keys

### 5.3 Per-Channel Auth

Each channel plugin is responsible for its own authentication. The `ChannelAuthAdapter` (`types.adapters.ts:361-369`) defines `login()` for channel-specific credential entry (OAuth flows, QR code scans, etc.).

**Channel security adapters** (`ChannelSecurityAdapter` at `types.adapters.ts:849-885`) handle DM policy enforcement — resolving whether a given sender is allowed to interact with the agent, based on the configured DM policy (allowlist, blocklist, pairing required).

### 5.4 Device and Node Pairing

The gateway has a separate pairing system for devices and nodes:
- `device.pair.*` methods — pairing a physical device (macOS app, iOS app, Android app) to the gateway
- `node.pair.*` methods — pairing a compute node (another openclaw instance) to the gateway
- Pairing uses token rotation (`device.token.rotate`) and revocation (`device.token.revoke`)

### 5.5 Auth Profile System

For LLM providers, the gateway maintains `auth-profiles.json` at `~/.openclaw/agents/<agentId>/agent/auth-profiles.json`. The model auth layer at `src/agents/model-auth.ts` resolves which auth profile to use for a given provider, handles credential rotation, and manages OAuth tokens for providers that support them.

---

## 6. The Agent Runtime

### 6.1 Embedded Agent Runner (`src/agents/embedded-agent-runner/`)

The agent runtime is the **embedded agent runner** — a TypeScript module that runs inside the gateway process (and also in CLI mode). The main entry point is `runEmbeddedAgent()` which:
1. Resolves tools and system prompt (3 modes: full/minimal/none)
2. Calls the LLM via provider transport (`provider-transport-stream.ts` or `provider-transport-fetch.ts`)
3. Handles tool calls via `agent-tools.ts` (1,196 lines)
4. Manages context window (embed/compact/rotate)
5. Delivers the reply and waits for the next turn

### 6.2 System Prompt Assembly (`src/agents/system-prompt.ts`, 1,425 lines)

The system prompt is assembled programmatically with these modes:
- `"full"` — main agent with full system prompt
- `"minimal"` — subagents with reduced prompt
- `"none"` — just identity (no system prompt at all)

Key composition elements:
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
- **Sandbox policy**: allowlist/denylist for sandboxed execution
- **Profile policy**: per-user configuration
- **Provider policy**: provider-specific tool restrictions
- **Sender policy**: who is sending the message (DM pairing, etc.)
- **Group policy**: group chat restrictions
- **Subagent policy**: subagent depth limits, blocked tools for child agents

### 6.4 Subagent Delegation (`subagent-*.ts`, ~30 files)

The subagent system allows the main agent to spawn child agents:
- **Spawning** — `subagent-spawn.ts` creates subagent sessions with configurable model, workspace, context
- **Registry** — `subagent-registry.ts` persists state in SQLite, tracks lifecycle
- **Lifecycle** — handles completion, errors, timeout, orphan recovery
- **Delivery** — `subagent-announce-*.ts` delivers results back to the main agent
- **Depth control** — `subagent-depth.ts` limits nesting depth
- **Liveness monitoring** — `subagent-run-liveness.ts`, `subagent-run-timeout.ts`

Subagent blocked tools (`agent-tools.policy.ts:50-61`): `gateway`, `agents_list`, `session_status`, `cron`, `sessions_send` are always blocked for subagents.

---

## 7. Session Management

### 7.1 Session Keys

Sessions are identified by **session keys** — deterministic strings derived from channel, account, and conversation identity. The session key format encodes the channel, account, and conversation in a single string that is used as the SQLite row key.

The routing resolution at `src/routing/resolve-route.ts:47-70` produces:
```typescript
ResolvedAgentRoute = {
  agentId: string;
  channel: string;
  accountId: string;
  sessionKey: string;   // Internal persistence key
  mainSessionKey: string;  // Direct-chat collapse
  lastRoutePolicy: "main" | "session";
}
```

### 7.2 Per-User Routing

A **binding** maps a channel account (one Discord bot, one WhatsApp number, one Telegram bot) to one agent. The gateway demultiplexes inbound messages to the right agent based on configured bindings. Multiple channel accounts can map to the same agent (enabling multi-account scenarios) or to different agents (enabling multi-tenant scenarios).

### 7.3 Session Binding Service

The `SessionBindingService` at `src/infra/outbound/session-binding-service.ts` manages conversation-level bindings — binding a specific channel conversation (DM, group, thread) to a specific agent or session. This enables per-conversation routing within a single channel account.

### 7.4 Cross-Channel Continuity

Cross-channel continuity is achieved through the **agent workspace** (`docs/concepts/agent-workspace.md`): each agent has its own `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, and `memory/` directory. An agent responding on Telegram has access to the same workspace, memory, and session history as that same agent responding on WhatsApp or Discord. The agent identity is channel-agnostic; the channel is just the transport.

---

## 8. Process Supervisor

### 8.1 The Supervisor (`src/process/supervisor/`, `src/process/supervisor/index.ts`)

The `ProcessSupervisor` is a singleton that manages long-running child processes. The interface at `src/process/supervisor/types.ts` defines:

```typescript
type ManagedRun = {
  id: string;
  scopeKey: string;
  state: RunState;
  exit?: RunExit;
};

type ProcessSupervisor = {
  spawn(input: SpawnInput): ManagedRun;
  wait(runId: string): Promise<RunExit>;
  kill(runId: string, gracefulMs?: number): Promise<void>;
  list(scopeKey?: string): ManagedRun[];
};
```

### 8.2 Dual Adapter System

The supervisor has two process adapters at `src/process/supervisor/adapters/`:
- **`child.ts`** — raw child process (used for CLI backend processes, cron jobs)
- **`pty.ts`** — PTY-based terminal for interactive shell sessions

The `SpawnMode` determines which adapter is used. PTY mode provides a full terminal emulator (Unix pseudoterminal or Windows ConPTY) for interactive sessions.

### 8.3 Graceful Cancel

The cancel flow (`kill()`) gives a process 5000ms between `SIGTERM` and `SIGKILL` to shut down cleanly. This is the "graceful cancel timeout" referenced in the cron-on-exit design (`DESIGN-cron-on-exit.md:16`).

### 8.4 Output Capture

Output is captured with a 1MB maximum, truncating with markers when the limit is exceeded. This prevents runaway processes from consuming unlimited memory.

### 8.5 The Cron-on-Exit Design (`DESIGN-cron-on-exit.md`)

This is one of OpenClaw's most architecturally novel features. The problem it solves: CLI backends kill their per-turn process tree at turn end. Any process the agent backgrounds via `exec` is in that tree and dies with the turn.

The solution (`DESIGN-cron-on-exit.md:9-17`):
1. `CronSchedule` gains `{ kind: "on-exit"; command: string; cwd?: string }`
2. `computeNextRunAtMs()` returns `undefined` for on-exit — time-based timer never fires it
3. `createCronExitWatchers()` (at `src/gateway/cron-exit-watchers.ts`) owns the watcher lifecycle, backed by `getProcessSupervisor()`
4. On reconcile, each enabled on-exit job reserves a watcher slot with an `armToken`, then spawns the command via `supervisor.spawn({ mode:"child", scopeKey:"cron-exit:<jobId>", replaceExistingScope:true, captureOutput:true })`
5. The watcher lives under the **gateway** supervisor tree — immune to per-turn teardown
6. `await run.wait()` → persist-before-fire (job disabled in store) → then fire via the existing cron run pipeline
7. Fail-closed: if the store write or `wait()` rejects, the job does NOT fire — preventing double-fire on gateway restart

### 8.6 Background Process Management

Long-running processes are scoped by `scopeKey`. Scopes include:
- `"cron-exit:<jobId>"` — cron on-exit watchers
- `"shell:<sessionId>"` — interactive shell sessions
- `"exec:<sessionId>"` — agent exec calls

The supervisor's scope key system allows cleanup of all processes belonging to a given scope in one call.

---

## 9. Plugin SDK

### 9.1 The Formal Public Contract

The Plugin SDK (`src/plugin-sdk/`, 538 files) is the **formal public contract** between core and plugins. The boundary rules at `src/plugin-sdk/AGENTS.md` are explicit: plugins must import only from `openclaw/plugin-sdk/*` subpaths — never from `src/**` internals. This boundary is enforced by import cycle checks (`pnpm check:import-cycles`).

### 9.2 SDK Entry Points

The canonical entry points are listed at `src/plugin-sdk/AGENTS.md`:
- `openclaw/plugin-sdk/core` — Core types, manifests, metadata
- `openclaw/plugin-sdk/plugin-entry` — Plugin registration API (`definePluginEntry`)
- `openclaw/plugin-sdk/channel-contract` — Channel plugin interfaces
- `openclaw/plugin-sdk/provider-entry` — Provider plugin interfaces
- `openclaw/plugin-sdk/agent-harness` — Agent harness API
- `openclaw/plugin-sdk/config-runtime` — Config runtime helpers
- `openclaw/plugin-sdk/browser-*` — Browser automation bridge
- `openclaw/plugin-sdk/memory-core-*` — Memory engine helpers
- `openclaw/plugin-sdk/secret-input` — Secret input handling
- `openclaw/plugin-sdk/ssrf-*` — SSRF protection utilities

### 9.3 Plugin Lifecycle

1. **Discovery** — Plugin found via `openclaw.plugin.json` manifest in `extensions/`
2. **Bootstrap** — Lightweight facade loaded (`api.ts`) — hot path, no heavy imports
3. **Activation** — Runtime loaded (`runtime-api.ts`) on demand when channel/provider is needed
4. **Setup** — Optional wizard (`setup.ts`) for credential entry
5. **Runtime** — Active message/stream processing
6. **Hot reload** — Config changes trigger re-activation without full restart
7. **Unload** — Clean shutdown on gateway restart

### 9.4 What 538 Files Means

The plugin SDK exports:
- TypeScript types for every plugin-facing contract (channels, providers, tools, memory)
- Runtime helpers for config validation, secret management, OAuth flows
- Channel adapter factories for messaging, outbound delivery, pairing, security
- Provider adapter helpers for auth, catalog, streaming
- Memory system integration helpers
- Approval delivery helpers (`approval-delivery-helpers.ts:253`)
- SSRF protection utilities
- Tool schema builders and validators

The size reflects the breadth of the plugin surface — every channel (28+), every provider (30+), every memory backend, and every tool integration needs typed SDK support.

### 9.5 How a Third Party Writes a Plugin

A plugin author writes:
1. `openclaw.plugin.json` — manifest with id, name, description, contracts, configSchema
2. `channel.ts` / `channel.runtime.ts` — implement the `ChannelMessagingAdapter`, `ChannelOutboundAdapter`, `ChannelPairingAdapter`, `ChannelSecurityAdapter`, `ChannelThreadingAdapter` interfaces
3. `inbound.ts` — message handling pipeline
4. `outbound.ts` / `outbound-adapter.ts` — message sending
5. `auth-store.ts` / `login.ts` — credential management
6. `session.ts` / `session.runtime.ts` — session lifecycle
7. `setup.ts` / `setup-surface.ts` — setup wizard integration
8. `doctor.ts` — self-diagnosis and repair

The plugin is discovered by the gateway's plugin registry, loaded lazily, and activated when the channel is configured.

---

## 10. Code References

All claims are verified against these source locations:

| Claim | Source |
|-------|--------|
| Gateway entry point + Node version check | `openclaw.mjs:11-58` |
| Lazy server import with tracing | `src/gateway/server.ts:19-28` |
| Server impl (1,869 lines) | `src/gateway/server.impl.ts:1-1869` |
| HTTP server routes | `src/gateway/server-http.ts:1-80` |
| Core method specs (264 methods) | `src/gateway/methods/core-descriptors.ts:21-265` |
| Core method descriptor creation (fails on unclassified) | `src/gateway/methods/core-descriptors.ts:317-346` |
| Gateway events (WebSocket) | `src/gateway/server-methods-list.ts:39-70` |
| Aux methods (11) | `src/gateway/server-aux-methods.ts:4-16` |
| Auth modes | `src/config/types.gateway.ts:198-214` |
| Auth rate limiting scopes | `src/gateway/auth-rate-limit.ts:51-60` |
| Token auth handler | `src/gateway/auth.ts:562` |
| Process supervisor singleton | `src/process/supervisor/index.ts:8` |
| Cron-on-exit design | `DESIGN-cron-on-exit.md:1-29` |
| Cron exit watchers | `src/gateway/cron-exit-watchers.ts:1-16` |
| Cron on-exit types | `src/cron/types.ts:19-32` |
| System prompt (1,425 lines) | `src/agents/system-prompt.ts:1-1425` |
| Context file order | `src/gateway/methods/core-descriptors.ts:126-134` |
| Agent tools (1,196 lines) | `src/agents/agent-tools.ts:1-1196` |
| Tool policy pipeline | `src/plugin-sdk/tool-policy-pipeline.ts` |
| Subagent blocked tools | `src/agents/agent-tools.policy.ts:50-61` |
| Session routing | `src/routing/resolve-route.ts:47-70` |
| Plugin SDK entry points | `src/plugin-sdk/AGENTS.md` |
| Plugin lifecycle | `src/plugin-sdk/core.ts:1-861` |
| Channel adapter interfaces | `src/channels/plugins/types.adapters.ts:1-885` |
| Channel core types | `src/channels/plugins/types.core.ts:1-833` |
| Auth adapter | `src/channels/plugins/types.adapters.ts:361-369` |
| Security adapter | `src/channels/plugins/types.adapters.ts:849-885` |
| Message adapter | `src/channels/plugins/types.core.ts:494-657` |
| Threading adapter | `src/channels/plugins/types.core.ts:400-454` |
| Outbound adapter | `src/channels/plugins/types.adapters.ts:24-33` |
| Pairing adapter | `src/channels/plugins/types.adapters.ts:47` |
| Session binding service | `src/infra/outbound/session-binding-service.ts:14-38` |
| WhatsApp plugin manifest | `extensions/whatsapp/openclaw.plugin.json:1-30` |
| Startup unavailable methods | `src/gateway/methods/core-descriptors.ts:272-274` |
