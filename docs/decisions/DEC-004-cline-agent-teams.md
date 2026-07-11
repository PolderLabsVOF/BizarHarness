> **Updated v6.3.0 (Claude Code migration).** The two-team-tools surface is preserved but the implementation now uses the Claude Code `Agent` tool (`agent_team: "<name>"`) under the hood. The plugin tools (`bizar_spawn_team`, `bizar_team_status`) become thin wrappers.

# DEC-004 — Agent teams integration (`bizar_spawn_team`)

**Date:** 2026-07-07
**Status:** Accepted
**Deciders:** @tyr
**Related:** DEC-002, DEC-011

## Context

Claude Code has first-class support for agent teams — multiple agents
collaborating on a shared mission, coordinated by a lead agent.
The lead agent decomposes the mission, dispatches teammates, and
collects results via the Claude Code agent-team event stream
(`AgentSpawned`, `AgentMessage`, `TeamProgress`, `TeamLifecycle`).

> **v6.3.0 update:** The Cline-era `team_progress_projection` and
> `team.lifecycle.v1` event names are replaced by Claude Code's
> typed agent-team events. The downstream kanban consumer subscribes
> to the same fields under their new names; the legacy event names
> are no longer emitted.

Bizar should expose this to its agents so they can spawn teams
on demand for tasks that benefit from multi-agent collaboration.

## Decision

Add two tools to the plugin:

1. **`bizar_spawn_team`** — creates a Claude Code session with the
   lead-agent team-coordination system prompt. Returns
   `sessionId`, `teamName`, `missionPreview`. Under the hood it
   calls the Claude Code `Agent` tool with `agent_team: "<name>"`
   and `run_in_background: true`.

2. **`bizar_team_status`** — subscribes to the Claude Code
   agent-team event stream for a session and returns the latest
   `TeamProgress` / `TeamLifecycle` event.

Both tools are registered only when the `ClaudeSdkRuntime` is up
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
// plugins/bizar/src/tools/team-status.ts (v6.3.0 excerpt)
const lastProgress: unknown = null;
const handler = (event: SessionEvent) => {
  const t = (event as { type?: string }).type;
  if (t === "TeamProgress" || t === "TeamLifecycle") {
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
  coordination (Claude Code's `Agent` tool with
  `agent_team: "<name>"` is the native dispatch path).
- The kanban board consumes Claude Code's agent-team events for
  real-time progress visualization.

### Negative

- Two new tools (`spawn_team`, `team_status`) increase the tool
  surface from 17 → 19.
- Team events require a live subscription; if the dashboard or
  plugin restarts, in-flight team events are lost.

### Neutral

- The dashboard's `Tasks.tsx` view shows a "team" badge on
  tasks tagged with `team:*` — a manual marker for now.
  Auto-detection from Claude Code `TeamProgress` events is queued
  for v6.4.0.

## References

- `plugins/bizar/src/tools/team-spawn.ts` (89 lines)
- `plugins/bizar/src/tools/team-status.ts` (60 lines)
- `plugins/bizar/src/clineruntime.ts` — the underlying
  `ClaudeSdkRuntime` (v6.3.0)
- `bizar-dash/src/web/views/Tasks.tsx` — team badge UI
- DEC-011 — Claude Code migration (v6.3.0)
