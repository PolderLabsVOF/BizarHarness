#!/usr/bin/env node
/** Bounded lifecycle state and proactive liveness guidance for agent teams. */

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveBizarHome } from '../../../cli/config-paths.mjs';

function bounded(value, max = 500) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeId(value, fallback) {
  return bounded(value, 120).replace(/[^A-Za-z0-9_.-]/g, '_') || fallback;
}

function readState(path, sessionId) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (value?.schema === 'bizar.team-state.v1' && Array.isArray(value.tasks)) return value;
  } catch { /* new or malformed state */ }
  return { schema: 'bizar.team-state.v1', sessionId, tasks: [], updatedAt: null };
}

export function handleTeamLifecycle(input, options = {}) {
  if (!input || typeof input !== 'object') return {};
  const event = String(input.hook_event_name || 'Unknown');
  const now = (options.now || new Date()).toISOString();
  const sessionId = safeId(input.session_id, 'unknown-session');
  const taskId = safeId(input.task_id || input.agent_id, 'unknown-task');
  const record = {
    at: now,
    event,
    sessionId,
    teammate: bounded(input.teammate_name || input.agent_name || input.agent_id, 120),
    taskId,
    subject: bounded(input.subject || input.task_subject, 300),
    status: bounded(input.status || input.task_status, 80),
  };
  const home = options.bizarHome || resolveBizarHome({ env: options.env || process.env, cwd: input.cwd || process.cwd() });
  let context = '';
  try {
    const logPath = join(home, 'telemetry', 'team-lifecycle.jsonl');
    const statePath = join(home, 'telemetry', 'team-state', `${sessionId}.json`);
    mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
    mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
    appendFileSync(logPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });

    const state = readState(statePath, sessionId);
    let task = state.tasks.find((item) => item.taskId === taskId);
    if (!task) {
      task = { taskId, teammate: record.teammate, subject: record.subject, state: 'running', idleCount: 0, updatedAt: now };
      state.tasks.push(task);
    }
    task.updatedAt = now;
    if (event === 'TaskCompleted' || event === 'SubagentStop') {
      task.state = /fail|error/i.test(record.status) ? 'failed' : 'completed';
      context = `Agent task ${taskId} is terminal (${task.state}). Consume its result, reconcile/merge its worktree, and continue the active objective.`;
    } else if (event === 'TeammateIdle') {
      task.idleCount = Number(task.idleCount || 0) + 1;
      if (task.idleCount >= 2) context = `Agent task ${taskId} has been idle ${task.idleCount} times. Inspect its evidence now; stop and reassign if it made no progress. Do not model-cycle.`;
    } else {
      task.state = 'running';
    }
    state.tasks = state.tasks.slice(-64);
    state.updatedAt = now;
    const tmp = `${statePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, statePath);
  } catch {
    return {};
  }
  return context ? { hookSpecificOutput: { hookEventName: event, additionalContext: context } } : {};
}

export function main() {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
  process.stdout.write(`${JSON.stringify(handleTeamLifecycle(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
