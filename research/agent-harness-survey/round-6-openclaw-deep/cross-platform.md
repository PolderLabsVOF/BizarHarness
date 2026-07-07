# OpenClaw Cross-Platform Distribution — Deep Dive

**Round:** 6 — OpenClaw deep dive
**Scope:** Distribution channels (npm, Docker, Nix, native installers), the macOS / Windows / iOS / Android native apps, the node-host "remote execution" mode, update mechanisms, and the onboarding wizard.
**Repo:** `repos/openclaw/` (commit captured 2026-07-06).

---

## 1. Distribution Strategy Overview

OpenClaw ships in seven different forms that target different audiences and deployment contexts:

| Channel | Audience | Update Path |
|---------|----------|-------------|
| npm package `openclaw` | CLI / VPS / WSL2 users | `npm i -g openclaw@latest` or `openclaw update` |
| pnpm global install | pnpm users | `pnpm add -g openclaw@latest` |
| Bun global install | Bun users (experimental) | `bun add -g openclaw@latest` |
| macOS `.dmg` / `.zip` | Native macOS menu bar users | Sparkle (`appcast.xml`) |
| Windows Hub installer | Windows 10/11 desktop users | Windows installer (NSIS/MSI); companion to CLI |
| iOS App Store | iPhone + Apple Watch | App Store |
| Google Play | Android phone users | Play Store |
| Docker image | Headless VPS / homelab | GHCR + Docker Hub mirror |
| Nix (`nix-openclaw`) | NixOS / Home Manager users | `home-manager switch` |
| Source build (`git checkout`) | Contributors | `git pull` + `pnpm install` + `pnpm build` |

The version convention is `YYYY.M.PATCH` (e.g., `2026.6.11`), and the latest at the time of capture is `2026.6.11` (`appcast.xml:7`). Stable and beta tags determine the patch train; alpha/nightlies use `alpha.N` suffix on the next unreleased train (per the root `AGENTS.md` "security-release" rules).

## 2. macOS Desktop App

### 2.1 Tech Stack

The macOS app is **native Swift/SwiftUI** (not Electron, not Tauri). It lives under `apps/macos/` with `Package.swift` declaring the SwiftPM products. The source directory has hundreds of Swift files organized by concern:

- `apps/macos/Sources/OpenClaw/Canvas*` — Canvas WebView, scheme handler, window controller
- `apps/macos/Sources/OpenClaw/Voice*` / `Talk*` — voice wake, push-to-talk, Talk mode
- `apps/macos/Sources/OpenClaw/CLIInstaller*` — bundled installer script that bootstraps a Node runtime + openclaw CLI under `~/.openclaw`
- `apps/macos/Sources/OpenClaw/ChannelsSettings*` — per-channel configuration UI
- `apps/macos/Sources/OpenClaw/AppState*` / `AppStateStore*` — `@Observable` settings store

Per `docs/platforms/macos.md:50-57`, the app owns:

- Menu bar status, notifications, health, and WebChat
- macOS permission prompts for screen, microphone, speech, automation, accessibility
- Local node tools: Canvas, camera/screen capture, notifications, `system.run`
- Exec approval prompts for Mac-hosted commands
- Remote-mode SSH tunnels or direct Gateway connections

### 2.2 Tray Icon, Menu Bar

The app is a menu bar companion — no Dock icon by default. Per `docs/platforms/macos.md:10-12`: *"The macOS app is the OpenClaw menu bar companion: native tray UI, macOS permission prompts, notifications, WebChat, voice input, Canvas, and Mac-hosted node tools such as `system.run`."*

Launchd management (`docs/platforms/mac/bundled-gateway.md:40-50`):

- Label: `ai.openclaw.gateway` (default profile), or `ai.openclaw.<profile>` for a named profile
- Plist location (per-user): `~/Library/LaunchAgents/ai.openclaw.gateway.plist`
- The macOS app owns LaunchAgent install/update for the default profile in Local mode; the CLI can also install directly via `openclaw gateway install`
- "OpenClaw Active" toggles the LaunchAgent; quitting the app does **not** stop the Gateway — launchd keeps it alive
- Logging: `~/Library/Logs/openclaw/gateway.log` (per-profile names use `gateway-<profile>.log`)

### 2.3 Permission Flow

The macOS app is the front door for macOS TCC (Transparency, Consent, and Control) prompts. From `docs/platforms/macos.md:53`: *"macOS permission prompts for screen, microphone, speech, automation, and accessibility."* The first-run checklist (`docs/platforms/macos.md:31-37`) is permission-by-permission:

1. Install and launch `OpenClaw.app`.
2. Pick "This Mac" for a local Gateway or connect to a remote one.
3. Local mode: wait while the app installs its user-space runtime and Gateway.
4. Complete provider setup and the macOS permission checklist.
5. Send the onboarding test message.

### 2.4 Auto-Update via Sparkle

Sparkle is the macOS auto-update framework. The appcast feed lives at the repo root: `appcast.xml`. Entry format (`appcast.xml:8-12`):

