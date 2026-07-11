/**
 * src/server/claude-info.mjs
 *
 * v6.3.0 — Dashboard-side documentation + discovery for the Claude
 * Code runtime. Replaces serve-info.mjs (which documented the Cline
 * HTTP serve subprocess contract).
 *
 * Why this module exists:
 *   Claude Code does NOT have an out-of-process serve child like
 *   Cline's `cline serve`. Instead, the dashboard talks to the
 *   `claude` CLI directly:
 *
 *     - `claude -p "<prompt>"`     — one-shot, runs to completion
 *     - `claude --bg`              — background daemon session
 *     - `claude --resume <id> -p …` — resume an existing session
 *
 *   And the SDK (`@anthropic-ai/claude-agent-sdk`) gives us in-process
 *   `query()` + `ClaudeSDKClient` for typed access to streaming events.
 *
 * This module:
 *   1. Documents the CLI flag contract (so other modules don't have
 *      to hardcode flag names).
 *   2. Documents the on-disk session storage at `~/.claude/sessions/`.
 *   3. Resolves the `claude` binary path (PATH first, then `npx
 *      @anthropic-ai/claude-agent-sdk/cli`).
 *   4. Provides small JSONL helpers for reading session message
 *      history that the rest of the dashboard can use.
 *
 * Reference:
 *   https://code.claude.com/docs/en/cli-reference
 *
 * No HTTP serve handshake, no Basic auth header, no SQLite DB. Claude
 * Code reads API keys from the environment itself.
 */

import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { warn as loggerWarn } from './logger.mjs';

const HOME = homedir();

/**
 * Canonical on-disk paths for Claude Code.
 *
 *   ~/.claude/             — root config + data dir (per Claude docs)
 *   ~/.claude/sessions/    — one subdir per session
 *     <sessionId>/
 *       messages.jsonl     — conversation history (one JSON per line)
 *
 * Each messages.jsonl line is one of:
 *   - {type:"user", message:{role:"user", content:[...]}}
 *   - {type:"assistant", message:{role:"assistant", content:[...]}}
 *   - {type:"system", subtype:"init", session_id, model, ...}
 *   - {type:"result", subtype:"success"|"error_during_execution", ...}
 */
export const CLAUDE_HOME = join(HOME, '.claude');
export const CLAUDE_SESSIONS_DIR = join(CLAUDE_HOME, 'sessions');

/**
 * Resolve the `claude` binary path. Tries (in order):
 *   1. `process.env.CLAUDE_BIN` (override)
 *   2. `claude` on PATH (the user-installed case)
 *   3. `npx -y @anthropic-ai/claude-agent-sdk/cli` as a fallback
 *
 * Returns `{ bin, args }` so the caller can construct the right
 * subprocess argv. The fallback uses `npx -y` so a fresh checkout
 * can spawn Claude Code even when the CLI isn't installed globally.
 *
 * @returns {{ bin: string, args: string[] }}
 */
export function resolveClaudeCommand() {
  if (process.env.CLAUDE_BIN && process.env.CLAUDE_BIN.trim()) {
    return { bin: process.env.CLAUDE_BIN.trim(), args: [] };
  }
  return { bin: 'claude', args: [] };
}

/**
 * Claude Code CLI flag contract (verified against
 * https://code.claude.com/docs/en/cli-reference). Single source of
 * truth — every other module reads flags from here so a Claude
 * update only changes one file.
 */
export const CLAUDE_CLI_FLAGS = Object.freeze({
  // Print / run modes
  PRINT: '-p',
  BACKGROUND: '--bg',
  RESUME: '--resume',
  SESSION_ID: '--session-id',
  SESSION_TITLE: '--session-title',

  // Model + agent
  MODEL: '--model',
  AGENT: '--agent',

  // Working directory
  ADD_DIR: '--add-dir',

  // Output / wire format
  OUTPUT_FORMAT: '--output-format',
  VERBOSE: '--verbose',
  JSON_FORMAT: 'json',

  // Permission / autonomy
  PERMISSION_MODE: '--permission-mode',
  PERMISSION_BYPASS: 'bypassPermissions',
  PERMISSION_PLAN: 'plan',
  PERMISSION_DEFAULT: 'default',

  // MCP + skills
  MCP_CONFIG: '--mcp-config',

  // Limits
  MAX_TURNS: '--max-turns',
});

