/**
 * Tests for the createBizarClient factory and its resource methods.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createBizarClient } from "../src/client.js";
import { isBizarError, type BizarError } from "../src/errors.js";
import type { Session } from "../src/types.js";
import { makeFetchMock, type FetchMock } from "./fixtures/fetch-mock.js";

describe("createBizarClient", () => {
  let m: FetchMock;

  beforeEach(() => {
    m = makeFetchMock();
  });

  it("attaches HTTP basic auth header with username 'cline'", async () => {
    m.respondWith("GET", "/sessions", { status: 200, body: "[]" });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "secret123",
      fetch: m.fetch,
    });

    const result = await client.sessions.list();
    expect(isBizarError(result)).toBe(false);
    expect(m.lastRequest).not.toBeNull();
    expect(m.lastRequest!.headers["Authorization"]).toBe(
      `Basic ${Buffer.from("cline:secret123").toString("base64")}`,
    );
  });

  it("GET /sessions returns an array of sessions on 200", async () => {
    const sessions: Session[] = [
      {
        id: "bgr_1",
        agent: "mimir",
        status: "running",
        toolCallCount: 0,
        worktree: "/tmp",
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    m.respondWith("GET", "/sessions", { status: 200, body: JSON.stringify(sessions) });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.sessions.list();
    expect(isBizarError(result)).toBe(false);
    expect(result).toEqual(sessions);
    expect(m.lastRequest!.method).toBe("GET");
  });

  it("POST /sessions sends JSON body and returns 201 session", async () => {
    const created: Session = {
      id: "bgr_2",
      agent: "thor",
      status: "pending",
      toolCallCount: 0,
      worktree: "/tmp",
      createdAt: 1,
      updatedAt: 1,
    };
    m.respondWith("POST", "/sessions", { status: 201, body: JSON.stringify(created) });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.sessions.create({
      agent: "thor",
      prompt: "hello",
    });

    expect(isBizarError(result)).toBe(false);
    expect(result).toEqual(created);
    expect(m.lastRequest!.method).toBe("POST");
    expect(m.lastRequest!.headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(m.lastRequest!.body!);
    expect(body.agent).toBe("thor");
    expect(body.prompt).toBe("hello");
  });

  it("DELETE /sessions/:id returns null on 204", async () => {
    m.respondWith("DELETE", "/sessions/bgr_2", { status: 204, body: "" });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.sessions.abort({ sessionId: "bgr_2" });
    expect(isBizarError(result)).toBe(false);
    expect(result).toBeNull();
  });

  it("returns a DashboardError on 4xx (not thrown by default)", async () => {
    m.respondWith("GET", "/sessions/missing", {
      status: 404,
      body: JSON.stringify({ name: "DashboardError", data: { statusCode: 404, message: "Session not found" } }),
    });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.sessions.get({ sessionId: "missing" });
    expect(isBizarError(result)).toBe(true);
    if (isBizarError(result)) {
      expect(result.name).toBe("DashboardError");
      if (result.name === "DashboardError") {
        expect(result.data.statusCode).toBe(404);
        expect(result.data.message).toBe("Session not found");
      }
    }
  });

  it("returns an APIError on 5xx with isRetryable=true", async () => {
    m.respondWith("GET", "/sessions", { status: 503, body: "service unavailable" });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.sessions.list();
    expect(isBizarError(result)).toBe(true);
    if (isBizarError(result)) {
      expect(result.name).toBe("APIError");
      if (result.name === "APIError") {
        expect(result.data.statusCode).toBe(503);
        expect(result.data.isRetryable).toBe(true);
      }
    }
  });

  it("returns a ConnectionError when fetch throws", async () => {
    m.respondWithError("GET", "/health", new TypeError("fetch failed"));

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.health.check();
    expect(isBizarError(result)).toBe(true);
    if (isBizarError(result)) {
      expect(result.name).toBe("ConnectionError");
      if (result.name === "ConnectionError") {
        expect(result.data.message).toContain("fetch failed");
      }
    }
  });

  it("throws when throwOnError=true", async () => {
    m.respondWithError("GET", "/sessions", new TypeError("connection refused"));

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
      throwOnError: true,
    });

    await expect(client.sessions.list()).rejects.toMatchObject({
      name: "ConnectionError",
    });
  });

  it("sends query parameters for sessions.list", async () => {
    m.respondWith("GET", "/sessions", { status: 200, body: "[]" });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    await client.sessions.list({ status: "running", limit: 25 });
    expect(m.lastRequest!.url).toContain("status=running");
    expect(m.lastRequest!.url).toContain("limit=25");
  });

  it("publishes a DashboardEvent via POST /event", async () => {
    m.respondWith("POST", "/event", { status: 204, body: "" });

    const client = createBizarClient({
      baseUrl: "http://127.0.0.1:4098",
      password: "x",
      fetch: m.fetch,
    });

    const result = await client.events.publish({
      type: "session.created",
      properties: { sessionId: "ses_1", agent: "mimir" },
    });
    expect(isBizarError(result)).toBe(false);

    const body = JSON.parse(m.lastRequest!.body!);
    expect(body.type).toBe("session.created");
    expect(body.properties.sessionId).toBe("ses_1");
  });
});