```xml
<item>
  <title>2026.6.11</title>
  <pubDate>Tue, 30 Jun 2026 17:39:25 +0000</pubDate>
  <link>https://raw.githubusercontent.com/openclaw/openclaw/main/appcast.xml</link>
  <sparkle:version>2606001190</sparkle:version>
  <sparkle:shortVersionString>2026.6.11</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>
  <description><![CDATA[...]]></description>
</item>
```

Notes:

- `<sparkle:version>` is the integer-encoded `YYYYMMDDHHMM` build number (`2606001190` = `2026.6.11 90`).
- `<sparkle:shortVersionString>` is the user-visible `YYYY.M.PATCH`.
- `<sparkle:minimumSystemVersion>15.0</sparkle:minimumSystemVersion>` is the macOS floor — OpenClaw requires macOS 15.0+.
- Delta updates via binary delta files are supported (per R2).
- Beta channel entries use `sparkle:channel="openclaw-beta"` (per R2).

## 3. Windows Hub

### 3.1 Why a "Hub"

Windows gets its own native companion app, **Windows Hub**, which is a **WinUI** app (`docs/platforms/windows.md:17-20`):

> *"Windows Hub is the native WinUI companion app for Windows 10 20H2+ and Windows 11. It installs without administrator privileges and ships as signed x64 and ARM64 installers on OpenClaw releases."*

The Hub is positioned as the recommended Windows entry point (`docs/platforms/windows.md:16`). Direct download links:

- `OpenClawCompanion-Setup-x64.exe`
- `OpenClawCompanion-Setup-arm64.exe`
- `OpenClawCompanion-SHA256SUMS.txt`

### 3.2 Windows Hub Features

Per `docs/platforms/windows.md:39-48`, Windows Hub includes:

- System tray status and launch-at-login
- First-run setup for a local app-owned WSL Gateway
- Connection settings for local, remote, and SSH-tunneled Gateways
- Native chat window plus browser Control UI access
- Command Center diagnostics for sessions, usage, channels, nodes, pairing, and repair
- Windows node mode for agent-controlled canvas, screen, camera, notifications, device status, talk, and `system.run`
- Local MCP server mode for MCP clients such as Claude Desktop, Claude Code, Cursor

### 3.3 Windows Node Mode

From `docs/platforms/windows.md:70-94`, Windows node mode exposes a fixed command taxonomy:

| Family | Commands |
|--------|----------|
| Canvas | `canvas.present`, `canvas.hide`, `canvas.navigate`, `canvas.eval`, `canvas.snapshot` |
| Screen | `screen.snapshot`; `screen.record` requires explicit opt-in |
| Camera | `camera.list`; `camera.snap`, `camera.clip` require explicit opt-in |
| System | `system.notify`, `system.run`, `system.run.prepare`, `system.which` |
| Device | `location.get`, `device.info`, `device.status` |
| Talk | `talk.ptt.start`, `talk.ptt.stop`, `talk.ptt.cancel`, `talk.ptt.once`, `talk.speak` |

The "explicit opt-in" caveat: `screen.record`, `camera.snap`, and `camera.clip` need `gateway.nodes.allowCommands` opt-in (`docs/platforms/windows.md:96-97`).

### 3.4 Local MCP Server Mode

Windows Hub can run as a **local MCP server on loopback** (`docs/platforms/windows.md:99-104`), so MCP-aware clients (Claude Desktop, Claude Code, Cursor) can drive Windows capabilities without running an OpenClaw Gateway. The mode matrix is explicit (`docs/platforms/windows.md:107-115`):

| Node mode | MCP server | Behavior |
|-----------|------------|----------|
| off | off | Operator-only desktop app |
| on | off | Gateway-connected Windows node |
| off | on | Local MCP server only |
| on | on | Gateway node plus local MCP server |

### 3.5 Native Windows CLI

For terminal-first Windows users, OpenClaw ships a PowerShell installer (`docs/platforms/windows.md:117-129`):

