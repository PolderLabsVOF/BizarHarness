#!/usr/bin/env node
/** Advisory, non-blocking lifecycle evidence for native Claude Code agent teams. */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

function bounded(value, max = 500) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function handleTeamLifecycle(input, options = {}) {
  if (!input || typeof input !== 'object') return {};
  const event = String(input.hook_event_name || 'Unknown');
  const record = {
    at: new Date().toISOString(),
    event,
    sessionId: bounded(input.session_id, 120),
    teammate: bounded(input.teammate_name || input.agent_name || input.agent_id, 120),
    taskId: bounded(input.task_id, 120),
    subject: bounded(input.subject || input.task_subject, 300),
    status: bounded(input.status || input.task_status, 80),
  };
  const home = options.bizarHome || process.env.BIZAR_HOME;
  if (home) {
    const path = join(home, 'telemetry', 'team-lifecycle.jsonl');
    try {
      mkdirSync(dirname(path), { recursive: true });
      appendFileSync(path, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    } catch {
      // Team lifecycle evidence is optional and must never block coordination.
    }
  }
  return {};
}

export function main() {
  let input;
  try { input = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { input = {}; }
  process.stdout.write(`${JSON.stringify(handleTeamLifecycle(input))}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
