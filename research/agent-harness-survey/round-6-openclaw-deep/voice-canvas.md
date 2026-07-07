# OpenClaw Voice + Canvas — Deep Dive

**Round:** 6 — OpenClaw deep dive
**Scope:** Realtime voice (Talk), voice wake, STT/TTS plugins, and the agent-controlled Canvas system (WKWebView + A2UI v0.8).
**Repo:** `repos/openclaw/` (commit captured 2026-07-06).
**All citations use repo-root refs as required by the OpenClaw AGENTS.md style guide.**

---

## 1. Voice Subsystem Overview

The Talk / voice subsystem lives under `src/talk/` (42 entries, per R2) plus five cross-cutting plugins: `extensions/talk-voice/`, `extensions/deepgram/`, `extensions/elevenlabs/`, `extensions/gradium/`, `extensions/tts-local-cli/`, plus the bundled speech under `src/plugin-sdk/speech.ts`. The macOS app, the macOS-MLX-TTS helper, and the standalone Swabble wake daemon ship in `apps/macos/`, `apps/macos-mlx-tts/`, and `apps/swabble/`. The boundary between the TypeScript Talk runtime and the native Swift Speech pipeline is the **RealtimeVoiceBridge** interface.

Architectural shape:

```
User audio
  → Transport (native app: macOS/iOS/Android)   → Talk Session Controller
    → RealtimeVoiceBridge (provider plugin)      [provider-types.ts]
      → audioSink (transport-side playback)
      → transcript / tool-call events
    → Agent Consult (background agent invocation)  [agent-consult-runtime.ts]
      → TTS synthesis (provider plugin)
        → audioSink → playback → User
```

There are four orthogonal transport shapes the runtime can drive:

- **WebRTC SDP** (browser / iOS native, peer-connection media + data channel)
- **Provider WebSocket** with JSON-over-PCM (browser-only)
- **Gateway relay** (PCM audio via Gateway WebSocket, used for headless clients)
- **Managed room** (LiveKit-style rooms)

These are enumerated as a closed union at `src/talk/provider-types.ts:179-183` (`RealtimeVoiceBrowserSession`). The corresponding audio contract is `RealtimeVoiceBrowserAudioContract` at `src/talk/provider-types.ts:128-133`, restricted to `pcm16` or `g711_ulaw` sample formats.

The provider capability table (`RealtimeVoiceProviderCapabilities`, `src/talk/provider-types.ts:84-93`) advertises the union of supported transports plus flags for `supportsBrowserSession`, `supportsBargeIn`, `supportsToolCalls`, `supportsVideoFrames`, and `supportsSessionResumption`. Plugin manifests expose their provider under `contracts.realtimeVoiceProviders` (see `extensions/openai/openclaw.plugin.json:329`).

## 2. Realtime Voice Sessions

### 2.1 Bridge Session Lifecycle

`createRealtimeVoiceBridgeSession(params)` (`src/talk/session-runtime.ts:75-158`) is the factory for one realtime voice session. The shape returned (`RealtimeVoiceBridgeSession`, `src/talk/session-runtime.ts:35-46`) is a stable facade handed to gateway code and provider tool callbacks:

```ts
type RealtimeVoiceBridgeSession = {
  bridge: RealtimeVoiceBridge;
  acknowledgeMark(): void;
  close(): void;
  connect(): Promise<void>;
  sendAudio(audio: Buffer): void;
  sendUserMessage(text: string): void;
  handleBargeIn(options?: RealtimeVoiceBargeInOptions): void;
  setMediaTimestamp(ts: number): void;
  submitToolResult(callId: string, result: unknown, options?: RealtimeVoiceToolResultOptions): void;
  triggerGreeting(instructions?: string): void;
};
```

Implementation note at `src/talk/session-runtime.ts:85-86`: the provider may invoke callbacks during `createBridge()`; the public facade is intentionally stable while blocking use until the bridge is returned. The bridge reference is held in a closure (`bridgeRef`, `src/talk/session-runtime.ts:78-83`) and a `requireBridge()` helper throws if anyone tries to use the facade before the bridge is set.

The audio sink is the boundary between provider audio and transport playback (`RealtimeVoiceAudioSink`, `src/talk/session-runtime.ts:20-25`):

```ts
type RealtimeVoiceAudioSink = {
  isOpen?: () => boolean;
  sendAudio: (audio: Buffer) => void;
  clearAudio?: () => void;
  sendMark?: (markName: string) => void;
};
```

Provider `onAudio`, `onClearAudio`, and `onMark` callbacks are all gated by `canSendAudio()` (`src/talk/session-runtime.ts:102`), so a closed sink swallows provider events rather than crashing the session.

Mark-strategy is centralized at the bridge boundary (`src/talk/session-runtime.ts:121-134`) with three modes: `transport` (let transport ack the mark), `ack-immediately` (call `acknowledgeMark()` synchronously), or `ignore` (drop the mark entirely). This keeps provider implementations transport-agnostic.

### 2.2 Audio Formats

`RealtimeVoiceAudioFormat` is a closed discriminated union (`src/talk/provider-types.ts:11-21`):

- `g711_ulaw` / 8 kHz / mono (`REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ`, `src/talk/provider-types.ts:23-27`)
- `pcm16` / 24 kHz / mono (`REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ`, `src/talk/provider-types.ts:29-33`)

