# DEC-015: OpenKan is Bizar's external control plane

**Status:** Accepted  
**Date:** 2026-07-30  
**Feature:** F-120

## Context

Bizar intentionally removed its old dashboard and note-vault/search subsystem.
It now owns guarded Claude Code orchestration, durable task coordination, and
session handoff artifacts. OpenKan already owns a local task UI, project
registry, HTTP server, and live browser updates.

The integration needs to expose Bizar agents, tasks, sessions, and messages in
OpenKan without restoring duplicate presentation, memory, or storage layers in
Bizar.

Claude Code provides scriptable background-session listing, named-agent start,
session resume, and lifecycle hooks. It does not document an external live
conversation socket. Its `SendMessage` tool is scoped to an active agent team or
subagent context.

## Decision

1. Bizar adds a machine-readable `bizar control` CLI contract.
2. Bizar remains the source of truth for agent metadata, task semantics, Claude
   session lifecycle calls, and durable messages.
3. Messages use atomic files under `.bizar/control/messages/` and are injected
   through `SessionStart` and `UserPromptSubmit` hooks.
4. OpenKan calls the Bizar CLI with argument arrays; it does not import Bizar
   modules or open Bizar's task database.
5. OpenKan owns REST endpoints, the WebSocket snapshot/event channel, and the
   control-plane UI.
6. The bridge is local-only by default and exposes no raw transcripts,
   credentials, arbitrary shell commands, or arbitrary filesystem reads.

## Consequences

- Both repositories can version independently around a JSON CLI contract.
- Bizar's task collision and lease rules remain authoritative.
- Messages are durable and exactly-once claimed at hook boundaries, but a
  currently executing model turn cannot be interrupted by an unrelated
  process.
- OpenKan can request a background session resume to deliver a session-targeted
  message promptly.
- WebSocket collaboration is available to OpenKan clients without adding a
  persistent service to Bizar.

## Sources

- <https://code.claude.com/docs/en/cli-usage>
- <https://code.claude.com/docs/en/sessions>
- <https://code.claude.com/docs/en/hooks>
- <https://code.claude.com/docs/en/agent-view>
- <https://opencode.ai/docs/plugins/>
- <https://opencode.ai/docs/sdk/>

