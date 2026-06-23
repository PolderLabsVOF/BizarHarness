# @polderlabs/bizar-sdk

Typed SDK for the BizarHarness plugin ↔ dashboard communication protocol.

This package is the **shared types + client library** used by both:
- The Bizar opencode plugin (`@polderlabs/bizar-plugin`) — publishes events to the dashboard.
- The Bizar dashboard (`@polderlabs/bizar-dash`) — exposes REST + SSE endpoints and consumes events.

It replaces the legacy file-based `serve.json` bridge with a typed HTTP + SSE protocol sourced from an OpenAPI 3.1 spec.

## Install

```bash
npm install @polderlabs/bizar-sdk
```

## Usage

```ts
import { createBizarClient, SDK_VERSION } from "@polderlabs/bizar-sdk";

const client = createBizarClient({
  baseUrl: process.env.BIZAR_DASHBOARD_URL ?? "http://127.0.0.1:4098",
  password: process.env.BIZAR_DASHBOARD_PASSWORD ?? readPasswordFromAuthFile(),
});

// REST — resource-grouped methods
const sessions = await client.sessions.list({ status: "running" });
const session = await client.sessions.create({
  agent: "mimir",
  prompt: "Research the latest opencode serve API.",
});

// SSE — async iterable
const sub = await client.events.subscribe();
for await (const event of sub.stream) {
  // event.type is a discriminated string: "session.created" | "session.updated" | …
  // event.properties is the typed payload
  console.log(event.type, event.properties);
}

// Errors are returned by default (not thrown). Discriminated by `name`.
const result = await client.sessions.get({ sessionId: "ses_xyz" });
if ("name" in result && result.name === "DashboardError") {
  console.error("dashboard error:", result.data);
}
```

## Architecture

```
                ┌────────────────────────────┐
                │ opencode + Bizar plugin    │
                │  (publishes events)        │
                └──────────────┬─────────────┘
                               │ HTTP + SSE
                               │ (this SDK)
                ┌──────────────▼─────────────┐
                │ Bizar dashboard server     │
                │  (subscribes, exposes UI)  │
                └────────────────────────────┘
```

## Transport

- **REST (JSON)** for request/response CRUD operations.
- **SSE (`text/event-stream`)** for live events — single endpoint at `GET /event`.
- **No WebSocket** anywhere in the protocol.

## Auth

HTTP basic with the dashboard-generated password. The dashboard writes the password to `~/.cache/bizarharness/dash-auth.json` (mode 0600) on first start. The plugin reads this file or accepts `BIZAR_DASHBOARD_PASSWORD` env var override.

## Source of Truth

The API surface is defined in [OPENAPI_SPEC.yaml](../../.bizar/research/OPENAPI_SPEC.yaml). TypeScript types in `src/types.ts` are hand-written to match the spec exactly. In v0.7.1, types will be auto-generated via `@hey-api/openapi-ts` from that spec.

## License

MIT
