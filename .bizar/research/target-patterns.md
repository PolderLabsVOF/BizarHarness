# Target Patterns: Plugin ↔ Dashboard Communication Architecture

## TL;DR

1. **HTTP + SSE hybrid** is the opencode model — REST for CRUD/commands, SSE for real-time events. No WebSocket. Follow this exactly.
2. **OpenAPI 3.1 as source of truth** — opencode auto-generates its TypeScript SDK (`types.gen.ts`) from the server's `/doc` OpenAPI spec. Do not hand-write types.
3. **bun-module package layout** is the standard for any plugin package: ESM-only, `src/index.ts` entry, `dist/` output, dual `exports` map, Vitest, ESLint, Prettier, release-please.
4. **Plugins are hook functions**, not servers — they receive `{ client, project, $, directory, worktree }` and return event hook handlers. The dashboard plugin should follow this pattern.
5. **SSE event types are discriminated by dotted string** (e.g. `"session.updated"`, `"server.connected"`) with a `type` + `properties` shape. Events flow server→client only.

---

## 1. bun-module Patterns (zenobi-us/bun-module)

### Package structure
```
my-package/
├── src/
│   ├── index.ts          # Entry point — re-exports public API
│   ├── version.ts        # Version marker (managed by release-please)
│   └── ...               # Internal modules
├── dist/                 # Compiled output (gitignored, shipped to npm)
├── .github/workflows/    # CI: build, lint, test, release
├── package.json
├── tsconfig.json
└── README.md
```

### package.json conventions
- `"type": "module"` — ESM everywhere
- `"exports"` map with `types` + `default` for each subpath:
  ```json
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  }
  ```
- `"files": ["dist", "src/version.ts"]` — only ship compiled output
- `"publishConfig": { "access": "public" }`
- Runtime deps only if needed. Plugin packages add `@opencode-ai/plugin`.
- DevDeps: `vitest`, `@types/node`, `bun-types`, `eslint`, `prettier`, `typescript-eslint`