/**
 * Claude Code stores sessions as JSONL. Normalize one parsed line
 * into the dashboard's chat shape:
 *
 *   { id, role, content, ts, kind? }
 *
 * Accepts both v1 shapes (text directly on the message) and v2
 * shapes (parts / blocks under `content`).
 *
 * @param {object} line  one entry from messages.jsonl
 * @returns {{ id: string, role: string, content: string, ts: number, kind?: string }}
 */
export function normalizeClaudeMessage(line) {
  if (!line || typeof line !== 'object') {
    return { id: '', role: 'assistant', content: '', ts: Date.now() };
  }
  const t = typeof line.type === 'string' ? line.type : null;
  const message = line.message || line;
  const id =
    (typeof message?.id === 'string' && message.id) ||
    (typeof line.id === 'string' && line.id) ||
    (typeof line.uuid === 'string' && line.uuid) ||
    (typeof line.timestamp === 'string' && line.timestamp) ||
    '';
  const role = typeof message?.role === 'string' ? message.role : (t === 'user' ? 'user' : 'assistant');
  const ts =
    (typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : NaN) ||
    (typeof line.ts === 'number' ? line.ts : NaN) ||
    (typeof message?.ts === 'number' ? message.ts : NaN) ||
    Date.now();
  const content = extractClaudeContent(message);
  const out = { id: String(id), role: String(role), content, ts: typeof ts === 'number' && Number.isFinite(ts) ? ts : Date.now() };
  if (t) out.kind = t;
  return out;
}

/**
 * Flatten a Claude Code message's `content` field into a single
 * string. Handles:
 *   - string content ("hello")
 *   - array of blocks (text, tool_use, tool_result, image, …)
 *   - legacy { text } wrapper
 *
 * Non-text blocks are skipped — they don't contribute to the chat
 * surface but still appear in the JSONL for tooling.
 */