Two formats is the deliberate choice — eight kHz µ-law for telephony-class providers (Twilio, SIP), 24 kHz linear PCM for neural TTS providers (OpenAI Realtime, ElevenLabs). Anything else has to be transcoded by the provider plugin before `onAudio` fires.

### 2.3 Browser Session Union

`RealtimeVoiceBrowserSession` (`src/talk/provider-types.ts:179-183`) is a four-way union used when the bridge is initiated from a browser tab rather than a native app:

- `RealtimeVoiceBrowserWebRtcSdpSession` (`provider-types.ts:135-144`) — the gateway hands the browser a client secret + offer URL.
- `RealtimeVoiceBrowserJsonPcmWebSocketSession` (`provider-types.ts:146-157`) — direct provider WebSocket with PCM JSON frames.
- `RealtimeVoiceBrowserGatewayRelaySession` (`provider-types.ts:159-167`) — the Gateway owns the audio session and bridges audio between browser and provider.
- `RealtimeVoiceBrowserManagedRoomSession` (`provider-types.ts:169-177`) — third-party managed rooms (LiveKit-style).

iOS's Talk session is implemented with a WebRTC peer connection directly to the provider (`apps/ios/Sources/Voice/TalkRealtimeWebRTCSession.swift:23` default offer URL = `https://api.openai.com/v1/realtime/calls`). The Swift class maintains its own tool buffering, agent run tracking, and audio-session activation (`TalkRealtimeWebRTCSession.swift:39-54`).

### 2.4 Gateway Realtime Relay

`src/gateway/talk-realtime-relay.ts` is the largest single Talk file (1039 lines). It implements the Gateway-side bridge that turns a browser-side `gateway-relay` session into a provider bridge session. Constants at the top of the file define the operation envelope (`src/gateway/talk-realtime-relay.ts:53-60`):

| Constant | Value | Purpose |
|----------|-------|---------|
| `RELAY_SESSION_TTL_MS` | 30 minutes | Idle expiry per relay session |
| `MAX_AUDIO_BASE64_BYTES` | 512 KB | Hard cap per audio chunk |
| `MAX_RELAY_SESSIONS_PER_CONN` | 2 | Concurrency cap per WebSocket connection |
| `MAX_RELAY_SESSIONS_GLOBAL` | 64 | Global concurrency cap |
| `RELAY_TRANSCRIPT_ECHO_LOOKBACK_MS` | 12 s | Window for detecting assistant echo |
| `FORCED_CONSULT_FALLBACK_DELAY_MS` | 200 ms | Delay before forcing an agent consult |
| `FORCED_CONSULT_RESULT_MAX_CHARS` | 1800 | Length cap on forced-consult tool text |

The relay event payload union (`talk-realtime-relay.ts:62-103`) carries `ready`, `inputAudio`, `audio` (base64), `audioDone`, `clear`, `mark`, `transcript`, `toolCall`, `toolResult`, `toolProgress`, `error`, and `close` events — every callback the bridge produces has a corresponding relay event.

`RelaySession` (`talk-realtime-relay.ts:107-120`) tracks `id`, owning `connId`, the `bridge` facade, the per-session `TalkSessionController` (turn/audio activity state), `activeAgentRuns`, `activeAgentToolCalls`, `completedAgentToolCalls`, and the `forcedConsults` coordinator.

## 3. Talk Session Controller

`createTalkSessionController` (`src/talk/talk-session-controller.ts:91-200+`) is a per-session state machine for turn lifecycle, output audio activity, and a bounded recent-event buffer (default 20 events, `talk-session-controller.ts:95`).

`TalkSessionController` (`talk-session-controller.ts:52-65`) exposes:

```ts
type TalkSessionController = {
  readonly activeTurnId: string | undefined;
  readonly context: TalkEventContext;
  readonly outputAudioActive: boolean;
  readonly recentEvents: readonly TalkEvent[];
  clearActiveTurn(): void;
  emit<TPayload>(input: TalkEventInput<TPayload>): TalkEvent<TPayload>;
  ensureTurn(params?: { payload?: unknown; turnId?: string }): TalkEnsureTurnResult;
  startTurn(params?: { payload?: unknown; turnId?: string }): TalkEnsureTurnResult;
  endTurn(params?: { payload?: unknown; turnId?: string }): TalkTurnResult;
  cancelTurn(params?: { payload?: unknown; turnId?: string }): TalkTurnResult;
  finishOutputAudio(params?: { payload?: unknown; turnId?: string }): TalkEvent | undefined;
  startOutputAudio(params?: { payload?: unknown; turnId?: string }): TalkEnsureTurnResult;
};
```

Critical invariants at `talk-session-controller.ts:102-115` and `121-131`: turn ids are caller-supplied so async output callbacks cannot close a newer turn; `resolveActiveTurn()` returns `{ ok: false, reason: "stale_turn" }` for any operation against a turn that's already been ended. This is the same callback-token pattern the macOS app uses in Swift (`apps/macos/Sources/OpenClaw/VoiceSessionCoordinator.swift:12-21`), with `UUID` tokens instead of strings — a deliberate cross-language consistency.

