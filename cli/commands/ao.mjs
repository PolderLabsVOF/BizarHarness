/**
 * Agent Orchestrator integration.
 *
 * AO owns daemon, worktree, session, PR, review, and browser state. This
 * command configures Bizar as a Codex worker harness through AO's supported
 * CLI rather than accessing AO's local database or runtime internals.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { basename, dirname, resolve } from 'node:path';

export const AO_RULES_FILE = '.ao/bizar-worker-rules.md';
export const AO_ORCHESTRATOR_RULES = 'Use AO for coordination and Bizar as the Codex worker harness. Spawn focused AO workers for implementation; workers own changes, verification, commits, and PR follow-up.';
const WORKER_RULES_TEMPLATE = resolve(dirname(fileURLToPath(import.meta.url)), '../../config/ao/worker-rules.md');

function optionValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : undefined;
}

export function parseAoArgs(args = []) {
  const [first, ...rest] = args;
  const subcommand = ['setup', 'doctor', 'status', 'sessions', 'help'].includes(first) ? first : 'forward';
  return {
    subcommand,
    forward: subcommand === 'forward' ? args : rest,
    project: optionValue(args, '--project'),
    model: optionValue(args, '--model'),
    permissions: optionValue(args, '--permissions'),
    help: args.includes('--help') || args.includes('-h') || first === 'help',
  };
}

export function isAoSession(env = process.env) {
  return Boolean(env.AO_SESSION_ID || env.AO_PROJECT_ID);
}

export function defaultProjectId(cwd) {
  const id = basename(resolve(cwd)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return id || 'bizar-project';
}

export function configuredProjectConfig(current = {}, options = {}) {
  const worker = { ...(current.worker || {}), agent: 'codex' };
  const orchestrator = { ...(current.orchestrator || {}), agent: 'codex' };
  const agentConfig = { ...(current.agentConfig || {}) };
  if (options.model) agentConfig.model = options.model;
  if (options.permissions) agentConfig.permissions = options.permissions;
  return {
    ...current,
    agentRulesFile: options.rulesFile || AO_RULES_FILE,
    orchestratorRules: current.orchestratorRules || AO_ORCHESTRATOR_RULES,
    worker,
    orchestrator,
    ...(Object.keys(agentConfig).length ? { agentConfig } : {}),
  };
}

/**
 * AO resolves agentRulesFile from the registered repository root. Install the
 * packaged Bizar rules there once, without replacing project-owned changes.
 */
export function materializeWorkerRules(cwd, options = {}) {
  const filesystem = options.filesystem || { existsSync, mkdirSync, readFileSync, writeFileSync };
  const target = resolve(cwd, AO_RULES_FILE);
  if (filesystem.existsSync(target)) return target;

  const source = options.rulesTemplate || WORKER_RULES_TEMPLATE;
  const contents = filesystem.readFileSync(source, 'utf8');
  filesystem.mkdirSync(dirname(target), { recursive: true });
  try {
    filesystem.writeFileSync(target, contents, { encoding: 'utf8', mode: 0o644, flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  return target;
}

function runAo(args, options = {}) {
  const execute = options.execute || ((command, commandArgs, spawnOptions) => spawnSync(command, commandArgs, spawnOptions));
  const result = execute(options.binary || 'ao', args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
  });
  if (result.error) throw result.error;
  return {
    ok: result.status === 0,
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function emit(result, output = process) {
  if (result.stdout) output.stdout.write(result.stdout);
  if (result.stderr) output.stderr.write(result.stderr);
}

function parseJson(text, context) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Agent Orchestrator returned invalid JSON for ${context}`);
  }
}

export function findProjectByPath(projects, cwd) {
  const expected = resolve(cwd);
  return projects.find((project) => project?.path && resolve(project.path) === expected) || null;
}

function help(output = process.stdout) {
  output.write(`
bizar ao — Agent Orchestrator bridge (AO-primary)

Usage:
  bizar ao doctor
  bizar ao setup [--project <id>] [--model <id>] [--permissions <mode>]
  bizar ao status
  bizar ao sessions
  bizar ao <any supported ao command> [args...]

AO remains the sole owner of sessions, worktrees, PRs, review feedback,
previews, and browser state. The setup command registers this repository with AO,
selects Codex for both AO roles, and preserves existing AO project settings.
It creates and configures the repository-local ${AO_RULES_FILE} as AO worker
rules, preserving a file that is already present.

OpenKan remains available independently through bizar openkan and ok.
`);
}

export function setupAo(options = {}) {
  const cwd = resolve(options.cwd || process.cwd());
  const list = runAo(['project', 'ls', '--json'], options);
  if (!list.ok) return list;
  const listed = parseJson(list.stdout, 'project list').projects || [];
  let projectDetails = null;
  let projectId = options.project;

  if (projectId) {
    const details = runAo(['project', 'get', projectId, '--json'], options);
    if (!details.ok) return details;
    projectDetails = parseJson(details.stdout, 'project get').project || {};
  } else {
    for (const project of listed) {
      if (!project?.id) continue;
      const details = runAo(['project', 'get', project.id, '--json'], options);
      if (!details.ok) return details;
      const candidate = parseJson(details.stdout, 'project get').project || {};
      if (findProjectByPath([candidate], cwd)) {
        projectId = candidate.id;
        projectDetails = candidate;
        break;
      }
    }
  }
  projectId ||= defaultProjectId(cwd);

  if (!projectDetails) {
    const added = runAo(['project', 'add', '--path', cwd, '--id', projectId, '--worker-agent', 'codex', '--orchestrator-agent', 'codex'], options);
    if (!added.ok) return added;
    const details = runAo(['project', 'get', projectId, '--json'], options);
    if (!details.ok) return details;
    projectDetails = parseJson(details.stdout, 'project get').project || {};
  }
  materializeWorkerRules(cwd, options);
  const config = configuredProjectConfig(projectDetails.config, options);
  const configured = runAo(['project', 'set-config', projectId, '--config-json', JSON.stringify(config), '--json'], options);
  if (configured.ok) {
    configured.stdout = `${configured.stdout}Bizar is configured as the AO Codex worker harness for ${projectId}.\n`;
  }
  return configured;
}

export function doctorAo(options = {}) {
  const status = runAo(['status', '--json'], options);
  if (!status.ok) return status;
  const agents = runAo(['agent', 'ls', '--json'], options);
  if (!agents.ok) return agents;
  return {
    ok: true,
    status: 0,
    stdout: `${status.stdout}${agents.stdout}Agent Orchestrator is reachable; verify that the Codex row is installed and authenticated before spawning workers.\n`,
    stderr: `${status.stderr}${agents.stderr}`,
  };
}

export function run(args = [], options = {}) {
  const parsed = parseAoArgs(args);
  const output = options.output || process;
  if (parsed.help) {
    help(output.stdout);
    return true;
  }
  try {
    let result;
    if (parsed.subcommand === 'setup') result = setupAo({ ...options, ...parsed });
    else if (parsed.subcommand === 'doctor') result = doctorAo(options);
    else if (parsed.subcommand === 'status') result = runAo(['status', '--json'], options);
    else if (parsed.subcommand === 'sessions') result = runAo(['session', 'ls', ...parsed.forward], options);
    else result = runAo(parsed.forward, options);
    emit(result, output);
    if (!result.ok) process.exitCode = result.status || 1;
  } catch (error) {
    output.stderr.write(`bizar ao: ${error.message || String(error)}\n`);
    process.exitCode = 1;
  }
  return true;
}
