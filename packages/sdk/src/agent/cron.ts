/**
 * src/agent/cron.ts
 *
 * Pillar A — Cron scheduled tasks.
 *
 * Exports:
 *   addCronTask({ cron, prompt, recurring })
 *   listCronTasks()
 *   removeCronTask(id)
 *
 * Persists to `.bizar/cron.json`.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface CronTask {
  id: string;
  cron: string;
  prompt: string;
  recurring: boolean;
  createdAt: string;
}

interface CronStore {
  tasks: CronTask[];
}

function cronStorePath(repoRoot?: string): string {
  return join(repoRoot ?? process.cwd(), ".bizar", "cron.json");
}

function loadStore(repoRoot?: string): CronStore {
  const fp = cronStorePath(repoRoot);
  if (!existsSync(fp)) return { tasks: [] };
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as CronStore;
  } catch {
    return { tasks: [] };
  }
}

function saveStore(store: CronStore, repoRoot?: string): void {
  const fp = cronStorePath(repoRoot);
  const dir = join(fp, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fp, JSON.stringify(store, null, 2), "utf-8");
}

/**
 * Add a cron task.
 *
 * @param opts.cron       — cron expression (e.g. "0 * * * *")
 * @param opts.prompt     — prompt to execute on trigger
 * @param opts.recurring  — if false, task is removed after first run
 * @param opts.repoRoot   — optional repo root override
 * @returns the created CronTask
 */
export function addCronTask(
  opts: { cron: string; prompt: string; recurring?: boolean; repoRoot?: string },
): CronTask {
  const { cron, prompt, recurring = false, repoRoot } = opts;
  const store = loadStore(repoRoot);
  const task: CronTask = {
    id: randomUUID(),
    cron,
    prompt,
    recurring,
    createdAt: new Date().toISOString(),
  };
  store.tasks.push(task);
  saveStore(store, repoRoot);
  return task;
}

/**
 * List all cron tasks.
 */
export function listCronTasks(repoRoot?: string): CronTask[] {
  return loadStore(repoRoot).tasks;
}

/**
 * Remove a cron task by id.
 * @returns true if the task existed and was removed
 */
export function removeCronTask(id: string, repoRoot?: string): boolean {
  const store = loadStore(repoRoot);
  const before = store.tasks.length;
  store.tasks = store.tasks.filter((t) => t.id !== id);
  if (store.tasks.length === before) return false;
  saveStore(store, repoRoot);
  return true;
}
