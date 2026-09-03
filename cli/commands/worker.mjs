/**
 * Exact-model process workers.
 *
 * This command is the separately launched alternative: it creates an isolated
 * worktree and starts a top-level Claude process with the literal gateway ID
 * selected through `bizar models`. No global settings are rewritten per
 * worker, so parallel workers cannot race each other's model selection.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveBizarHome, resolveClaudeConfigDir, resolveGlobalModelRouter } from '../config-paths.mjs';

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return result.stdout.trim();
}

function readRouter() {
  const path = resolveGlobalModelRouter();
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { throw new Error('Global Bizar model router is missing or invalid; run `bizar models`.'); }
}

export function enabledModels(router) {
  const disabled = new Set((router.disabledProviders || []).filter((id) => typeof id === 'string').map((id) => id.trim().toLowerCase()));
  return (router.userSelected?.models || []).filter((id) => typeof id === 'string' && id.trim() && ![...disabled].some((prefix) => id.toLowerCase().startsWith(prefix)));
}

function workerRoot() { return join(resolveBizarHome(), 'workers'); }
function statePath(id) { return join(workerRoot(), `${id}.json`); }
function writeState(state) {
  mkdirSync(workerRoot(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(state.id), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export function buildWorkerPlan({ repoRoot = process.cwd(), model, task, agent = 'todd' } = {}) {
  if (!model || typeof model !== 'string') throw new Error('worker start requires --model <selected gateway model id>.');
  if (!task || typeof task !== 'string') throw new Error('worker start requires --task <bounded task>.');
  const router = readRouter();
  if (!enabledModels(router).includes(model)) throw new Error(`Model ${model} is not an enabled global bizar models selection.`);
  const root = runGit(['rev-parse', '--show-toplevel'], repoRoot);
  const id = `worker-${randomUUID().slice(0, 8)}`;
  const branch = `wt/${id}`;
  const worktree = join(dirname(root), `${basename(root)}-${id}`);
  const logPath = join(workerRoot(), `${id}.log`);
  return { id, root, branch, worktree, model, task: task.trim(), agent, logPath };
}

export function workerClaudeArgs(plan) {
  return [
    '--print', '--name', `bizar-${plan.id}`, '--model', plan.model,
    '--permission-mode', 'acceptEdits', '--agent', plan.agent,
    `${plan.task}\n\nYou are an exact-model Bizar process worker in ${plan.worktree}. Work only in this worktree. Do not spawn subagents. Implement and test the bounded task, commit one logical change locally, never push, then report the commit and verification.`,
  ];
}

function parseStart(args) {
  const value = (name) => {
    const eq = args.find((arg) => arg.startsWith(`${name}=`));
    if (eq) return eq.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : null;
  };
  return { model: value('--model'), task: value('--task'), agent: value('--agent') || 'todd', background: args.includes('--background') };
}

function listWorkers() {
  if (!existsSync(workerRoot())) return [];
  return readdirSync(workerRoot()).filter((name) => name.endsWith('.json')).flatMap((name) => {
    try { return [JSON.parse(readFileSync(join(workerRoot(), name), 'utf8'))]; } catch { return []; }
  }).sort((a, b) => String(b.startedAt || '').localeCompare(String(a.startedAt || '')));
}

function usage() {
  console.log(`
  bizar worker start --model <selected-id> --task <task> [--agent todd] [--background]
  bizar worker list [--json]

  Starts an isolated top-level Claude Code process in a wt/ worktree with the
  exact selected gateway model. Use this when a separately launched worktree
  process is useful. Merge completed branches with bizar worktree-merge <branch>.
`);
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'worker') return false;
  if (isHelpRequest || args.length === 0) { usage(); return true; }
  const [subcommand] = args;
  if (subcommand === 'list') {
    const rows = listWorkers();
    if (args.includes('--json')) process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
    else for (const row of rows) console.log(`${row.id}\t${row.status}\t${row.model}\t${row.branch}`);
    return true;
  }
  if (subcommand !== 'start') { usage(); return false; }
  const parsed = parseStart(args.slice(1));
  const plan = buildWorkerPlan({ repoRoot: process.cwd(), ...parsed });
  mkdirSync(workerRoot(), { recursive: true, mode: 0o700 });
  runGit(['worktree', 'add', '-b', plan.branch, plan.worktree, 'HEAD'], plan.root);
  const state = { ...plan, status: 'running', startedAt: new Date().toISOString(), pid: null };
  const child = spawn(process.env.CLAUDE_BIN || 'claude', workerClaudeArgs(plan), {
    cwd: plan.worktree,
    env: { ...process.env, CLAUDE_CONFIG_DIR: resolveClaudeConfigDir() },
    detached: parsed.background,
    stdio: parsed.background ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  child.once('error', (error) => {
    writeState({ ...state, status: 'failed', exitedAt: new Date().toISOString(), error: error.message });
    console.error(`Unable to start exact-model worker: ${error.message}`);
  });
  state.pid = child.pid || null;
  writeState(state);
  child.once('exit', (code) => writeState({ ...state, status: code === 0 ? 'completed' : 'failed', exitedAt: new Date().toISOString(), exitCode: code ?? 1 }));
  if (parsed.background) {
    const log = createWriteStream(plan.logPath, { flags: 'a', mode: 0o600 });
    child.stdout?.pipe(log); child.stderr?.pipe(log); child.unref();
    console.log(JSON.stringify({ id: plan.id, status: 'running', model: plan.model, branch: plan.branch, worktree: plan.worktree }));
    return true;
  }
  const code = await new Promise((done) => child.once('exit', (value) => done(value ?? 1)));
  process.exitCode = code;
  return true;
}
