#!/usr/bin/env node
/**
 * scripts/overnight-loop.mjs — queue inspector for the overnight loop.
 *
 * Reads scripts/loop-tasks.md, parses the numbered task queue, and
 * prints it. The actual iteration loop runs in the Claude Code
 * conversation: each wake-up picks the next task from the queue and
 * dispatches a Thor subagent to implement + test + commit it.
 *
 * Stop sentinel: create a file at /home/drb0rk/projects/BizarHarness/STOP
 * and the next wake-up will halt instead of dispatching another task.
 *
 * Usage:
 *   node scripts/overnight-loop.mjs                    # print queue
 *   node scripts/overnight-loop.mjs --dry-run --from=5  # preview
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const DRY_RUN = process.argv.includes('--dry-run');
const FROM = Number(process.argv.find((a) => a.startsWith('--from='))?.split('=')[1] ?? '1');

function parseTasks(md) {
  const tasks = [];
  const lines = md.split('\n');
  let current = null;
  let block = [];
  for (const line of lines) {
    const m = line.match(/^###\s+Task\s+(\d+)\.\s+(.+)$/);
    if (m) {
      if (current) tasks.push({ n: current.n, title: current.title, block: block.join('\n') });
      current = { n: Number(m[1]), title: m[2].trim() };
      block = [];
    } else if (current) {
      block.push(line);
    }
  }
  if (current) tasks.push({ n: current.n, title: current.title, block: block.join('\n') });
  return tasks;
}

const stopPath = resolve(ROOT, 'STOP');
const md = readFileSync(resolve(__dirname, 'loop-tasks.md'), 'utf8');
const tasks = parseTasks(md);

console.log(`Queue: ${tasks.length} tasks`);
console.log(`Stop sentinel: ${existsSync(stopPath) ? 'PRESENT (loop will halt)' : 'absent'}\n`);
for (const t of tasks) {
  if (t.n < FROM) continue;
  console.log(`#${t.n}  ${t.title}`);
  if (DRY_RUN) {
    console.log(t.block.trim().split('\n').map((l) => '    ' + l).join('\n'));
    console.log();
  }
}