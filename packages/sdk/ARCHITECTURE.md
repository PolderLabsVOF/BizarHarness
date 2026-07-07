# packages/sdk/ — Architecture

> TypeScript SDK wrapper for the Bizar Harness. Provides typed access
> to the Cline events and HTTP responses.

## Top-level layout

```
packages/sdk/
├── src/
│   ├── cline.ts                   # HTTP client (legacy compat)
│   ├── cline-events.ts            # Event shape definitions
│   ├── cline-types.ts             # Type definitions
│   ├── client.ts                  # Higher-level client wrapper
│   ├── errors.ts                  # Discriminated error model
│   ├── events.ts                  # Event stream helpers
│   ├── index.ts                   # Public API surface
│   ├── types.ts                   # Shared types
│   └── version.ts                 # SDK version constant
├── tests/
│   ├── client.test.ts             # vitest
│   ├── errors.test.ts
│   └── events.test.ts
└── package.json
```

## Public contract

```ts
import { ClineSdk, parseEvent, isBizarError } from "@polderlabs/bizar-sdk";

const sdk = new ClineSdk({ baseUrl: "http://127.0.0.1:4321", password });
const events = await sdk.events.subscribe({ sessionID });
for await (const event of events) {
  if (isBizarError(event)) console.error("error:", event);
  else console.log("event:", parseEvent(event));
}
```

## Key invariants

- SDK is HTTP-only (legacy compat). New code uses `@cline/core`
  in-process for both plugin and dashboard.
- Discriminated error model via `isBizarError(event)`.
- Event shapes are versioned (current: `runtime.team.progress.v1`).
- Tests use vitest (`bun test` doesn't pick them up — see test files).

## Verification

- `make check` — TS compile + tests (incl. vitest)
- `make e2e` — SDK wrapper integration (plugin ↔ dashboard roundtrip)
