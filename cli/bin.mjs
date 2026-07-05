#!/usr/bin/env node
/**
 * cli/bin.mjs
 *
 * v3.10.0 — `bizar` runtime CLI.
 *
 * Architecture:
 *   - `bizar` is the core runtime + installer + audit/init/export/update/artifact
 *     + service + dash commands.
 *   - The dashboard lives in `@polderlabs/bizar-dash` as a library.
 *     Commands live under `bizar dash <subcommand>` (new canonical form).
 *     `bizar dashboard` is a deprecated alias (still works, prints warning).
 *
 * Subcommands:
 *   install, audit, init, export, artifact, update, test-gate, service, dash
 */
import { existsSync } from 'node:fs';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const BIZAR_HOME = join(HOME, '.config', 'bizar');
import chalk from 'chalk';
import { runInstaller } from './install.mjs';
import { runAudit } from './audit.mjs';
import { runInit } from './init.mjs';
import { runExport } from './export.mjs';
import runArtifact from './artifact.mjs';
import { runUpdate } from './update.mjs';
import { runHeadsUp } from './heads-up.mjs';
import { ensureSetup, checkSetupStatus } from './bootstrap.mjs';

const args = process.argv.slice(2);
const isHelpRequest = args.includes('--help') || args.includes('-h');
const isVersionRequest = args.includes('--version') || args.includes('-v');

// ── Bootstrap ─────────────────────────────────────────────────────────────────
// Every bin command checks setup status on first invocation.
// Skip only when: --postinstall (manual trigger), --check (status only),
// --help / --version (informational), BIZAR_SKIP_INSTALL=1 (disabled),
// or already handled via npm script.
if (
  !args.includes('--postinstall') &&
  !args.includes('--check') &&
  !isHelpRequest &&
  !isVersionRequest &&
  !process.env.BIZAR_SKIP_INSTALL
) {
  await ensureSetup({ silent: true });
}
// ─────────────────────────────────────────────────────────────────────────────