The recent-event buffer is bounded by `maxRecentEvents` (`talk-session-controller.ts:102-108`); the comment makes the contract explicit: *"Keep only recent events for diagnostics; the authoritative transcript lives with downstream observers/loggers, so this bounded buffer must not grow with session length."*

## 4. Agent Consult Runtime

`src/talk/agent-consult-runtime.ts` (368 lines) is the bridge from realtime voice into the agent runtime. When the realtime provider calls a tool named `openclaw_agent_consult` (registered via `REALTIME_VOICE_AGENT_CONSULT_TOOL_NAME`, imported at `talk-realtime-relay.ts:8-10`), the consult runtime forks a child session and runs the agent against a transcript slice.

Key behavior at `agent-consult-runtime.ts:36-37` (`RealtimeVoiceAgentConsultContextMode = "isolated" | "fork"`):

- **`isolated`** — start a fresh session for the consult. Default for cross-agent or cross-user consults.
- **`fork`** — fork from the requester's session. Used when the realtime bridge should preserve the requester's conversation context.

Delivery-context resolution at `agent-consult-runtime.ts:96-128` walks three candidate keys in order: the requester session key, its base thread key, and the voice consult session itself. Whichever first has a routable `DeliveryContext` (with both `channel` and `to`) wins. The comment explains why: *"This preserves channel/account/thread routing when a voice bridge delegates back to agent."*

`resolveRealtimeVoiceAgentSandboxSessionKey` (`agent-consult-runtime.ts:66-74`) prefixes non-agent session keys with `agent:<agentId>:` so embedded-agent runs land in the right per-agent sandbox.

## 5. STT Plugins

### 5.1 Deepgram

Two STT surfaces in `extensions/deepgram/`:

- **Batch transcription** (`audio.ts:48-105`) — POST to `https://api.deepgram.com/v1/listen` with `model=nova-3` (`audio.ts:15-16`). Supports `language` and arbitrary `query` params forwarded to Deepgram's URL. The response walker at `audio.ts:23-46` rejects malformed JSON with a hard error rather than guessing.
- **Realtime transcription** (`realtime-transcription-provider.ts`) — WebSocket-based streaming. Constants at `realtime-transcription-provider.ts:55-62`:
  - `DEEPGRAM_REALTIME_DEFAULT_SAMPLE_RATE = 8000`
  - `DEEPGRAM_REALTIME_DEFAULT_ENCODING = "mulaw"`
  - `DEEPGRAM_REALTIME_DEFAULT_ENDPOINTING_MS = 800`
  - `DEEPGRAM_REALTIME_CONNECT_TIMEOUT_MS = 10_000`
  - `DEEPGRAM_REALTIME_CLOSE_TIMEOUT_MS = 5_000`
  - `DEEPGRAM_REALTIME_MAX_RECONNECT_ATTEMPTS = 5`
  - `DEEPGRAM_REALTIME_RECONNECT_DELAY_MS = 1000`
  - `DEEPGRAM_REALTIME_MAX_QUEUED_BYTES = 2 MB`

The encoding helper at `realtime-transcription-provider.ts:70-83` normalizes alias names: `pcm`, `pcm_s16le`, and `linear16` all map to `linear16`; `ulaw`, `g711_ulaw`, and `g711-mulaw` all map to `mulaw`. Event shape at `realtime-transcription-provider.ts:42-53` is the subset Deepgram sends: `type`, `channel.alternatives.transcript`, `is_final`, `speech_final`, `error`, `message`.

### 5.2 ElevenLabs STT and Azure Speech

`extensions/elevenlabs/realtime-transcription-provider.ts` ships ElevenLabs' STT surface. `extensions/azure-speech/` ships Azure's. Both follow the same plugin shape — `media-understanding-provider.ts` for batch, `realtime-transcription-provider.ts` for streaming — discovered via the `realtimeTranscriptionProviders` capability contract.

## 6. TTS Plugins

### 6.1 ElevenLabs

`extensions/elevenlabs/tts.ts` is the canonical speech implementation. Defaults at `speech-provider.ts:35-43`:

```ts
const DEFAULT_ELEVENLABS_VOICE_ID = "pMsXgVXv3BLzUgSXRplE";
const DEFAULT_ELEVENLABS_MODEL_ID = "eleven_multilingual_v2";
const DEFAULT_ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.5, similarityBoost: 0.75, style: 0,
  useSpeakerBoost: true, speed: 1,
};
```

Supported models at `speech-provider.ts:45-52`: `eleven_v3`, `eleven_multilingual_v2`, `eleven_flash_v2_5`, `eleven_flash_v2`, `eleven_turbo_v2_5` (auto-normalized to `eleven_flash_v2_5`), `eleven_turbo_v2` (auto-normalized to `eleven_flash_v2`), and `eleven_monolingual_v1`. The latency tier (`speech-provider.ts:109-117`) accepts integer 0–4; streaming latency optimization is auto-disabled for `eleven_v3` since that model doesn't support streaming (`tts.ts:105`).

Streaming endpoint is hit by appending `/stream` to the path (`tts.ts:100`). `assertElevenLabsVoiceSettings` (`tts.ts:19-30`) validates the voice settings before every request — `stability`, `similarityBoost`, `style` in `[0, 1]`, `speed` in `[0.5, 2]`. `resolveElevenLabsAcceptHeader` (`tts.ts:32-38`) returns `audio/mpeg` for any `mp3_*` output format and lets everything else default to the provider's binary content-type.