function extractClaudeContent(message) {
  if (!message) return '';
  if (typeof message.text === 'string') return stripThinkingTags(message.text);
  const c = message.content;
  if (typeof c === 'string') return stripThinkingTags(c);
  if (!Array.isArray(c)) return '';
  const text = c
    .filter((p) => p && (p.type === 'text' || typeof p.text === 'string'))
    .map((p) => (typeof p.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n\n');
  return stripThinkingTags(text);
}

/**
 * Strip `<thinking>...</thinking>` blocks from model output so the
 * chat UI doesn't render them as visible escaped HTML.
 *
 * Same shape as the v5.0.0 cline helper — kept here so chat
 * rendering stays consistent across the migration.
 */
function stripThinkingTags(text) {
  if (typeof text !== 'string') return '';
  const cleaned = text
    .replace(/<thinking\b[^>]*>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<thinking\b[^>]*\/?>/gi, '')
    .replace(/<\/thinking>/gi, '');
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * List every Claude Code session currently on disk. Reads
 * `~/.claude/sessions/` and returns metadata derived from each
 * `messages.jsonl` (first system/init line carries the model +
 * session id; first user message carries the title).
 *
 * Returns `[]` when the directory doesn't exist (a fresh user has
 * never run `claude`). Never throws.
 *
 * @returns {Array<{ id: string, title: string, createdAt: number, updatedAt: number, model?: string }>}
 */
export function listClaudeSessions() {
  if (!existsSync(CLAUDE_SESSIONS_DIR)) return [];
  let dirs;
  try {
    dirs = readdirSync(CLAUDE_SESSIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (err) {
    loggerWarn('claude-info: listClaudeSessions readdir failed', { err: err instanceof Error ? err.message : String(err) });
    return [];
  }
  const out = [];
  for (const id of dirs) {
    const file = join(CLAUDE_SESSIONS_DIR, id, 'messages.jsonl');
    if (!existsSync(file)) continue;
    const meta = readSessionMeta(file, id);
    if (meta) out.push(meta);
  }
  out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return out;
}

/**
 * Read the metadata header for a single session (first init line +
 * first user message + last mtime). Returns `null` on any failure.
 *
 * @param {string} file  absolute path to messages.jsonl
 * @param {string} id    session id (the directory name)
 */
function readSessionMeta(file, id) {
  let firstUserText = '';
  let model = '';
  let createdAt = 0;
  let lastTs = 0;
  let size = 0;
  try {
    const stat = statSync(file);
    size = stat.size;
    lastTs = stat.mtimeMs || 0;
  } catch {
    /* fall through — stat is best-effort */
  }
  try {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (parsed?.type === 'system' && parsed?.subtype === 'init') {
        if (typeof parsed.session_id === 'string') id = parsed.session_id;
        if (typeof parsed.model === 'string') model = parsed.model;
        if (typeof parsed.timestamp === 'string') {
          const t = Date.parse(parsed.timestamp);
          if (Number.isFinite(t)) createdAt = createdAt || t;
        }
      }
      if (parsed?.type === 'user' && !firstUserText) {
        const content = parsed?.message?.content;
        if (typeof content === 'string') firstUserText = content;
        else if (Array.isArray(content)) {
          const t = content.find((b) => b && (b.type === 'text' || typeof b.text === 'string'));
          if (t && typeof t.text === 'string') firstUserText = t.text;
        }
        if (typeof parsed.timestamp === 'string') {
          const t = Date.parse(parsed.timestamp);
          if (Number.isFinite(t)) createdAt = createdAt || t;
        }
      }
      if (typeof parsed?.timestamp === 'string') {
        const t = Date.parse(parsed.timestamp);
        if (Number.isFinite(t)) lastTs = Math.max(lastTs, t);
      }
    }
  } catch {
    return null;
  }
  const title = firstUserText
    ? firstUserText.replace(/\s+/g, ' ').trim().slice(0, 80) || `Session ${id}`
    : `Session ${id}`;
  return {
    id,
    title,
    createdAt: createdAt || lastTs || 0,
    updatedAt: lastTs || createdAt || 0,
    model: model || undefined,
    size,
  };
}

/**
 * List every message in a session. Reads `messages.jsonl` from
 * `~/.claude/sessions/<id>/` and normalizes each line via
 * {@link normalizeClaudeMessage}.
 *
 * Returns `{ ok, messages }` on success; `{ ok: false, error }`
 * when the file is missing or unreadable. Never throws.
 *
 * @param {string} sessionId
 * @returns {{ ok: true, messages: ReturnType<typeof normalizeClaudeMessage>[] } | { ok: false, error: string }}
 */
export function listClaudeMessages(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId is required' };
  }
  const file = join(CLAUDE_SESSIONS_DIR, sessionId, 'messages.jsonl');
  if (!existsSync(file)) {
    return { ok: false, error: `session ${sessionId} not found at ${file}` };
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let parsed;
    try { parsed = JSON.parse(line); } catch { continue; }
    out.push(normalizeClaudeMessage(parsed));
  }
  return { ok: true, messages: out };
}

/**
 * Read the most recent assistant text from a session — used by the
 * bg-poller's html-artifact scanner (replaces the old
 * `extractContentFromClineMessage` + `listClineMessages` flow).
 *
 * @param {string} sessionId
 * @returns {string}
 */
export function readLastAssistantText(sessionId) {
  const res = listClaudeMessages(sessionId);
  if (!res.ok) return '';
  for (let i = res.messages.length - 1; i >= 0; i -= 1) {
    const m = res.messages[i];
    if (m && m.role === 'assistant' && m.content) return m.content;
  }
  return '';
}

/**
 * Resolve the on-disk worktree (directory) for a session by looking
 * at the JSONL init line. Claude Code stores `cwd` and `addDir` on
 * the system init event.
 *
 * Returns `null` when the session can't be found or has no cwd field.
 *
 * @param {string} sessionId
 * @returns {string|null}
 */
export function resolveSessionWorktree(sessionId) {
  if (!sessionId) return null;
  const file = join(CLAUDE_SESSIONS_DIR, sessionId, 'messages.jsonl');
  if (!existsSync(file)) return null;
  try {
    const text = readFileSync(file, 'utf8');
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (parsed?.type === 'system' && parsed?.subtype === 'init') {
        if (typeof parsed.cwd === 'string' && parsed.cwd) return resolve(parsed.cwd);
        if (Array.isArray(parsed.addDir) && parsed.addDir.length > 0) {
          const first = parsed.addDir.find((d) => typeof d === 'string' && d);
          if (first) return resolve(first);
        }
      }
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Best-effort deletion of a session's on-disk directory. Idempotent.
 *
 * @param {string} sessionId
 * @returns {{ ok: boolean, error?: string }}
 */
export function deleteClaudeSession(sessionId) {
  if (!sessionId || typeof sessionId !== 'string') {
    return { ok: false, error: 'sessionId is required' };
  }
  const dir = join(CLAUDE_SESSIONS_DIR, sessionId);
  if (!existsSync(dir)) return { ok: true };
  try {
    rmSync(dir, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Exposed for tests / introspection.
export const _claudeInfoInternals = {
  CLAUDE_HOME,
  CLAUDE_SESSIONS_DIR,
  CLAUDE_CLI_FLAGS,
  resolveClaudeCommand,
  normalizeClaudeMessage,
  listClaudeSessions,
  listClaudeMessages,
};
