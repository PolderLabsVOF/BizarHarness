/**
 * cli/commands/util.mjs
 *
 * Miscellaneous utility commands:
 *   audit, init, export, test-gate, doctor, repair, heads-up,
 *   browser,
 *   backup, restore
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Help texts ──────────────────────────────────────────────────────────────────

export function showAuditHelp() {
  console.log(`
  bizar audit — Run security audit on agent configuration

  Usage:
    bizar audit
  `);
}

export function showInitHelp() {
  console.log(`
  bizar init — Initialize .bizar/ in current project

  Usage:
    bizar init

  Description:
    Detects the project stack, creates .bizar/PROJECT.md and the bounded
    project-learning directory, and installs relevant skills.
    The per-project knowledge graph (in .bizar/graph/) is provided
    by the graphify mod — install it from the mod registry for
    that feature.
  `);
}

export function showExportHelp() {
  console.log(`
  bizar export — Export agents/rules to another harness

  Usage:
    bizar export [claude|cursor]

  Description:
    Copies installed Bizar agents and rules into another harness format.
  `);
}

export function showTestGateHelp() {
  console.log(`
  bizar test-gate - Detect & run the project's test suite

  Usage:
    bizar test-gate                Detect and run the test suite

  Description:
    Detects package.json, pyproject.toml, Cargo.toml, or go.mod and runs
    npm test, pytest, cargo test, or go test respectively. Extra arguments
    are forwarded to the selected runner.

  Exit codes:
    0  All tests passed
    1  Tests failed
    2  No test runner detected
  `);
}

export function showDoctorHelp() {
  console.log(`
  bizar doctor — Check the BizarHarness install for health issues

  Usage:
    bizar doctor

  Description:
    Runs a battery of health checks against the local install:
      • Claude Code CLI and settings
      • Bizar MCP registration
      • hook wiring
      • installed agents and skills
      • required local tools
      • alias map (ANTHROPIC_DEFAULT_*_MODEL)

    Prints ✓/✗ for each check and a final summary. Exits non-zero
    if any check fails. Use \`bizar doctor\` after installation or
    a manual Claude Code configuration edit.

  Related:
    bizar update              Update + auto-run doctor on success
  `);
}

export function showRepairHelp() {
  console.log(`
  bizar repair — Fix common install issues

  Usage:
    bizar repair                Diagnose + fix stale bin symlinks and mismatched versions
    bizar repair --dry-run      Show what would change without modifying anything
    bizar repair --bin-only     Only fix the bin symlink; skip version checks
  `);
}

export function showBackupHelp() {
  console.log(`
  bizar backup — Backup BizarHarness state

  Usage:
    bizar backup [label]        Create a new backup (with optional label)
    bizar backup list           List available backups
    bizar backup verify <path>  Verify a backup's integrity
    bizar backup delete <path>  Delete a backup

  Description:
    Backs up Bizar config and optionally project-level state
    (.bizar/, .claude/skills/, .agents/skills/).
    Backups are stored under ~/.local/share/bizar/backups/.

  Examples:
    bizar backup
    bizar backup "before-upgrade"
    bizar backup list
    bizar backup verify ~/.local/share/bizar/backups/bizar-2025-07-05-120000
  `);
}

export function showRestoreHelp() {
  console.log(`
  bizar restore — Restore BizarHarness from a backup

  Usage:
    bizar restore <path>                Restore from a backup
    bizar restore <path> --dry-run      Preview restore without modifying files
    bizar restore <path> --overwrite    Replace existing files (default: merge)
    bizar restore <path> --skip         Keep existing files, don't overwrite

  Description:
    Restores files from a backup directory. Default strategy is 'merge'
    (newer files from backup overlay existing files). Use --overwrite to
    replace everything, or --skip to leave existing files untouched.

  Examples:
    bizar restore ~/.local/share/bizar/backups/bizar-2025-07-05-120000
    bizar restore ~/.local/share/bizar/backups/bizar-2025-07-05-120000 --dry-run
    bizar restore ~/.local/share/bizar/backups/bizar-2025-07-05-120000 --overwrite
  `);
}

// ── Test gate ──────────────────────────────────────────────────────────────────

export function buildTestGateArgs(suite, args = []) {
  const forwarded = args[0] === '--' ? args.slice(1) : args;
  return suite.command === 'npm' && forwarded.length
    ? [...suite.baseArgs, '--', ...forwarded]
    : [...suite.baseArgs, ...forwarded];
}

export async function runTestGate(args = []) {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ TEST GATE ᚦ\n'));
  const { spawnSync } = await import('node:child_process');
  const cwd = process.cwd();
  const possible = [
    { command: 'npm', baseArgs: ['test'], label: 'npm test', check: 'package.json' },
    { command: 'pytest', baseArgs: [], label: 'pytest', check: 'pyproject.toml' },
    { command: 'cargo', baseArgs: ['test'], label: 'cargo test', check: 'Cargo.toml' },
    { command: 'go', baseArgs: ['test', './...'], label: 'go test ./...', check: 'go.mod' },
  ];
  for (const suite of possible) {
    try {
      if (existsSync(join(cwd, suite.check))) {
        const forwarded = args[0] === '--' ? args.slice(1) : args;
        const commandArgs = buildTestGateArgs(suite, args);
        process.stdout.write(`  Running: ${suite.label}${forwarded.length ? ` ${forwarded.join(' ')}` : ''}\n`);
        const result = spawnSync(suite.command, commandArgs, { stdio: 'inherit', timeout: 120000, cwd });
        if (result.status !== 0) throw new Error(`${suite.label} exited ${result.status}`);
        console.log('\n  ✓ Test gate passed\n');
        return true;
      }
    } catch {
      process.stdout.write(`\n  ✗ Test gate failed: ${suite.label}\n\n`);
      process.exitCode = 1;
      return false;
    }
  }
  console.log('  No test suite detected. Install one to use the test gate.\n');
  process.exitCode = 2;
  return false;
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  switch (name) {
    // NOTE: 'update' is intentionally NOT routed through this dispatcher.
    // `cli/bin.mjs` dispatches 'install' / 'update' directly to
    // `cli/commands/install.mjs`, which owns both commands (they share
    // the same code path). The legacy branch below used to import
    // `runUpdate` from `./install.mjs`, but that module never exported
    // `runUpdate` — the import would throw at runtime. The branch was
    // dead code, deleted in v10.19.6 as part of the `bizar update` audit
    // fix.

    case 'audit':
      if (isHelpRequest) showAuditHelp();
      else {
        const { runAudit } = await import('../audit.mjs');
        await runAudit();
      }
      break;

    case 'init':
      if (isHelpRequest) showInitHelp();
      else {
        const { runInit } = await import('../init.mjs');
        await runInit(process.cwd());
      }
      break;

    case 'export':
      if (isHelpRequest) showExportHelp();
      else {
        const { runExport } = await import('../export.mjs');
        const targetFlag = args.includes('--target') ? args[args.indexOf('--target') + 1] : args.find((arg) => !arg.startsWith('-'));
        const ok = await runExport(targetFlag || null);
        if (!ok) process.exitCode = 2;
      }
      break;

    case 'test-gate':
      if (isHelpRequest) showTestGateHelp();
      else await runTestGate(args);
      break;

    case 'doctor':
      if (isHelpRequest) showDoctorHelp();
      else {
        const wantJson = args.includes('--json');
        const { runDoctor } = await import('../doctor.mjs');
        const result = await runDoctor({ silent: wantJson, json: wantJson });
        if (wantJson) process.stdout.write(JSON.stringify(result) + '\n');
        if (result.failed > 0) process.exit(1);
      }
      break;

    case 'repair':
      if (isHelpRequest) showRepairHelp();
      else {
        const { runRepair } = await import('../repair.mjs');
        const dryRun = args.includes('--dry-run');
        const binOnly = args.includes('--bin-only');
        const result = await runRepair({ dryRun, binOnly });
        if (!result.ok) {
          for (const n of result.notes) console.log(`  ${n}`);
          process.exit(1);
        }
        for (const n of result.notes) console.log(`  ${n}`);
        if (result.fixed.length > 0) {
          console.log(chalk.green('\n  Repair complete. Re-run your shell or `hash -r` to pick up the new path.'));
        }
      }
      break;

    case 'backup': {
      if (isHelpRequest) {
        showBackupHelp();
        break;
      }
      const sub = args[0] || null;
      if (sub === 'list') {
        const { listBackups } = await import('../core/backup-store.mjs');
        const backups = await listBackups();
        if (backups.length === 0) {
          console.log('  No backups found.');
        } else {
          for (const b of backups) {
            console.log(`  ${b.path}`);
            console.log(`    Created: ${b.createdAt}`);
            console.log(`    Size: ${b.sizeFormatted}`);
            if (b.manifest?.label) console.log(`    Label: ${b.manifest.label}`);
            console.log('');
          }
        }
        break;
      }
      if (sub === 'verify') {
        const path = args[1];
        if (!path) { console.error('  Usage: bizar backup verify <path>'); process.exit(1); }
        const { verifyBackup } = await import('../core/backup-store.mjs');
        const result = await verifyBackup({ backupPath: path });
        if (result.ok) {
          console.log(chalk.green('  ✓ Backup is valid'));
        } else {
          console.error(chalk.red('  ✗ Backup has issues:'));
          for (const issue of result.issues) console.error(`    - ${issue}`);
          process.exit(1);
        }
        break;
      }
      if (sub === 'delete') {
        const path = args[1];
        if (!path) { console.error('  Usage: bizar backup delete <path>'); process.exit(1); }
        const { deleteBackup } = await import('../core/backup-store.mjs');
        const result = await deleteBackup({ backupPath: path });
        if (result.ok) {
          console.log(chalk.green('  ✓ Backup deleted'));
        } else {
          console.error(chalk.red(`  ✗ Delete failed: ${result.error}`));
          process.exit(1);
        }
        break;
      }
      // Default: create backup
      const label = sub || null;
      const { createBackup } = await import('../core/backup-store.mjs');
      const result = await createBackup({ label, projectRoot: process.cwd() });
      if (result.ok) {
        console.log(chalk.green('  ✓ Backup created'));
        console.log(`  Path: ${result.path}`);
        console.log(`  Size: ${result.sizeBytes > 0 ? `${(result.sizeBytes / 1024).toFixed(1)} KB` : '0 B'}`);
        console.log(`  Duration: ${result.durationMs}ms`);
      } else {
        console.error(chalk.red('  ✗ Backup failed'));
        process.exit(1);
      }
      break;
    }

    case 'restore': {
      if (isHelpRequest) {
        showRestoreHelp();
        break;
      }
      const path = args[0];
      if (!path) { showRestoreHelp(); process.exit(1); }
      const dryRun = args.includes('--dry-run');
      const conflictStrategy = args.includes('--overwrite') ? 'overwrite' : args.includes('--skip') ? 'skip' : 'merge';
      const { restoreBackup } = await import('../core/backup-store.mjs');
      const result = await restoreBackup({ backupPath: path, dryRun, conflictStrategy, projectRoot: process.cwd() });
      if (dryRun) {
        console.log('  Dry-run mode — no files were modified.');
      }
      if (result.restored.length > 0) {
        console.log(`  Restored: ${result.restored.join(', ')}`);
      }
      if (result.skipped.length > 0) {
        console.log(`  Skipped: ${result.skipped.join(', ')}`);
      }
      if (result.errors.length > 0) {
        console.error(chalk.red('  Errors:'));
        for (const e of result.errors) console.error(`    - ${e}`);
        process.exit(1);
      }
      if (result.ok) {
        console.log(chalk.green(`  ✓ Restore complete`));
      }
      break;
    }

    case 'heads-up':
      if (isHelpRequest) {
        console.log('  heads-up <subcommand>   Manage pre-push / pre-release heads-ups (list/check/archive)');
      } else {
        const { runHeadsUp } = await import('../heads-up.mjs');
        await runHeadsUp(args[0], args.slice(1));
      }
      break;

    case 'browser': {
      const { install, update, detectState, doctor, printStatus } =
        await import('../agent-browser-update.mjs');
      const sub = args[0] || 'status';
      switch (sub) {
        case 'status':
          printStatus();
          break;
        case 'install': {
          const s = install({ silent: false });
          console.log(chalk.green('\n  agent-browser ready.'));
          console.log(`    version: ${s.version}`);
          break;
        }
        case 'update': {
          const s = update({ silent: false });
          console.log(chalk.green('\n  agent-browser up-to-date.'));
          console.log(`    version: ${s.version}`);
          break;
        }
        case 'detect': {
          const s = detectState();
          console.log(JSON.stringify(s, null, 2));
          break;
        }
        case 'doctor': {
          const result = doctor({ silent: false });
          if (!result.ok) {
            console.error(chalk.red(`  ✗ ${result.message}`));
            process.exitCode = 1;
          }
          break;
        }
        default:
          console.log(`bizar browser <subcommand>

  Subcommands:
    status   one-line status (default)
    install  install agent-browser + its managed browser
    update   upgrade to the latest version
    detect   JSON state (for scripts)
    doctor   run the official diagnostic

  Examples:
    bizar browser status
    bizar browser install
    bizar browser update
    bizar browser doctor`);
      }
      break;
    }

    default:
      return false;
  }
  return true;
}
