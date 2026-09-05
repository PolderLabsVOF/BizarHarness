import { spawnSync } from 'node:child_process';
import { executableOnPath, ensureOpenKanProject, installOpenKanPromise, OpenKanError, runOpenKanOk } from '../openkan.mjs';

function print(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (!result.ok) process.exitCode = result.status || 1;
}

function help() {
  process.stdout.write(`
bizar openkan — default durable planning and goals surface

Usage:
  bizar openkan install                 Install @polderlabs/openkan@latest from npm
  bizar openkan init                    Initialise .ok/ in this project
  bizar openkan task <ok task args...>  Manage durable tasks
  bizar openkan plan <ok plan args...>  Manage plans and phases
  bizar openkan goals <ok prd args...>  Manage PRDs, goals, and milestones
  bizar openkan doctor                  Validate the .ok/ workspace
  bizar openkan dashboard [args...]     Forward to the OpenKan dashboard CLI

Shortcuts: \`bizar task\`, \`bizar plan\`, and \`bizar goals\` use this
same OpenKan workspace. Bizar no longer creates a SQLite task ledger or
feature/progress files for live planning.
`);
}

function runDashboard(args) {
  const bin = process.env.BIZAR_OPENKAN_BIN || executableOnPath('openkan');
  if (!bin) throw new OpenKanError('OPENKAN_NOT_FOUND', 'OpenKan is required. Run `bizar openkan install`.');
  const result = spawnSync(bin, args, { cwd: process.cwd(), encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  print({ ok: result.status === 0, status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' });
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'openkan') return false;
  const [subcommand, ...rest] = args;
  if (isHelpRequest || !subcommand || subcommand === 'help') { help(); return true; }
  try {
    if (subcommand === 'install') {
      const result = await installOpenKanPromise();
      print(result);
      return true;
    }
    if (subcommand === 'init') {
      print(ensureOpenKanProject());
      return true;
    }
    if (subcommand === 'task' || subcommand === 'plan') {
      print(runOpenKanOk([subcommand, ...rest]));
      return true;
    }
    if (subcommand === 'goals' || subcommand === 'prd') {
      print(runOpenKanOk(['prd', ...rest]));
      return true;
    }
    if (subcommand === 'doctor' || subcommand === 'index') {
      print(runOpenKanOk([subcommand, ...rest]));
      return true;
    }
    if (subcommand === 'dashboard') { runDashboard(rest); return true; }
    help();
    process.exitCode = 2;
    return true;
  } catch (error) {
    process.stderr.write(`bizar openkan: ${error.message || String(error)}\n`);
    process.exitCode = 1;
    return true;
  }
}