### 6.2 Gradium and Local CLI

`extensions/gradium/` ships the Gradium TTS provider. `extensions/tts-local-cli/` is a thin wrapper that shells out to a local TTS binary; defaults are loaded from `tts-local-cli`'s config block.

### 6.3 macOS MLX TTS

`apps/macos-mlx-tts/` is a separate SwiftPM target that exposes an Apple-Silicon-local TTS engine. The macOS app uses it via the `TalkMLXSpeechSynthesizer` class (`apps/macos/Sources/OpenClaw/TalkMLXSpeechSynthesizer.swift`). It's bundled into the macOS app rather than exposed as a standalone service because the MLX runtime is private to Apple Silicon and the SwiftPM product is consumed via `apps/macos/Package.swift` only.

### 6.4 Talk-Voice Plugin

`extensions/talk-voice/index.ts` is the user-facing `/voice` channel command (aliased to `/talkvoice` on Discord — `talk-voice/index.ts:103-107`). Three verbs:

- `voice status` (`talk-voice/index.ts:163-171`) — print the active Talk provider, configured voice id, and the masked API key prefix.
- `voice list [limit]` (`talk-voice/index.ts:173-189`) — list available voices (capped to 50, sliced to the requested `limit` or 12 by default).
- `voice set <voiceId|name>` (`talk-voice/index.ts:191-249`) — mutate the gateway config to switch voices. Gated by `requiresAdminToSetVoice` (`talk-voice/index.ts:116-125`): anyone holding `operator.admin` scope, or the owner, may mutate; everyone else gets `⚠️ /voice set requires operator.admin.`

The voice-list formatter at `talk-voice/index.ts:52-77` emits lines in the shape `- <name> [· <category>]`, `  id: <id>`, `  meta: <locale> · <gender> · <personality tags>`, `  note: <description>`. Voice lookup (`talk-voice/index.ts:79-95`) is exact-by-id → exact-by-name (lowercased) → partial-by-name (lowercased substring).

## 7. Voice Wake

### 7.1 macOS Voice Wake

`docs/platforms/mac/voicewake.md:19-27` enumerates the runtime constants:

- `triggerPauseWindow = 0.55 s` — minimum gap between the wake word and the next word before capture starts
- `silenceWindow = 2.0 s` — silence timeout while speech is flowing
- `triggerOnlySilenceWindow = 5.0 s` — silence timeout if only the wake word was heard
- `captureHardStop = 120 s` — hard stop to prevent runaway sessions
- `debounceAfterSend = 350 ms` — debounce between sessions after a send

The recognizer lives in `VoiceWakeRuntime` (referenced at `voicewake.md:21`), and the overlay in `VoiceWakeOverlayController`. Voice Wake and push-to-talk require macOS 26+ (`voicewake.md:12`); older macOS hides the settings UI and shows the version requirement instead.

Push-to-talk uses a `.flagsChanged` monitor on keyCode 61 with `.option` flag (`voicewake.md:36`) — observes events, never swallows them. The hotkey adopts visible overlay text as `adoptedPrefix` when triggered while the wake overlay is up (`voice-overlay.md:21`), so the user can press the hotkey mid-sentence and the wake text is preserved.

The audio tap on `VoiceWakeManager` (`apps/ios/Sources/Voice/VoiceWakeManager.swift:8-13`) enqueues `AVAudioPCMBuffer.deepCopy()` copies onto a thread-safe `AudioBufferQueue` (`VoiceWakeManager.swift:15-39`) because the AVAudio tap callback fires on a realtime audio thread (`// This callback is invoked on a realtime audio thread/queue. Keep it tiny and nonisolated.`). The deep-copy implementation at `VoiceWakeManager.swift:52-90` handles `floatChannelData`, `int16ChannelData`, and `int32ChannelData` cases.

### 7.2 Voice Session Coordinator

`apps/macos/Sources/OpenClaw/VoiceSessionCoordinator.swift` is the single owner of an active voice session. It's a `@MainActor @Observable` singleton (`VoiceSessionCoordinator.swift:5-7`) — not an actor. Each `Session` carries a `UUID` token (`VoiceSessionCoordinator.swift:13-21`) and stale or mismatched tokens are dropped (`VoiceSessionCoordinator.swift:59` — `guard let session, session.token == token else { return }`). Sources are `.wakeWord` or `.pushToTalk` (`VoiceSessionCoordinator.swift:10`).

The coordinator never owns overlay state itself — it forwards user actions through `VoiceWakeOverlayController` via the session token (`docs/platforms/mac/voice-overlay.md:19-20`). On `dismiss`, the overlay calls `VoiceSessionCoordinator.overlayDidDismiss`, which triggers `VoiceWakeRuntime.refresh(state:)` so manual X-dismiss, empty-text dismiss, and post-send dismiss all resume wake-word listening (`voice-overlay.md:22-23`). This is the load-bearing invariant: every dismiss path must re-arm the wake-word listener.

### 7.3 iOS Voice Wake

