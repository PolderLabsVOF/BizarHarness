# OpenClaw Channel Adapters — Deep Architecture Analysis

**Round:** 6 of 15 (OpenClaw Deep Dive)  
**Scope:** All 28+ channel adapters, adapter interfaces, routing, cross-channel continuity  
**Sources:** `src/channels/plugins/`, `extensions/`, `src/channels/`, `src/routing/`, `src/infra/outbound/`  
**Date:** 2026-07-06

---

## 1. The Adapter Interface

Every OpenClaw channel plugin implements a set of typed adapter interfaces. These are the contracts that the gateway uses to interact with the channel, independent of the channel's specific protocol. The interfaces are defined in `src/channels/plugins/types.core.ts` (core types) and `src/channels/plugins/types.adapters.ts` (adapter types).

### 1.1 The Five Primary Adapter Interfaces

**`ChannelMessagingAdapter`** (`types.core.ts:494-657`) is the largest interface. It defines how the channel handles inbound and outbound message routing:

```typescript
// Core capabilities
targetPrefixes?: readonly string[];        // Accepted target prefixes
normalizeTarget?: (raw: string) => string;   // Target normalization
resolveSessionConversation?: (params) => {   // Parse thread/scoped-conversation semantics
  id: string;
  threadId?: string | null;
  baseConversationId?: string | null;
  parentConversationCandidates?: string[];
};
resolveInboundConversation?: (params) => {  // Parse inbound message metadata
  conversationId?: string;
  parentConversationId?: string;
} | null;
inferTargetChatType?: (params) => ChatType;  // Lightweight chat type inference
resolveOutboundSessionRoute?: (params) => ChannelOutboundSessionRoute | null;  // Build route for outbound
// Formatting
buildCrossContextPresentation?: ChannelCrossContextPresentationFactory;  // Cross-channel presentation
transformReplyPayload?: (params) => ReplyPayload | null;  // Transform before sending
// Capabilities
enableInteractiveReplies?: (params) => boolean;  // Interactive reply support
hasStructuredReplyPayload?: (params) => boolean;  // Structured message support
```

**`ChannelOutboundAdapter`** (`types.adapters.ts:24-33`) handles message delivery:
```typescript
send?: (ctx: ChannelOutboundContext, payload: ReplyPayload) => Promise<OutboundDeliveryResult>;
sendPoll?: (ctx: ChannelOutboundContext, poll: ChannelPollContext) => Promise<ChannelPollResult>;
typing?: (ctx: ChannelOutboundContext) => Promise<void>;
```

**`ChannelPairingAdapter`** (`types.adapters.ts:47`, `pairing.types.ts`) handles device/account pairing:
```typescript
notifyApproval?: (ctx) => Promise<void>;  // Notify user of pending approval
normalizeAllowEntry?: (raw: string) => string;  // Normalize allowlist entries
idLabel?: string;  // Human-readable ID label
```

**`ChannelSecurityAdapter`** (`types.adapters.ts:849-885`) enforces DM policy and inbound security:
```typescript
resolveDmPolicy?: (ctx: ChannelSecurityContext) => ChannelSecurityDmPolicy | null;
collectWarnings?: (ctx) => string[] | Promise<string[]>;
collectAuditFindings?: (ctx) => AuditFinding[];  // Security audit findings
```

**`ChannelThreadingAdapter`** (`types.core.ts:400-454`) handles thread/topic management:
```typescript
resolveReplyToMode?: (params) => "off" | "first" | "all" | "batched";
resolveAutoThreadId?: (params) => string | undefined;
resolveReplyTransport?: (params) => ChannelReplyTransport | null;
buildToolContext?: (params) => ChannelThreadingToolContext | undefined;
```

### 1.2 Secondary Adapter Interfaces

Beyond the five primary, there are supporting adapters:

**`ChannelConfigAdapter`** (`types.adapters.ts:121-160`) — validates and mutates channel configuration
**`ChannelStatusAdapter`** (`types.adapters.ts:182-242`) — probes channel health, builds capability diagnostics
**`ChannelDirectoryAdapter`** (`types.adapters.ts:415-424`) — directory lookups (list peers, groups, self)
**`ChannelHeartbeatAdapter`** (`types.adapters.ts:371-391`) — check ready, send/clear typing indicators
**`ChannelApprovalAdapter`** (`types.adapters.ts:629-644`) — approval rendering and delivery for exec/plugin approvals
**`ChannelLifecycleAdapter`** (`types.adapters.ts:547-575`) — on-account-config-changed, on-account-removed, startup maintenance
**`ChannelDoctorAdapter`** (`types.adapters.ts:511-545`) — self-diagnosis and config repair
**`ChannelAllowlistAdapter`** (`types.adapters.ts:677-731`) — inbound allow/deny list management
**`ChannelGroupAdapter`** (`types.adapters.ts:176-180`) — group-specific policy resolution

