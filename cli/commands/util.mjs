/**
 * cli/commands/util.mjs
 *
 * Miscellaneous utility commands:
 *   audit, init, export, test-gate, dev-link, dev-unlink,
 *   doctor, repair, heads-up, bg, agent-browser, agent-browser-up, providers detect,
 *   backup, restore
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    Detects the project stack, creates .bizar/PROJECT.md and
    .bizar/AGENTS_SELF_IMPROVEMENT.md and installs relevant skills.
    The per-project knowledge graph (in .bizar/graph/) is provided
    by the graphify mod — install it from the mod registry for
    that feature.
  `);
}

export function showExportHelp() {
  console.log(`
  bizar export — Export agents/rules to another harness

  Usage:
    bizar export [claude|cursor|cline]

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
    Inspects the project for known test runners (jest, vitest, mocha,
    bun:test, bun run test, etc.) and runs them. Falls back to package.json
    "scripts.test" when present. Exits non-zero on test failures.

  Exit codes:
    0  All tests passed
    1  Tests failed
    2  No test runner detected
  `);
}

export function showDevLinkHelp() {
  console.log(`
  bizar dev-link / dev-unlink — Manage a symlink from the cline plugin dir
  to a local source checkout, so edits propagate to cline on next session.

  Usage:
    bizar dev-link [source-dir]    Symlink source-dir (default: ./plugins/bizar)
                                   to ~/.config/cline/plugins/bizar
    bizar dev-link --force         Replace an existing deployed copy
    bizar dev-unlink               Remove the dev symlink + restore from npm
    bizar dev-unlink --force       Remove even if not a symlink (destructive)

  Description:
    By default, cline loads the Bizar plugin from
    ~/.config/cline/plugins/bizar, which is a real directory copied
    from the npm package. Edits to plugins/bizar/ in the BizarHarness
    repo don't propagate until you re-run the installer.

    \`bizar dev-link\` replaces that directory with a symlink pointing
    at your local checkout, so source edits are picked up immediately.
    \`bizar dev-unlink\` reverses the change by removing the symlink
    and re-installing the deployed copy from the npm package.

    While the dev link is in place, \`bizar update\` will skip the
    plugin-copy step (and print a warning) so it doesn't clobber the
    link. Run \`bizar dev-unlink\` first, or pass --force to overwrite.

  Examples:
    bizar dev-link
    bizar dev-link /home/me/projects/bizar/plugins/bizar
    bizar dev-link --force
    bizar dev-unlink
  `);
}

export function showDoctorHelp() {
  console.log(`
  bizar doctor — Check the BizarHarness install for health issues

  Usage:
    bizar doctor

  Description:
    Runs a battery of health checks against the local install:
      • cline CLI reachable
      • ~/.config/cline/cline.json parses as JSON
      • the Bizar plugin is registered
      • plugin path resolves
      • @polderlabs/bizar-plugin is installed globally
      • core agent files are installed (odin, quick, thor, tyr)
      • semble / skills on PATH (lenient — at least one)
      • dashboard reachable (skipped if no port file)
      • provider.minimax block + MiniMax model flags are sane

    Prints ✓/✗ for each check and a final summary. Exits non-zero
    if any check fails. Use \`bizar doctor\` after a manual config
    edit or to diagnose "why is cline misbehaving?" questions.

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
    Backs up config (~/.config/bizar/, ~/.config/cline/), memory,
    usage logs, and optionally project-level state (.bizar/, skills/).
    Backups are stored under ~/.local/share/bizar/backups/.

  Examples:
    bizar backup
    bizar backup "before-upgrade"
    bizar backup list
    bizar backup verify ~/.local/share/bizar/backups/bizar-2025-07-05-120000
  `);
}

export function showProvidersHelp() {
  console.log(`
  bizar providers - Auto-detect provider API keys

  Usage:
    bizar providers detect     Auto-detect provider API keys from env + cline.json
    bizar providers --help     Show this help

  Description:
    Scans process.env + ~/.config/cline/cline.json for known provider
    API keys (OpenAI, Anthropic, OpenRouter, MiniMax, etc.) and reports
    what's available. Useful before the first \`bizar install\` to verify
    credentials are picked up.

  No API keys are sent over the network - detection is local.
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

export async function runTestGate() {
  console.log(chalk.bold.hex('#a855f7')('\n  ᚦ TEST GATE ᚦ\n'));
  const { execSync } = await import('node:child_process');
  const cwd = process.cwd();
  const possible = [
    { cmd: 'npm test', check: 'package.json' },
    { cmd: 'pytest', check: 'pyproject.toml' },
    { cmd: 'cargo test', check: 'Cargo.toml' },
    { cmd: 'go test ./...', check: 'go.mod' },
  ];
  for (const suite of possible) {
    try {
      if (existsSync(join(cwd, suite.check))) {
        console.log(`  Running: ${suite.cmd}`);
        execSync(suite.cmd, { stdio: 'inherit', timeout: 120000, cwd });
        console.log('\n  ✓ Test gate passed\n');
        return true;
      }
    } catch {
      console.log(`\n  ✗ Test gate failed: ${suite.cmd}\n`);
      process.exit(1);
    }
  }
  console.log('  No test suite detected. Install one to use the test gate.\n');
  return false;
}

// ── Main dispatcher ────────────────────────────────────────────────────────────

export async function run(name, args, isHelpRequest) {
  switch (name) {
    case 'update':
      // `bizar update` lives in commands/install.mjs (the install/update
      // pair share a code path). Proxy to it.
      if (isHelpRequest) {
        const { showUpdateHelp } = await import('./install.mjs');
        showUpdateHelp();
      } else {
        const { runUpdate } = await import('./install.mjs');
        await runUpdate(args, {});
      }
      break;

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
        const targetFlag = args.includes('--target') ? args[args.indexOf('--target') + 1] : null;
        await runExport(targetFlag);
      }
      break;

    case 'test-gate':
      if (isHelpRequest) showTestGateHelp();
      else await runTestGate();
      break;

    case 'dev-link':
      if (isHelpRequest) showDevLinkHelp();
      else {
        const { createDevLink } = await import('../dev-link.mjs');
        const positional = args.filter((a) => !a.startsWith('-'));
        const flags = args.filter((a) => a.startsWith('-'));
        const sourceDir = positional[0] ?? null;
        const force = flags.includes('--force') || flags.includes('-f');
        const ok = createDevLink(sourceDir, { force });
        if (!ok) process.exit(1);
      }
      break;

    case 'dev-unlink':
      if (isHelpRequest) showDevLinkHelp();
      else {
        const { removeDevLink } = await import('../dev-link.mjs');
        const force = args.includes('--force') || args.includes('-f');
        const ok = await removeDevLink({ force });
        if (!ok) process.exit(1);
      }
      break;

    case 'doctor':
      if (isHelpRequest) showDoctorHelp();
      else {
        const wantJson = args.includes('--json');
        if (args[0] === 'smoke') {
          // `bizar doctor smoke` — run post-install smoke test
          const { runSmokeTest } = await import('../post-install-smoke.mjs');
          const result = await runSmokeTest();
          if (wantJson) process.stdout.write(JSON.stringify(result) + '\n');
          process.exit(result.ok ? 0 : 1);
        }
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
      if (isHelpRequest || args.length === 0) {
        showBackupHelp();
        break;
      }
      const sub = args[0];
      if (sub === 'list') {
        const { listBackups } = await import('../../bizar-dash/src/server/backup-store.mjs');
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
        const { verifyBackup } = await import('../../bizar-dash/src/server/backup-store.mjs');
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
        const { deleteBackup } = await import('../../bizar-dash/src/server/backup-store.mjs');
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
      const { createBackup } = await import('../../bizar-dash/src/server/backup-store.mjs');
      const result = await createBackup({ label });
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
      const { restoreBackup } = await import('../../bizar-dash/src/server/backup-store.mjs');
      const result = await restoreBackup({ backupPath: path, dryRun, conflictStrategy });
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

    case 'bg':
      if (isHelpRequest) {
        console.log('  bg <subcommand>   Manage background agents (list/view/kill/logs)');
      } else {
        const { runBg } = await import('../bg.mjs');
        await runBg(args[0], args.slice(1));
      }
      break;

    case 'digest':
      // v4.8.0 — Weekly digest management
      if (isHelpRequest) {
        const { showDigestHelp } = await import('../digest.mjs');
        showDigestHelp();
      } else {
        const { runDigest } = await import('../digest.mjs');
        await runDigest(args[0], args.slice(1));
      }
      break;

    case 'agent-browser-up': {
      const { execFileSync } = await import('node:child_process');
      const sub = args[0] || 'start';
      const __dirname = fileURLToPath(new URL('.', import.meta.url));
      const scriptPath = join(__dirname, '..', 'agent-browser-up.sh');
      try {
        const out = execFileSync('bash', [scriptPath, sub], {
          encoding: 'utf8',
          stdio: 'inherit',
        });
        if (out) process.stdout.write(out);
      } catch (err) {
        console.error(chalk.red(`  ✗ agent-browser-up ${sub} failed (exit ${err.status ?? 1})`));
        process.exit(err.status || 1);
      }
      break;
    }

    case 'agent-browser': {
      // v6.0.0 — install / update / verify the agent-browser CLI.
      // (The 'agent-browser-up' sibling is the bash wrapper that just
      // manages the daemon process; this is the rich installer + updater.)
      const { install, update, detectState, ensureRunning, printStatus } =
        await import('../agent-browser-update.mjs');
      const sub = args[0] || 'status';
      switch (sub) {
        case 'status':
          printStatus();
          break;
        case 'install': {
          const s = install({ silent: false });
          console.log(chalk.green('\n  agent-browser ready.'));
          console.log(`    version:    ${s.version}`);
          console.log(`    daemon:     ${s.daemonRunning ? 'running' : 'stopped'}`);
          console.log(`    profile:    ${s.profileDir}`);
          break;
        }
        case 'update': {
          const s = update({ silent: false });
          console.log(chalk.green('\n  agent-browser up-to-date.'));
          console.log(`    version:    ${s.version}`);
          console.log(`    daemon:     ${s.daemonRunning ? 'running' : 'stopped'}`);
          break;
        }
        case 'detect': {
          const s = detectState();
          console.log(JSON.stringify(s, null, 2));
          break;
        }
        case 'start':
          ensureRunning({ silent: false });
          break;
        case 'stop': {
          const { spawnSync } = await import('node:child_process');
          const killed = spawnSync('pkill', ['-f', 'agent-browser serve'], { stdio: 'ignore' });
          if (killed.status === 0) {
            console.log(chalk.green('  ✓ daemon stopped'));
          } else {
            console.log(chalk.dim('  daemon was not running'));
          }
          break;
        }
        default:
          console.log(`bizar agent-browser <sub>

  Subcommands:
    status   one-line status (default)
    install  install agent-browser + download Chrome
    update   upgrade to the latest version
    detect   JSON state (for scripts)
    start    start the daemon
    stop     stop the daemon

  Examples:
    bizar agent-browser status
    bizar agent-browser install
    bizar agent-browser update
    bizar agent-browser start`);
      }
      break;
    }

    case 'providers':
      if (isHelpRequest || args.length === 0) {
        showProvidersHelp();
        break;
      }
      if (args[0] === 'detect') {
        const { runProvidersDetect } = await import('../providers-detect.mjs');
        await runProvidersDetect(args.slice(1));
      }
      break;

    case 'plan':
      // Alias for artifact
      if (isHelpRequest) {
        const { showHelp } = await import('../artifact-cli.mjs');
        showHelp();
      } else {
        const { runArtifact } = await import('../artifact-cli.mjs');
        await runArtifact(args, {});
      }
      break;

    default:
      return false;
  }
  return true;
}
