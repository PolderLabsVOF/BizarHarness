# opencode Server (opencode.ai/docs/server/)

## Source: https://opencode.ai/docs/server/

### Overview
- `opencode serve` runs a headless HTTP server
- Default: port 4096, hostname 127.0.0.1
- Exposes OpenAPI 3.1 spec at `http://<host>:<port>/doc`
- The SDK is generated from this spec
- Architecture: TUI is a client of the server; multiple clients supported

### CLI flags
```
opencode serve [--port <number>] [--hostname <string>] [--cors <origin>] [--mdns] [--mdns-domain]
```
`--cors` can be passed multiple times for multiple origins.
mDNS: `--mdns` enables, `--mdns-domain` sets custom domain (default: `opencode.local`).

### Auth
- `OPENCODE_SERVER_PASSWORD` env var enables HTTP basic auth
- `OPENCODE_SERVER_USERNAME` overrides username (default: `opencode`)

### Endpoints (grouped by domain)

**Global**
- `GET /global/health` → `{ healthy: boolean, version: string }`
- `GET /global/event` → SSE event stream

**Project**
- `GET /project` → `Project[]`
- `GET /project/current` → `Project`

**Path & VCS**
- `GET /path` → `Path`
- `GET /vcs` → `VcsInfo`

**Instance**
- `POST /instance/dispose` → `boolean`

**Config**
- `GET /config` → `Config`
- `PATCH /config` → `Config`
- `GET /config/providers` → `{ providers: Provider[], default: {...} }`

**Provider**
- `GET /provider` → `{ all: Provider[], default: ..., connected: string[] }`
- `GET /provider/auth` → auth methods per provider
- `POST /provider/{id}/oauth/authorize`
- `POST /provider/{id}/oauth/callback`

**Sessions** (heaviest API group)
- `GET /session` — list all
- `POST /session` — create (`{ parentID?, title? }`)
- `GET /session/status` — status for all sessions (keyed by sessionID)
- `GET /session/:id` — get one
- `DELETE /session/:id` — delete
- `PATCH /session/:id` — update (`{ title? }`)
- `GET /session/:id/children` — child sessions
- `GET /session/:id/todo` — todo list
- `POST /session/:id/init` — analyze app + create AGENTS.md
- `POST /session/:id/fork` — fork at a message
- `POST /session/:id/abort` — abort running
- `POST /session/:id/share` / `DELETE /session/:id/share`
- `GET /session/:id/diff` — session diff (optional `messageID` query)
- `POST /session/:id/summarize`
- `POST /session/:id/revert` / `POST /session/:id/unrevert`
- `POST /session/:id/permissions/:permissionID`

**Messages**
- `GET /session/:id/message` — list messages (`?limit=`)
- `POST /session/:id/message` — send + wait for response (body: `{ messageID?, model?, agent?, noReply?, system?, tools?, parts }`)
- `GET /session/:id/message/:messageID` — get details
- `POST /session/:id/prompt_async` — send, no wait (204 No Content)
- `POST /session/:id/command` — execute slash command (`{ command, arguments }`)
- `POST /session/:id/shell` — run shell command (`{ command }`)

**Commands**
- `GET /command` — list commands

**Files**
- `GET /find?pattern=<pat>` — text search
- `GET /find/file?query=<q>` — file name search (params: query, type, directory, limit, dirs)
- `GET /find/symbol?query=<q>` — symbol search
- `GET /file?path=<path>` — list files/directories
- `GET /file/content?path=<p>` — read file
- `GET /file/status` — VCS status

**Tools (Experimental)**
- `GET /experimental/tool/ids`
- `GET /experimental/tool?provider=<p>&model=<m>`

**LSP/Formatters/MCP**
- `GET /lsp`, `GET /formatter`, `GET /mcp`
- `POST /mcp` — add MCP server dynamically

**Agents**
- `GET /agent`

**Logging**
- `POST /log` — body: `{ service, level, message, extra? }`

**TUI**
- `POST /tui/append-prompt`, `/tui/open-help`, `/tui/open-sessions`, `/tui/open-themes`, `/tui/open-models`
- `POST /tui/submit-prompt`, `/tui/clear-prompt`, `/tui/execute-command`, `/tui/show-toast`
- `GET /tui/control/next` — wait for next control request (long-poll)
- `POST /tui/control/response` — respond to control request

**Auth**
- `PUT /auth/:id` — set credentials

**Events**
- `GET /event` — SSE stream. First event is `server.connected`, then bus events
- `GET /global/event` — separate SSE stream for global events

**Docs**
- `GET /doc` — HTML page with OpenAPI 3.1 spec

### Key transport patterns
- Standard REST (JSON request/response) for all CRUD
- SSE for real-time events (`GET /event` and `GET /global/event`)
- Long-poll for TUI control requests (`GET /tui/control/next`)
- `prompt_async` for fire-and-forget (204 No Content)
- No WebSocket anywhere
- OpenAPI spec drives SDK generation