```powershell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

Managed startup uses Windows Scheduled Tasks when available. The task launches a generated `gateway.vbs` WScript wrapper so the background Gateway does not open a visible console window. If task creation is denied, OpenClaw falls back to a per-user Startup-folder login item (`docs/platforms/windows.md:133-137`).

### 3.6 WSL2 Gateway

WSL2 is the recommended Linux-compatible Gateway runtime on Windows (`docs/platforms/windows.md:153-157`). Windows Hub can set up an app-owned WSL Gateway, or you can install manually in any distro:

```powershell
wsl --install
# or:
wsl --list --online
wsl --install -d Ubuntu-24.04
```

The systemd-in-WSL guidance at `docs/platforms/windows.md:166-174` enables systemd so the user-mode systemd unit works:

```bash
sudo tee /etc/wsl.conf >/dev/null <<'EOF'
[boot]
systemd=true
EOF
```

A documented quirk at `docs/platforms/windows.md:215-228` explains two changes from older recipes: `dbus-launch true` instead of `/bin/true` to keep WSL ≥ 2.6.1.0 distros alive after the last client exits, and `/ru "$env:USERNAME"` instead of `/ru SYSTEM` because per-user WSL distros are not visible to the SYSTEM account.

## 4. iOS App

### 4.1 What the iOS App Is

Per `docs/platforms/ios.md:9-25`, the iOS app is a **node** (companion device) that connects to the Gateway over WebSocket — it does **not** host the Gateway. Capabilities exposed:

- Canvas, Screen snapshot, Camera capture, Location, Talk mode, Voice wake
- `node.invoke` commands for the agent
- Read-only Agents Files browser (`agents.workspace.list` / `agents.workspace.get`) with directory drill-down, syntax-highlighted text previews, image previews, and share-sheet export
- Small read-only offline cache of recent chat sessions and transcripts per paired gateway
- Durable per-gateway outbox (up to 50 messages) for offline sends; queued bubbles render in the transcript and flush in order on reconnect with idempotent retries; expires after 48 hours offline
- "Listen" long-press action that plays supported gateway `tts.speak` clips with the configured TTS provider, falling back to on-device speech when gateway audio is unavailable

### 4.2 Architecture

- `apps/ios/Sources/Voice/` — Voice wake, Talk mode, Talk client (WebRTC and gateway-relay)
- `apps/ios/Sources/swabble/SwabbleKit/` — shared wake-gate library
- `apps/ios/Sources/Gateway/` — gateway WebSocket client + pairing
- `apps/ios/Sources/Chat/` — chat UI
- `apps/ios/Sources/Voice/TalkRealtimeWebRTCSession.swift` — full-duplex Talk over WebRTC

The iOS Talk session opens directly to OpenAI Realtime via WebRTC by default (`TalkRealtimeWebRTCSession.swift:23`: `defaultOfferURL = "https://api.openai.com/v1/realtime/calls"`). Consult and control tools are registered at the session level (`TalkRealtimeWebRTCSession.swift:21-22`):

```swift
private static let consultToolName = "openclaw_agent_consult";
private static let controlToolName = "openclaw_agent_control";
```

### 4.3 Discovery and Pairing

Per `docs/platforms/ios.md:186-197`, the iOS app uses three discovery paths:

- **Bonjour** on `local.` for same-LAN gateways
- **Tailnet** via unicast DNS-SD (`openclaw.internal.`)
- **Manual host/port** as fallback

Pairing is via the QR code or setup code at `docs/platforms/ios.md:46-51` — Settings → Gateway → scan QR. Multiple paired gateways are remembered (`docs/platforms/ios.md:201-206`) and switching gateways tears down the current sessions and reconnects; TLS pin, device tokens, and cached chats are stored per-gateway.

### 4.4 Push Relay for App Store Builds

Official distributed iOS builds use an external **push relay** (`docs/platforms/ios.md:97-104`) — `https://ios-push-relay.openclaw.ai` for App Store builds. The relay enforces two constraints direct APNs-on-gateway cannot provide for official iOS builds (`docs/platforms/ios.md:149-152`):

- Only genuine OpenClaw iOS builds distributed through Apple can use the hosted relay.
- A gateway can send relay-backed pushes only for iOS devices that paired with that specific gateway.

The auth flow involves App Attest + StoreKit app transaction JWS (`docs/platforms/ios.md:118-119`). The relay returns an opaque relay handle + registration-scoped send grant; the gateway stores the relay handle and send grant from `push.apns.register` and uses them for `push.test`, reconnect wakes, and wake nudges (`docs/platforms/ios.md:120-123`).

The build-time env var `OPENCLAW_PUSH_RELAY_BASE_URL` only affects local/sandbox iOS build modes (`docs/platforms/ios.md:144-145`). The App Store release build hardcodes the hosted relay host and never reads a relay-URL override.

### 4.5 Background Alive Beacons

When iOS wakes the app for a silent push, background refresh, or significant-location event, the app attempts a short node reconnect and calls `node.event` with `event: "node.presence.alive"` (`docs/platforms/ios.md:137-139`). The gateway records this as `lastSeenAtMs`/`lastSeenReason` only after the authenticated node device identity is known.

## 5. Android App

### 5.1 What the Android App Is

Per `docs/platforms/android.md:11-23`, the Android app is a companion node (Android does not host the Gateway). It is available on Google Play (`ai.openclaw.app`) and from source via `apps/android/`. The app is **native Kotlin** (per `apps/android/build.gradle.kts` and `apps/android/AGENTS.md`).

### 5.2 Connection Runbook

The Android app connects directly to the Gateway WebSocket via device pairing (`role: node`) (`docs/platforms/android.md:121-124`). For Tailscale or public hosts, Android requires a secure endpoint (`docs/platforms/android.md:127-129`):

- Preferred: Tailscale Serve / Funnel with `https://<magicdns>` / `wss://<magicdns>`
- Also supported: any other `wss://` Gateway URL with a real TLS endpoint
- Cleartext `ws://` is still supported on private LAN addresses, `.local` hosts, `localhost`, `127.0.0.1`, and the Android emulator bridge (`10.0.2.2`)

