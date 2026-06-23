# BizarHarness Plugin ↔ Dashboard Communication Rebuild

> **Status:** Implementation plan. Authored by Odin (direct execution — Tyr/Thor routing unavailable this session).
> **Goal:** Replace the file-based `serve.json` bridge between the Bizar plugin and the dashboard with an HTTP+SSE protocol, sourced from an OpenAPI 3.1 spec, generated into a shared `@polderlabs/bizar-sdk` package, consumed by both the plugin (publishes events) and the dashboard (subscribes + exposes REST).
> **Reference sources:** `https://github.com/zenobi-us/bun-module`, `https://opencode.ai/docs/sdk/`, `https://opencode.ai/docs/server/`.

---

## §0. TL;DR

- Build `@polderlabs/bizar-sdk` — typed SDK with auto-generated types from OpenAPI spec.
- Move `plugins/bizar/` → `packages/plugin/` (monorepo); refactor to use SDK for dashboard-bound calls.
- Refactor `bizar-dash/` in place (no file move) — add `/api/v2/*` namespace, `GET /doc`, `GET /api/v2/event` SSE.
- Existing endpoints at `/api/*` stay untouched (backward compat).
- Replace file-based `serve.json` bridge with HTTP+SSE using the SDK.
- 6-iteration test plan: SDK → plugin → dashboard → integration → smoke → publish.

**Phasing (this session):**
1. **Foundation (full):** OpenAPI spec, SDK package, root monorepo workspaces config.
2. **Plugin (minimal demo):** Add `dashboard-client.ts` to existing `plugins/bizar/` that publishes one event type via SDK.
3. **Dashboard (partial):** Add `GET /api/v2/event` SSE endpoint that accepts published events.
4. **Tests:** SDK unit + smoke test (curl) for one round-trip.
5. **Document remaining work** as next-steps in CHANGELOG.
6. **Commit + push** as v0.7.0-alpha.1.

**Top 3 risks:**
- Dashboard's `serve-info.mjs` + plugin's `serve-info.ts` are used by external consumers (TUI, hooks) — must stay backward compat until those migrate.
- SDK codegen adds build-time complexity; for v0.7.0-alpha.1 we hand-write the types to avoid that step. Add `@hey-api/openapi-ts` in v0.7.1.
- Plugin's existing 30+ bun tests must continue passing; SDK introduction must not break them.

---

## §1. Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ opencode TUI                                                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                │ (in-process plugin loader)
                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ @opencode-ai/plugin                                                          │
│   loads: packages/plugin/src/index.ts  (← was plugins/bizar/index.ts)        │
│   hooks: config, event, chat.message, tool.execute.before,                   │
│          tool.execute.after, experimental.chat.system.transform              │
│   tools: 7 (bg-spawn, bg-status, bg-collect, bg-kill,                        │
│           bg-get-comments, plan-action, wait-for-feedback)                   │
└─────────────────────────────────────────────────────────────────────────────┘
       │                                       │
       │ HTTP (Bun.spawn → localhost)          │ HTTP+SSE (new SDK)
       ▼                                       ▼