function readCliVersion() {
  try {
    const packageJsonPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getBizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(process.env.HOME || process.cwd(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(process.env.HOME || process.cwd(), '.config', 'bizar');
}

function showHelp() {
  console.log(`
  Bizar — Norse Pantheon Agent System for opencode

  Usage:
    bizar <command> [options]

  Commands:
    install             Run the interactive installer
    audit               Run security audit on agent configuration
    init                Initialize .bizar/ in current project
    export [target]     Export agents/rules to another harness
    artifact <subcommand>  Manage visual artifacts
    test-gate           Detect & run the project's test suite
    update              Auto-update everything (opencode + bizar + dash + plugin)
    service             Manage the background service daemon
    bg <subcommand>     Manage background agents (list/view/kill/logs)
    memory <subcommand> Manage project memory (Bizar Memory Service)
    dash <subcommand>   Manage the dashboard (start/stop/status/cleanup/tui)
    browser-harness-up  Start Chromium for browser-harness (start/stop/status/restart)
    dev-link [src]      Symlink the local plugin source into opencode's plugin dir
    dev-unlink          Remove the dev symlink and restore the deployed copy
    doctor              Check the BizarHarness install for health issues
    heads-up <subcommand>  Manage pre-push / pre-release heads-ups (list/check/archive)
    minimax <subcommand>   Manage MiniMax Token Plan integration (key + onboarding)
    usage                 Show compact usage analytics summary (24h rolling)
    mod <subcommand>       Manage mods (install/upgrade/list via the dashboard API)

  Examples:
    bizar install
    bizar audit
    bizar dash start
    bizar dash start --bg
    bizar dash stop
    bizar dash status
    bizar doctor
    bizar update --all --dry-run

  Run \`bizar <command> --help\` for per-command help.

  Install:
    npm install -g @polderlabs/bizar          Install globally
    npm install -g @polderlabs/bizar-dash     Optional dashboard package
    npm install -g @polderlabs/bizar-plugin   Bizar opencode plugin
  `);
}

function showAuditHelp() {
  console.log(`
  bizar audit — Run security audit on agent configuration

  Usage:
    bizar audit
  `);
}

function showInitHelp() {
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

function showExportHelp() {
  console.log(`
  bizar export — Export agents/rules to another harness

  Usage:
    bizar export [claude|cursor|opencode]

  Description:
    Copies installed Bizar agents and rules into another harness format.
  `);
}

function showInstallHelp() {
  console.log(`
  bizar install — Run the unified BizarHarness installer

  Usage:
    bizar install                       Install (or refresh) every component
    bizar install --dry-run             Print what would happen, change nothing
    bizar install --force               Overwrite existing files
    bizar install --with-mods a,b,c     Opt-in: install specific mods as part of the run
    bizar install --help                Show this help

  Description:
    v4.4.7+ — unified installer. Same code path as 'bizar update'; the
    difference is just mode=install vs mode=update. Every step is
    idempotent — running this twice is safe.

    1. Installs @polderlabs/bizar via npm (skipped if already current).
    2. Shells to ./install.sh for platform-specific system deps (uv,
       python3.12, jq, gh on Linux; brew on macOS) + service registration
       (systemd / launchd / Task Scheduler).
    3. Syncs agent files, slash commands, and bundled skills into
       ~/.config/opencode/.
    4. Copies plugins/bizar/ from the npm install into
       ~/.config/opencode/plugins/bizar/ (preserves dev symlinks).
    5. Patches ~/.config/opencode/opencode.json with the Bizar plugin
       entry (skipped if already present).
    6. Runs 'bizar doctor' as a post-install health check.

    No API key collection, no interactive prompts.
  `);
}

function showUpdateHelp() {
  console.log(`
  bizar update — Update opencode + @polderlabs/bizar (which bundles the
  plugin and dashboard). Detects what's installed and only touches what's
  missing or out of date.

  Usage:
    bizar update                       Update EVERYTHING (default; auto-kills + restarts)
    bizar update --check               Only print current vs. latest; do not update
    bizar update --channel=stable|beta Pick the npm dist-tag (default: stable)
    bizar update --no-restart          Don't auto-restart the dashboard after update
    bizar update --dry-run             Print what would happen, change nothing
    bizar update --force               Override .bizar/PRE_PUSH_NOTES.md blockers
    bizar update --yes                 Same as --force, but named for one-line scripts
    bizar update --with-mods a,b,c     Opt-in: install specific mods as part of the run
    bizar update --help                Show this help

  Components updated:
    opencode-ai   the opencode CLI itself
    @polderlabs/bizar    this CLI + dashboard + plugin (one package)

  Behavior (v4.4.7+):
    • Single unified provisioner. 'bizar install' and 'bizar update' are
      the same code path with different mode flags. Every step is
      idempotent — re-running is safe.
    • Detects running Bizar instances (background service daemon, web
      dashboard) by reading ~/.config/bizar/{service,dashboard}.pid and
      cleans up any stale or empty PID files.
    • Auto-kills running instances with a brief notice.
    • Sends SIGTERM, waits up to 5s, escalates to SIGKILL if needed.
    • Re-runs the install script so the deployed plugin source matches
      the just-upgraded npm version (avoids the version-skew trap).
    • If the dashboard was running and bizar was updated, spawns a
      fresh detached dashboard process with the new code (skipped with
      --no-restart).
    • Runs 'bizar doctor' after a successful update to catch config
      regressions before opencode tries to start.
    • With --check: prints the version matrix and release-notes excerpt
      between current and latest, exits non-zero if an update is available.

  Examples:
    bizar update                       Full auto-update (recommended)
    bizar update --check               Show version matrix + notes, do nothing
    bizar update --channel=beta        Upgrade to latest beta build
    bizar update --dry-run             Preview what would change
    bizar update plugin --no-restart   Plugin-only, leave dashboard alone

  Errors:
    Network failures (registry offline / DNS) and npm permission issues
    are surfaced with the raw npm output. The provisioner never silently
    swallows them — look for the ✗ marker in the step output.
  `);
}

function showTestGateHelp() {
  console.log(`
  bizar test-gate — Detect & run the project's test suite
  `);
}

function showDevLinkHelp() {
  console.log(`
  bizar dev-link / dev-unlink — Manage a symlink from the opencode plugin dir
  to a local source checkout, so edits propagate to opencode on next session.

  Usage:
    bizar dev-link [source-dir]    Symlink source-dir (default: ./plugins/bizar)
                                   to ~/.config/opencode/plugins/bizar
    bizar dev-link --force         Replace an existing deployed copy
    bizar dev-unlink               Remove the dev symlink + restore from npm
    bizar dev-unlink --force       Remove even if not a symlink (destructive)

  Description:
    By default, opencode loads the Bizar plugin from
    ~/.config/opencode/plugins/bizar, which is a real directory copied
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

function showDoctorHelp() {
  console.log(`
  bizar doctor — Check the BizarHarness install for health issues

  Usage:
    bizar doctor

  Description:
    Runs a battery of health checks against the local install:
      • opencode CLI reachable
      • ~/.config/opencode/opencode.json parses as JSON
      • the Bizar plugin is registered
      • plugin path resolves
      • @polderlabs/bizar-plugin is installed globally
      • core agent files are installed (odin, quick, thor, tyr)
      • headroom / semble / skills on PATH (lenient — at least one)
      • dashboard reachable (skipped if no port file)
      • provider.minimax block + MiniMax model flags are sane

    Prints ✓/✗ for each check and a final summary. Exits non-zero
    if any check fails. Use \`bizar doctor\` after a manual config
    edit or to diagnose "why is opencode misbehaving?" questions.

  Related:
    bizar update              Update + auto-run doctor on success
  `);
}

function showServiceHelp() {
  const bizarConfigDir = getBizarConfigDir();
  console.log(`
  bizar service — Manage the background service daemon

  Usage:
    bizar service start            Start the service in background
    bizar service stop             Stop the running service
    bizar service status           Show whether the service is running
    bizar service logs             Tail the service log
    bizar service follow           Follow the service log until Ctrl-C
    bizar service install          Register with systemd / launchd / scheduled task
    bizar service install --force  Re-install even when the unit matches
    bizar service uninstall        Remove the OS-level autostart
    bizar service uninstall --force  Force-uninstall even when nothing is registered

  Description:
    The service watches per-project schedules (cron / interval / once)
    and runs them at the right time. It logs to
    ${bizarConfigDir}/service.log and writes its PID to
    ${bizarConfigDir}/service.pid.

    install registers the daemon under the OS init system — systemd user
    unit on Linux, launchd LaunchAgent on macOS, scheduled task
    ("BizarDashboardService", ONSTART, HIGHEST) on Windows. After
    install, a normal user does not need to run \`bizar service start\`
    for the dashboard background process — the OS does it at login.
  `);
}

function showModHelp() {
  console.log(`
  bizar mod — Manage mods (via the dashboard's HTTP API)

  Usage:
    bizar mod upgrade <id> [--backup]   Upgrade an installed mod to the latest version
    bizar mod install <id>              Install a mod from the registry
    bizar mod list                       List installed mods
    bizar mod registry                  Show registry URL + available mods

  Description:
    Subcommands call the running dashboard's HTTP API. If no dashboard is
    reachable, you'll be told to run \`bizar dash start\` first.

    \`bizar mod upgrade <id>\` will:
      1. Snapshot the existing version of the mod
      2. Optionally back up the folder (--backup)
      3. Remove the existing copy (and its opencode-config instructions)
      4. Install the latest version from the registry
      5. Re-install the new mod's instruction files into opencode config
      6. Print from-version → to-version
`);
}

async function runModCommand(modArgs) {
  const sub = modArgs[0];
  const positional = modArgs.slice(1).filter((a) => !a.startsWith('-'));
  const flags = modArgs.slice(1).filter((a) => a.startsWith('-'));

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showModHelp();
    return;
  }

  // Read dashboard port from the port file the dashboard writes on start.
  const { readFileSync: rfs } = await import('node:fs');
  const { join: joinPath } = await import('node:path');
  const portFile = joinPath(getBizarConfigDir(), 'dashboard.port');
  let port = null;
  try {
    port = parseInt(rfs(portFile, 'utf8').trim(), 10);
    if (!Number.isFinite(port) || port <= 0) port = null;
  } catch {
    port = null;
  }
  if (!port) {
    console.error(chalk.red('  ✗ Dashboard is not running (no port file at ' + portFile + ').'));
    console.error(chalk.dim('  Start it first: `bizar dash start --bg`'));
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  async function postJson(path, body) {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    if (!res.ok) {
      const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
      throw new Error(`${path} failed: ${msg}`);
    }
    return json;
  }
  async function getJson(path) {
    const res = await fetch(`${baseUrl}${path}`);
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
    if (!res.ok) {
      const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
      throw new Error(`${path} failed: ${msg}`);
    }
    return json;
  }

  if (sub === 'install') {
    const id = positional[0];
    if (!id) {
      console.error(chalk.red('  ✗ Missing mod id. Usage: bizar mod install <id>'));
      process.exit(1);
    }
    try {
      const m = await postJson('/api/mods', { id });
      console.log(chalk.green(`  ✓ Installed "${m.id}" v${m.version}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else if (sub === 'upgrade') {
    const id = positional[0];
    if (!id) {
      console.error(chalk.red('  ✗ Missing mod id. Usage: bizar mod upgrade <id> [--backup]'));
      process.exit(1);
    }
    const backup = flags.includes('--backup') || flags.includes('-b');
    try {
      const r = await postJson(`/api/mods/${encodeURIComponent(id)}/upgrade`, { backup });
      const note = r.backupPath ? chalk.dim(` (backup: ${r.backupPath})`) : '';
      console.log(chalk.green(`  ✓ Upgraded "${id}" v${r.from} → v${r.to}`) + note);
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else if (sub === 'list') {
    try {
      const r = await getJson('/api/mods');
      const mods = r.mods || [];
      if (mods.length === 0) {
        console.log(chalk.dim('  (no mods installed)'));
        return;
      }
      for (const m of mods) {
        const state = m.enabled ? chalk.green('enabled ') : chalk.yellow('disabled');
        console.log(`  ${m.id.padEnd(20)} v${m.version.padEnd(10)} ${state}  ${m.name || ''}`);
      }
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else if (sub === 'registry') {
    try {
      const r = await getJson('/api/mods/registry');
      console.log(chalk.dim(`  Source: ${r.registry?.source || '(unknown)'}`));
      console.log(chalk.dim(`  Updated: ${r.registry?.updatedAt || '(unknown)'}`));
      console.log('');
      const mods = r.mods || [];
      if (mods.length === 0) {
        console.log(chalk.dim('  (no mods in registry)'));
        return;
      }
      for (const m of mods) {
        const installed = m.installed ? chalk.green(`installed v${m.installedVersion || '?'}`) : chalk.dim('not installed');
        const upgrade = m.upgradeAvailable ? chalk.yellow(` ↑ v${m.upgradeAvailable} available`) : '';
        console.log(`  ${m.id.padEnd(20)} v${(m.latest || '?').padEnd(10)} ${installed}${upgrade}  ${m.name || ''}`);
      }
    } catch (err) {
      console.error(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
  } else {
    console.error(chalk.red(`  ✗ Unknown mod subcommand: ${sub}`));
    showModHelp();
    process.exit(1);
  }
}

function showMinimaxHelp() {
  console.log(`
  bizar minimax — Manage the MiniMax Token Plan integration

  Usage:
    bizar minimax status              Show whether the Subscription Key is configured
                                       and where it was resolved from (auth.json,
                                       opencode.json, env var, or none).
    bizar minimax remains              Fetch the live 5-hour + weekly remaining
                                       quota per model. Shows reset times.
    bizar minimax test                 Smoke-test the key with a one-shot chat
                                       completion. Prints the usage block.
    bizar minimax config <key>         Save a new Subscription Key to
                                       ~/.local/share/opencode/auth.json. The
                                       key never leaves this machine.
    bizar minimax clear                Remove the Subscription Key from
                                       opencode's auth.json.
    bizar minimax reset-onboarding    Re-trigger the first-run wizard. Use
                                       this if the key was changed outside the
                                       dashboard and you want to re-enter it.

  Flags:
    --base-url <url>    Override the Token Plan host (default: https://www.minimax.io)
    --chat-url  <url>    Override the chat-completions host (default: https://api.minimax.io/v1)
    --yes                 Skip the confirmation prompt on 'clear' and 'reset-onboarding'
`);
}

// Find the dashboard's port + password so the CLI can talk to /api/minimax/*.
function readDashboardConn() {
  const portFile = join(BIZAR_HOME, 'dashboard.port');
  const authFile = join(BIZAR_HOME, 'dashboard-secret');
  let port = 4321;
  let secret = '';
  try {
    if (existsSync(portFile)) {
      const parsed = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
      if (Number.isFinite(parsed) && parsed > 0) port = parsed;
    }
  } catch { /* ignore */ }
  try {
    if (existsSync(authFile)) secret = readFileSync(authFile, 'utf8').trim();
  } catch { /* ignore */ }
  return { port, secret };
}

async function minimaxApi(path, opts = {}) {
  const { port, secret } = readDashboardConn();
  const url = `http://127.0.0.1:${port}${path}`;
  const headers = { 'content-type': 'application/json', accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`;
  const method = (opts.method || 'GET').toUpperCase();
  try {
    const resp = await fetch(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!resp.ok) {
      return { ok: false, error: `http_${resp.status}`, message: data?.message || data?.error || resp.statusText, status: resp.status };
    }
    return { ok: true, status: resp.status, data };
  } catch (err) {
    return { ok: false, error: 'network_error', message: err && err.message ? err.message : String(err) };
  }
}

async function runMinimaxCommand(minimaxArgs) {
  const sub = minimaxArgs[0];
  const flags = minimaxArgs.slice(1).filter((a) => a.startsWith('-'));
  const positional = minimaxArgs.slice(1).filter((a) => !a.startsWith('-'));
  const yes = flags.includes('--yes') || flags.includes('-y');

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showMinimaxHelp();
    return;
  }

  if (sub === 'status') {
    const r = await minimaxApi('/api/minimax/status');
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    const s = r.data;
    console.log('');
    console.log(chalk.bold('  MiniMax Token Plan status'));
    console.log('');
    console.log(`    ${chalk.dim('configured:')}    ${s.configured ? chalk.green('yes') : chalk.red('no')}`);
    console.log(`    ${chalk.dim('key source:')}    ${chalk.cyan(s.source)}`);
    if (s.apiKeyHint) console.log(`    ${chalk.dim('key hint:')}      ${s.apiKeyHint}`);
    console.log(`    ${chalk.dim('group id:')}     ${s.groupId}`);
    console.log(`    ${chalk.dim('token host:')}   ${s.tokenBaseUrl}`);
    console.log(`    ${chalk.dim('chat host:')}    ${s.chatBaseUrl}`);
    console.log(`    ${chalk.dim('key format:')}   ${s.keyPatternValid === true ? chalk.green('ok') : s.keyPatternValid === false ? chalk.red('unexpected prefix') : chalk.dim('n/a')}`);
    console.log('');
    if (s.cache) {
      console.log(`    ${chalk.dim('cached:')}         ${new Date(s.cache.fetchedAt).toLocaleString()} (${s.cache.modelCount} models)`);
    } else {
      console.log(`    ${chalk.dim('cached:')}         none yet — run \`bizar minimax remains\` to populate`);
    }
    return;
  }

  if (sub === 'remains') {
    const r = await minimaxApi('/api/minimax/remains');
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    if (!r.data?.ok) {
      console.error(chalk.red(`  ✗ ${r.data?.message || r.data?.error || 'unknown'}`));
      process.exit(1);
    }
    const data = r.data;
    console.log('');
    console.log(chalk.bold(`  MiniMax Token Plan quota  (${new Date(data.fetchedAt).toLocaleString()})`));
    if (data.apiKeyHint) console.log(chalk.dim(`  Key: ${data.apiKeyHint} · source: ${data.keySource} · group: ${data.groupId}`));
    console.log('');
    for (const m of data.models || []) {
      const five = m.current_interval_remaining_percent;
      const week = m.current_weekly_remaining_percent;
      const fiveBar = '█'.repeat(Math.round(five / 5)) + '░'.repeat(20 - Math.round(five / 5));
      const weekBar = '█'.repeat(Math.round(week / 5)) + '░'.repeat(20 - Math.round(week / 5));
      const fiveColor = five >= 75 ? chalk.green : five >= 25 ? chalk.yellow : chalk.red;
      const weekColor = week >= 75 ? chalk.green : week >= 25 ? chalk.yellow : chalk.red;
      console.log(`    ${chalk.bold(m.model_name)}`);
      console.log(`      ${chalk.dim('5h:')}    ${fiveColor(five + '%'.padStart(4))} ${fiveBar}  resets in ${m.intervalResetInHuman}`);
      console.log(`      ${chalk.dim('week:')}  ${weekColor(week + '%'.padStart(4))} ${weekBar}  resets in ${m.weeklyResetInHuman}`);
      console.log('');
    }
    return;
  }

  if (sub === 'test') {
    const prompt = positional[0] || 'Reply with the single word: pong';
    const r = await minimaxApi('/api/minimax/test', {
      method: 'POST',
      body: { prompt, model: 'MiniMax-M3', maxTokens: 32 },
    });
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    const data = r.data;
    if (!data?.ok) {
      console.error(chalk.red(`  ✗ ${data?.message || data?.error || 'unknown'}`));
      process.exit(1);
    }
    console.log('');
    console.log(chalk.green('  ✓ Key works'));
    console.log(`    ${chalk.dim('model:')}     ${data.model}`);
    console.log(`    ${chalk.dim('finish:')}    ${data.finishReason}`);
    if (data.content) console.log(`    ${chalk.dim('content:')}    ${JSON.stringify(data.content.slice(0, 80))}${data.content.length > 80 ? '…' : ''}`);
    if (data.usage) {
      console.log(`    ${chalk.dim('usage:')}      total=${data.usage.total_tokens} prompt=${data.usage.prompt_tokens} completion=${data.usage.completion_tokens}`);
    }
    return;
  }

  if (sub === 'config' || sub === 'set') {
    const key = positional[0];
    if (!key) {
      console.error(chalk.red('  ✗ Missing key. Usage: bizar minimax config <sk-cp-…>'));
      process.exit(1);
    }
    if (!/^sk-(cp|ant|or)-[A-Za-z0-9_-]{20,}$/.test(key)) {
      console.error(chalk.red('  ✗ Key does not look like a MiniMax key (expected sk-cp-…, sk-ant-…, or sk-or-… prefix)'));
      process.exit(1);
    }
    console.log(chalk.dim('  Saving to opencode auth.json…'));
    const r = await minimaxApi('/api/minimax/onboarding/save-key', {
      method: 'POST',
      body: { key, groupId: 'default' },
    });
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    console.log(chalk.green(`  ✓ Saved to ${r.data?.path}`));
    console.log(`    ${chalk.dim('key hint:')} ${r.data?.apiKeyHint}`);
    return;
  }

  if (sub === 'clear' || sub === 'remove') {
    if (!yes) {
      console.log(chalk.yellow(`  ⚠ This will remove the MiniMax Subscription Key from opencode's auth.json.`));
      console.log(chalk.dim('  Continue? [y/N]'));
      // simple readline confirmation
      const buf = [];
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf.push(c); if (c.includes('\n')) process.stdin.pause(); });
      await new Promise((resolve) => process.stdin.once('close', resolve));
      const answer = buf.join('').trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }
    // We don't have a "clear key" route; instead write an empty auth.json
    // entry. We piggyback on the onboarding save-key by saving an empty
    // marker isn't allowed — use the providers-store side instead. For
    // now, recommend using the dashboard's "clear" button. But the
    // simplest CLI path is to write auth.json directly.
    const authFile = join(HOME, '.local', 'share', 'opencode', 'auth.json');
    let auth = {};
    try {
      if (existsSync(authFile)) auth = JSON.parse(readFileSync(authFile, 'utf8'));
    } catch { /* ignore */ }
    if (auth.minimax) {
      delete auth.minimax;
      writeFileSync(authFile, JSON.stringify(auth, null, 2) + '\n', 'utf8');
      console.log(chalk.green('  ✓ MiniMax key removed from auth.json'));
    } else {
      console.log(chalk.dim('  No MiniMax key was configured.'));
    }
    return;
  }

  if (sub === 'reset-onboarding' || sub === 'reset') {
    if (!yes) {
      console.log(chalk.yellow('  ⚠ This will re-trigger the first-run MiniMax onboarding wizard.'));
      console.log(chalk.dim('  Continue? [y/N]'));
      const buf = [];
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (c) => { buf.push(c); if (c.includes('\n')) process.stdin.pause(); });
      await new Promise((resolve) => process.stdin.once('close', resolve));
      const answer = buf.join('').trim().toLowerCase();
      if (answer !== 'y' && answer !== 'yes') {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }
    // Reset via the dashboard API.
    const r = await minimaxApi('/api/minimax/onboarding', {
      method: 'POST',
      body: { dismissedAt: null },
    });
    if (!r.ok) {
      console.error(chalk.red(`  ✗ ${r.message || r.error}`));
      process.exit(1);
    }
    console.log(chalk.green('  ✓ Onboarding wizard will show on next dashboard load'));
    return;
  }

  console.error(chalk.red(`  ✗ Unknown minimax subcommand: ${sub}`));
  showMinimaxHelp();
  process.exit(1);
}

// ── Usage subcommand ───────────────────────────────────────────────────────

function showUsageHelp() {
  console.log(`
  bizar usage — Show compact usage analytics summary

  Usage:
    bizar usage [24h|7d|30d]   Show summary for the given range (default: 24h)

  Examples:
    bizar usage
    bizar usage 7d
    bizar usage 30d
  `);
}

async function runUsageCommand(args) {
  const range = (args[0] && ['24h', '7d', '30d'].includes(args[0])) ? args[0] : '24h';
  const { port, secret } = readDashboardConn();
  const url = `http://127.0.0.1:${port}/api/usage?range=${range}`;
  const headers = { accept: 'application/json' };
  if (secret) headers.authorization = `Basic ${Buffer.from(`opencode:${secret}`).toString('base64')}`;
  try {
    const resp = await fetch(url, { method: 'GET', headers });
    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!resp.ok || !data) {
      console.error(chalk.red(`  ✗ Failed to load usage data: ${data?.message ?? resp.statusText}`));
      process.exit(1);
    }
    const t = data.totals;
    console.log('');
    console.log(chalk.bold(`  Usage summary — ${range} (from JSONL store)`));
    console.log('');
    console.log(`    ${chalk.dim('Requests:')}   ${t.requests.toLocaleString()}  (${t.errors} errors)`);
    console.log(`    ${chalk.dim('Tokens:')}     ${t.totalTokens.toLocaleString()} total  (${t.promptTokens.toLocaleString()} prompt · ${t.completionTokens.toLocaleString()} completion)`);
    console.log(`    ${chalk.dim('Cached:')}     ${t.cachedTokens.toLocaleString()} tokens`);
    console.log(`    ${chalk.dim('Reasoning:')}  ${t.reasoningTokens.toLocaleString()} tokens`);
    console.log(`    ${chalk.dim('Avg latency:')} ${t.avgLatencyMs}ms  (p95: ${t.p95LatencyMs}ms)`);
    if (t.costEstimate > 0) {
      console.log(`    ${chalk.dim('Est. cost:')}   $${t.costEstimate.toFixed(4)} USD`);
    }
    console.log('');
    if (data.daily && data.daily.length > 0) {
      console.log(chalk.dim(`  ${chalk.bold('Daily breakdown')}`));
      for (const day of data.daily.slice(-7)) {
        const barLen = Math.round((day.totalTokens / Math.max(...data.daily.map(d => d.totalTokens))) * 20);
        const bar = '█'.repeat(barLen) + '░'.repeat(20 - barLen);
        console.log(`    ${day.date}  ${bar}  ${day.totalTokens.toLocaleString()} tok  ${day.requests} req`);
      }
    }
    if (data.perModel && data.perModel.length > 0) {
      console.log('');
      console.log(chalk.dim(`  ${chalk.bold('Per model')}`));
      for (const m of data.perModel.slice(0, 8)) {
        console.log(`    ${m.modelId.padEnd(24)} ${String(m.requests).padStart(6)} req  ${String(m.totalTokens).padStart(8)} tok`);
      }
    }
    console.log('');
  } catch (err) {
    console.error(chalk.red(`  ✗ Network error: ${err && err.message ? err.message : String(err)}`));
    console.error(chalk.dim('    Is the dashboard running? Run `bizar dash start` first.'));
    process.exit(1);
  }
}

function showDashHelp() {
  console.log(`
  bizar dash — Manage the Bizar dashboard

  Usage:
    bizar dash <subcommand> [options]　

  Subcommands:
    start [--bg] [--port N]   Start the dashboard (default port 4321)
    stop                       Stop the running dashboard
    status                     Show dashboard port and URL
    cleanup                    Find + kill zombie/orphan dashboards
    tui [--no-web]             Launch the TUI

  Options:
    --bg                       Detach and run in background (for start)
    --port N                   Override the default port
    --no-web                   Skip launching the web UI (for tui)

  Examples:
    bizar dash start
    bizar dash start --bg
    bizar dash stop
    bizar dash status
    bizar dash tui
    bizar dash tui --no-web

  Note:
    \`bizar dashboard\` is a deprecated alias for \`bizar dash\` and still
    works, but new code should use \`bizar dash\`.
  `);
}

function showMemoryHelp() {
  console.log(`
  memory <subcommand>   Manage project memory (local-only or Git-shared Obsidian vault)
                        Subcommands: init, setup, status, link, unlink, write, pull, commit,
                        push, sync, reindex, conflicts, doctor
  `);
}

/**
 * Detect whether the dashboard CLI is available.
 * v4.0.0: primary path is the relative one (dashboard ships inside the
 * same package at bizar-dash/src/cli.mjs). A global-npm fallback is
 * kept for legacy users who still have @polderlabs/bizar-dash installed.
 */
async function findBizarDash() {
  // v4.0.0 — primary: relative import inside the same package
  const primaryPath = join(import.meta.dirname, '..', 'bizar-dash', 'src', 'cli.mjs');
  if (existsSync(primaryPath)) return primaryPath;

  // Legacy fallback: global npm install of @polderlabs/bizar-dash
  const { execSync } = await import('node:child_process');
  try {
    const root = execSync('npm root -g', { encoding: 'utf8', timeout: 5000 }).trim();
    const dashPath = join(root, '@polderlabs', 'bizar-dash', 'src', 'cli.mjs');
    if (existsSync(dashPath)) return dashPath;
  } catch {
    /* fall through */
  }
  // Local fallback — node_modules of this package
  const localPath = fileURLToPath(new URL('../node_modules/@polderlabs/bizar-dash/src/cli.mjs', import.meta.url));
  if (existsSync(localPath)) return localPath;
  return null;
}

/**
 * Delegate a subcommand to the bizar-dash CLI, if installed.
 */
async function delegateToDash(argsForDash) {
  const dashPath = await findBizarDash();
  if (!dashPath) {
    console.log('The Bizar dashboard is part of this package.');
    console.log('If you see this error, the install may be corrupted.');
    console.log('Please report at: github.com/DrB0rk/BizarHarness/issues');
    return;
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [dashPath, ...argsForDash], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });
  await new Promise((resolve, reject) => {
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`dashboard exited via signal ${signal}`));
        return;
      }
      reject(new Error(`dashboard exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

function parseFlag(name) {
  const idx = args.indexOf(name);
  if (idx === -1) return null;
  return args[idx + 1] || null;
}

/**
 * v4.4.11 — Parse `--with-mods <csv>` from the given subargs slice.
 * Returns `null` if the flag isn't present (the provisioner's
 * "don't touch mods" default), or a string[] of mod ids if it is.
 */
function parseWithModsFlag(subargs) {
  const idx = subargs.indexOf('--with-mods');
  if (idx === -1) return null;
  const raw = subargs[idx + 1];
  if (!raw || raw.startsWith('--')) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function readAutoLaunchWeb() {
  try {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const bizarConfigDir = process.platform === 'win32'
      ? (process.env.APPDATA
        ? path.join(process.env.APPDATA, 'bizar')
        : path.join(os.homedir(), '.config', 'bizar'))
      : (process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, 'bizar')
        : path.join(os.homedir(), '.config', 'bizar'));
    const file = path.join(bizarConfigDir, 'settings.json');
    if (!fs.existsSync(file)) return true;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && parsed.dashboard && typeof parsed.dashboard.autoLaunchWeb === 'boolean') {
      return parsed.dashboard.autoLaunchWeb;
    }
  } catch {
    /* fall through */
  }
  return true;
}

async function runTestGate() {
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

/**
 * Service commands — start / stop / status / logs / install / uninstall.
 *
 * Implementation lives in cli/service.mjs. The install / uninstall
 * branches delegate to cli/service-controller.mjs for OS-level
 * registration (systemd / launchd / schtasks).
 */
async function runServiceCommand(sub) {
  const { runService } = await import('./service.mjs');
  await runService(sub || 'status', args.slice(2));
}

async function main() {
  if (args.includes('--check')) {
    const status = checkSetupStatus();
    console.log(JSON.stringify(status, null, 2));
    process.exit(status.needed ? 1 : 0);
  } else if (args.includes('--setup')) {
    await ensureSetup({ silent: false });
    process.exit(0);
  } else if (args.includes('--postinstall')) {
    // Legacy manual trigger — now an alias for --setup
    await ensureSetup({ silent: false });
    process.exit(0);
  } else if (isVersionRequest) {
    console.log(readCliVersion());
  } else if (args[0] === 'audit') {
    if (isHelpRequest) showAuditHelp();
    else await runAudit();
  } else if (args[0] === 'init') {
    if (isHelpRequest) showInitHelp();
    else await runInit(process.cwd());
  } else if (args[0] === 'memory') {
    if (isHelpRequest && !args[1]) showMemoryHelp();
    else {
      const { runMemory } = await import('./memory.mjs');
      await runMemory(args[1], args.slice(2));
    }
  } else if (args[0] === 'export') {
    if (isHelpRequest) showExportHelp();
    else await runExport(parseFlag('--target'));
  } else if (args[0] === 'test-gate') {
    if (isHelpRequest) showTestGateHelp();
    else await runTestGate();
  } else if (args[0] === 'update') {
    if (isHelpRequest) showUpdateHelp();
    else {
      // v4.4.11 — Same --with-mods opt-in for update.
      const withMods = parseWithModsFlag(args.slice(1));
      // runUpdate expects (subargs: string[], opts?: object). Splice
      // --with-mods <csv> out of subargs since the provisioner now
      // takes it via opts, not as a positional arg.
      const subargs = args.slice(1).filter((a, i, arr) => {
        if (a === '--with-mods') return false;
        if (arr[i - 1] === '--with-mods') return false;
        return true;
      });
      await runUpdate(subargs, { withMods });
    }
  } else if (args[0] === 'dev-link') {
    if (isHelpRequest) showDevLinkHelp();
    else {
      const { createDevLink } = await import('./dev-link.mjs');
      const positional = args.slice(1).filter((a) => !a.startsWith('-'));
      const flags = args.slice(1).filter((a) => a.startsWith('-'));
      const sourceDir = positional[0] ?? null;
      const force = flags.includes('--force') || flags.includes('-f');
      const ok = createDevLink(sourceDir, { force });
      if (!ok) process.exit(1);
    }
  } else if (args[0] === 'dev-unlink') {
    if (isHelpRequest) showDevLinkHelp();
    else {
      const { removeDevLink } = await import('./dev-link.mjs');
      const force = args.includes('--force') || args.includes('-f');
      const ok = await removeDevLink({ force });
      if (!ok) process.exit(1);
    }
  } else if (args[0] === 'doctor') {
    if (isHelpRequest) showDoctorHelp();
    else {
      const { runDoctor } = await import('./doctor.mjs');
      const result = await runDoctor();
      if (result.failed > 0) process.exit(1);
    }
  } else if (args[0] === 'repair') {
    // v4.4.3 — One-shot repair for stale `bizar` bin symlinks.
    // Symptom: after `npm i -g @polderlabs/bizar`, the package is
    // installed under `npm root -g` but the `bizar` symlink on PATH
    // still points at a legacy install path (e.g. ~/.local/lib/...).
    // Calls of `bizar ...` then run the old code with the old bugs.
    if (isHelpRequest) {
      console.log(`
  bizar repair — Fix common install issues

  Usage:
    bizar repair                Diagnose + fix stale bin symlinks and mismatched versions
    bizar repair --dry-run      Show what would change without modifying anything
    bizar repair --bin-only     Only fix the bin symlink; skip version checks
      `);
    } else {
      const { runRepair } = await import('./repair.mjs');
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
  } else if (args[0] === 'heads-up') {
    // v3.21.0 — Pre-push / pre-release heads-ups
    await runHeadsUp(args[1], args.slice(2));
  } else if (args[0] === 'plan') {
    await runArtifact(args.slice(1), {});
  } else if (args[0] === 'install') {
    if (isHelpRequest) showInstallHelp();
    else {
      // v4.4.11 — Parse --with-mods <csv> to opt into mod installs
      // during the run. Default: mods are NEVER touched.
      const withMods = parseWithModsFlag(args.slice(1));
      await runInstaller({ withMods });
      // v4.4.3 — After install, repair any stale bin symlinks so the
      // user picks up the new code (the installer itself may have
      // been running from a stale install path).
      try {
        const { runRepair } = await import('./repair.mjs');
        const r = await runRepair({});
        if (r.fixed.length > 0) {
          console.log(chalk.cyan('\n  Repair: repointed stale bin symlinks:'));
          for (const f of r.fixed) console.log(`    ${f}`);
          console.log(chalk.dim('    Re-run your shell or `hash -r` to pick up the new path.'));
        }
      } catch (err) {
        console.log(chalk.dim(`  Repair skipped: ${err.message}`));
      }
    }
  } else if (args[0] === 'service') {
    if (isHelpRequest) showServiceHelp();
    else await runServiceCommand(args[1]);
  } else if (args[0] === 'bg') {
    // v3.11.1 — Background agent manager (list / view / kill / logs).
    const { runBg } = await import('./bg.mjs');
    await runBg(args[1], args.slice(2));
  } else if (args[0] === 'browser-harness-up') {
    // v3.20.7 — Browser-harness daemon: start / stop / status / restart
    // Chromium with remote debugging so the browser-harness Python tool
    // (from https://github.com/browser-use/browser-harness) can connect.
    const { execFileSync } = await import('node:child_process');
    const sub = args[1] || 'start';
    const scriptPath = join(import.meta.dirname || process.cwd(), 'browser-harness-up.sh');
    try {
      const out = execFileSync('bash', [scriptPath, sub], {
        encoding: 'utf8',
        stdio: 'inherit',
      });
      if (out) process.stdout.write(out);
    } catch (err) {
      console.error(chalk.red(`  ✗ browser-harness-up ${sub} failed (exit ${err.status ?? 1})`));
      process.exit(err.status || 1);
    }
  } else if (args[0] === 'providers' && args[1] === 'detect') {
    // v3.16.0 — Auto-detect provider API keys from env + opencode.json.
    const { runProvidersDetect } = await import('./providers-detect.mjs');
    await runProvidersDetect(args.slice(2));
  } else if (args[0] === 'mod') {
    // v3.20.5 — Mod manager. Talks to the running dashboard over HTTP
    // (the dashboard owns the actual mod install/upgrade logic and the
    // opencode-config install/uninstall of instruction files).
    await runModCommand(args.slice(1));
  } else if (args[0] === 'minimax') {
    // v4.5.0 — MiniMax Token Plan integration CLI. Status, remains,
    // test, config, clear, reset-onboarding. All commands shell out
    // to the dashboard's /api/minimax/* routes.
    await runMinimaxCommand(args.slice(1));
  } else if (args[0] === 'usage') {
    // v4.6.0 — Compact usage analytics summary from the JSONL store.
    await runUsageCommand(args.slice(1));
  } else if (args[0] === 'dash' || args[0] === 'dashboard') {
    // `bizar dashboard` is a deprecated alias for `bizar dash`
    if (args[0] === 'dashboard') {
      console.warn(chalk.yellow('  ⚠ `bizar dashboard` is deprecated, use `bizar dash` instead.'));
    }
    const dashArgs = args.slice(1); // everything after 'dash' or 'dashboard'
    if (dashArgs.length === 0 || isHelpRequest) {
      showDashHelp();
    } else {
      await runDash(dashArgs);
    }
  } else if (isHelpRequest) {
    showHelp();
  } else {
    // No args — show help (breaking: previously launched TUI)
    showHelp();
    process.exit(1);
  }
}

// ── Dashboard subcommand ───────────────────────────────────────────────────────

/**
 * Parse dash-specific options from an array of args.
 * Returns { opts, remaining } where opts have --bg / --port stripped.
 */
function parseDashOpts(dashArgs) {
  const opts = { bg: false, port: null, noWeb: false };
  const remaining = [];
  for (let i = 0; i < dashArgs.length; i++) {
    const a = dashArgs[i];
    if (a === '--bg') {
      opts.bg = true;
    } else if (a === '--no-web') {
      opts.noWeb = true;
    } else if (a === '--port' && i + 1 < dashArgs.length) {
      opts.port = Number(dashArgs[i + 1]);
      i++;
    } else {
      remaining.push(a);
    }
  }
  return { opts, remaining };
}

/**
 * Try to load the dashboard CLI module.
 * v4.0.0: the dashboard ships inside this package at bizar-dash/src/cli.mjs.
 * A legacy npm-global fallback is kept for the transitional period.
 */
async function loadDashCli() {
  const { pathToFileURL } = await import('node:url');
  const { join } = await import('node:path');

  const primary = join(import.meta.dirname, '..', 'bizar-dash', 'src', 'cli.mjs');

  // Legacy npm-global fallback (only computed if primary is missing)
  let legacyFallbacks = [];
  try {
    const { execFileSync } = await import('node:child_process');
    const npmRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 5000 }).trim();
    if (npmRoot) legacyFallbacks = [join(npmRoot, '@polderlabs', 'bizar-dash', 'src', 'cli.mjs')];
  } catch { /* npm not available or no globals — fine */ }

  const candidates = [primary, ...legacyFallbacks];

  for (const p of candidates) {
    try {
      const url = pathToFileURL(p).href;
      const mod = await import(url);
      return mod;
    } catch (_e) {
      // try next
    }
  }
  return null;
}

/**
 * Dispatch a dashboard subcommand by loading the dashboard module and
 * calling the appropriate exported function.
 */
async function runDash(dashArgs) {
  const { opts, remaining } = parseDashOpts(dashArgs);
  const sub = remaining[0];
  const subOpts = { ...opts, subArgs: remaining.slice(1) };

  const dashModule = await loadDashCli();
  if (!dashModule) {
    console.error(chalk.red('  ✗ Dashboard not found.'));
    console.error(chalk.dim('  this should not happen — please report a bug at github.com/DrB0rk/BizarHarness/issues'));
    process.exit(1);
  }

  switch (sub) {
    case 'start':
      if (subOpts.bg) {
        // v4.4.0 — Background mode: spawn the dashboard as a detached
        // child process via dashModule.startInBackground(). The child
        // runs `node cli.mjs start --bg` which keeps itself alive via
        // the bg-* pollers and the (v4.4.3) module-scope backgroundHandle.
        await dashModule.startInBackground(['start', ...(subOpts.subArgs || [])]);
      } else {
        await dashModule.start(subOpts);
      }
      break;
    case 'stop':
      await dashModule.stop(subOpts);
      break;
    case 'status':
      await dashModule.status(subOpts);
      break;
    case 'cleanup':
      // v3.20.7 — Find + kill zombie/orphan dashboards.
      // Pass through --force and --kill flags to the dash module.
      await dashModule.cleanup(subOpts);
      break;
    case 'tui':
      await dashModule.tui(subOpts);
      break;
    default:
      console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
      showDashHelp();
      process.exit(1);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

await main().catch((err) => {
  console.error(chalk.red(`bizar: ${err && err.message ? err.message : String(err)}`));
  process.exit(1);
});