### 5.3 Foreground Service for Connection

The app keeps its gateway connection alive via a **foreground service** (persistent notification) (`docs/platforms/android.md:188-190`). The service declares `FOREGROUND_SERVICE_CONNECTED_DEVICE` with `CHANGE_NETWORK_STATE`; Android 14+ also requires `FOREGROUND_SERVICE_MICROPHONE`, the `RECORD_AUDIO` runtime grant, and the microphone service type at runtime (`docs/platforms/android.md:278`).

### 5.4 Voice Wake Status

`docs/platforms/android.md:281`: *"Voice wake is implemented in source (`VoiceWakeMode`) but the shipping app runtime always forces it to `off` on connect — there is no user-facing toggle today."* This is more conservative than the macOS app, which has a user-facing Voice Wake toggle. The source code is there, but the shipping product does not expose it.

### 5.5 Talk Mode on Android

Talk Mode promotes the existing foreground service from `connectedDevice` to `connectedDevice|microphone` before capture starts, then demotes it when Talk Mode stops (`docs/platforms/android.md:278`). By default, Android Talk uses native speech recognition, Gateway chat, and `talk.speak` through the configured gateway Talk provider. Local system TTS is used only when `talk.speak` is unavailable (`docs/platforms/android.md:279-280`).

Android Talk uses realtime Gateway relay only when `talk.realtime.mode` is `realtime` and `talk.realtime.transport` is `gateway-relay` (`docs/platforms/android.md:280`).

### 5.6 App Actions for Assistant Launch

Android supports launching OpenClaw from the system assistant trigger (`docs/platforms/android.md:298-301`): holding the home button (or another `ACTION_ASSIST` trigger) opens the app; saying "Hey Google, ask OpenClaw `<prompt>`" matches the app's declared App Actions query pattern and hands the prompt into the chat composer without auto-sending it. Uses Android App Actions (`shortcuts.xml` capability) declared in the app manifest.

### 5.7 Notification Forwarding

Android can forward device notifications to the gateway as `node.event` items (`docs/platforms/android.md:307-323`):

| Setting | Description |
|---------|-------------|
| Forward Notification Events | Master toggle; off by default; requires Notification Listener Access |
| Package Filter | Allowlist or Blocklist; WhatsApp/Telegram/Discord/Signal are always excluded |
| Quiet Hours | HH:mm start/end window; defaults to 22:00-07:00 when enabled |
| Max Events / Minute | Per-device rate limit; default 20 |
| Route Session Key | Optional pin to a specific session |

## 6. The Node Mode

### 6.1 What a Node Is

Per `docs/nodes/index.md:10`: *"A **node** is a companion device (macOS/iOS/Android/headless) that connects to the Gateway **WebSocket** (same port as operators) with `role: "node"` and exposes a command surface (e.g. `canvas.*`, `camera.*`, `device.*`, `notifications.*`, `system.*`) via `node.invoke`."*

The Gateway host runs the model and routes tool calls; the node host executes the commands. Approvals are enforced on the **node host** via `~/.openclaw/exec-approvals.json` (`docs/nodes/index.md:60-66`).

### 6.2 Starting a Headless Node Host

```bash
openclaw node run --host <gateway-host> --port 18789 --display-name "Build Node"
```

`docs/nodes/index.md:82` lists the flags:

- `--context-path` — Gateway WS context path
- `--tls` — enable TLS
- `--tls-fingerprint <sha256>` — pin the TLS cert
- `--node-id` — override the node id (clears the pairing token)

Or install as a service:

```bash
openclaw node install --host <gateway-host> --port 18789 --display-name "Build Node"
openclaw node start
openclaw node restart
```

The node host stores node id, token, display name, and gateway connection info in `~/.openclaw/node.json` (`docs/nodes/index.md:131`).

### 6.3 Local-Only Mode

A "local-only" mode for the node host exists in two flavors:

1. **macOS app-as-node** — the macOS menu bar app connects to the Gateway WS server as a node, so `openclaw nodes …` works against this Mac. In remote mode, the app opens an SSH tunnel for the Gateway port and connects to `localhost` (`docs/nodes/index.md:491-494`).

2. **Headless node host on macOS** — executes `system.run` locally by default. Set `OPENCLAW_NODE_EXEC_HOST=app` to route `system.run` through the companion app exec host; add `OPENCLAW_NODE_EXEC_FALLBACK=0` to require the app host and fail closed if unavailable (`docs/nodes/index.md:488`).

### 6.4 Command Policy

Per `docs/nodes/index.md:189-213`, node commands pass two gates before they can be invoked:

1. The node must declare the command in its WebSocket `connect.commands` list.
2. The gateway's platform-and-approval-derived allowlist must include the declared command.

Default allowlists by platform (`docs/nodes/index.md:196-204`):