┌──────────────────────────┐    ┌──────────────────────────────────────────────┐
│ opencode serve child     │    │ dashboard server (Express, stays at          │
│ 127.0.0.1:4096/4097      │    │  bizar-dash/src/server/server.mjs)           │
│ OPENCODE_SERVER_PASSWORD │    │                                              │
│ v2 routes only           │    │ NEW: /api/v2/* namespace + /doc + /api/v2/event│
└──────────────────────────┘    │ EXISTING: /api/* (artifacts, plans, chat,    │
                                │   sessions, agents, mcp-proxy, …)             │
                                └──────────────────────────────────────────────┘
                                          │
                                          ▼
                                ┌──────────────────────────────────────────────┐
                                │ @polderlabs/bizar-sdk (NEW — packages/sdk/)      │
                                │   - createBizarClient({baseUrl, password})  │
                                │   - auto-generated types from OPENAPI_SPEC   │
                                │   - resource-grouped methods (sessions,      │
                                │     plans, artifacts, agents, events)        │
                                │   - async-iterable SSE subscriber            │
                                │   - discriminated error model                │
                                └──────────────────────────────────────────────┘
                                          ▲                                  ▲
                                          │                                  │
                            (plugin imports)                  (dashboard imports)
```

**Transport choices:**
- HTTP+SSE hybrid (REST for CRUD, SSE for events). No WebSocket. Matches opencode.
- Async-iterable consumption in SDK: `for await (const event of client.events.subscribe())`.

**Auth model:**
- Dashboard listens on `127.0.0.1:<BIZAR_DASHBOARD_PORT>` (default 4098; not 4096/4097 which are reserved).
- HTTP basic with `OPENCODE_DASHBOARD_PASSWORD` (32-byte random, generated on dashboard startup, persisted to `~/.cache/bizarharness/dash-auth.json`, mode 0600).
- Plugin reads the password file on init (or accepts `BIZAR_DASHBOARD_PASSWORD` env var).

**Discovery:**
- Env `BIZAR_DASHBOARD_URL` (default `http://127.0.0.1:4098`).
- Env `BIZAR_DASHBOARD_PASSWORD` (optional override; otherwise read from auth file).

---

## §2. Monorepo Restructuring (Phase 1 — full)

### File moves / creates

| Action | Source | Destination |
|---|---|---|
| CREATE | — | `packages/sdk/package.json` |
| CREATE | — | `packages/sdk/tsconfig.json` |
| CREATE | — | `packages/sdk/src/index.ts` |
| CREATE | — | `packages/sdk/src/client.ts` |
| CREATE | — | `packages/sdk/src/types.ts` |
| CREATE | — | `packages/sdk/src/errors.ts` |
| CREATE | — | `packages/sdk/src/events.ts` |
| CREATE | — | `packages/sdk/src/version.ts` |
| CREATE | — | `packages/sdk/README.md` |
| CREATE | — | `packages/sdk/tests/client.test.ts` |
| CREATE | — | `packages/sdk/tests/events.test.ts` |
| CREATE | — | `packages/sdk/tests/errors.test.ts` |
| CREATE | — | `packages/sdk/tests/fixtures/fetch-mock.ts` |
| CREATE | — | `packages/sdk/tests/fixtures/sse-mock.ts` |
| CREATE | — | `packages/sdk/.gitignore` |
| CREATE | — | `packages/sdk/LICENSE` |
| EDIT | root `package.json` | add `"workspaces": ["packages/*"]` |
| EDIT | root `tsconfig.json` | add `packages/sdk/src/**/*` to `include` |
| EDIT | root `.gitignore` | add `packages/*/dist/`, `packages/*/node_modules/` |

### NOT moved in this session (Phase 2+):
- `plugins/bizar/` stays at root (plugin refactor is minimal — add `src/dashboard-client.ts` only). Move to `packages/plugin/` in v0.8.0.
- `bizar-dash/` stays at root (dashboard refactor is minimal — add `src/server/routes-v2/`). Move to `packages/dashboard/` in v0.8.0.

This phased approach de-risks the refactor: the foundation (SDK) is established first, then the plugin and dashboard can each adopt it incrementally.

### Root `package.json` changes

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "build:sdk": "npm run build -w @polderlabs/bizar-sdk",
    "test:sdk": "npm run test -w @polderlabs/bizar-sdk"
  },
  "devDependencies": {
    "@hey-api/openapi-ts": "^0.65.0"  // for codegen in v0.7.1
  }
}
```

### Per-package `packages/sdk/package.json`

```json
{
  "name": "@polderlabs/bizar-sdk",
  "version": "0.7.0-alpha.1",
  "description": "Typed SDK for the BizarHarness plugin ↔ dashboard protocol",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist", "src/version.ts", "README.md", "LICENSE"],
  "publishConfig": { "access": "public" },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  },
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/DrB0rk/BizarHarness.git",
    "directory": "packages/sdk"
  }
}
```

---

## §3. `@polderlabs/bizar-sdk` Package Design

### Layout
```
packages/sdk/
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE
├── .gitignore
├── src/
│   ├── index.ts          # barrel: exports createBizarClient, types, errors
│   ├── client.ts         # createBizarClient factory + resource methods
│   ├── types.ts          # hand-written types matching OPENAPI_SPEC (v0.7.0-alpha)
│   ├── errors.ts         # BizarError discriminated union
│   ├── events.ts         # async-iterable SSE subscriber
│   └── version.ts        # SDK version constant
├── tests/
│   ├── client.test.ts
│   ├── events.test.ts
│   ├── errors.test.ts
│   └── fixtures/
│       ├── fetch-mock.ts
│       └── sse-mock.ts
└── dist/                 # build output (gitignored)
```

### Public API

```ts
// packages/sdk/src/index.ts
export { createBizarClient } from "./client.js";
export type {
  BizarClient,
  BizarClientConfig,
  Session,
  Message,
  Part,
  Project,
  Plan,
  Event,
  DashboardEvent,
  // ...
} from "./types.js";
export type { BizarError } from "./errors.js";
export { isBizarError } from "./errors.js";
export { SDK_VERSION } from "./version.js";
```