### Build & tooling
- **No bundler** — Bun compiles TypeScript natively
- **tsconfig**: `target: ESNext`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`, `noEmit: true` (Bun handles emit)
- **mise** manages tool versions (not direct npm scripts)
- **release-please** with conventional commits, two channels: `.next` (pre-release) and `latest` (stable)
- **NPM Trusted Publishing** via OIDC — no tokens

### Application to BizarHarness
Any new npm package (plugin SDK, dashboard SDK, shared types) should follow this exact layout. If the dashboard itself ships as a package, use the same convention.

---

## 2. opencode SDK Patterns

### Client architecture
- Single `createOpencodeClient({ baseUrl, fetch, parseAs, responseStyle, throwOnError })` call
- Returns a typed client object with methods grouped by resource: `client.global.*`, `client.session.*`, `client.config.*`, etc.
- Method signatures follow `resource.action({ path?, query?, body? })` where `path`, `query`, `body` are typed objects

### Type generation
- All types live in `types.gen.ts` — auto-generated from server OpenAPI spec via `@hey-api/openapi-ts`
- All `export type` (no interfaces)
- Discriminated unions for: events (by `type`), messages (by `role`), errors (by `name`), parts (by `type`)
- Types are importable: `import type { Session, Message, Part } from "@opencode-ai/sdk"`

### Error model
- Default: return errors (don't throw). `throwOnError: true` to switch.
- Discriminated error types: `ProviderAuthError`, `UnknownError`, `MessageOutputLengthError`, `MessageAbortedError`, `APIError` (with `statusCode`, `isRetryable`)
- Each has `name` discriminator and `data` payload

### Event subscription
```ts
const events = await client.event.subscribe()
for await (const event of events.stream) {
  // event.type is a dotted string like "session.updated"
  // event.properties is the payload
}
```
Events are SSE streams, returned as async iterables.

### Application to BizarHarness
The BizarHarness dashboard needs a client SDK that mirrors opencode's pattern:
- Typed, resource-grouped methods
- Types generated from a spec
- `client.plugin.*`, `client.dashboard.*`, `client.session.*`, etc.
- Consistent error model (discriminated)
- SSE subscription for real-time updates

---

## 3. opencode Server Patterns

### Transport
- **REST (JSON)**: all CRUD operations — `GET/POST/PATCH/DELETE` with JSON bodies
- **SSE**: real-time events at `GET /event` and `GET /global/event`
- **Long-poll**: `GET /tui/control/next` — blocks until next control request
- **Fire-and-forget**: `POST /session/:id/prompt_async` returns 204 No Content
- **No WebSocket anywhere**

### Endpoint naming convention
- Resource-based paths: `/session`, `/session/:id`, `/session/:id/message`, `/session/:id/message/:messageID`
- Namespace prefixes for sub-resources: `/session/:id/permissions/:permissionID`
- Config at `/config`, docs at `/doc`
- Experimental features prefixed: `/experimental/tool`

### SSE event shape
```
event: <type>
data: { "type": "...", "properties": { ... } }
```
First event on connect: `server.connected` with empty properties. After that, any bus event matching the event type to subscription filter.

### Session message flow
1. `POST /session/:id/message` with body `{ parts: [{ type: "text", text: "..." }], model, ... }`
2. Server processes, returns `{ info: AssistantMessage, parts: Part[] }`
3. For streaming, use `POST /session/:id/prompt_async` (204) and listen on `/event` SSE

### Configuration
- `GET /config` reads, `PATCH /config` updates
- `GET /config/providers` returns provider list + defaults
- Per-session model override in message body: `{ model: { providerID, modelID } }`

### Auth
- HTTP basic auth via `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME`
- Per-provider OAuth: `POST /provider/{id}/oauth/authorize`, `POST /provider/{id}/oauth/callback`
- Credential storage: `PUT /auth/:id`

### Application to BizarHarness
The dashboard server should follow the same REST endpoints pattern. The BizarHarness plugin (running inside opencode) communicates with the dashboard via opencode's `client` object — the dashboard is an external HTTP+SSE server that the plugin connects to.

---

## 4. Implications for BizarHarness Plugin ↔ Dashboard Communication

### Transport
**RECOMMENDATION: HTTP + SSE hybrid (same as opencode)**
- REST for all request/response operations (session CRUD, file operations, config)
- SSE for real-time events (session updates, agent activity, status changes)
- Fire-and-forget POSTs (204 No Content) for operations where the client doesn't need a response
- **No WebSocket** — opencode doesn't use it, and SSE is simpler for unidirectional event flow

### Schema / Source of Truth
**RECOMMENDATION: OpenAPI 3.1 (auto-generate types)**
- Define server endpoints in an OpenAPI 3.1 spec at `GET /doc`
- Generate TypeScript types using `@hey-api/openapi-ts` → `types.gen.ts`
- Import types into both plugin (client) and dashboard (server) from a shared `@bizarharness/sdk` package
- This ensures the plugin and dashboard are always in sync
- Follow opencode's type conventions: discriminated unions, `export type` not `interface`, dotted event type strings

### Module Structure
**RECOMMENDATION: Split into 3 npm packages under a monorepo**
1. `@bizarharness/sdk` — shared SDK with types + client (following bun-module layout)
   - `src/index.ts` re-exports client + types
   - Types in `src/gen/types.gen.ts` (auto-generated)
   - Client in `src/client/` (typed resource methods)
2. `@bizarharness/plugin` — the opencode plugin that hooks into opencode events
   - Depends on `@opencode-ai/plugin` and `@bizarharness/sdk`
   - Exports a `Plugin` function: `async (ctx) => { return { event hooks } }`
3. `@bizarharness/dashboard` — the dashboard server application
   - Express/Hono server with REST + SSE endpoints
   - Depends on `@bizarharness/sdk` for shared types

All 3 follow bun-module conventions: ESM, `exports` map, Vitest, ESLint, Prettier.

### Architecture Flow
```
opencode TUI / CLI
    ↓ HTTP + SSE
opencode Server
    ↓ Plugin system loads @bizarharness/plugin
    ↓ Plugin creates SSE + HTTP connection to dashboard
Dashboard Server (Express/Hono)
    ↓ Uses @bizarharness/sdk types
Dashboard Web UI (React)
```

The plugin is the bridge — it receives opencode events via its hook functions and forwards relevant ones to the dashboard via the SDK client. The dashboard is an independent server the plugin connects to.

### Error Model
**RECOMMENDATION: Discriminated errors (same as opencode)**
```ts
export type BizarError =
  | { name: "PluginError"; data: { code: string; message: string } }
  | { name: "DashboardError"; data: { statusCode: number; message: string } }
  | { name: "ConnectionError"; data: { message: string } }