| Platform | Commands allowed by default |
|----------|---------------------------|
| iOS | `camera.list`, `location.get`, `device.info`, `device.status`, `contacts.search`, `calendar.events`, `reminders.list`, `photos.latest`, `motion.activity`, `motion.pedometer`, `system.notify` |
| Android | `camera.list`, `location.get`, `notifications.list`, `notifications.actions`, `system.notify`, `device.info`, `device.status`, `device.permissions`, `device.health`, `device.apps`, `contacts.search`, `calendar.events`, `callLog.search`, `reminders.list`, `photos.latest`, `motion.activity`, `motion.pedometer` |
| macOS | `camera.list`, `location.get`, `device.info`, `device.status`, `contacts.search`, `calendar.events`, `reminders.list`, `photos.latest`, `motion.activity`, `motion.pedometer`, `system.notify` |
| Windows | `camera.list`, `location.get`, `device.info`, `device.status`, `system.notify` |
| Linux | `system.notify` |

`canvas.*` commands default-allow on iOS, Android, macOS, Windows, and unknown platforms (not Linux); all of them are foreground-restricted on iOS (`docs/nodes/index.md:204`).

`talk.ptt.start`, `talk.ptt.stop`, `talk.ptt.cancel`, and `talk.ptt.once` are allowed by default for any node that advertises the `talk` capability or declares `talk.*` commands, independent of platform label (`docs/nodes/index.md:206`).

Dangerous or privacy-heavy commands still require explicit opt-in with `gateway.nodes.allowCommands` even if the node declares them: `camera.snap`, `camera.clip`, `screen.record`, `contacts.add`, `calendar.add`, `reminders.add`, `sms.send`, `sms.search`. `gateway.nodes.denyCommands` always wins (`docs/nodes/index.md:210`).

### 6.5 Approval Binding

Approval-backed node runs bind exact request context. Per `docs/nodes/index.md:70-72`:

> *"The exec path prepares a canonical `systemRunPlan` before approval; once granted, the gateway forwards that stored plan, not any later caller-edited command/cwd/session fields, and re-validates the working directory before running. For direct shell/runtime file executions, OpenClaw also best-effort binds one concrete local file operand and denies the run if that file changes before execution."*

This is the kind of safety property Bizar's `bizar approval` mechanism (per Round 3) aspires to — the approval binds to the request, not to a later re-evaluation.

### 6.6 Version Skew

The Gateway accepts authenticated node clients across an **N-1 protocol window** (`docs/nodes/index.md:45-49`). Current v4 Gateway accepts v3 nodes when the connection declares both `role: "node"` and `client.mode: "node"`. Operator and UI sessions must use the current protocol. For staged fleet upgrades, upgrade the Gateway first, then upgrade each node — an N-1 node remains visible and manageable while it is upgraded.

## 7. Update Mechanism

### 7.1 The `openclaw update` Command

The recommended update path is `openclaw update` (`docs/install/updating.md:11-17`):

```bash
openclaw update                    # default channel
openclaw update --channel beta
openclaw update --channel extended-stable
openclaw update --channel dev
openclaw update --dry-run          # preview without applying
```

The command detects install type (npm or git), fetches the latest version, runs `openclaw doctor`, and restarts the gateway. Channel semantics (`docs/install/updating.md:32-59`):

| Channel | Behavior |
|---------|----------|
| `stable` | Prefers beta dist-tag, falls back to stable/latest if beta missing or older |
| `extended-stable` | Package-only, foreground-only; no automatic apply; verifies exact package, fails closed if inconsistent |
| `beta` | Checks every `betaCheckIntervalHours` (default 1) and applies immediately |
| `dev` | Persistent moving GitHub `main` checkout |

The auto-update config (`docs/install/updating.md:197-219`):

```json
{
  "update": {
    "channel": "stable",
    "auto": {
      "enabled": true,
      "stableDelayHours": 6,
      "stableJitterHours": 12,
      "betaCheckIntervalHours": 1
    }
  }
}
```

| Channel | Behavior |
|---------|----------|
| `stable` | Waits `stableDelayHours` (default 6), then applies with deterministic jitter across `stableJitterHours` (default 12) |
| `extended-stable` | No startup check or automatic apply. Use `openclaw update` manually |
| `beta` | Checks every `betaCheckIntervalHours` (default 1) and applies immediately |
| `dev` | No automatic apply. Use `openclaw update` manually |

`OPENCLAW_NO_AUTO_UPDATE=1` blocks automatic applies even when `update.auto.enabled` is configured (`docs/install/updating.md:222`).

### 7.2 Sparkle (macOS)

macOS updates use Sparkle independently from `openclaw update` (which is CLI-side). The Sparkle feed is `appcast.xml` (see Section 2.4). Channel-level beta is delivered via `sparkle:channel="openclaw-beta"` entries in the same appcast.

### 7.3 App Store / Play Store

The iOS and Android apps are updated through their respective stores. The `apps/ios/AGENTS.md:31-49` policy is explicit:

