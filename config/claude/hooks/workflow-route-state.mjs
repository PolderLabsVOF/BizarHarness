import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function isTinyDirectTask(prompt) {
  const text = String(prompt || '').trim();
  if (text.length === 0 || text.length > 240 || text.split('\n').length > 1) return false;
  if (!/^(?:please\s+)?(?:fix|correct|format|adjust|change|update)\b/i.test(text)) return false;
  if (/[?]\s*$/.test(text) || /\b(?:do\s+not|don't|never)\b/i.test(text)) return false;
  if (!/\b(typo|spelling|punctuation|comment|copy|wording|whitespace|formatting|indentation|padding|margin|spacing|color|colour|alignment?)\b/i.test(text)) return false;
  return !/\b(and|also|then|plus|both|across|multiple|several|throughout|entire|everywhere|sitewide|app-wide|components?|files?|api|sdk|library|framework|dependency|version|migration|architecture|security|auth|credential|deploy|publish|release|database|workflow|agent|hook|performance|benchmark|all files|every file|failing|failure|error|crash|root cause|regression|test|tests|logic|handling|parser|parsing|algorithm|calculation|rendering?|generation|tokenizer|lexer)\b/i.test(text);
}

function safeSessionId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

function stateDir(env = process.env) {
  const root = env.BIZAR_HOME || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'bizar');
  return join(root, 'workflow-routing');
}

export function routeStatePath(sessionId, env = process.env) {
  const safe = safeSessionId(sessionId);
  return safe ? join(stateDir(env), `${safe}.json`) : '';
}

export function markWorkflowRequired(input, env = process.env) {
  const path = routeStatePath(input?.session_id, env);
  if (!path) return false;
  const dir = stateDir(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ required: true, createdAt: Date.now(), cwd: String(input?.cwd || '') })}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return true;
}

export function clearWorkflowRequired(sessionId, env = process.env) {
  const path = routeStatePath(sessionId, env);
  if (!path) return false;
  rmSync(path, { force: true });
  return true;
}

export function workflowRequired(sessionId, env = process.env, now = Date.now()) {
  const path = routeStatePath(sessionId, env);
  if (!path || !existsSync(path)) return false;
  try {
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (state?.required !== true || !Number.isFinite(state.createdAt) || now - state.createdAt > MAX_AGE_MS) {
      rmSync(path, { force: true });
      return false;
    }
    return true;
  } catch {
    rmSync(path, { force: true });
    return false;
  }
}

export function promptRequiresWorkflow(input) {
  const prompt = String(input?.prompt ?? input?.user_prompt ?? '').trim();
  if (!prompt) return false;
  if (input?.task_notification || /^<task-notification\b[\s\S]*<result\b[\s\S]*<\/task-notification>\s*$/i.test(prompt)) return false;
  const quick = prompt.match(/^\/quick(?:\s+([\s\S]*))?$/i);
  if (quick) return Boolean(quick[1]?.trim()) && !isTinyDirectTask(quick[1]);
  return !isTinyDirectTask(prompt);
}