`apps/ios/Sources/Voice/VoiceWakeManager.swift` mirrors the macOS lifecycle (`VoiceWakeManager.swift:92-100` — `@MainActor @Observable final class`). Trigger words load from `VoiceWakePreferences` (`VoiceWakeManager.swift:98`). The shipped Android app forces Voice Wake to `off` on connect today (`docs/platforms/android.md:281`): *"Voice wake is implemented in source (`VoiceWakeMode`) but the shipping app runtime always forces it to `off` on connect — there is no user-facing toggle today."* This is honest about feature status — the source exists, the user toggle does not.

### 7.4 Swabble — Standalone Wake Daemon

`apps/swabble/` is a separate Swift package that ships a CLI wake daemon and a shared library. The CLI targets macOS 26 (SpeechAnalyzer + SpeechTranscriber) and is local-only: *"Local-only: Speech.framework on-device models; zero network usage."* (`apps/swabble/README.md:5`). Default wake word is `clawd` with alias `claude` (`README.md:6`).

The pipeline at `apps/swabble/Sources/SwabbleCore/Speech/SpeechPipeline.swift:30-80` builds an `AVAudioEngine` → `SpeechAnalyzer` → `SpeechTranscriber` chain. The `installTap(onBus: 0, bufferSize: 2048, ...)` callback at `SpeechPipeline.swift:55-59` boxes the buffer into an `UnsafeBuffer` struct and hands it to the analyzer.

`apps/swabble/Sources/SwabbleKit/WakeWordGate.swift:21-35` is the gating logic. `WakeWordGateConfig` carries `triggers`, `minPostTriggerGap = 0.45 s`, and `minCommandLength = 1`. The gate matches a trigger, then waits for the post-gap, then accepts a command of at least one character. This is the shared wake-gating library that the macOS app's voice overlay (`apps/macos/Sources/OpenClaw/VoiceWakeOverlayController+Session.swift`) consumes; iOS uses the same `SwabbleKit` import (`apps/ios/Sources/Voice/VoiceWakeManager.swift:6`).

### 7.5 Privacy Implications

Always-listening voice wake requires microphone + speech recognition permissions. macOS surfaces the OS-level prompts through `docs/platforms/mac/voicewake.md:39`. Speech recognition is processed **on-device** via Speech.framework — the Swabble README is explicit: *"Local-only: Speech.framework on-device models; zero network usage."* The capture window is bounded by `captureHardStop = 120 s` (`voicewake.md:24`) and the recognizer pauses during active push-to-talk capture (`voicewake.md:38`) so the two audio taps never run simultaneously.

## 8. Voice Talk Mode

`apps/macos/Sources/OpenClaw/TalkModeController.swift` is the macOS side of full-duplex Talk mode. The class is `@MainActor @Observable` (`TalkModeController.swift:4-6`), a single shared instance (`TalkModeController.swift:7`). It tracks a phase enum (`TalkModeController.swift:11` — `.idle` default), a paused flag (`TalkModeController.swift:12`), and orchestrates the overlay (`TalkModeController.swift:17-20`), the speech interrupt monitor (`TalkModeController.swift:21`), and the push-to-talk key monitor (`TalkModeController.swift:23-24`).

A key invariant at `TalkModeController.swift:23-24`: *"Talk Mode and Push-to-Talk share the right Option key — disable PTT while Talk Mode is active."* The wake-word runtime resumes only after Talk Mode audio is fully torn down (`TalkModeController.swift:26-31`) — this prevents the two audio sessions from racing.

iOS Talk mode uses WebRTC directly via `TalkRealtimeWebRTCSession` (`apps/ios/Sources/Voice/TalkRealtimeWebRTCSession.swift`). Key constants at `TalkRealtimeWebRTCSession.swift:27-33`:

- `toolCallTimeoutSeconds = 12` — per-tool-call timeout
- `toolResultTimeoutSeconds = 45` — tool-result delivery timeout
- `agentWaitSliceSeconds = 3` — agent wait poll slice
- `agentWaitRequestGraceSeconds = 15` — agent wait grace window
- `historyFallbackTimeoutSeconds = 5` — fallback transcript fetch timeout
- `stillWorkingDelaySeconds = 6` — "still working" placeholder delay
- `assistantPlaybackDrainGraceSeconds = 1.8` — drain time after playback ends

Default offer URL is `https://api.openai.com/v1/realtime/calls` (`TalkRealtimeWebRTCSession.swift:23`), so the iOS Talk mode is by default an OpenAI Realtime client. Other providers (ElevenLabs, Google, Azure) plug in via the provider plugin contract; the Talk Mode runtime only sees the bridge interface.

## 9. Voice → Canvas Combined Use Cases

The agent can drive both Canvas and voice in the same turn because Canvas commands and Talk commands are both first-class node commands in the same WebSocket surface (`docs/nodes/index.md:10`):

| Family | Commands |
|--------|----------|
| Canvas | `canvas.present`, `canvas.hide`, `canvas.navigate`, `canvas.eval`, `canvas.snapshot`, `canvas.a2ui.push`, `canvas.a2ui.reset` |
| Talk | `talk.ptt.start`, `talk.ptt.stop`, `talk.ptt.cancel`, `talk.ptt.once`, `talk.speak` |
| Screen | `screen.snapshot`, `screen.record` |
| Camera | `camera.list`, `camera.snap`, `camera.clip` |

Combined patterns:

