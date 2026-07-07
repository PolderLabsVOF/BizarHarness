/**
 * SSE event subscriber for the BizarHarness SDK.
 *
 * Wraps the cline-style SSE format:
 *
 *   event: <type>
 *   data: {"type": "<type>", "properties": { ... }}
 *
 * Returns an async iterable + close handle.
 *
 * Reference: cline SDK pattern (`for await (const event of events.stream)`).
 */

import type { DashboardEvent } from "./types.js";

export interface EventSubscriptionOptions {
  signal?: AbortSignal;
  /** Replay events from this sequence number (buffered by dashboard). */
  since?: number;
}

export interface EventSubscription {
  stream: AsyncIterable<DashboardEvent>;
  close(): void;
}

/**
 * Subscribe to dashboard events. The returned stream yields parsed
 * `DashboardEvent` instances.
 *
 * If `signal` aborts, the underlying fetch is aborted and the stream ends.
 */
export async function subscribeEvents(
  baseUrl: string,
  authHeader: string,
  opts: EventSubscriptionOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<EventSubscription> {
  const url = new URL("/event", baseUrl);
  if (typeof opts.since === "number") {
    url.searchParams.set("since", String(opts.since));
  }

  const controller = new AbortController();
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "text/event-stream",
    },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(
      `SSE subscribe failed: ${response.status} ${response.statusText}`,
    );
  }

  const stream = parseSseStream<DashboardEvent>(response.body, controller);
  return {
    stream,
    close: () => controller.abort(),
  };
}

/**
 * Parse an SSE byte stream into a typed async iterable.
 *
 * Handles the cline SSE format: lines starting with `event:` and `data:`.
 * Lines beginning with `:` are comments (ignored). Empty lines delimit events.
 *
 * Yields parsed events as `{ type, properties, ... }` objects (the JSON
 * decoded value of the `data:` line).
 */
export async function* parseSseStream<T extends { type: string }>(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
): AsyncIterable<T> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // SSE events are delimited by a blank line.
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const parsed = parseSseEvent(raw);
        if (parsed !== null) {
          yield parsed as T;
        }
        boundary = buffer.indexOf("\n\n");
      }
    }

    // Flush any trailing event without a blank line terminator.
    if (buffer.trim().length > 0) {
      const parsed = parseSseEvent(buffer);
      if (parsed !== null) yield parsed as T;
    }
  } finally {
    reader.releaseLock();
    controller.abort();
  }
}

function parseSseEvent(raw: string): unknown | null {
  let eventType: string | null = null;
  const dataLines: string[] = [];

  for (const line of raw.split("\n")) {
    if (line.length === 0) continue;
    if (line.startsWith(":")) continue; // comment
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const field = line.slice(0, colonIdx);
    let value = line.slice(colonIdx + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") {
      eventType = value;
    } else if (field === "data") {
      dataLines.push(value);
    }
  }

  if (dataLines.length === 0) return null;
  const data = dataLines.join("\n");

  try {
    const parsed = JSON.parse(data) as { type?: string; properties?: unknown };
    // Prefer the SSE `event:` line; fall back to JSON's `type` field.
    if (eventType && parsed.type !== eventType) {
      return { ...parsed, type: eventType };
    }
    return parsed;
  } catch {
    // Malformed JSON — skip this event rather than crash the stream.
    return null;
  }
}
