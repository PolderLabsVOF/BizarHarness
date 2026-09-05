import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { listOpenKanGoals, listOpenKanPlans, listOpenKanTasks } from './openkan-store.mjs';

const MESSAGE_STATES = ['queued', 'processing', 'delivered', 'failed'];
const MAX_MESSAGE_BYTES = 16 * 1024;

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}

export function resolveControlDir(projectRoot = process.cwd()) {
  return resolve(
    projectRoot,
    process.env.BIZAR_CONTROL_DIR || join('.bizar', 'control'),
  );
}

function parseFrontmatter(content) {
  if (!content.startsWith('---')) return {};
  const end = content.indexOf('\n---', 3);
  if (end === -1) return {};
  const result = {};
  for (const line of content.slice(3, end).split('\n')) {
    const match = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return result;
}

export function listControlAgents(projectRoot = process.cwd()) {
  const local = join(projectRoot, '.claude', 'agents');
  const installed = join(
    process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude'),
    'agents',
  );
  const agentsDir = existsSync(local) ? local : installed;
  if (!existsSync(agentsDir)) return [];

  return readdirSync(agentsDir)
    .filter((entry) => entry.endsWith('.md') && !entry.startsWith('_'))
    .sort()
    .map((entry) => {
      const absolute = join(agentsDir, entry);
      const meta = parseFrontmatter(readFileSync(absolute, 'utf8'));
      const id = basename(entry, '.md');
      return {
        id,
        name: meta.name || id,
        description: meta.description || '',
        ...(meta.model ? { model: meta.model } : {}),
        source: relative(projectRoot, absolute).replaceAll('\\', '/'),
      };
    });
}

function messageDirs(projectRoot) {
  const root = ensureDir(join(resolveControlDir(projectRoot), 'messages'));
  const dirs = {};
  for (const state of MESSAGE_STATES) {
    dirs[state] = ensureDir(join(root, state));
  }
  return dirs;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function atomicWriteJson(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

function cleanText(value, field, maxBytes = MAX_MESSAGE_BYTES) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${field} must be a non-empty string`);
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new Error(`${field} exceeds ${maxBytes} bytes`);
  }
  return text;
}

export function enqueueControlMessage(projectRoot, input) {
  const dirs = messageDirs(projectRoot);
  const toAgent = input?.toAgent ? cleanText(input.toAgent, 'toAgent', 128) : null;
  const toSession = input?.toSession ? cleanText(input.toSession, 'toSession', 128) : null;
  if (!toAgent && !toSession) {
    throw new Error('message requires toAgent or toSession');
  }
  const now = new Date().toISOString();
  const message = {
    id: randomUUID(),
    from: cleanText(input?.from || 'user', 'from', 128),
    toAgent,
    toSession,
    taskId: input?.taskId ? cleanText(input.taskId, 'taskId', 128) : null,
    text: cleanText(input?.text, 'text'),
    status: 'queued',
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  atomicWriteJson(join(dirs.queued, `${message.id}.json`), message);
  return message;
}

function targetMatches(message, target) {
  if (message.toSession && message.toSession !== target.sessionId) return false;
  if (message.toAgent && message.toAgent !== target.agentType) return false;
  return Boolean(message.toSession || message.toAgent);
}

export function claimControlMessages(projectRoot, target) {
  const dirs = messageDirs(projectRoot);
  const claimed = [];
  for (const entry of readdirSync(dirs.queued).filter((name) => name.endsWith('.json')).sort()) {
    const queuedPath = join(dirs.queued, entry);
    const message = readJson(queuedPath);
    if (!message || !targetMatches(message, target)) continue;
    const processingPath = join(dirs.processing, entry);
    try {
      renameSync(queuedPath, processingPath);
    } catch {
      continue;
    }
    const delivered = {
      ...message,
      status: 'delivered',
      attempts: Number(message.attempts || 0) + 1,
      deliveredAt: new Date().toISOString(),
      deliveredTo: {
        sessionId: target.sessionId || null,
        agentType: target.agentType || null,
      },
      updatedAt: new Date().toISOString(),
    };
    atomicWriteJson(processingPath, delivered);
    renameSync(processingPath, join(dirs.delivered, entry));
    claimed.push(delivered);
  }
  return claimed;
}

export function listControlMessages(projectRoot = process.cwd(), options = {}) {
  const dirs = messageDirs(projectRoot);
  const messages = [];
  const states = options.status ? [options.status] : MESSAGE_STATES;
  for (const state of states) {
    if (!MESSAGE_STATES.includes(state)) continue;
    for (const entry of readdirSync(dirs[state]).filter((name) => name.endsWith('.json'))) {
      const message = readJson(join(dirs[state], entry));
      if (message) messages.push({ ...message, status: state });
    }
  }
  messages.sort((left, right) =>
    String(right.createdAt).localeCompare(String(left.createdAt)));
  return { count: messages.length, messages };
}

export function listControlTasks(projectRoot = process.cwd()) {
  return {
    tasks: listOpenKanTasks(projectRoot),
    plans: listOpenKanPlans(projectRoot),
    goals: listOpenKanGoals(projectRoot),
  };
}

function claudeBin() {
  return process.env.CLAUDE_BIN || 'claude';
}

export function listControlSessions(projectRoot = process.cwd()) {
  const result = spawnSync(
    claudeBin(),
    ['agents', '--json', '--all', '--cwd', projectRoot],
    { cwd: projectRoot, encoding: 'utf8', shell: false },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || `claude agents exited ${result.status}`);
  }
  const sessions = JSON.parse(result.stdout || '[]');
  return Array.isArray(sessions) ? sessions : [];
}

function runClaudeBackground(projectRoot, args) {
  const result = spawnSync(
    claudeBin(),
    ['--background', ...args],
    { cwd: projectRoot, encoding: 'utf8', shell: false },
  );
  return {
    ok: result.status === 0,
    exitCode: result.status ?? 1,
    stdout: result.stdout?.trim() || '',
    stderr: result.stderr?.trim() || '',
  };
}

export function startControlSession(projectRoot, input) {
  const agent = cleanText(input?.agent, 'agent', 128);
  if (!listControlAgents(projectRoot).some((candidate) => candidate.id === agent)) {
    throw new Error(`unknown Bizar agent: ${agent}`);
  }
  const prompt = cleanText(input?.prompt, 'prompt');
  const name = String(input?.name || `${agent}: ${prompt.slice(0, 60)}`).trim();
  const before = new Set(listControlSessions(projectRoot).map((session) => session.sessionId));
  const dispatch = runClaudeBackground(projectRoot, [
    '--agent', agent,
    '--name', name,
    prompt,
  ]);
  if (!dispatch.ok) throw new Error(dispatch.stderr || 'Claude session start failed');
  const sessions = listControlSessions(projectRoot);
  const session = sessions.find((candidate) => !before.has(candidate.sessionId))
    || sessions.sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))[0]
    || null;
  return { session, dispatch };
}

export function sendControlSessionMessage(projectRoot, sessionId, input) {
  const id = cleanText(sessionId, 'sessionId', 128);
  const sessions = listControlSessions(projectRoot);
  if (!sessions.some((session) => session.sessionId === id)) {
    throw new Error(`unknown Claude session: ${id}`);
  }
  const message = enqueueControlMessage(projectRoot, {
    from: input?.from || 'openkan',
    toSession: id,
    taskId: input?.taskId,
    text: input?.text,
  });
  const dispatch = runClaudeBackground(projectRoot, [
    '--resume', id,
    `Process the queued Bizar control message ${message.id}.`,
  ]);
  return { message, dispatch };
}

export function stopControlSession(projectRoot, sessionId, killProcess = process.kill) {
  const id = cleanText(sessionId, 'sessionId', 128);
  const session = listControlSessions(projectRoot)
    .find((candidate) => candidate.sessionId === id);
  if (!session) throw new Error(`unknown Claude session: ${id}`);
  if (!Number.isInteger(session.pid) || session.pid <= 1) {
    throw new Error('Claude did not expose a stoppable PID for this session');
  }
  if (['done', 'failed', 'cancelled'].includes(session.state)) {
    throw new Error(`session is already ${session.state}`);
  }
  killProcess(session.pid, 'SIGTERM');
  return { ok: true, sessionId: id, pid: session.pid, signal: 'SIGTERM' };
}

export function getControlSnapshot(projectRoot = process.cwd()) {
  const root = resolve(projectRoot);
  const coordination = listControlTasks(root);
  return {
    version: 2,
    projectRoot: root,
    generatedAt: new Date().toISOString(),
    agents: listControlAgents(root),
    tasks: coordination.tasks,
    plans: coordination.plans,
    goals: coordination.goals,
    sessions: listControlSessions(root),
    messages: listControlMessages(root).messages,
  };
}
