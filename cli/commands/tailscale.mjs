/**
 * cli/commands/tailscale.mjs
 *
 * v5.2 — Tailscale auth key integration for the dashboard.
 *
 * When TAILSCALE_AUTHKEY is set (or BIZAR_TAILSCALE_AUTOSETUP=1), the
 * dashboard auto-configures `tailscale serve` on startup so the user
 * doesn't need to run `sudo tailscale serve ...` manually.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';

const TS_AUTHKEY = process.env.TAILSCALE_AUTHKEY;
const TS_STATE_DIR = process.env.TAILSCALE_STATE_DIR || join(homedir(), '.local', 'share', 'bizar', 'tailscale');
const TS_SERVE_CONFIG = join(TS_STATE_DIR, 'serve.json');

function ensureStateDir() {
  try {
    mkdirSync(TS_STATE_DIR, { recursive: true });
  } catch { /* ignore */ }
}

/**
 * Check if tailscale binary exists and is executable.
 */
export function isTailscaleInstalled() {
  try {
    execFileSync('tailscale', ['version'], { encoding: 'utf8', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if already authenticated with Tailscale.
 * Returns { authenticated, hostname, backendState }.
 */
export async function ensureTailscaleAuth() {
  if (!isTailscaleInstalled()) {
    return { authenticated: false, message: 'Tailscale not installed' };
  }
  try {
    const result = execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
    const status = JSON.parse(result);
    return {
      authenticated: !!status.Self?.Online,
      hostname: (status.Self?.DNSName || '').split('.')[0],
      backendState: status.BackendState || 'unknown',
    };
  } catch {
    if (!TS_AUTHKEY) {
      return { authenticated: false, message: 'No TAILSCALE_AUTHKEY env var set' };
    }
    // Authenticate with auth key
    console.log(chalk.dim('  Authenticating with Tailscale...'));
    try {
      execFileSync('tailscale', ['up', '--authkey=' + TS_AUTHKEY, '--hostname=bizar-dash'], { encoding: 'utf8', timeout: 60000 });
      return { authenticated: true, hostname: 'bizar-dash' };
    } catch (err) {
      return { authenticated: false, message: 'Auth failed: ' + (err.message || String(err)) };
    }
  }
}

/**
 * Set up tailscale serve for the dashboard.
 */
export async function setupTailscaleServe({ dashboardPort = 4097, path = '/', https = 443 }) {
  const authResult = await ensureTailscaleAuth();
  if (!authResult.authenticated) {
    console.error(chalk.red('  ✗ Tailscale not authenticated'));
    return { ok: false, reason: 'not_authenticated' };
  }

  // Remove existing serve config
  try {
    execFileSync('tailscale', ['serve', '--https=443', 'off'], { encoding: 'utf8', timeout: 5000 });
  } catch { /* ignore — might not have existing config */ }

  // Set up new serve config
  // v5.3.1 — Use --set-x-forwarded-for=trailing so the dashboard sees
  // the original client IP (a 100.x Tailscale address) in X-Forwarded-For.
  // Without this, the dashboard can't tell that the request came from
  // a trusted tailnet client and demands a bearer token.
  try {
    execFileSync('tailscale', [
      'serve', '--bg',
      `--https=${https}`,
      `--set-path=${path}`,
      '--set-x-forwarded-for=trailing',
      `http://localhost:${dashboardPort}`,
    ], { encoding: 'utf8', timeout: 30000 });
  } catch (err) {
    return { ok: false, reason: 'serve_setup_failed', error: err.message };
  }

  // Get the public URL
  try {
    const statusResult = execFileSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
    const status = JSON.parse(statusResult);
    const url = `https://${(status.Self?.DNSName || '').split('.')[0]}`;

    // Save config
    ensureStateDir();
    writeFileSync(TS_SERVE_CONFIG, JSON.stringify({
      url,
      port: dashboardPort,
      https,
      path,
      setAt: new Date().toISOString(),
    }, null, 2));

    return { ok: true, url };
  } catch (err) {
    return { ok: false, reason: 'status_check_failed', error: err.message };
  }
}

/**
 * Remove tailscale serve configuration.
 */
export function unsetupTailscaleServe() {
  try {
    execFileSync('tailscale', ['serve', 'reset'], { encoding: 'utf8', timeout: 10000 });
    // Remove saved config
    if (existsSync(TS_SERVE_CONFIG)) {
      try { unlinkSync(TS_SERVE_CONFIG); } catch { /* ignore */ }
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Print the saved serve URL (if any).
 */
export function getServeUrl() {
  try {
    if (existsSync(TS_SERVE_CONFIG)) {
      const cfg = JSON.parse(readFileSync(TS_SERVE_CONFIG, 'utf8'));
      return cfg.url || null;
    }
  } catch { /* ignore */ }
  return null;
}

export function showTailscaleStatus() {
  if (!isTailscaleInstalled()) {
    console.error(chalk.red('  ✗ tailscale not found or not installed'));
    console.error('  Install: https://tailscale.com/download');
    return;
  }
  try {
    const result = execFileSync('tailscale', ['status'], { encoding: 'utf8', timeout: 5000 });
    console.log(result);

    // Also show serve URL if configured
    const url = getServeUrl();
    if (url) {
      console.log(chalk.dim(`  Serve URL: ${url}`));
    }
  } catch (err) {
    console.error(chalk.red('  ✗ Failed to get tailscale status'));
    console.error('  ', err.message);
  }
}

export function showTailscaleHelp() {
  console.log(`
  bizar tailscale — Manage Tailscale integration for the dashboard

  Usage:
    bizar tailscale status              Show Tailscale auth + serve status
    bizar tailscale auth                Authenticate with auth key (from env TAILSCALE_AUTHKEY)
    bizar tailscale serve               Set up tailscale serve for the dashboard
    bizar tailscale unserve             Remove tailscale serve
    bizar tailscale url                 Print the public dashboard URL

  Env vars:
    TAILSCALE_AUTHKEY                   Auth key for non-interactive auth
    TAILSCALE_STATE_DIR                 Where to store Tailscale state (default ~/.local/share/bizar/tailscale)
    BIZAR_TAILSCALE_AUTOSETUP=1        Auto-setup tailscale serve when running 'bizar dash start'

  Examples:
    TAILSCALE_AUTHKEY=tskey-... bizar tailscale auth
    TAILSCALE_AUTHKEY=tskey-... bizar tailscale serve
    bizar tailscale unserve
  `);
}

/**
 * Main entry point for the `bizar tailscale` CLI command.
 */
export async function run(name, args, isHelpRequest) {
  if (isHelpRequest || args.length === 0 || args[0] === 'help') {
    showTailscaleHelp();
    return;
  }

  const sub = args[0];

  switch (sub) {
    case 'status': {
      showTailscaleStatus();
      break;
    }
    case 'auth': {
      const result = await ensureTailscaleAuth();
      if (result.authenticated) {
        console.log(chalk.green(`  ✓ Authenticated as ${result.hostname}`));
      } else {
        console.error(chalk.red(`  ✗ Not authenticated: ${result.message}`));
        if (!TS_AUTHKEY) {
          console.error(chalk.dim('  Set TAILSCALE_AUTHKEY env var and try again'));
        }
      }
      break;
    }
    case 'serve': {
      const result = await setupTailscaleServe({ dashboardPort: 4321 });
      if (result.ok) {
        console.log(chalk.green(`  ✓ Tailscale serve: ${result.url}`));
      } else {
        console.error(chalk.red(`  ✗ Serve setup failed: ${result.reason}`));
      }
      break;
    }
    case 'unset': {
      const result = unsetupTailscaleServe();
      if (result.ok) {
        console.log(chalk.green('  ✓ Tailscale serve removed'));
      } else {
        console.error(chalk.red(`  ✗ ${result.error}`));
      }
      break;
    }
    case 'url': {
      const url = getServeUrl();
      if (url) {
        console.log(url);
      } else {
        console.error(chalk.red('  ✗ No serve URL configured'));
      }
      break;
    }
    default: {
      console.error(chalk.red(`  ✗ Unknown subcommand: ${sub}`));
      showTailscaleHelp();
    }
  }
}
