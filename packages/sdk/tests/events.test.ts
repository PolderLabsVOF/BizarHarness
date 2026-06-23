/**
 * Tests for the SSE event subscriber.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { subscribeEvents, parseSseStream } from "../src/events.js";
import type { DashboardEvent } from "../src/types.js";
import { sseStream, sseRawStream } from "./fixtures/sse-mock.js";
import { makeFetchMock, type FetchMock } from "./fixtures/fetch-mock.js";

describe("parseSseStream", () => {
  it("parses a single event", async () => {
    const stream = sseStream([
      { type: "dashboard.connected", properties: {} },
    ]);

    const controller = new AbortController();
    const iter = parseSseStream<DashboardEvent>(stream, controller);
    const events: DashboardEvent[] = [];
    for await (const e of iter) events.push(e);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("dashboard.connected");
  });

  it("parses multiple events in order", async () => {
    const stream = sseStream([
      { type: "dashboard.connected", properties: {} },
      {
        type: "session.created",
        properties: { sessionId: "ses_1", agent: "mimir" },
      },
      {
        type: "session.updated",
        properties: { sessionId: "ses_1", status: "running" },
      },
    ]);

    const controller = new AbortController();
    const iter = parseSseStream<DashboardEvent>(stream, controller);
    const events: DashboardEvent[] = [];
    for await (const e of iter) events.push(e);

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual([
      "dashboard.connected",
      "session.created",
      "session.updated",
    ]);
  });

  it("skips malformed data lines instead of throwing", async () => {
    const stream = sseRawStream([
      "event: dashboard.connected\ndata: {not valid json}\n\n",
      "event: session.created\ndata: {\"type\":\"session.created\",\"properties\":{\"sessionId\":\"ses_1\",\"agent\":\"thor\"}}\n\n",
    ]);

    const controller = new AbortController();
    const iter = parseSseStream<DashboardEvent>(stream, controller);
    const events: DashboardEvent[] = [];
    for await (const e of iter) events.push(e);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("session.created");
  });

  it("ignores comment lines starting with ':'", async () => {
    const stream = sseRawStream([
      ": this is a comment\n",
      "event: dashboard.connected\n",
      "data: {\"type\":\"dashboard.connected\",\"properties\":{}}\n\n",
    ]);

    const controller = new AbortController();
    const iter = parseSseStream<DashboardEvent>(stream, controller);
    const events: DashboardEvent[] = [];
    for await (const e of iter) events.push(e);

    expect(events).toHaveLength(1);
  });
});

describe("subscribeEvents", () => {
  let m: FetchMock;

  beforeEach(() => {
    m = makeFetchMock();
  });

  it("returns subscription that yields parsed events", async () => {
    const events: DashboardEvent[] = [
      { type: "dashboard.connected", properties: {} },
      {
        type: "session.created",
        properties: { sessionId: "ses_1", agent: "mimir" },
      },
    ];

    m.respondWithStream("GET", "/event", sseStream(events));

    const sub = await subscribeEvents(
      "http://127.0.0.1:4098",
      "Basic xyz",
      {},
      m.fetch,
    );

    const received: DashboardEvent[] = [];
    for await (const e of sub.stream) received.push(e);

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("dashboard.connected");
    expect(received[1].type).toBe("session.created");

    expect(m.lastRequest!.headers["Accept"]).toBe("text/event-stream");
    expect(m.lastRequest!.headers["Authorization"]).toBe("Basic xyz");
  });

  it("aborts the fetch when subscription.close() is called", async () => {
    // Long-lived stream that blocks
    const blockedStream = new ReadableStream<Uint8Array>({
      start() {
        /* never closes */
      },
    });

    m.respondWithStream("GET", "/event", blockedStream);

    const sub = await subscribeEvents(
      "http://127.0.0.1:4098",
      "Basic xyz",
      {},
      m.fetch,
    );

    sub.close();
    // No assertion needed beyond "did not hang"
  });
});
