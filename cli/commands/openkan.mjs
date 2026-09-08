import { spawnSync } from 'node:child_process';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureOpenKanProject, installOpenKanPromise, OpenKanError, resolveOpenKanDashboard, runOpenKanOk } from '../openkan.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATE_TASKS = join(HERE, '..', '..', 'scripts', 'openkan', 'migrate-tasks-to-v2.mts');
const MIGRATE_BOARD = join(HERE, '..', '..', 'scripts', 'openkan', 'migrate-board-to-v2.mts');

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
  bizar openkan project clean [--apply|--all|--dry-run]  Clean project workspace
  bizar openkan board delete <id>        Delete a board
  bizar openkan migrate [--apply] [--tasks|--board]       Migrate v1 tasks/board to v2 layout
                                                          (default: dry-run; --apply to apply)
  bizar openkan dashboard [args...]     Forward to the OpenKan dashboard CLI
                                        (legacy openkan.mjs on pre-v0.5.0
                                         releases; ok serve on v0.5.0+ where
                                         the legacy binary is retired)

Canonical commands are \`ok task\`, \`ok plan\`, and \`ok prd\`; they use this
same OpenKan workspace. The Bizar planning aliases remain compatibility-only.
Bizar no longer creates a SQLite task ledger or
feature/progress files for live planning.
`);
}

/**
 * Run one of the vendored OpenKan migration scripts. The scripts are
 * `.mts` files that need `--experimental-strip-types` because they
 * preserve the upstream TypeScript source verbatim from the v0.7.0
 * tag. See `scripts/openkan/` for the vendored files.
 */
function runMigrateScript(scriptPath, args) {
  const resolved = resolvePath(scriptPath);
  const result = spawnSync(process.execPath, ['--experimental-strip-types', resolved, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.status ?? 1;
}

function runDashboard(args) {
  const launcher = resolveOpenKanDashboard();
  // OpenKan v0.5.0 dropped the legacy `openkan` dashboard launcher. The
  // dashboard now ships as `ok serve`; route to that subcommand when the
  // resolved launcher is the `ok` binary instead of `openkan.mjs`.
  const isOkLauncher = launcher.endsWith('ok.mjs') || launcher.endsWith('ok.ts');
  const launcherArgs = isOkLauncher ? ['serve', ...args] : args;
  const command = launcher.endsWith('.ts')
    ? [process.execPath, '--experimental-strip-types', launcher, ...launcherArgs]
    : launcher.endsWith('.mjs')
      ? [process.execPath, launcher, ...launcherArgs]
      : [launcher, ...launcherArgs];
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
    if (subcommand === 'project') {
      // Forward project subcommands (e.g., project clean)
      print(runOpenKanOk([subcommand, ...rest]));
      return true;
    }
    if (subcommand === 'board') {
      // Forward board subcommands (e.g., board delete)
      print(runOpenKanOk([subcommand, ...rest]));
      return true;
    }
    if (subcommand === 'migrate') {
      // Migrate v1 tasks/board to the v2 layout that OpenKan 0.7.0 ships.
      // Default is dry-run; --apply actually moves files. --tasks / --board
      // narrow scope. The vendored scripts live under scripts/openkan/ and
      // run via --experimental-strip-types because they're .mts.
      const apply = rest.includes('--apply');
      const tasksOnly = rest.includes('--tasks');
      const boardOnly = rest.includes('--board');
      if (!apply) {
        process.stdout.write('Running in dry-run mode. Pass --apply to actually migrate.\n\n');
      }
      let exitCode = 0;
      if (!boardOnly) {
        process.stdout.write('=== Migrating tasks (.ok/tasks/<id>.json → <id>/task.json) ===\n');
        const code = runMigrateScript(MIGRATE_TASKS, []);
        if (code !== 0) exitCode = code;
      }
      if (!tasksOnly) {
        process.stdout.write('\n=== Migrating board.json → per-task directories ===\n');
        const code = runMigrateScript(MIGRATE_BOARD, []);
        if (code !== 0) exitCode = code;
      }
      if (exitCode === 0) {
        process.stdout.write(apply
          ? '\n✓ Migration complete.\n'
          : '\n✓ Dry-run complete. Re-run with --apply to execute.\n');
      } else {
        process.stderr.write('\n✗ Migration completed with errors. See output above.\n');
      }
      process.exitCode = exitCode;
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
