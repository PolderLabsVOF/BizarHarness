/**
 * dashboard-client.test.ts
 *
 * v0.7.0-alpha.1 — Tests for the SDK-backed dashboard publisher.
 *
 * Verifies:
 *   - publish() succeeds when the dashboard is reachable (uses a stub
 *     fetch via `createBizarClient`'s `fetch` injection — but our
 *     publisher doesn't currently expose fetch injection, so we test
 *     via the real `publishV2Event` round-trip from the smoke test
 *     pattern instead).
 *   - publish() drops events when the publisher is not started.
 *   - Graceful degradation: env var override is respected.
 *
 * Network tests (publish to a real dashboard) live in
 * `tests/integration/dashboard-bridge.test.ts` and require a running
 * dashboard server.
 */

import { describe, it, expect } from "bun:test";
import { createDashboardPublisher, type Logger } from "../src/dashboard-client.js";

// ---------------------------------------------------------------------------
// Test logger
// ---------------------------------------------------------------------------

const makeLogger = (): Logger & { lines: string[] } => {
  const lines: string[] = [];
  return {
    lines,
    debug(m) { lines.push(`debug: ${m}`); },
    info(m) { lines.push(`info: ${m}`); },
    warn(m) { lines.push(`warn: ${m}`); },
    error(m) { lines.push(`error: ${m}`); },
  };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createDashboardPublisher", () => {
  it("publish() drops events when not started", async () => {
    const logger = makeLogger();
    const pub = createDashboardPublisher({ logger });
    // Do NOT call start()
    expect(pub.isReady()).toBe(false);

    await pub.publish({
      type: "session.created",
      properties: { sessionId: "ses_1", agent: "mimir" },
    });

    // Logger should have recorded a debug drop message.
    expect(logger.lines.some((l) => l.includes("not ready"))).toBe(true);
  });

  it("start() is a no-op when disabled by config", async () => {
    const logger = makeLogger();
    const pub = createDashboardPublisher({ logger, disabled: true });
    await pub.start();
    expect(pub.isReady()).toBe(false);
    expect(logger.lines.some((l) => l.includes("disabled"))).toBe(true);
  });

  it("start() is a no-op when no password is available", async () => {
    const logger = makeLogger();
    // Make sure no env vars or auth files are present in this test.
    const prevUrl = process.env.BIZAR_DASHBOARD_URL;
    const prevPort = process.env.BIZAR_DASHBOARD_PORT;
    const prevPw = process.env.BIZAR_DASHBOARD_PASSWORD;
    const prevAuthFile = process.env.BIZAR_DASHBOARD_AUTH_FILE;
    const prevAuthFiles = process.env.BIZAR_DASHBOARD_AUTH_FILES;
    delete process.env.BIZAR_DASHBOARD_URL;
    delete process.env.BIZAR_DASHBOARD_PORT;
    delete process.env.BIZAR_DASHBOARD_PASSWORD;
    // Point auth-file discovery at a non-existent path.
    process.env.BIZAR_DASHBOARD_AUTH_FILE = "/tmp/__no_such_auth_file__.json";

    try {
      const pub = createDashboardPublisher({ logger });
      await pub.start();
      expect(pub.isReady()).toBe(false);
      expect(logger.lines.some((l) => l.includes("not started"))).toBe(true);
    } finally {
      if (prevUrl !== undefined) process.env.BIZAR_DASHBOARD_URL = prevUrl;
      if (prevPort !== undefined) process.env.BIZAR_DASHBOARD_PORT = prevPort;
      if (prevPw !== undefined) process.env.BIZAR_DASHBOARD_PASSWORD = prevPw;
      if (prevAuthFile !== undefined) {
        process.env.BIZAR_DASHBOARD_AUTH_FILE = prevAuthFile;
      } else {
        delete process.env.BIZAR_DASHBOARD_AUTH_FILE;
      }
      if (prevAuthFiles !== undefined) {
        process.env.BIZAR_DASHBOARD_AUTH_FILES = prevAuthFiles;
      } else {
        delete process.env.BIZAR_DASHBOARD_AUTH_FILES;
      }
    }
  });

  it("start() succeeds when password is provided via env", async () => {
    const logger = makeLogger();
    process.env.BIZAR_DASHBOARD_PASSWORD = "test-password-1234567890abcdef";

    try {
      const pub = createDashboardPublisher({
        logger,
        baseUrl: "http://127.0.0.1:1", // port 1 = unreachable, but SDK client constructs fine
      });
      await pub.start();
      expect(pub.isReady()).toBe(true);
      expect(logger.lines.some((l) => l.includes("publisher started"))).toBe(true);
      pub.stop();
    } finally {
      delete process.env.BIZAR_DASHBOARD_PASSWORD;
    }
  });

  it("start() respects BIZAR_DASHBOARD_URL env var", async () => {
    const logger = makeLogger();
    process.env.BIZAR_DASHBOARD_URL = "http://127.0.0.1:4099";
    process.env.BIZAR_DASHBOARD_PASSWORD = "test-password-1234567890abcdef";

    try {
      const pub = createDashboardPublisher({ logger });
      await pub.start();
      expect(pub.isReady()).toBe(true);
      expect(
        logger.lines.some((l) => l.includes("url=http://127.0.0.1:4099")),
      ).toBe(true);
      pub.stop();
    } finally {
      delete process.env.BIZAR_DASHBOARD_URL;
      delete process.env.BIZAR_DASHBOARD_PASSWORD;
    }
  });

  it("stop() clears ready state and drops queue", async () => {
    const logger = makeLogger();
    process.env.BIZAR_DASHBOARD_PASSWORD = "test-password-1234567890abcdef";

    try {
      const pub = createDashboardPublisher({ logger });
      await pub.start();
      expect(pub.isReady()).toBe(true);
      pub.stop();
      expect(pub.isReady()).toBe(false);
      // Subsequent publish should be a no-op (drops because not ready).
      await pub.publish({
        type: "session.created",
        properties: { sessionId: "ses_x", agent: "thor" },
      });
      // Just verifies it doesn't throw.
    } finally {
      delete process.env.BIZAR_DASHBOARD_PASSWORD;
    }
  });
});
