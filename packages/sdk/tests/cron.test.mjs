/**
 * cron.test.mjs
 *
 * Pillar A — cron task smoke test.
 * Run via: vitest run --root packages/sdk
 */

import { describe, it, beforeEach, afterEach } from "vitest";
import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addCronTask,
  listCronTasks,
  removeCronTask,
} from "../src/agent/cron.js";

describe("cron", () => {
  let tmp;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cron-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("addCronTask creates a task and listCronTasks returns it", () => {
    const task = addCronTask({
      cron: "0 * * * *",
      prompt: "Check emails",
      recurring: true,
      repoRoot: tmp,
    });
    assert.ok(task.id, "task must have an id");
    assert.strictEqual(task.cron, "0 * * * *");
    assert.strictEqual(task.prompt, "Check emails");
    assert.strictEqual(task.recurring, true);

    const list = listCronTasks(tmp);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, task.id);
  });

  it("removeCronTask returns true when task exists and removes it", () => {
    const task = addCronTask({
      cron: "0 * * * *",
      prompt: "Check emails",
      recurring: false,
      repoRoot: tmp,
    });
    const removed = removeCronTask(task.id, tmp);
    assert.strictEqual(removed, true);
    assert.strictEqual(listCronTasks(tmp).length, 0);
  });

  it("removeCronTask returns false for unknown id", () => {
    const removed = removeCronTask("not-a-real-id", tmp);
    assert.strictEqual(removed, false);
  });

  it("addCronTask persists across calls", () => {
    addCronTask({ cron: "0 * * * *", prompt: "task1", repoRoot: tmp });
    addCronTask({ cron: "0 * * * *", prompt: "task2", repoRoot: tmp });
    const list = listCronTasks(tmp);
    assert.strictEqual(list.length, 2);
  });
});
