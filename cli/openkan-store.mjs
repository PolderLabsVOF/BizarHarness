/** Read-only `.ok/` adapter used by Bizar hooks and control snapshots. */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

function readJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return fallback; }
}

export function openKanDir(root = process.cwd()) { return join(resolve(root), '.ok'); }

export function listOpenKanTasks(root = process.cwd()) {
  const dir = join(openKanDir(root), 'tasks');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    .map((name) => readJson(join(dir, name))).filter((task) => task?.schema === 'ok.task.v1');
}

export function listOpenKanPlans(root = process.cwd()) {
  const dir = join(openKanDir(root), 'plans');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    .map((name) => readJson(join(dir, name))).filter((plan) => plan?.schema === 'ok.plan.v1');
}

export function listOpenKanGoals(root = process.cwd()) {
  const dir = join(openKanDir(root), 'prds');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
    .map((name) => readJson(join(dir, name))).filter((prd) => prd?.schema === 'ok.prd.v1');
}

export function activeOpenKanTask(root = process.cwd(), id = '') {
  const task = listOpenKanTasks(root).find((candidate) => candidate.id === id);
  return task || null;
}

function normalizedScope(value) {
  let scope = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (scope.endsWith('/')) scope += '**';
  return scope;
}

function scopeContains(scope, path) {
  const base = scope.endsWith('/**') ? scope.slice(0, -3) : scope;
  return scope.endsWith('/**') ? path === base || path.startsWith(`${base}/`) : path === base;
}

/** Advisory-only sibling scope check, mirroring Bizar's former ledger guard. */
export function ownerOfOpenKanPath({ root = process.cwd(), cwd = root, filePath, taskId = '' }) {
  const projectRoot = resolve(root);
  const absolute = isAbsolute(filePath) ? resolve(filePath) : resolve(cwd, filePath);
  const path = relative(projectRoot, absolute).replaceAll('\\', '/');
  if (!path || path.startsWith('../') || path === '..') return null;
  for (const task of listOpenKanTasks(projectRoot)) {
    if (task.id === taskId || !['in_progress', 'review'].includes(task.status)) continue;
    const scope = (task.scopes || []).map(normalizedScope).find((candidate) => scopeContains(candidate, path));
    if (scope) return { taskId: task.id, owner: task.owner || null, scope, path };
  }
  return null;
}
