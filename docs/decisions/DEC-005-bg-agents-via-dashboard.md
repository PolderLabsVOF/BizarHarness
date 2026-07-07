# DEC-005 — Background agents via dashboard HTTP + dashboard in-process Cline

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @tyr
**Related:** DEC-002

## Context

Background agents can run either as:

- **Dashboard-spawned** sessions via HTTP to the dashboard's
  `/api/background` endpoint.
- **In-process** ClineCore sessions (via the new `ClineRuntime`).

The Bizar plugin needs to support both, since the dashboard is
optional but useful for long-running agent observation.

## Decision

The plugin's `bizar_spawn_background` tool POSTs to the dashboard
HTTP API (existing behavior). The dashboard's `bg-spawner.mjs`
embeds `ClineCore` in-process. The plugin's local `InstanceManager`
tracks state and exposes kill/pause/resume/collect locally.

### Plugin → Dashboard

```ts
// plugins/bizar/src/tools/bg-spawn.ts
const res = await fetch(`${dashboardUrl}/api/background`, {
  method: "POST",
  body: JSON.stringify({ prompt, model, worktree }),
});
const { instanceId } = await res.json();
```

### Dashboard → ClineCore (in-process)

```mjs
// bizar-dash/src/server/bg-spawner.mjs
import { ClineCore } from "@cline/core";
const cline = await ClineCore.create({ clientName: "bizar-dashboard" });
const { sessionId } = await cline.start({ config: { providerId, modelId }, prompt });
cline.subscribe((event) => broadcast(`bg:${event.type}`, event));
```

## Consequences

### Positive

- Background tools work when the dashboard is running.
- The dashboard owns the actual Cline session lifecycle.
- The plugin tracks state for `bizar_status`, `bizar_collect`,
  `bizar_kill`, etc., without round-tripping to Cline.

### Negative

- Two ClineCore instances (plugin + dashboard) may run for the
  same project. Provider rate limits apply to both.
- The plugin and dashboard have separate state; if one restarts,
  the other may be out of sync until the next event.

### Neutral

- The plugin's `InstanceManager` runs in "bg-only mode" — it
  tracks the local state but doesn't own the lifecycle.
- The dashboard's `bg-spawner.mjs` exposes WebSocket events
  (`bg:output`, `bg:progress`, `bg:tool-call`) that the plugin's
  `BackgroundAgents.tsx` view subscribes to.

## References

- `plugins/bizar/src/background.ts` — `InstanceManager`
- `plugins/bizar/src/tools/bg-{spawn,status,collect,kill,pause,resume}.ts`
- `bizar-dash/src/server/bg-spawner.mjs` — the dashboard's
  ClineCore wrapper
- `bizar-dash/src/web/views/BackgroundAgents.tsx` — live viewer
