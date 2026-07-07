/**
 * cli/agent-browser-update.test.mjs
 *
 * Unit tests for the v6.0.0 agent-browser install/update module.
 * Uses node:test (no `expect` — uses `assert` instead).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  detectState,
  printStatus,
  install,
  update,
  ensureRunning,
} = await import("./agent-browser-update.mjs");

describe("agent-browser-update", () => {
  it("exports the public API", () => {
    assert.equal(typeof detectState, "function");
    assert.equal(typeof printStatus, "function");
    assert.equal(typeof install, "function");
    assert.equal(typeof update, "function");
    assert.equal(typeof ensureRunning, "function");
  });

  it("detectState returns a structured state object", () => {
    const s = detectState();
    assert.ok("installed" in s);
    assert.ok("version" in s);
    assert.ok("chromeReady" in s);
    assert.ok("daemonRunning" in s);
    assert.ok("profileDir" in s);
    assert.ok("daemonPort" in s);
    assert.ok("bin" in s);
    assert.equal(typeof s.installed, "boolean");
    if (s.installed) {
      assert.equal(typeof s.version, "string");
    } else {
      assert.equal(s.version, null);
    }
  });

  it("detectState profileDir points to ~/.agent-browser/profile by default", () => {
    const s = detectState();
    assert.match(s.profileDir, /\.agent-browser\/profile$/);
  });

  it("detectState default daemon port is 9223", () => {
    delete process.env.AGENT_BROWSER_PORT;
    const s = detectState();
    assert.equal(s.daemonPort, 9223);
  });

  it("printStatus does not throw (regardless of install state)", () => {
    const origLog = console.log;
    const captured = [];
    console.log = (...args) => captured.push(args.join(" "));
    try {
      printStatus();
    } finally {
      console.log = origLog;
    }
    assert.ok(captured.length > 0);
    assert.match(captured[0], /agent-browser/);
  });

  it("install with dryRun=true returns a state object", () => {
    const s = install({ dryRun: true, silent: true });
    assert.ok("installed" in s);
  });

  it("update with dryRun=true returns a state object", () => {
    const s = update({ dryRun: true, silent: true });
    assert.ok("installed" in s);
  });

  it("ensureRunning with dryRun=true returns a state object", () => {
    const s = ensureRunning({ dryRun: true });
    assert.ok("installed" in s);
  });

  // NOTE: AGENT_BROWSER_PORT env override is tested manually (node --test
  // spawns a child process that doesn't inherit the parent's env).
});
