# opencode SDK (opencode.ai/docs/sdk/)

## Source: https://opencode.ai/docs/sdk/

### Package
- `npm install @opencode-ai/sdk`
- Type-safe JS client for opencode server
- All types generated from server's OpenAPI spec

### Client Creation

```ts
// Full: starts server + client
import { createOpencode } from "@opencode-ai/sdk"
const { client } = await createOpencode(options)
// Options: hostname (127.0.0.1), port (4096), signal (AbortSignal), timeout (5000), config (Config)

// Client-only: connect to existing server
import { createOpencodeClient } from "@opencode-ai/sdk"
const client = createOpencodeClient({
  baseUrl: "http://localhost:4096",
  fetch: globalThis.fetch,
  parseAs: "auto",
  responseStyle: "fields",   // "data" or "fields"
  throwOnError: false,
})
```

### Type imports
```ts
import type { Session, Message, Part } from "@opencode-ai/sdk"
```
All from `types.gen.ts` — auto-generated from server OpenAPI spec.

### Error handling
- SDK returns errors by default (not throws)
- `throwOnError: true` to throw exceptions
- Discriminated error types: `ProviderAuthError`, `UnknownError`, `MessageOutputLengthError`, `MessageAbortedError`, `APIError`

### Structured Output
- `session.prompt()` supports `format: { type: "json_schema", schema: {...}, retryCount: 2 }`
- Returns validated JSON matching schema
- Error type: `StructuredOutputError` on failure after retries

### API Methods (typed client)

**Global**: `global.health()` → `{ healthy: true, version: string }`
**App**: `app.log()`, `app.agents()`
**Project**: `project.list()`, `project.current()`
**Path**: `path.get()`
**Config**: `config.get()`, `config.providers()`
**Session** (full CRUD):
  - `session.list()`, `session.get({path})`, `session.create({body})`, `session.delete({path})`
  - `session.children({path})`, `session.update({path, body})`
  - `session.init({path, body})`, `session.abort({path})`
  - `session.share({path})`, `session.unshare({path})`
  - `session.summarize({path, body})`
  - `session.messages({path})`, `session.message({path})`
  - `session.prompt({path, body})` — send + wait for response
    - `body.noReply: true` → inject context without AI response
  - `session.command({path, body})`, `session.shell({path, body})`
  - `session.revert({path, body})`, `session.unrevert({path})`
**Files**: `find.text()`, `find.files()`, `find.symbols()`, `file.read()`, `file.status()`
**TUI**: `tui.appendPrompt()`, `tui.openHelp()`, `tui.openSessions()`, `tui.openThemes()`, `tui.openModels()`, `tui.submitPrompt()`, `tui.clearPrompt()`, `tui.executeCommand()`, `tui.showToast()`
**Auth**: `auth.set()`
**Events**:
```ts
const events = await client.event.subscribe()
for await (const event of events.stream) {
  console.log("Event:", event.type, event.properties)
}
```

### Transport
- HTTP-based (standard fetch API)
- Events: Server-Sent Events (SSE stream via `event.subscribe()`)
- No WebSocket