### Client factory

```ts
// packages/sdk/src/client.ts
export interface BizarClientConfig {
  baseUrl: string;                          // e.g. "http://127.0.0.1:4098"
  password: string;                          // OPENCODE_DASHBOARD_PASSWORD
  fetch?: typeof fetch;                      // injectable for testing
  throwOnError?: boolean;                    // default false (return errors)
  headers?: Record<string, string>;
}

export interface BizarClient {
  sessions: SessionsResource;
  messages: MessagesResource;
  plans: PlansResource;
  projects: ProjectsResource;
  events: EventsResource;                    // async-iterable SSE
  health: HealthResource;
}

export function createBizarClient(config: BizarClientConfig): BizarClient;
```

### Error model (discriminated union)

```ts
// packages/sdk/src/errors.ts
export type BizarError =
  | { name: "PluginError"; data: { code: string; message: string } }
  | { name: "DashboardError"; data: { statusCode: number; message: string } }
  | { name: "ConnectionError"; data: { message: string; cause?: unknown } }
  | { name: "APIError"; data: { statusCode: number; isRetryable: boolean; message: string } };

export function isBizarError(value: unknown): value is BizarError;
```

### Event subscriber (async iterable)

```ts
// packages/sdk/src/events.ts
export interface EventSubscription {
  stream: AsyncIterable<DashboardEvent>;
  close(): void;
}

export interface EventsResource {
  subscribe(opts?: { signal?: AbortSignal }): Promise<EventSubscription>;
}
```

### Tests (Vitest)

- `client.test.ts`: 6 cases — basic GET, basic POST, basic DELETE, auth header attached, error response mapped to BizarError, throwOnError true throws.
- `events.test.ts`: 3 cases — single event parsed, multiple events parsed in order, malformed data line skipped.
- `errors.test.ts`: 2 cases — isBizarError narrows correctly, error data shape preserved.
- Uses `tests/fixtures/fetch-mock.ts` (custom fetch returning canned responses) and `tests/fixtures/sse-mock.ts` (ReadableStream that emits SSE lines).

---

## §4. `@bizarharness/plugin` Refactor (Phase 2 — minimal demo)

### What changes in this session

Add ONE new module: `plugins/bizar/src/dashboard-client.ts`. This module:
1. Imports `createBizarClient` from `@polderlabs/bizar-sdk`.
2. Provides a `publishEvent(event: DashboardEvent)` function that POSTs to the dashboard.
3. Reads `BIZAR_DASHBOARD_URL` + `BIZAR_DASHBOARD_PASSWORD` from env / auth file.
4. Falls back gracefully if dashboard is unreachable (logs warn, returns; never throws).

Wire it into ONE existing place: `plugins/bizar/src/event-stream.ts`. After every SSE event received from opencode, forward it to the dashboard via `publishEvent()`. This demonstrates the full event flow end-to-end.

### What does NOT change in this session

