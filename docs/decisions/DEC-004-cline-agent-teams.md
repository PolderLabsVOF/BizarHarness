# DEC-004 — Cline agent teams integration (`bizar_spawn_team`)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @tyr
**Related:** DEC-002

## Context

Cline has first-class support for agent teams — multiple agents
collaborating on a shared mission, coordinated by a lead agent.
The lead agent decomposes the mission, dispatches teammates, and
collects results via `team_progress_projection` and
`team.lifecycle.v1` events.

Bizar should expose this to its agents so they can spawn teams
on demand for tasks that benefit from multi-agent collaboration.

## Decision

Add two tools to the plugin:

1. **`bizar_spawn_team`** — creates a Cline session with the
   lead-agent team-coordination system prompt. Returns
   `sessionId`, `teamName`, `missionPreview`.

2. **`bizar_team_status`** — subscribes to team events for a
   session and returns the latest `team_progress_projection` /
   `team.lifecycle.v1` event.

Both tools are registered only when the `ClineRuntime` is up
(else the lead agent can't coordinate teammates).

## API

```ts
// plugins/bizar/src/tools/team-spawn.ts
const opts: StartSessionOpts = {
  providerId, modelId,
  workspaceRoot, systemPrompt,
  prompt,
  source: "bizar-team-spawn",
  sessionMetadata: {
    bizarTeam: input.teamName,
    bizarMission: input.mission.slice(0, 500),
  },
};
const sessionId = await runtime.startSession(opts);
return { ok: true, sessionId, teamName, missionPreview };
```

```ts
// plugins/bizar/src/tools/team-status.ts
const lastProgress: unknown = null;
const handler = (event: CoreSessionEvent) => {
  const t = (event as { type?: string }).type;
  if (t === "team_progress_projection" || t === "team.lifecycle.v1") {
    lastProgress = event;
    done = true;
  }
};
const unsubscribe = runtime.subscribe({ sessionId }, handler);
const start = Date.now();
while (!done && Date.now() - start < timeoutMs) {
  await new Promise(r => setTimeout(r, 50));
}
return { ok: true, sessionId, teamProgress: lastProgress };
```

## Consequences

### Positive

- Agents can spawn teams without leaving the plugin context.
- The lead agent's system prompt is configured for team
  coordination (`enableAgentTeams: true` is implied).
- The kanban board consumes team events for real-time progress
  visualization.

### Negative

- Two new tools (`spawn_team`, `team_status`) increase the tool
  surface from 17 → 19.
- Team events require a live subscription; if the dashboard or
  plugin restarts, in-flight team events are lost.

### Neutral

- The dashboard's `Tasks.tsx` view shows a "team" badge on
  tasks tagged with `team:*` — a manual marker for now.
  Auto-detection from `team_progress_projection` events is queued
  for v6.1.0.

## References

- `plugins/bizar/src/tools/team-spawn.ts` (89 lines)
- `plugins/bizar/src/tools/team-status.ts` (60 lines)
- `plugins/bizar/src/clineruntime.ts` — the underlying runtime
- `bizar-dash/src/web/views/Tasks.tsx` — team badge UI
