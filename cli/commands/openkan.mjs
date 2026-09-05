import { spawnSync } from 'node:child_process';
import { ensureOpenKanProject, installOpenKanPromise, OpenKanError, resolveOpenKanDashboard, runOpenKanOk } from '../openkan.mjs';

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
  ok init                                Initialise .ok/ in this project
  ok task <add|list|show|update|...>     Manage durable tasks
  ok plan <add|list|show|update>         Manage plans and phases
  ok prd <add|list|show|update>          Manage PRDs, goals, and milestones
  ok doctor                              Validate the .ok/ workspace
  bizar openkan dashboard [args...]     Forward to the OpenKan dashboard CLI

Canonical commands are \`ok task\`, \`ok plan\`, and \`ok prd\`; they use this
same OpenKan workspace. The Bizar planning aliases remain compatibility-only.
Bizar no longer creates a SQLite task ledger or
feature/progress files for live planning.
`);
}

function runDashboard(args) {
  const launcher = resolveOpenKanDashboard();
  const command = launcher.endsWith('.ts')
    ? [process.execPath, '--experimental-strip-types', launcher, ...args]
    : launcher.endsWith('.mjs')
      ? [process.execPath, launcher, ...args]
      : [launcher, ...args];
  const result = spawnSync(command[0], command.slice(1), { cwd: process.cwd(), encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  print({ ok: result.status === 0, status: result.status ?? 1, stdout: result.stdout || '', stderr: result.stderr || '' });
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'openkan') return false;
  const [subcommand, ...rest] = args;
  if (isHelpRequest || !subcommand || subcommand === 'help') { help(); return true; }
  try {
    if (subcommand === 'install') {
      const result = await installOpenKanPromise({ persistConfig: true });
      process.stdout.write(`  ✓ ${result.message}\n`);
      if (result.agent?.skipped) process.stdout.write('  ! OpenKan agent/skill installation was skipped by configuration.\n');
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