- Existing 30+ bun tests stay untouched (no signature changes to existing exports).
- Plugin entry point stays at `plugins/bizar/index.ts`.
- `serve-info.ts` stays (the file-based bridge remains the fallback path).
- No move to `packages/plugin/` yet (that's Phase 2.5 in v0.8.0).

### Tests added this session

- `plugins/bizar/tests/dashboard-client.test.ts` — 3 cases: publishEvent success, publishEvent unreachable (warn + return), publishEvent wrong auth (BizarError propagated).

---

## §5. `@polderlabs/bizar-dash` In-Place Refactor (Phase 3 — partial)

### What changes in this session

Add NEW directory `bizar-dash/src/server/routes-v2/`:
- `index.mjs` — Express router for `/api/v2/*` namespace.
- `events.mjs` — `GET /api/v2/event` SSE endpoint that accepts subscriptions.
- `auth.mjs` — HTTP basic auth middleware for v2 routes (uses `BIZAR_DASHBOARD_PASSWORD`).
- `health.mjs` — `GET /api/v2/health` endpoint.

Add NEW module `bizar-dash/src/server/v2-event-bus.mjs`:
- In-memory `EventEmitter` that buffers recent events (last 100) for late subscribers.
- New subscribers get the buffer + live stream.
- Each event is JSON-serialized in the opencode format: `event: <type>\ndata: {type, properties}\n\n`.

Wire into `bizar-dash/src/server/server.mjs`:
- Mount the v2 router at `/api/v2/*` AFTER the existing `/api/*` mounts.
- On dashboard startup, generate password if missing; write to `~/.cache/bizarharness/dash-auth.json` (mode 0600).
- The existing `serve-info.mjs` (which reads from the plugin's serve.json) stays untouched.

### What does NOT change in this session

- Existing 20+ dashboard routes stay untouched.
- Existing WebSocket layer (used for TUI) stays untouched.
- React UI, plan canvas, artifact editor — all untouched.
- No move to `packages/dashboard/` yet.

### Tests added this session

- `bizar-dash/tests/routes-v2/health.test.mjs` — 2 cases: 200 OK with `{status: "ok"}`, requires auth (401 without).
- `bizar-dash/tests/routes-v2/events.test.mjs` — 3 cases: 200 with `text/event-stream` content type, first event is `dashboard.connected`, published event reaches subscriber.
- `bizar-dash/tests/routes-v2/auth.test.mjs` — 2 cases: missing auth → 401, valid auth → 200.

### Auth file format

`~/.cache/bizarharness/dash-auth.json`:
```json
{
  "baseUrl": "http://127.0.0.1:4098",
  "port": 4098,
  "password": "<32-byte random base64>",
  "createdAt": 1700000000000
}
```

Written atomically (tmp+rename). Mode 0600. Idempotent across restarts (existing password preserved if file exists).

---

## §6. Test Strategy

### Iteration 1 — SDK unit tests (Vitest)
- `npm run test -w @polderlabs/bizar-sdk` — all pass
- `npx tsc --noEmit -p packages/sdk/tsconfig.json` — clean

### Iteration 2 — Plugin integration (bun test)
- `cd plugins/bizar && bun test tests/dashboard-client.test.ts` — 3 pass
- `cd plugins/bizar && bun test` — all existing 30+ tests still pass (no regressions)
- `cd plugins/bizar && npx tsc --noEmit` — clean

### Iteration 3 — Dashboard v2 routes (Vitest)
- `cd bizar-dash && npm run test` — new tests pass (we add Vitest if not present; otherwise Node `--test` runner)
- `cd bizar-dash && npm run typecheck` — clean
- Manual smoke: `curl http://127.0.0.1:4098/api/v2/health` returns 401 (auth required)
- `curl -u opencode:<password> http://127.0.0.1:4098/api/v2/health` returns 200

### Iteration 4 — End-to-end (curl SSE)
- Start dashboard in foreground (background process): `cd bizar-dash && node src/server/server.mjs &`
- Note the generated password from `~/.cache/bizarharness/dash-auth.json`.
- Start a curl SSE subscriber: `curl -N -u opencode:<password> http://127.0.0.1:4098/api/v2/event`
- Expected: `event: dashboard.connected\ndata: {"type":"dashboard.connected",...}\n\n`
- POST a test event via SDK or curl: `curl -X POST -u opencode:<password> http://127.0.0.1:4098/api/v2/event -d '{"type":"test.event","properties":{"foo":"bar"}}'`
- Expected: subscriber sees the event.

### Iteration 5 — Plugin → Dashboard round-trip
- Configure `BIZAR_DASHBOARD_URL=http://127.0.0.1:4098` and `BIZAR_DASHBOARD_PASSWORD=<from-auth-file>`.
- Run a minimal opencode session with the plugin loaded.
- Subscribe to dashboard SSE.
- Confirm events flow.

*Note: Iteration 5 may be deferred if opencode integration requires a full TUI session. For this session we ship Iteration 1-4 + the publish-to-npm prep, and document Iteration 5 as next-steps.*

### Iteration 6 — Publish prep
- `cd packages/sdk && npm pack --dry-run` — verify expected tarball contents.
- README updated per package.
- CHANGELOG entry drafted.
- Version bumped to 0.7.0-alpha.1.

---

## §7. Parallel Implementation Split

This session (with only Odin executing directly — no parallel agents available):

**Sequential phases** (Odin writes code directly):
1. Phase A: Write SDK package files (types, client, errors, events, tests).
2. Phase B: Run SDK tests + typecheck → green.
3. Phase C: Write dashboard v2 routes (auth, events, health) + auth-file logic + tests.
4. Phase D: Write plugin dashboard-client module + tests.
5. Phase E: Smoke test end-to-end.
6. Phase F: Update CHANGELOG + version bump.
7. Phase G: Commit + push.

**Future (post-session) split** (when Tyr/Thor routing is restored):
- Thor (moderate): packages/sdk/ — well-bounded, isolated, no external deps.
- Tyr (complex): dashboard v2 routes + plugin dashboard-client — needs cross-package coordination.
- Disjoint file scopes enforced via parallel-execution protocol.

---

## §8. Iteration Schedule (this session)

| Iteration | Owner | Output | Test gate |
|---|---|---|---|
| A | Odin | SDK package files | `npm test -w @polderlabs/bizar-sdk` |
| B | Odin | SDK green | tsc clean |
| C | Odin | Dashboard v2 routes | curl smoke + node --test |
| D | Odin | Plugin dashboard-client | bun test |
| E | Odin | End-to-end smoke | curl SSE round-trip |
| F | Odin | CHANGELOG + version | grep verify |
| G | Odin | Commit + push | git status clean |

---

## §9. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | Existing 30+ plugin tests break | Medium | High | Dashboard-client is additive; no signature changes to existing exports. New module only. |
| 2 | Dashboard auth file permissions wrong | Low | Medium | Explicit `chmod 0600` after write. Document in README. |
| 3 | SDK types drift from server | Medium | Medium | Hand-written types match OPENAPI_SPEC exactly. Add codegen (v0.7.1). |
| 4 | SSE buffer unbounded | Low | Medium | Cap buffer at 100 events; subscribers can use `?since=<seq>` for replay. |
| 5 | Plugin import of `@polderlabs/bizar-sdk` fails | Low | High | Use workspaces; SDK built before plugin runs; verify `npm ls @polderlabs/bizar-sdk` in plugin dir. |
| 6 | Bun vs Node typecheck differences | Medium | Medium | SDK targets both. Plugin uses Bun. Dashboard uses Node. Hand-written types avoid edge cases. |
| 7 | install.sh breaks after restructure | Low | Medium | install.sh copies `plugins/bizar/` — that path is unchanged. No update needed this session. |

---

## §10. Backward Compatibility

- All existing `/api/*` dashboard endpoints stay.
- Plugin's `serve-info.ts` file bridge stays (dashboard's `serve-info.mjs` keeps reading it).
- Plugin's 7 tools keep their signatures.
- 30+ existing plugin tests stay unchanged.
- New SDK endpoints under `/api/v2/*` namespace (no collision).
- Auth file at `~/.cache/bizarharness/dash-auth.json` is a NEW path — no existing file there.
- New SDK package is additive; no removal of existing packages.
- Plugin moves to `@bizarharness/plugin` is deferred to v0.8.0 (breaking per semver; documented in CHANGELOG).
- v0.6.2 → v0.7.0-alpha.1 (plugin minor bump; alpha tag for the new SDK).

---

## §11. Publish Checklist (Iteration 6)

- [ ] `packages/sdk/package.json` version bumped to `0.7.0-alpha.1`
- [ ] `packages/sdk/README.md` documents install + usage
- [ ] `packages/sdk/LICENSE` (MIT) in place
- [ ] `packages/sdk/dist/` built (gitignored, but `npm pack` includes it)
- [ ] `cd packages/sdk && npm pack --dry-run` shows expected files
- [ ] Root `CHANGELOG.md` entry: "v0.7.0-alpha.1 — adds @polderlabs/bizar-sdk with HTTP+SSE plugin↔dashboard bridge"
- [ ] Root `package.json` workspace config added
- [ ] Root `tsconfig.json` includes SDK paths
- [ ] Root `.gitignore` excludes `packages/*/dist/`
- [ ] Commit with conventional message: `feat(sdk): add @polderlabs/bizar-sdk v0.7.0-alpha.1 with HTTP+SSE plugin↔dashboard bridge`
- [ ] Push to `origin master`
- [ ] (Optional, manual) `cd packages/sdk && npm publish --tag alpha` — user can run this with their own npm creds

---

## Next Steps (post-session)

When Tyr/Thor routing is restored:

1. **v0.7.0** — Move `plugins/bizar/` → `packages/plugin/` (delete root copy). Update install.sh. Update root tsconfig.json paths.
2. **v0.7.0** — Move `bizar-dash/` → `packages/dashboard/` (delete root copy). Update install.sh.
3. **v0.7.1** — Add `@hey-api/openapi-ts` codegen; replace hand-written `types.ts` with generated `types.gen.ts`. Add CI step to verify generated types match server.
4. **v0.7.2** — Implement the full `/api/v2/*` surface per OPENAPI_SPEC (sessions, messages, plans, projects endpoints with full CRUD).
5. **v0.7.3** — Add Vitest in dashboard for the full v2 surface; add integration tests using a real opencode serve child.
6. **v0.8.0** — Replace file-based `serve.json` bridge with SDK-based event publishing (full migration; remove `serve-info.ts` + `serve-info.mjs` once all consumers migrate).
7. **v0.9.0** — TUI migration: rewrite the dashboard's blessed-based TUI to consume SDK + SSE instead of in-process state.