- Agent-driven App Store uploads must use only `pnpm ios:release:upload`
- App Store uploads must include explicit release intent: `pnpm ios:release:upload -- --version <YYYY.M.D>` and `--build-number <n>`
- If the command exits non-zero, **stop immediately** and report the failing step
- After a failed upload, do not continue with `pnpm ios:release:archive`, `asc builds upload`, `asc release stage`, `asc publish appstore`, `asc review submit`, direct Fastlane lanes, or any manual App Store Connect mutation command
- Do not submit an iOS App Store version for App Review — App Review submission stays manual unless explicitly asked
- `pnpm ios:release:archive` is for local archive validation only — not a fallback release path

### 7.4 Rollback

`docs/install/updating.md:260-283` covers rollback for npm and source installs:

```bash
# npm pin
npm i -g openclaw@<version>
openclaw doctor
openclaw gateway restart

# source pin
git fetch origin
git checkout "$(git rev-list -n 1 --before=\"2026-01-01\" origin/main)"
pnpm install && pnpm build
openclaw gateway restart
```

For Nix-managed installs, the `home-manager switch --rollback` invocation restores the previous generation (`docs/install/nix.md:20-21`).

### 7.5 Versioning Strategy

The `YYYY.M.PATCH` format pins the month (`M`) and increments `PATCH` sequentially within that month (per root `AGENTS.md` "security-release" rules):

> *"Release versions use `YYYY.M.PATCH`, where `PATCH` is a sequential monthly release-train number, never the calendar day. Stable and beta tags determine the current train; alpha-only tags do not consume or advance the beta/stable patch number. After `2026.6.5`, the next beta train is `2026.6.6-beta.1` even if higher alpha-only tags exist."*

This is the OpenClaw equivalent of monthly Chrome trains — calendar-bound but not day-bound, so emergency patches don't double up with normal releases.

## 8. Docker Deployment

### 8.1 Multi-Stage Dockerfile

`Dockerfile:1-358` is a four-stage build:

1. **`workspace-deps`** (`Dockerfile:29-48`) — extracts only `package.json` files for workspaces and the build-time extension list, so the main build layer doesn't invalidate on source changes.
2. **`bun-binary`** (`Dockerfile:51`) — copies the pinned Bun 1.3.13 binary from the official image.
3. **`build`** (`Dockerfile:52-137`) — runs `pnpm install --frozen-lockfile` with `--max-old-space-size=2048` to avoid OOM-kill on small VMs (`Dockerfile:78-82`), then `pnpm build:docker` and `pnpm ui:build`. Falls back to stubbing the A2UI bundle under QEMU cross-compilation (`Dockerfile:118-124`).
4. **`runtime-assets`** (`Dockerfile:141-168`) — prunes dev deps, removes plugin runtime packages, deletes `.d.ts`/`.d.mts`/`.d.cts`/`.map` files.
5. **`base-runtime`** + **`runtime`** (`Dockerfile:171-358`) — final `node:24-bookworm-slim` image. Runs as the `node` user (`Dockerfile:341`), exposes `node openclaw.mjs gateway` as the entrypoint (`Dockerfile:357-358`).

Base images are pinned to **SHA256 digests** for reproducible builds (`Dockerfile:22-27`). Dependabot refreshes the blessed digests.

### 8.2 Docker Compose

`docker-compose.yml` defines two services:

- **`openclaw-gateway`** (`docker-compose.yml:1-90`) — binds ports `18789` (gateway), `18790` (bridge), `3978` (MS Teams). Drops `NET_RAW` and `NET_ADMIN` capabilities (`docker-compose.yml:56-58`). Sets `security_opt: no-new-privileges: true` (`docker-compose.yml:59-60`). Uses `extra_hosts: ["host.docker.internal:host-gateway"]` (`docker-compose.yml:61-62`) so bundled local-model providers reach LM Studio/Ollama on the host. Healthcheck hits `http://127.0.0.1:18789/healthz` every 30s (`docker-compose.yml:79-90`).

- **`openclaw-cli`** (`docker-compose.yml:92-129`) — shares the gateway's network namespace (`network_mode: "service:openclaw-gateway"`) so `openclaw` CLI commands reach the gateway container directly.

Volume mounts (`docker-compose.yml:41-44`) are the canonical config/state dirs:

```yaml
volumes:
  - "${OPENCLAW_CONFIG_DIR:-${HOME:-/tmp}/.openclaw}:/home/node/.openclaw"
  - "${OPENCLAW_WORKSPACE_DIR:-${HOME:-/tmp}/.openclaw/workspace}:/home/node/.openclaw/workspace"
  - "${OPENCLAW_AUTH_PROFILE_SECRET_DIR:-${HOME:-/tmp}/.openclaw-auth-profile-secrets}:/home/node/.config/openclaw"
```

### 8.3 Production Considerations