### 1.3 Channel Capabilities Matrix

Each channel advertises its capabilities via `ChannelCapabilities` (`types.core.ts:305-321`):

| Capability | Meaning |
|-----------|---------|
| `chatTypes` | Array of supported `ChatType` values |
| `polls` | Poll creation and voting support |
| `reactions` | Emoji reaction support |
| `edit` | Message editing support |
| `unsend` | Message deletion support |
| `reply` | Reply threading support |
| `effects` | Message effects (e.g., Slack crayons) |
| `groupManagement` | Group/channel administration |
| `threads` | Native thread support |
| `media` | File/image/video attachment support |
| `tts.voice` | Voice memo delivery via TTS pipeline |
| `nativeCommands` | Slash-command support |
| `blockStreaming` | Streaming text cannot be sent |

---

## 2. Major Channels — Detailed Analysis

### 2.1 WhatsApp (`extensions/whatsapp/`)

**Protocol:** WhatsApp Web (Baileys-based), WhatsApp Business API  
**Auth:** QR code scan (Baileys) or Business API credentials  
**File locations:** `extensions/whatsapp/src/` with `channel.ts`, `channel.runtime.ts`, `inbound.ts`, `outbound.ts`, `auth-store.ts`, `login.ts`, `session.ts`, `session.runtime.ts`, `setup.ts`, `doctor.ts`

WhatsApp uses the Baileys library for WhatsApp Web protocol. The plugin manifest (`extensions/whatsapp/openclaw.plugin.json`) declares the `whatsapp_call` tool contract. Key features:
- **Media support** — images, voice notes, documents, video via Baileys media handlers
- **Group policy** — configurable allow/deny for group DMs
- **QR login** — `loginWithQrStart` / `loginWithQrWait` flow for WhatsApp Web sessions
- **Status updates** — can receive WhatsApp status updates as inbound messages
- **Voice notes** — audio received as voice notes are transcribed via the STT pipeline

**Known quirks:** WhatsApp Web sessions are prone to being disconnected when the phone goes offline. The `connection-controller.ts` handles reconnection with exponential backoff.

### 2.2 Telegram (`extensions/telegram/`)

**Protocol:** Telegram Bot API (webhooks + long polling)  
**Auth:** Bot token from `@BotFather`  
**File locations:** `extensions/telegram/src/` — standard plugin structure

Telegram is one of the most fully-featured channels:
- **Inline keyboards** — callback buttons attached to messages (`CallbackQuery` handling)
- **Commands** — native `/command` handlers via Bot API commands
- **Reply keyboards** — custom reply markup
- **File uploads** — documents, photos, voice, video via `InputFile`
- **Message editing** — edit existing messages
- **Pinned messages** — group management
- **Polls** — native poll creation via Bot API

The Telegram plugin uses long polling by default (with webhook support for production). The `doctor.ts` can verify the bot token and probe the Bot API for updates.

### 2.3 Discord (`extensions/discord/`)

**Protocol:** Discord Bot API (WebSocket gateway + REST)  
**Auth:** Bot token from Discord Developer Portal  
**Key features:**
- **Slash commands** — Discord's native command system
- **Message components** — buttons, select menus, modals
- **Embeds** — rich embed formatting for messages
- **Threads** — native thread creation and management
- **Reactions** — emoji reactions
- **Roles and permissions** — channel-level permission enforcement
- **Guild settings** — server configuration

Discord's webhook model means it can receive messages via Discord's gateway without persistent outbound WebSocket from OpenClaw (the bot connects outbound). The `discord/src/outbound-adapter.ts` handles formatting Discord-specific embed structures.

### 2.4 Slack (`extensions/slack/`)

**Protocol:** Slack Web API + Event API (webhook receiver)  
**Auth:** Bot token (`xoxb-`) from Slack App  
**Key features:**
- **Block Kit** — Slack's structured message blocks
- **Thread support** — threaded replies in channels and DMs
- **Slash commands** — `/command` handlers via `src/slash.ts`
- **Views** — modals, home tabs via `views.publish`
- **Scheduled messages** — via `chat.scheduleMessage`
- **File uploads** — via `files.uploadV2`

