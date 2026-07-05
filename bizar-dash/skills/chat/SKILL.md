---
name: chat
description: How chat and opencode session integration works in BizarHarness - session management, message history, opencode session detail, and the chat view.
---

# Chat + OpenCode Session Integration

The chat view in BizarHarness integrates with opencode sessions to provide a conversational interface for agent interactions.

## Session Management

Each opencode session has a unique session ID. The chat router (`bizar-dash/src/server/routes/chat.mjs`) manages:
- Listing active and historical sessions
- Streaming message events via SSE
- Session termination

## Chat Endpoints

- `GET /api/chat/sessions` - list all sessions (active and recent)
- `GET /api/chat/sessions/:id` - get session metadata and messages
- `POST /api/chat/sessions` - create a new session
- `DELETE /api/chat/sessions/:id` - terminate a session
- `GET /api/chat/sessions/:id/stream` - SSE stream of messages

## Message Format

```typescript
interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  model?: string;
  tokens?: { input: number; output: number };
  createdAt: string;
  attachments?: Attachment[];
}
```

## OpenCode Session Detail

`bizar-dash/src/server/routes/opencode-session-detail.mjs` exposes per-session metadata:
- Agent chain (which agents handled this message)
- Token usage breakdown
- Tool calls made
- Session duration

## Chat View (Frontend)

`bizar-dash/src/web/views/Chat.tsx` - the main chat UI:
- Real-time message streaming via SSE
- Markdown rendering with syntax highlighting
- File attachment support
- Message regeneration
- Copy code buttons

Mobile: `bizar-dash/src/web/views/MobileChat.tsx`

## Hooks

`bizar-dash/src/web/hooks/useChat.ts` - manages:
- Session state
- Message list
- Streaming state
- Auto-scroll
- Error recovery

## Common Issues

### Messages not streaming
Check that the SSE endpoint is reachable and the session is still active. The server closes the stream after session timeout.

### Session shows wrong agent
Sessions are routed based on the current routing table in `AGENTS.md`. A session started under Thor will continue under Thor unless explicitly rerouted.
