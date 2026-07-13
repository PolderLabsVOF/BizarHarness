/**
 * v8/ui/chat/EventStream.tsx — text/event-stream reader.
 *
 * Thin helper over `fetch()` that parses `data:` lines from a server
 * response and yields each event to a callback. Used by the chat
 * composer (POST /api/chat sends, response is a stream) and by the
 * Claude session detail (GET /api/claude-sessions/:id/stream).
 *
 * The server emits either:
 *   - JSON envelopes per line (`fetchJson`-compatible), used when
 *     handlers prefer that shape;
 *   - SSE-formatted `data:` lines for streaming tokens.
 *
 * This reader handles both. JSON-only payloads (no `data:` prefix)
 * are forwarded verbatim. `event:` lines are split into separate
 * callbacks when present.
 */

export interface EventStreamHandlers {
  onChunk?: (text: string) => void;
  onEvent?: (event: string, data: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export interface EventStreamOptions extends EventStreamHandlers {
  signal?: AbortSignal;
}

export async function readEventStream(
  url: string,
  init: RequestInit,
  handlers: EventStreamOptions,
): Promise<void> {
  const { signal, onChunk, onEvent, onDone, onError } = handlers;
  try {
    const response = await fetch(url, { ...init, signal });
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status} reading ${url}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sawDone = false;
    // pump until the stream is fully drained or the caller aborts
    while (!sawDone) {
      if (signal?.aborted) break;
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line. Split and process.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const lines = frame.split('\n').filter((l) => l.length > 0);
        let data = '';
        let event = 'message';
        for (const line of lines) {
          if (line.startsWith('data:')) {
            data += line.slice(5).trim();
          } else if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          }
        }
        if (data.length === 0) continue;
        if (event === 'done') {
          sawDone = true;
          onDone?.();
          break;
        }
        if (event !== 'message') {
          onEvent?.(event, data);
        } else {
          onChunk?.(data);
        }
      }
    }
    onDone?.();
  } catch (err) {
    if (signal?.aborted) return;
    onError?.(err instanceof Error ? err : new Error(String(err)));
  }
}