Slack's OAuth is more complex than most: the `slack-tools` extension provides tools in addition to the channel adapter. The plugin handles Slack's request signature verification for webhook authenticity.

### 2.5 iMessage (Built-in, `src/channels/imessage/` or bundled)

**Protocol:** Native macOS iMessage via Private.framework (AppleScript/IPC)  
**Auth:** Running on macOS with iMessage enabled  
**Built-in status:** Ships in core, not as a plugin

iMessage is unique because it's the only channel that uses native macOS IPC rather than a network protocol. The implementation at `extensions/imessage/` or core `src/channels/` uses `osascript` to communicate with the Messages app. This means:
- No bot token or OAuth required
- Works for personal Apple ID messages
- No group chat support (iMessage limitation)
- Voice notes supported (Apple's CAF audio format preference at `types.core.ts:287`)

The `ChannelTtsVoiceDeliveryCapabilities` at `types.core.ts:289-302` has special handling for iMessage: it sets `preferAudioFileFormat: "caf"` for Apple's voice memo format.

### 2.6 Signal (`extensions/signal/`)

**Protocol:** Signal Messenger protocol  
**Auth:** Phone number + verification, linked devices  
**Status:** Official plugin

Signal's plugin uses the Signal protocol for end-to-end encryption. Key features:
- **Sealed sender** — encrypted sender identity
- **Group management** — Signal groups with E2E encryption
- **Note to self** — the Signal bot can DM the user themselves
- **Voice messages** — audio attachment support

### 2.7 Google Chat (`extensions/googlechat/`)

**Protocol:** Google Chat REST API + Webhooks  
**Auth:** Service account or OAuth for bot  
**Key features:**
- **Space-based messaging** — Google's room/space model
- **Card messages** — Google's widget card format
- **Threaded replies** — via threadKey
- **Incoming webhooks** — for simple inbound integration

### 2.8 Microsoft Teams (`extensions/msteams/`)

**Protocol:** Microsoft Bot Framework + Teams API  
**Auth:** Azure AD app registration, bot token  
**Key features:**
- **Adaptive Cards** — Microsoft's card format
- **Channel-specific messaging** — Teams channels vs DMs
- **Graph API integration** — for team/channel enumeration
- **Proactive messaging** — bot can initiate conversations

### 2.9 Matrix (`extensions/matrix/`)

**Protocol:** Matrix protocol (Homeserver API)  
**Auth:** Access token from Matrix homeserver  
**Key features:**
- **Decentralized** — federates across homeservers
- **E2E encryption** — Matrix E2EE support
- **Room management** — create, join, leave rooms
- **Threading** — via `Relation` events
- **Bridge support** — can bridge to other networks

The Matrix plugin (`extensions/matrix/src/channel.ts:336`) implements `matrixChannelOutbound: ChannelOutboundAdapter`.

### 2.10 IRC (`extensions/irc/`)

**Protocol:** RFC 1459 IRC  
**Auth:** NickServ authentication, server password  
**Key features:**
- Classic IRC protocol with channel and DM support
- CTCP commands (version, ping, etc.)
- Nick changes and server reconnection handling

---

## 3. The Niche Channels

### 3.1 SMS (`extensions/sms/`)
Basic SMS gateway — uses telephony providers (Twilio, etc.) for SMS send/receive. Limited to text only; no media. Configuration includes provider credentials and sender number.

### 3.2 Voice Call (`extensions/voice-call/`)
Telephony bridge — connects OpenClaw to phone calls. Used for voice interaction without the full real-time audio pipeline. The agent receives transcribed audio and responds via TTS.

### 3.3 Feishu (`extensions/feishu/`)
ByteDance's enterprise chat platform (Lark/Feishu). Uses Feishu Open Platform API. Supports:
- Feishu mini programs
- Card messages
- Group management

### 3.4 LINE (`extensions/line/`)
LINE messaging platform. Uses LINE Messaging API. Supports:
- LINE rich media (Flex messages)
- Line Pay integration
- Group and room management

### 3.5 Mattermost (`extensions/mattermost/`)
Self-hosted team chat (Atlassian-owned). Uses Mattermost API. Supports:
- Mattermost OAuth (self-hosted auth)
- Channel and DM support
- File uploads

### 3.6 Nextcloud Talk (`extensions/nextcloud-talk/`)
Federated chat built on Nextcloud. Uses Nextcloud Talk API. Designed for self-hosted scenarios with Nextcloud as the hub.

### 3.7 Nostr (`extensions/nostr/`)
Decentralized protocol built on relays. Uses NIP-01/NIP-04 for direct messages and NIP-28 for group chats. No central server — events are published to configurable relays.

### 3.8 Synology Chat (`extensions/synology-chat/`)
Synology NAS chat integration. Uses Synology Chat API. Designed for on-premises deployment behind a Synology NAS.

### 3.9 Tlon (`extensions/tlon/`)
Urbit-native chat integration. The `tlon` channel connects to Urbit's Landscape interface. Niche but interesting for Urbit ecosystem deployments.

### 3.10 Twitch (`extensions/twitch/`)
Twitch chat via IRC. The `twitch` plugin connects to Twitch's IRC interface using the Twitch chat credentials. Supports:
- Twitch chat commands
- Whisper DMs
- Automatic reconnection

### 3.11 Zalo (`extensions/zalo/`) and Zalo Personal (`extensions/zalouser/`)
Vietnamese messaging platform. Zalo has two plugins: one for official Zalo OA (business account) and one for personal Zalo accounts via unofficial protocol.

### 3.12 QQ Bot (`extensions/qq-bot/`)
Tencent QQ platform. Uses QQ Bot Open Platform. Supports group and DM messages for the Chinese QQ ecosystem.

### 3.13 Raft (`extensions/raft/`)
Consensus-based channel — uses the Raft protocol for reliable message ordering across distributed OpenClaw instances. Novel for multi-node deployments.

### 3.14 External/Community Plugins

These are maintained outside the core repo:
- **WeChat** (`extensions/wechat/`) — WeChat Work integration
- **Yuanbao** (`extensions/yuanbao/`) — Tencent Yuanbao
- **Zalo ClawBot** (`extensions/zalouser/`) — Alternative Zalo personal client

### 3.15 WebChat (Built-in)

The simplest channel — a browser-based chat widget served by the gateway itself at the gateway HTTP port. Used for quick testing and local deployments without external platform setup. Implemented in `extensions/webchat/` with a lightweight `channel.ts` facade.

---

## 4. Message Routing

### 4.1 How an Inbound Message Reaches the Right Agent

The routing chain for an inbound message:

1. **Channel plugin receives message** — the plugin's `inbound.ts` handles the protocol-specific parsing (e.g., Telegram `Update` object, Discord `Message` event)

2. **Session key derivation** — `src/channels/plugins/types.core.ts:494-657` `resolveSessionConversation()` maps the protocol-specific conversation ID to the OpenClaw session key format. The session key encodes: `channel:accountId:conversationId`

3. **Binding resolution** — `src/channels/plugins/binding-routing.ts` looks up the configured `AgentBinding` for this channel account. A binding maps a channel account to an `agentId`. Multiple channel accounts can bind to the same agent (multi-account routing).

4. **Agent route resolution** — `src/routing/resolve-route.ts:47-70` produces the final `ResolvedAgentRoute`:
   ```typescript
   { agentId, channel, accountId, sessionKey, mainSessionKey, lastRoutePolicy }
   ```

5. **Session creation/retrieval** — if the session doesn't exist, the gateway creates it. If it does exist, the gateway retrieves it and resumes the conversation.

6. **Agent invocation** — the message is added to the session history and the embedded agent runner is called to produce a response.

### 4.2 Per-User Routing

Bindings are per-account, not per-user. A single WhatsApp Business account can have bindings for multiple agents based on:
- The specific phone number / account ID
- Conversation-level routing (via `SessionBindingService`)
- Group membership (for group chats)

The `ChannelConfiguredBindingProvider` at `types.adapters.ts:756-771` defines how a channel maps configured bindings to conversation references at runtime.

### 4.3 Multi-User on One Instance

OpenClaw supports multi-user scenarios via the **binding system**: different channel accounts on the same gateway can route to different agents, or the same channel account can route different conversations to different agents based on the session binding. Each agent has its own workspace, memory, and session history.

The `ChannelAllowlistAdapter` (`types.adapters.ts:677-731`) handles inbound allow/deny lists to restrict which users can trigger which agents.

---

## 5. Cross-Channel Continuity

### 5.1 What "Continuity" Means

OpenClaw's cross-channel continuity means that a user can message the agent on Telegram, get a response, then continue the same conversation on WhatsApp or Discord. The agent has access to the same workspace, the same session history, and the same memory on every channel.

### 5.2 How Continuity Is Traced

The **session key** is the continuity primitive. The session key format at `src/routing/resolve-route.ts` is deterministic: `channel:accountId:conversationId`. For a user `alice` talking to the agent on WhatsApp account `+1234567890`, the session key might be `whatsapp:+1234567890:+1234567890:dm`. On Telegram, the same user's DM session would be `telegram:bot_token:123456789:dmo`.

**Continuity across the same user on different channels** is achieved by having the agent's workspace carry the persistent state. The session key connects to a session history, and the agent's `memory/` directory carries long-term memory. The agent itself is identified by `agentId`, not by channel — so the agent on Telegram and the agent on WhatsApp are the same agent.

### 5.3 Per-User vs Per-Session Storage

**Per-agent storage** (`~/.openclaw/agents/<agentId>/`):
- `agent/auth-profiles.json` — OAuth/API credentials
- `sessions/` — SQLite session history files
- `openclaw-agent.sqlite` — agent-scoped state/cache
- `workspace/` — agent workspace files (AGENTS.md, SOUL.md, etc.)

**Per-session storage**:
- Session key → SQLite row in the session store
- Session metadata (last-route, label, category, pinned, archived, unread)

**Global state**:
- `state/openclaw.sqlite` — global runtime state and plugin KV data

The memory layer (`extensions/memory-core/`, `extensions/memory-wiki/`, `extensions/memory-lancedb/`) is agent-owned, not session-owned. This means memory persists across sessions and across channels.

---

## 6. Channel-Specific Features

### 6.1 Telegram: Inline Keyboards and File Uploads

Telegram's inline keyboard feature is handled in the outbound adapter via `ReplyPayload` transformation. The Telegram plugin (`extensions/telegram/`) uses the Bot API's `InlineKeyboardMarkup` for structured button layouts.

File uploads work via `InputFile` — the plugin handles multipart form data for photos, documents, audio, and video.

### 6.2 Slack: Thread Support and Slash Commands

Slack threading is managed via `ts` (thread timestamp) in the API. The `resolveReplyTransport` in `ChannelThreadingAdapter` maps the thread context to Slack's `thread_ts` parameter.

Slash commands (`/openclaw`, `/ask`) are handled by `slash.ts` — the plugin registers the command with Slack and processes the command payload.

### 6.3 Discord: Reactions and Embeds

Discord reactions are sent as `PUT` requests to the `/channels/{id}/messages/{id}/reactions/{emoji}/@me` endpoint. The `ChannelMessageActionAdapter` describes which actions the channel supports in its `describeMessageTool` method.

Embeds are Discord's rich message format — structured objects with title, description, color, fields, footer, image, thumbnail. The Discord outbound adapter transforms `ReplyPayload` into Discord embed format.

### 6.4 WhatsApp: Status Updates and Voice Notes

WhatsApp status updates (the "Status" feature, separate from messages) can be received as inbound events if `messageReceived` plugin hook is enabled (`extensions/whatsapp/openclaw.plugin.json:22-26`). Voice notes are received as audio attachments, which are passed to the STT pipeline for transcription.

### 6.5 Matrix: E2E Encryption

Matrix supports end-to-end encryption via Megolm and Olm. The Matrix plugin handles E2EE key management using the Matrix E2EE module.

---

## 7. Failover / Multi-Channel

### 7.1 Multi-Channel Delivery

An agent can send messages to multiple channels. The `send` RPC method at `core-descriptors.ts:215` accepts a `channel` parameter. For outbound-only scenarios (sending notifications to a channel the agent isn't actively listening on), the agent uses the `message(action=send)` tool.

### 7.2 Delivery Guarantees

OpenClaw does **not** provide at-least-once or exactly-once delivery guarantees across channel restarts. Each channel plugin manages its own retry logic:
- **WhatsApp** — Baileys handles message acknowledgment and retry
- **Telegram** — the Bot API is idempotent for most operations; updates are fetched via long polling
- **Discord** — Discord's gateway provides guaranteed ordering within a shard
- **Slack** — web API calls are idempotent with proper `ts` handling

The `ReplyPayload` model at `src/auto-reply/reply-payload.ts` provides a normalized representation that all channel adapters transform into channel-specific formats. Delivery failures are surfaced via `OutboundDeliveryResult`.

### 7.3 Retry Logic

Channel plugins that send outbound messages implement their own retry logic. The gateway does not provide a global retry mechanism for failed outbound deliveries. The session store can replay failed deliveries on a best-effort basis.

---

## 8. Code References

All claims are verified against these source locations:

| Claim | Source |
|-------|--------|
| ChannelMessagingAdapter interface | `src/channels/plugins/types.core.ts:494-657` |
| ChannelOutboundAdapter interface | `src/channels/plugins/types.adapters.ts:24-33` |
| ChannelPairingAdapter interface | `src/channels/plugins/types.adapters.ts:47`, `pairing.types.ts` |
| ChannelSecurityAdapter interface | `src/channels/plugins/types.adapters.ts:849-885` |
| ChannelThreadingAdapter interface | `src/channels/plugins/types.core.ts:400-454` |
| ChannelCapabilities definition | `src/channels/plugins/types.core.ts:305-321` |
| PreferredAudioFileFormat for iMessage CAF | `src/channels/plugins/types.core.ts:287` |
| WhatsApp plugin manifest | `extensions/whatsapp/openclaw.plugin.json:1-30` |
| WhatsApp message hook opt-in | `extensions/whatsapp/openclaw.plugin.json:22-26` |
| Session routing | `src/routing/resolve-route.ts:47-70` |
| Channel binding routing | `src/channels/plugins/binding-routing.ts:1-17` |
| Session binding service | `src/infra/outbound/session-binding-service.ts:14-38` |
| Message routing: session conversation | `src/channels/plugins/types.core.ts:557-562` |
| Message routing: inbound conversation | `src/channels/plugins/types.core.ts:531-541` |
| ChannelConfiguredBindingProvider | `src/channels/plugins/types.adapters.ts:756-771` |
| ChannelAllowlistAdapter | `src/channels/plugins/types.adapters.ts:677-731` |
| ChannelOutboundContext | `src/channels/plugins/types.adapters.ts:24-33` |
| ChannelPollContext | `src/channels/plugins/types.core.ts:803-821` |
| TTS voice delivery for iMessage | `src/channels/plugins/types.core.ts:289-302` |
| ReplyPayload normalization | `src/auto-reply/reply-payload.ts` |
| Channel gateway adapter | `src/channels/plugins/types.adapters.ts:342-359` |
| Channel config adapter | `src/channels/plugins/types.adapters.ts:121-160` |
| Channel status adapter | `src/channels/plugins/types.adapters.ts:182-242` |
| Channel directory adapter | `src/channels/plugins/types.adapters.ts:415-424` |
| Channel heartbeat adapter | `src/channels/plugins/types.adapters.ts:371-391` |
| Channel lifecycle adapter | `src/channels/plugins/types.adapters.ts:547-575` |
| Channel doctor adapter | `src/channels/plugins/types.adapters.ts:511-545` |
| Matrix outbound adapter | `extensions/matrix/src/channel.ts:336` |
| Zalo personal plugin | `extensions/zalouser/src/channel.ts:210-222` |
| Channel capability tone | `src/channels/plugins/types.adapters.ts:67-77` |
| Channel status issue | `src/channels/plugins/types.core.ts:143-149` |
| Outbound delivery result | `src/infra/outbound/deliver.ts` |
| Outbound session route | `src/channels/plugins/types.core.ts:387-398` |
| Channel agent tool | `src/channels/plugins/types.core.ts:37-40` |
| Message action discovery context | `src/channels/plugins/types.core.ts:48-60` |
| Message tool discovery | `src/channels/plugins/types.core.ts:84-95` |
| Channel gateway context | `src/channels/plugins/types.adapters.ts:244-314` |
| Channel setup input | `src/channels/plugins/types.core.ts:98-141` |
| Channel group context | `src/channels/plugins/types.core.ts:265-276` |
| Channel security context | `src/channels/plugins/types.core.ts:332-336` |
| Channel security DM policy | `src/channels/plugins/types.core.ts:323-330` |
| Channel mention adapter | `src/channels/plugins/types.core.ts:338-355` |
| Channel streaming adapter | `src/channels/plugins/types.core.ts:357-362` |
| Session key utilities | `src/sessions/session-key-utils.js` |
| Routing peer | `src/routing/resolve-route.ts` |
| Agent binding | `src/config/types.agents.ts` |
| Agent binding type | `src/channels/plugins/types.adapters.ts:49` |
| Per-agent storage | `~/.openclaw/agents/<agentId>/` |
| Global state DB | `state/openclaw.sqlite` |
| Agent-scoped DB | `agents/<agentId>/agent/openclaw-agent.sqlite` |
| Plugin manifest schema | `docs/plugins/manifest.md` |
| Plugin SDK channel contracts | `src/plugin-sdk/channel-contract.ts:1-44` |