- **Voice-controlled UI** — agent invokes `talk.speak` to read a UI affordance aloud while simultaneously calling `canvas.present` to show it. Canvas rendering happens in the WKWebView; audio is mixed into the device speaker.
- **Live transcription display** — when Talk mode produces a transcript via `transcript` events (`talk-realtime-relay.ts:75-81`), the agent can `canvas.eval` to push the latest partial text into a `<div>` on the Canvas page. The A2UI `text` component (`extensions/canvas/src/a2ui-jsonl.ts:32`) already renders a `usageHint: "body"` text primitive suitable for this.
- **Interactive voice agent with visual feedback** — the agent speaks through Talk mode, captures user input via Voice Wake, and pushes the next UI state via `canvas.a2ui.push` between turns. Each A2UI push goes through `canvas.a2ui.push` (`docs/platforms/mac/canvas.md:73-76`), which the Canvas plugin validates as A2UI v0.8 JSONL (`extensions/canvas/src/a2ui-jsonl.ts:44-95`).
- **Canvas → Agent deep links** — Canvas HTML can call `window.location.href = "openclaw://agent?message=Review this design"` to trigger a new agent run (`docs/platforms/mac/canvas.md:88-91`). The macOS app prompts for confirmation unless a valid key is provided (`canvas.md:103-105`).

## 10. The Canvas System

### 10.1 What Canvas Is

The Canvas system is an agent-controlled HTML/CSS/JS rendering surface embedded in client apps. The macOS app uses WKWebView (`docs/platforms/mac/canvas.md:10-12`). iOS and Android use their platform WebView equivalents and render either local Canvas files or a remote A2UI host page.

The agent drives Canvas through the Gateway WebSocket (`docs/platforms/mac/canvas.md:41-50`):

```bash
openclaw nodes canvas present --node <id>
openclaw nodes canvas navigate --node <id> --url "/"
openclaw nodes canvas eval --node <id> --js "document.title"
openclaw nodes canvas snapshot --node <id>
openclaw nodes canvas a2ui push --node <id> --text "Hello from A2UI"
```

Canvas state lives at `~/Library/Application Support/OpenClaw/canvas/<session>/` on macOS (`canvas.md:18`). The panel is served via a custom URL scheme `openclaw-canvas://<session>/<path>` (`canvas.md:21-25`):

```
openclaw-canvas://main/                         → <canvasRoot>/main/index.html
openclaw-canvas://main/assets/app.css           → <canvasRoot>/main/assets/app.css
openclaw-canvas://main/widgets/todo/            → <canvasRoot>/main/widgets/todo/index.html
```

The custom-scheme path blocks directory traversal (`canvas.md:108-109`). If no `index.html` exists at the root, the macOS app shows a built-in scaffold page (`canvas.md:27`).

### 10.2 Panel Behavior

The Canvas panel is borderless, resizable, anchored near the menu bar (or mouse cursor), remembers size and position per session, and auto-reloads when local Canvas files change (`canvas.md:30-34`). Only one Canvas panel is visible at a time; session switches as needed (`canvas.md:34`). Canvas can be disabled in Settings under **Allow Canvas**; when disabled, canvas node commands return `CANVAS_DISABLED` (`canvas.md:36-37`).

### 10.3 Canvas Plugin (Agent-Side)

`extensions/canvas/index.ts:14-23` enumerates the agent-callable commands:

```ts
const CANVAS_NODE_COMMANDS = [
  "canvas.present",
  "canvas.hide",
  "canvas.navigate",
  "canvas.eval",
  "canvas.snapshot",
  "canvas.a2ui.push",
  "canvas.a2ui.pushJSONL",
  "canvas.a2ui.reset",
];
```

The plugin registers three HTTP routes (`extensions/canvas/index.ts:79-100`) — `/__openclaw__/a2ui`, `/__openclaw__/canvas`, and `/__openclaw__/ws` (WebSocket) — under `auth: "plugin"` with the `canvas` node capability. The same plugin also registers the `canvas` agent tool (`extensions/canvas/index.ts:124-129`) and CLI feature (`extensions/canvas/index.ts:130-145`).

The tool schema at `extensions/canvas/src/tool-schema.ts:27-46` defines seven actions via TypeBox (`CANVAS_ACTIONS` at `tool-schema.ts:13-21`):

```ts
const CANVAS_ACTIONS = [
  "present", "hide", "navigate", "eval",
  "snapshot", "a2ui_push", "a2ui_reset",
] as const;
```

plus snapshot formats `["png", "jpg", "jpeg"]` (`tool-schema.ts:24`). Optional fields include `gatewayUrl`, `gatewayToken`, `timeoutMs`, `node`, `target`, `x/y/width/height` (for `present`), `url` (for `navigate`), `javaScript` (for `eval`), `outputFormat/maxWidth/quality/delayMs` (for `snapshot`), `jsonl`/`jsonlPath` (for `a2ui_push`).

### 10.4 Canvas Configuration

`extensions/canvas/src/config.ts:18-23` defines the host config shape:

```ts
type CanvasHostConfig = {
  enabled?: boolean;
  root?: string;
  port?: number;
  liveReload?: boolean;
};
```

Enabling (`config.ts:90-98`): the host server is enabled when `isTruthyEnvValue(process.env.OPENCLAW_SKIP_CANVAS_HOST)` is false, the plugin is enabled in config, and `host.enabled` is not explicitly false. The `OPENCLAW_SKIP_CANVAS_HOST` env var is the kill switch.

