#!/usr/bin/env node
// PreToolUse — Bizar harness hook (Claude Code format).
//
// F-040: matches `tool_name === "Agent"` (the Claude Code agent dispatch
// tool) and notifies the dashboard so the Agents view can flip the
// dispatched agent's status to "working" + display its current task
// immediately — without waiting for the JSONL watcher to see the
// tool_use line.
//
// Claude Code stdin shape:
//   {
//     "session_id": "...",
//     "transcript_path": "...",
//     "cwd": "...",
//     "hook_event_name": "PreToolUse",
//     "tool_name": "Agent",
//     "tool_input": { "subagent_type": "...", "prompt": "..." }
//   }
//
// Behaviour:
//   1. Extract the agent name from tool_input (tries subagent_type →
//      agent → name → type → "claude").
//   2. Fire-and-forget POST to the dashboard /api/agents/:name/status
//      so the Agents view updates. 1.5s request timeout, 15s total
//      guard. NEVER blocks the model — if the dashboard is
//      unreachable we exit 0 silently.
//   3. Append a JSONL line to
//      ~/.config/bizar/hook-logs/agent-tool-YYYY-MM-DD.jsonl so
//      downstream tooling can correlate Agent invocations across
//      sessions, regardless of whether the dashboard was up.
//
// Claude Code stdout shape: we do not return any hookSpecificOutput
// because the Agent tool should proceed normally — this hook is
// pure observability.

'use strict';

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const HOME = os.homedir();
const HOOK_LOG_DIR = path.join(HOME, '.config', 'bizar', 'hook-logs');
const HOOK_TIMEOUT_MS = 1500;
const TOTAL_GUARD_MS = 15_000;

function pickAgentName(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return 'claude';
  const cand = toolInput.subagent_type || toolInput.agent || toolInput.name || toolInput.type;
  if (typeof cand === 'string' && cand.trim()) return cand.trim().slice(0, 64);
  return 'claude';
}

function previewPrompt(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return '';
  const p = toolInput.prompt || toolInput.task || toolInput.message || '';
  if (typeof p !== 'string') return '';
  return p.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function logToFile(sessionId, agentName, promptPreview) {
  try {
    fs.mkdirSync(HOOK_LOG_DIR, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    const file = path.join(HOOK_LOG_DIR, `agent-tool-${today}.jsonl`);
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      sessionId: sessionId || null,
      agentName,
      promptPreview,
      source: 'hook',
    });
    fs.appendFileSync(file, line + '\n');
  } catch {
    /* best-effort — never crash the model over a log write */
  }
}

function notifyDashboard(agentName, sessionId) {
  const base = process.env.BIZAR_DASHBOARD_URL || 'http://127.0.0.1:4321';
  let url;
  try {
    const u = new URL(`/api/agents/${encodeURIComponent(agentName)}/status`, base);
    url = u;
  } catch {
    return; // bad URL → silently drop
  }
  const taskId = `agent:${sessionId || 'unknown'}:${Date.now()}`;
  const body = JSON.stringify({
    status: 'working',
    currentTaskId: taskId,
    source: 'hook',
  });
  const opts = {
    method: 'POST',
    hostname: url.hostname,
    port: url.port || 80,
    path: url.pathname,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    timeout: HOOK_TIMEOUT_MS,
  };
  try {
    const req = http.request(opts, (res) => {
      // Drain so the socket can be reused / closed cleanly.
      res.on('data', () => {});
      res.on('end', () => {});
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => { /* unreachable, refused, etc. — ignore */ });
    req.write(body);
    req.end();
  } catch {
    /* never throw out of the hook */
  }
}

const guard = setTimeout(() => process.exit(0), TOTAL_GUARD_MS);
guard.unref?.();

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { input = {}; }

  // Hard gate: only react to the Agent tool. PreToolUse matchers do
  // this for us, but defense-in-depth in case matcher config drifts.
  if (input.tool_name !== 'Agent') {
    process.exit(0);
  }

  const sessionId = typeof input.session_id === 'string' ? input.session_id : '';
  const agentName = pickAgentName(input.tool_input);
  const promptPreview = previewPrompt(input.tool_input);

  logToFile(sessionId, agentName, promptPreview);
  notifyDashboard(agentName, sessionId);

  // Always exit 0 — this hook is pure observability; the model must
  // never be blocked by it.
  process.exit(0);
});