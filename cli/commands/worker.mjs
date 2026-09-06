/**
 * Process workers spawned with a native Claude alias.
 *
 * This command is the separately launched alternative: it creates an isolated
 * worktree and starts a top-level Claude process with a native alias
 * (default `sonnet`). No global settings are rewritten per worker, so
 * parallel workers cannot race each other's model selection. The alias is
 * passed through to `claude --model <alias>`; native Claude Code is the
 * sole authority on alias-to-combo resolution.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveBizarHome, resolveClaudeConfigDir } from '../config-paths.mjs';

const NATIVE_ALIASES = Object.freeze(new Set(['sonnet', 'haiku', 'opus', 'fable']));
const DEFAULT_ALIAS = 'sonnet';

function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  return result.stdout.trim();
}

function normalizeAlias(value) {
  const alias = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : DEFAULT_ALIAS;
  if (!NATIVE_ALIASES.has(alias)) {
    throw new Error(`worker start requires a native alias (sonnet | haiku | opus | fable); got "${alias}"`);
  }
  return alias;
}

export function enabledModels() {
  // Retained for backwards compatibility with `cli/commands/worker.test.mjs`.
  // The picker is gone; native aliases are the only legal `model` values.
  return [...NATIVE_ALIASES];
}

function workerRoot() { return join(resolveBizarHome(), 'workers'); }
function statePath(id) { return join(workerRoot(), `${id}.json`); }
function writeState(state) {
  mkdirSync(workerRoot(), { recursive: true, mode: 0o700 });
  writeFileSync(statePath(state.id), JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}

export function buildWorkerPlan({ repoRoot = process.cwd(), model, task, agent = 'todd' } = {}) {
  if (!task || typeof task !== 'string') throw new Error('worker start requires --task <bounded task>.');
  const normalized = normalizeAlias(model);
  const root = runGit(['rev-parse', '--show-toplevel'], repoRoot);
  const id = `worker-${randomUUID().slice(0, 8)}`;
  const branch = `wt/${id}`;
  const worktree = join(dirname(root), `${basename(root)}-${id}`);
  const logPath = join(workerRoot(), `${id}.log`);
  return { id, root, branch, worktree, model: normalized, task: task.trim(), agent, logPath };
}

export function workerClaudeArgs(plan) {
  return [
    '--print', '--name', `bizar-${plan.id}`, '--model', plan.model,
    '--permission-mode', 'acceptEdits', '--agent', plan.agent,
    `${plan.task}\n\nYou are an isolated Bizar process worker in ${plan.worktree}, running with the native "${plan.model}" alias. Work only in this worktree. Do not spawn subagents. Implement and test the bounded task, commit one logical change locally, never push, then report the commit and verification.`,
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
  bizar worker start --model <sonnet|haiku|opus|fable> --task <task> [--agent todd] [--background]
  bizar worker list [--json]

  Starts an isolated top-level Claude Code process in a wt/ worktree with a
  native alias. Default alias is "sonnet". Native Claude Code maps the
  alias to an OmniRoute combo via the four ANTHROPIC_DEFAULT_*_MODEL
  env vars in config/claude/settings.json. Merge completed branches with
  bizar worktree-merge <branch>.
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
    console.error(`Unable to start isolated worker: ${error.message}`);
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