UI hints at `config.ts:103-126` expose the host config to the macOS settings page with `advanced: true` — these are power-user knobs.

### 10.5 HTTP Route Wiring

`extensions/canvas/src/http-route.ts:21-78` is the route adapter. The handler is lazy: `loadHostHandler()` (`http-route.ts:28-47`) only initializes the host when needed, and the promise is cached in `hostHandlerPromise` to avoid re-initialization on every request. The A2UI path is special-cased: `handleA2uiHttpRequest` handles `/__openclaw__/a2ui/...` (`http-route.ts:56-58`); the rest goes through `handler.handleHttpRequest`.

`handleUpgrade` (`http-route.ts:61-71`) handles WebSocket upgrades only for `/__openclaw__/ws`. This is the live-reload socket — when local Canvas files change, the host pushes a `reload` message and the WebView reloads.

### 10.6 macOS Canvas Window

`apps/macos/Sources/OpenClaw/CanvasWindowController.swift` is the WKWebView controller. Initialization at `CanvasWindowController.swift:41-48` sets `developerExtrasEnabled` and registers a `WKURLSchemeHandler` for every scheme in `CanvasScheme.allSchemes` — that's how `openclaw-canvas://` URLs resolve to local files instead of hitting the network.

The injected bridge script at `CanvasWindowController.swift:61-115` listens for `a2uiaction` events on the page. When the page dispatches an `a2uiaction` event with `payload.eventType === 'a2ui.action'`, the script builds a `userAction` object with `name`, `surfaceId`, `sourceComponentId`, `dataContextPath`, `timestamp`, and optional `context[]`, then forwards via `webkit.messageHandlers.openclawCanvasA2UIAction.postMessage(...)`.

The bridge falls back gracefully when the bundled A2UI shell (`globalThis.openclawA2UI` or `<openclaw-a2ui-host>`) is present — letting the shell handle richer context resolution (`CanvasWindowController.swift:96-107`). Without a native handler, the bridge **fails closed** instead of exposing an unattended deep-link credential to page JS (`CanvasWindowController.swift:109-111`).

### 10.7 Live Reload Injection

`extensions/canvas/src/host/a2ui-shared.ts:21-79` ships the live-reload snippet that's injected into every served Canvas HTML page. The snippet:

1. Defines `postToNode(payload)` that probes `globalThis.webkit.messageHandlers.openclawCanvasA2UIAction.postMessage` (iOS) and `globalThis.openclawCanvasA2UIAction.postMessage` (Android) — covers both mobile WebView interfaces with one helper.
2. Defines `sendUserAction(userAction)` that wraps the payload with an `id` (UUID via `crypto.randomUUID` or `Date.now()`).
3. Opens a WebSocket to `/__openclaw__/ws?oc_cap=<token>` and reloads on `"reload"` messages.

The injection point is `</body>` (`a2ui-shared.ts:75-79`); if `</body>` is missing, the snippet is appended to the end of the HTML. The snippet runs as soon as the page parses, before any other script.

### 10.8 A2UI Host Paths

`a2ui-shared.ts:7-13` defines the host paths:

```ts
export const A2UI_PATH = "/__openclaw__/a2ui";
export const CANVAS_HOST_PATH = "/__openclaw__/canvas";
export const CANVAS_WS_PATH = "/__openclaw__/ws";
```

The A2UI host URL by default is `http://<gateway-host>:18789/__openclaw__/a2ui/` (`docs/platforms/mac/canvas.md:61`). The macOS app auto-navigates to the A2UI host on first open when the Gateway advertises a Canvas host (`canvas.md:58-60`).

## 11. A2UI Protocol

### 11.1 Supported Versions

Canvas accepts **A2UI v0.8** server-to-client messages (`docs/platforms/mac/canvas.md:64-67`):

- `beginRendering`
- `surfaceUpdate`
- `dataModelUpdate`
- `deleteSurface`

`createSurface` (v0.9) is **not** supported yet. The validation helper at `extensions/canvas/src/a2ui-jsonl.ts:4-10` recognizes both:

```ts
const A2UI_ACTION_KEYS = [
  "beginRendering", "surfaceUpdate",
  "dataModelUpdate", "deleteSurface",
  "createSurface",
] as const;

export type A2UIVersion = "v0.8" | "v0.9";
```

A file that mixes v0.8 and v0.9 messages is rejected with `"mixed A2UI v0.8 and v0.9 messages in one file"` (`a2ui-jsonl.ts:86-88`). Each line must contain exactly one action key (`a2ui-jsonl.ts:69-74`).

### 11.2 Minimal Text Push

`buildA2UITextJsonl(text)` at `extensions/canvas/src/a2ui-jsonl.ts:16-41` is the smallest valid A2UI v0.8 payload — a `Column` with a single `Text` child. This is what `canvas.a2ui.push --text "Hello"` produces under the hood (`docs/platforms/mac/canvas.md:80-82`).

```jsonl
{"surfaceUpdate":{"surfaceId":"main","components":[{"id":"root","component":{"Column":{"children":{"explicitList":["text"]}}}},{"id":"text","component":{"Text":{"text":{"literalString":"Hello"},"usageHint":"body"}}}]}}
{"beginRendering":{"surfaceId":"main","root":"root"}}
```

