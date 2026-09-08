import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureOpenKanProject, installOpenKanPromise, OpenKanError, resolveOpenKanDashboard, runOpenKanOk } from '../openkan.mjs';
import { cmdMigrateTasksToV2 } from '../../scripts/openkan/migrate-tasks-to-v2.mts';
import { cmdMigrateBoardToV2 } from '../../scripts/openkan/migrate-board-to-v2.mts';

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
                                        (legacy openkan.mjs on pre-v0.5.0
                                         releases; ok serve on v0.5.0+ where
                                         the legacy binary is retired)
  bizar openkan project clean           Clean orphaned files from .ok/
  bizar openkan board delete           Delete the board.json file
  bizar openkan migrate [--apply]       Migrate v1 tasks to v2 layout
                                        (default: dry-run; --apply to apply)

Canonical commands are \`ok task\`, \`ok plan\`, and \`ok prd\`; they use this
same OpenKan workspace. The Bizar planning aliases remain compatibility-only.
Bizar no longer creates a SQLite task ledger or
feature/progress files for live planning.
`);
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
    if (subcommand === 'migrate') {
      const cwd = process.cwd();
      const apply = rest.includes('--apply');
      const tasksOnly = rest.includes('--tasks');
      const boardOnly = rest.includes('--board');

      if (!apply) {
        process.stdout.write('Running in dry-run mode. Use --apply to actually migrate.\n\n');
      }

      let exitCode = 0;

      if (!boardOnly) {
        process.stdout.write('=== Migrating tasks (flat .json → directory layout) ===\n');
        const tasksCode = await cmdMigrateTasksToV2([cwd]);
        if (tasksCode !== 0) exitCode = tasksCode;
      }

      if (!tasksOnly) {
        process.stdout.write('\n=== Migrating board.json ===\n');
        const boardCode = await cmdMigrateBoardToV2([cwd]);
        if (boardCode !== 0) exitCode = boardCode;
      }

      if (exitCode === 0 && apply) {
        process.stdout.write('\n✓ Migration completed successfully.\n');
      } else if (exitCode === 0) {
        process.stdout.write('\n✓ Dry-run completed. Run with --apply to execute migrations.\n');
      }

      process.exitCode = exitCode;
      return true;
    }
    if (subcommand === 'project' && rest[0] === 'clean') {
      // Clean orphaned files from .ok/
      const okDir = join(process.cwd(), '.ok');
      if (!existsSync(okDir)) {
        process.stdout.write('.ok/ does not exist. Nothing to clean.\n');
        return true;
      }
      // Placeholder: OpenKan doesn't ship a project clean command yet
      process.stdout.write('Project clean not yet implemented. Manual cleanup: remove orphan .json files in .ok/tasks/ that are not in subdirectories.\n');
      return true;
    }
    if (subcommand === 'board' && rest[0] === 'delete') {
      // Delete board.json
      const boardPath = join(process.cwd(), '.ok', 'board.json');
      if (!existsSync(boardPath)) {
        process.stdout.write('.ok/board.json does not exist. Nothing to delete.\n');
        return true;
      }
      if (!rest.includes('--force')) {
        process.stdout.write('This will delete .ok/board.json. Use --force to confirm.\n');
        process.exitCode = 1;
        return true;
      }
      const { unlinkSync } = await import('node:fs');
      unlinkSync(boardPath);
      process.stdout.write('Deleted .ok/board.json\n');
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