```
- Default: return errors (not throw) unless `throwOnError: true`
- Each error has `name` discriminator + `data` payload
- `APIError` type includes `statusCode`, `isRetryable`, `responseHeaders`, `responseBody`

### Auth
**RECOMMENDATION: HTTP basic auth or bearer token**
- Dashboard listens on localhost by default (like opencode)
- Optional `BIZAR_DASHBOARD_PASSWORD` env var for basic auth
- Plugin passes auth header in SDK client configuration
- Follow opencode's pattern: simple, env-var-based, no OAuth dance

### Event / SSE Specifics
**RECOMMENDATION: Dot-separated event types with discriminated payloads**
```ts
// Event type definitions (in @bizarharness/sdk)
export type EventPluginConnected = {
  type: "plugin.connected"
  properties: { version: string }
}
export type EventSessionUpdated = {
  type: "session.updated"
  properties: { sessionID: string; status: "idle" | "running" | "error" }
}
export type EventToolExecuted = {
  type: "tool.executed"
  properties: { toolID: string; duration: number }
}
```

SSE endpoints:
- `GET /event` — subscription to all dashboard events (first event: `plugin.connected`)
- `GET /event?filter=tool.executed` — filtered subscription (optional)

Event stream as async iterable (matching SDK pattern):
```ts
const events = await client.dashboard.event.subscribe()
for await (const event of events.stream) {
  // handle event
}
```

### Configuration
- Plugin config passed via opencode.json (`"plugin": { "bizar": { "dashboardUrl": "...", "password": "..." } }`)
- Dashboard config via env vars: `PORT`, `HOSTNAME`, `BIZAR_DASHBOARD_PASSWORD`
- Follow opencode's config pattern: `GET /config` reads, `PATCH /config` updates at runtime

---

## 5. Open Questions

1. **Monorepo vs separate repos** — Should the 3 packages (sdk, plugin, dashboard) live in the BizarHarness monorepo or be split? The bun-module template assumes a per-package repo. opencode uses a monorepo (`packages/sdk`, `packages/web`). Recommend monorepo with `packages/` layout.

2. **Dashboard framework** — Express vs Hono vs Fastify for the dashboard server? opencode itself doesn't document its server framework. Hono is modern, fast, Bun-native, has SSE support built in.

3. **Plugin lifecycle** — Does the plugin start the dashboard server, or does the user run the dashboard separately? opencode has both modes (TUI auto-starts server, or standalone `opencode serve`). Should the BizarHarness plugin auto-spawn the dashboard as a child process?

4. **Event filtering** — For SSE subscriptions, should we support filter parameters like `GET /event?filter=tool.executed` for client-side efficiency? opencode's SSE seems to send all events; filtering is client-side.

5. **Ready-to-use SSE in Hono** — Hono has SSE helper. Confirm if it works well with the async iterable pattern the SDK expects, or if we need a custom streaming approach.

6. **CLI integration** — opencode has a `/tui` endpoint set for driving the TUI programmatically. Do we need equivalent endpoint for the dashboard (e.g., `POST /dashboard/toast`, `POST /dashboard/prompt`)?

7. **CORS** — The dashboard serves a web UI. opencode allows `--cors` flag. Should the dashboard have built-in CORS for development?

8. **Error propagation** — When the plugin encounters an error connecting to the dashboard, should it surface via opencode's logging or via the SSE event stream?

9. **First publish** — The bun-module workflow requires manual first publish to npm, then OIDC trusted publishing. Who does the first `npm publish`?

10. **Bun-only or Node-compatible?** — The bun-module template targets Bun (all types assume Bun runtime). The SDK package could target Node too (use `@types/node`). The opencode SDK works in Node. Decision needed for `@bizarharness/sdk`.

---

## Reference: Key Source Documents

| File | Contents |
|------|----------|
| `raw-fetch-bun-module.md` | bun-module README, package.json, tsconfig.json, release process |
| `raw-fetch-opencode-sdk.md` | SDK docs: client API, types, errors, structured output, events |
| `raw-fetch-opencode-server.md` | Server docs: all endpoints, transport, auth, config, events |
| `raw-fetch-opencode-plugins.md` | Plugin docs: hook system, events, custom tools, lifecycle |
| `raw-fetch-opencode-types.md` | types.gen.ts: type shapes, discriminated unions, naming conventions |