### 11.3 Components

A2UI v0.8 components referenced in the OpenClaw docs include `Column`, `Text`, `Stack`, `Image`, and `Button` (`docs/platforms/mac/canvas.md:65`). Component definitions live in the bundled A2UI page shipped with the Canvas plugin.

### 11.4 Mobile A2UI Action Routing

The mobile apps restrict where A2UI button actions can be invoked:

- **Bundled app-owned A2UI page** — actions are accepted, sent back to the agent via `canvas.a2ui.push`/`canvas.a2ui.reset`.
- **Remote Gateway A2UI pages** — render-only on iOS and Android. Native A2UI button actions are accepted only from bundled app-owned pages (`docs/platforms/ios.md:220`, `docs/platforms/android.md:266`).

This split keeps user-interactive controls in trusted code paths and prevents arbitrary web pages from driving the agent.

## 12. Canvas / WebView Architecture Summary

| Layer | macOS | iOS | Android |
|-------|-------|-----|---------|
| Renderer | WKWebView (`apps/macos/Sources/OpenClaw/CanvasWindowController.swift`) | WKWebView (`docs/platforms/ios.md:209`) | Platform WebView (`docs/platforms/android.md:249`) |
| URL scheme | `openclaw-canvas://` (custom) | Hosted at `gateway:18789/__openclaw__/canvas/` | Hosted at `gateway:18789/__openclaw__/canvas/` |
| A2UI | Bundled app-owned page, render-only remote | Bundled app-owned page, render-only remote | Bundled app-owned page, render-only remote |
| Live reload | WebSocket `/__openclaw__/ws` injected via `a2ui-shared.ts:21-79` | Same injected snippet | Same injected snippet |
| File watcher | `CanvasFileWatcher` (referenced at `CanvasWindowController.swift:15`) | Gateway-side file watcher triggers reload | Gateway-side file watcher triggers reload |
| Background support | Always foreground (menu bar app) | Foreground only (`docs/platforms/ios.md:248`) | Foreground only (`docs/platforms/android.md:269`) |

The agent's tool surface (`extensions/canvas/index.ts:124-129`) is unified across all platforms — the same `canvas` tool works against any paired node that advertises the canvas capability. The Canvas plugin (`extensions/canvas/index.ts:118-123`) registers `canvas.*` commands as default-allowed on iOS, Android, macOS, Windows, and unknown platforms, with `foregroundRestrictedOnIos: true` because iOS suspends background WebView activity.

## 13. Cross-References

- **Talk realtime transport** — `src/talk/provider-types.ts:179-183` (browser session union), `src/talk/session-runtime.ts:75-158` (bridge factory)
- **Provider registry** — `src/talk/provider-registry.ts:25-83` (resolves `realtimeVoiceProviders` capability)
- **Agent consult** — `src/talk/agent-consult-runtime.ts:1-368` (forks sessions, resolves delivery context)
- **Gateway relay** — `src/gateway/talk-realtime-relay.ts:1-1039` (browser-relay transport)
- **macOS voice wake** — `docs/platforms/mac/voicewake.md:19-27` (runtime constants), `apps/macos/Sources/OpenClaw/VoiceSessionCoordinator.swift:1-145` (token-based coordinator)
- **macOS overlay lifecycle** — `docs/platforms/mac/voice-overlay.md:19-23` (single-owner invariant)
- **iOS WebRTC Talk** — `apps/ios/Sources/Voice/TalkRealtimeWebRTCSession.swift:27-33` (timeouts)
- **iOS voice wake** — `apps/ios/Sources/Voice/VoiceWakeManager.swift:8-39` (audio thread → buffer queue)
- **Swabble wake daemon** — `apps/swabble/Sources/SwabbleCore/Speech/SpeechPipeline.swift:30-80`, `apps/swabble/Sources/SwabbleKit/WakeWordGate.swift:21-55`
- **Talk-Voice plugin** — `extensions/talk-voice/index.ts:127-262` (the `/voice` channel command)
- **ElevenLabs TTS** — `extensions/elevenlabs/tts.ts:19-117`, `extensions/elevenlabs/speech-provider.ts:35-52`
- **Deepgram STT** — `extensions/deepgram/audio.ts:48-105`, `extensions/deepgram/realtime-transcription-provider.ts:55-83`
- **Canvas plugin** — `extensions/canvas/index.ts:14-145` (commands, HTTP routes, tool, CLI)
- **Canvas tool schema** — `extensions/canvas/src/tool-schema.ts:13-46`
- **Canvas config** — `extensions/canvas/src/config.ts:18-126`
- **A2UI validation** — `extensions/canvas/src/a2ui-jsonl.ts:4-95`
- **Live reload injection** — `extensions/canvas/src/host/a2ui-shared.ts:7-79`
- **Canvas HTTP routing** — `extensions/canvas/src/http-route.ts:21-78`
- **Canvas Swift bridge** — `apps/macos/Sources/OpenClaw/CanvasWindowController.swift:61-115` (A2UI bridge script)
- **Canvas macOS doc** — `docs/platforms/mac/canvas.md:10-116`

This covers the full realtime voice → A2UI Canvas loop. The next document moves outward from in-process audio/web to the cross-platform distribution surface that hosts these systems — native apps, container, Nix, and updates.