- **Loopback bind default** (`Dockerfile:344-356`) — the gateway binds `127.0.0.1` by default. With Docker bridge networking, this is unreachable from the host. Either use `--network host` or override `--bind` to `lan`.
- **Sandbox support** — `Dockerfile:282-315` adds Docker CLI support via `OPENCLAW_INSTALL_DOCKER_CLI=1`. The Dockerfile verifies Docker's GPG fingerprint (`OPENCLAW_DOCKER_GPG_FINGERPRINT="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"`) before trusting the apt key.
- **Browser sandbox** — `Dockerfile:266-276` supports `OPENCLAW_INSTALL_BROWSER=1` to bake Chromium into the image (~300MB) and skip the 60-90s Playwright install on first container start.
- **Image registries** — `docs/install/docker.md:35-44` says GHCR is the primary registry (`ghcr.io/openclaw/openclaw`) with a Docker Hub mirror (`openclaw/openclaw`). Official tags: `main`, `latest`, `<version>` (e.g., `2026.6.11`), and beta tags (`2026.6.11-beta.1`). A `-browser` variant (`latest-browser`) ships with Chromium.
- **User setup** — `Dockerfile:326-334` pre-creates `/home/node/.openclaw`, `/home/node/.openclaw/workspace`, `/home/node/.config/openclaw` with proper ownership before the container drops to the non-root `node` user.

### 8.4 Airgapped Deployments

`docs/install/docker.md:48-61` covers offline installs:

```bash
docker load -i openclaw-image.tar
export OPENCLAW_IMAGE="ghcr.io/openclaw/openclaw:latest"
./scripts/docker/setup.sh --offline
```

`--offline` verifies `OPENCLAW_IMAGE` already exists locally, disables implicit Compose pulls/builds, then runs the normal flow: `.env` sync, permission fixes, onboarding, gateway config sync, Compose startup.

## 9. Nix Deployment

### 9.1 nix-openclaw

The first-party Nix entry point is the sibling repo **`openclaw/nix-openclaw`** (`docs/install/nix.md:10`):

> *"Install OpenClaw declaratively with **[nix-openclaw](https://github.com/openclaw/nix-openclaw)**, the first-party, batteries-included Home Manager module."*

What you get (`docs/install/nix.md:16-22`):

- Gateway + macOS app + tools (whisper, spotify, cameras), all pinned
- Launchd service that survives reboots
- Plugin system with declarative config
- Instant rollback: `home-manager switch --rollback`

Quick start (`docs/install/nix.md:26-47`):

1. Install Determinate Nix.
2. Create a local flake using the `templates/agent-first/flake.nix` from the nix-openclaw repo.
3. Configure secrets (messaging bot token, model provider API key) — plain files at `~/.secrets/` work fine.
4. Fill in template placeholders and switch: `home-manager switch`.
5. Verify the launchd service is running and your bot responds to messages.

### 9.2 OPENCLAW_NIX_MODE

When `OPENCLAW_NIX_MODE=1` is set (automatic with nix-openclaw), OpenClaw enters a deterministic mode for Nix-managed installs (`docs/install/nix.md:52-57`). What changes (`docs/install/nix.md:67-73`):

- Auto-install and self-mutation flows are disabled
- `openclaw.json` is treated as immutable
- Startup-derived defaults stay runtime-only
- Config writers (setup, onboarding, mutating `openclaw update`, plugin install/update/uninstall/enable, `doctor --fix`, `doctor --generate-gateway-token`, `openclaw config set`) refuse to edit the file
- The UI shows a read-only Nix mode banner

On macOS the GUI app does not inherit shell environment variables, so Nix mode is enabled via `defaults` instead:

```bash
defaults write ai.openclaw.mac openclaw.nixMode -bool true
```

(`docs/install/nix.md:61-65`)

### 9.3 Service PATH Discovery

The launchd/systemd gateway service auto-discovers Nix-profile binaries (`docs/install/nix.md:88-92`):

- When `NIX_PROFILES` is set, every entry is added to the service PATH in right-to-left precedence
- When unset, `~/.nix-profile/bin` is added as a fallback

This applies to both macOS launchd and Linux systemd service environments.

### 9.4 Reproducible Builds

Nix mode plus `home-manager switch --rollback` makes the install **fully reproducible and rollback-able**. Combined with the `YYYY.M.PATCH` versioning strategy and the Dependabot-managed Docker SHA256 digests, OpenClaw achieves reproducible-build semantics across three distribution channels.

## 10. Onboarding

### 10.1 The Wizard

The first-run wizard runs through `openclaw onboard` (interactive) or `openclaw onboard --install-daemon` (install the gateway systemd/launchd service) (`docs/platforms/linux.md:33-38`).

The macOS path uses a separate bundled installer (`docs/platforms/mac/bundled-gateway.md:17-25`): *"On a fresh Mac, choose **This Mac** during onboarding. The app runs its signed, bundled installer script before the Gateway wizard: it installs a user-space Node runtime and the matching `openclaw` CLI under `~/.openclaw`, then installs and starts the per-user launchd service. This path needs no Terminal, Homebrew, or administrator access."*

### 10.2 Cross-Platform Consistency

The wizard steps are consistent across platforms:

1. **Install** — npm/global for CLI; native app for macOS/Windows; iOS/Android via app store.
2. **Pick gateway mode** — local vs remote (`docs/platforms/macos.md:39-44`).
3. **Provider setup** — API key entry, OAuth device-code flow, or ChatGPT device pairing. The OpenAI plugin's auth choices are at `extensions/openai/openclaw.plugin.json:283-325` and include `oauth`, `device-code`, and `api-key`.
4. **macOS TCC permission checklist** — mic, speech, screen, accessibility (`docs/platforms/macos.md:33-34`).
5. **First test message** — runs the wizard's onboarding test prompt.
6. **Optional channel login** — WhatsApp QR (`openclaw channels login`), Telegram/Discord token.

### 10.3 Non-Interactive Mode

`docs/platforms/windows.md:147-151` shows the non-interactive flag:

```powershell
openclaw onboard --non-interactive --skip-health
openclaw gateway run
```

`--non-interactive` skips prompts; `--skip-health` skips the doctor post-check. The same flag pair works on macOS/Linux for CI scenarios.

### 10.4 Onboarding Security Caveats

`docs/start/openclaw.md:13-18` is direct about the security implications:

> *"Giving an agent a channel puts it in a position to run commands on your machine (depending on your tool policy), read/write files in your workspace, and send messages back out via any connected channel. Start conservative:*
> *- Always set `channels.whatsapp.allowFrom` (never run open-to-the-world on your personal Mac).*
> *- Use a dedicated WhatsApp number for the assistant.*
> *- Heartbeats default to every 30 minutes. Disable until you trust the setup by setting `agents.defaults.heartbeat.every: \"0m\"`."*

This is the safety-first section — the same directness the OpenClaw AGENTS.md demands for any change that touches user-visible surface area.

## 11. Cross-Platform Summary

| Distribution | Tech | Install | Auto-update | License constraints |
|--------------|------|---------|-------------|---------------------|
| npm `openclaw` | Node.js ≥ 22.19 | `npm i -g openclaw@latest` | `openclaw update` channels | MIT |
| macOS app | Swift/SwiftUI + Sparkle | `.dmg` / `.zip` | Sparkle (`appcast.xml`) | MIT; macOS ≥ 15.0 |
| Windows Hub | WinUI | `OpenClawCompanion-Setup-x64/arm64.exe` | Windows installer | MIT; Windows 10 20H2+ / Windows 11 |
| iOS app | Swift + WKWebView | App Store / source | App Store | MIT + App Store review |
| Android app | Kotlin | Google Play / source | Play Store | MIT + Play review |
| Docker | Multi-stage Node 24-bookworm | `docker pull` from GHCR/Docker Hub | Rebuild image | MIT; non-root `node` user |
| Nix | Home Manager module | `home-manager switch` | `home-manager switch --rollback` | MIT + Nix flakes |
| Source | TypeScript monorepo | `git clone` + `pnpm install` + `pnpm build` | `git pull` | MIT; Node 22.19+ |

All distribution channels share the same plugin SDK contract (`src/plugin-sdk/`, 538 entries per R2), so a plugin that works on one platform works on every platform that supports its manifest capability. Mobile-platform parity is the careful part — iOS and Android both have foreground-restricted Canvas, Android Talk uses native speech recognition by default, and only macOS exposes a user-facing Voice Wake toggle.

## 12. Cross-References

- **macOS app overview** — `docs/platforms/macos.md:10-87`
- **macOS gateway as launchd** — `docs/platforms/mac/bundled-gateway.md:40-83`
- **macOS voice wake** — `docs/platforms/mac/voicewake.md:1-69`
- **macOS voice overlay** — `docs/platforms/mac/voice-overlay.md:1-55`
- **macOS Canvas** — `docs/platforms/mac/canvas.md:1-116`
- **Windows Hub** — `docs/platforms/windows.md:10-329`
- **iOS node app** — `docs/platforms/ios.md:9-263`
- **iOS Talk WebRTC** — `apps/ios/Sources/Voice/TalkRealtimeWebRTCSession.swift:1-1028`
- **iOS voice wake** — `apps/ios/Sources/Voice/VoiceWakeManager.swift:8-100`
- **Android node app** — `docs/platforms/android.md:11-329`
- **Node host protocol** — `docs/nodes/index.md:10-494`
- **Update channels** — `docs/install/updating.md:11-296`
- **Sparkle appcast** — `appcast.xml:1-443`
- **Dockerfile** — `Dockerfile:1-358`
- **Docker compose** — `docker-compose.yml:1-129`
- **Docker install guide** — `docs/install/docker.md:1-524`
- **Nix module** — `docs/install/nix.md:10-109`
- **Node.js install** — `docs/install/node.md:1-142`
- **Linux gateway service** — `docs/platforms/linux.md:33-125`
- **Linux OOM protection** — `docs/platforms/linux.md:88-125`
- **Onboarding safety** — `docs/start/openclaw.md:11-18`

The next document moves inside the running system to the memory + tool-policy + provider layer — what the agent actually does once the cross-platform shell is in place.