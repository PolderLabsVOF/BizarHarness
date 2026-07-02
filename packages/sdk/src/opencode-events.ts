/**
 * SSE event iteration helper for the opencode serve child.
 *
 * Subscribes to the opencode SSE stream at `/event?directory=…`, filters
 * by `sessionID` when provided, and yields parsed typed events.
 *
 * This module is consumed by the SDK's `events.subscribe()` and by the
 * dashboard's chat SSE bridge.
 */

import { parseSseStream } from "./events.js";
import type { EventSubscription } from "./events.js";

/**
 * Options for subscribing to the opencode event stream.
 */
export interface OpencodeEventSubscribeOptions {
  /** AbortSignal to cancel the subscription early. */
  signal?: AbortSignal;
  /**
   * When provided, only events whose `sessionID` matches are yielded.
   * When omitted, all events are yielded.
   */
  sessionID?: string;
  /**
   * Optional baseUrl override (defaults to the SDK's configured baseUrl).
   */
  baseUrl?: string;
  /**
   * Optional auth header override.
   */
  authHeader?: string;
  /**
   * Injectable fetch. Defaults to global `fetch`.
   */
  fetch?: typeof fetch;
}

/**
 * A single parsed opencode SSE event envelope.
 */
export interface OpencodeEventEnvelope {
  type: string;
  sessionID?: string;
  messageID?: string;
  part?: object;
  data?: object;
}

/**
 * Subscribe to opencode's SSE `/event` endpoint.
 *
 * @param baseUrl  e.g. "http://127.0.0.1:4097"
 * @param authHeader  `Authorization: Basic …` value
 * @param opts
 */
export async function subscribeOpencodeEvents(
  baseUrl: string,
  authHeader: string,
  opts: OpencodeEventSubscribeOptions = {},
): Promise<EventSubscription> {
  const fetchImpl = opts.fetch ?? fetch;
  const controller = new AbortController();
  if (opts.signal) {
    opts.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  const url = new URL("/event", baseUrl);

  const response = await fetchImpl(url.toString(), {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "text/event-stream",
    },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`opencode event subscribe failed: ${response.status} ${response.statusText}`);
  }

  // Cast through unknown so the AsyncIterable<OpencodeEventEnvelope> satisfies
  // the AsyncIterable<DashboardEvent> constraint from the existing EventSubscription type.
  // The actual events flowing through are OpencodeEventEnvelope-shaped.
  const filteredStream = filterOpencodeSseStream(response.body, controller, opts.sessionID);
  return {
    stream: filteredStream as unknown as EventSubscription["stream"],
    close: () => controller.abort(),
  };
}

/**
 * Wrap `parseSseStream` with optional sessionID filtering.
 */
async function* filterOpencodeSseStream(
  body: ReadableStream<Uint8Array>,
  controller: AbortController,
  sessionID?: string,
): AsyncIterable<OpencodeEventEnvelope> {
  for await (const raw of parseSseStream<OpencodeEventEnvelope>(body, controller)) {
    if (!raw || typeof raw !== "object") continue;
    const evt = raw as unknown as Record<string, unknown>;
    // Unwrap sync envelope if present (mirrors serve-info.mjs:unwrapOpencodeSseEvent)
    let unwrapped = evt;
    if (evt.type === "sync" && evt.syncEvent && typeof evt.syncEvent === "object") {
      const se = evt.syncEvent as Record<string, unknown>;
      if (typeof se.type === "string") {
        if (se.data && typeof se.data === "object") {
          unwrapped = se.data as Record<string, unknown>;
        }
      }
    }
    const type = typeof unwrapped.type === "string" ? unwrapped.type : null;
    if (!type) continue;
    const evtSessionID = pickString(unwrapped, ["sessionID", "sessionId", "session_id"]);
    if (sessionID && evtSessionID !== sessionID) continue;
    yield {
      type,
      sessionID: evtSessionID,
      messageID: pickString(unwrapped, ["messageID", "messageId", "message_id"]),
      part: unwrapped.part && typeof unwrapped.part === "object" ? (unwrapped.part as object) : undefined,
      data: unwrapped,
    };
  }
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}
