/**
 * src/server/tailscale-store.mjs
 *
 * v3.0.0 — Tailscale serve control.
 *
 * v3 only does the surface plumbing. The actual `tailscale serve` CLI
 * invocation is wrapped in try/catch with helpful errors.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, hostname as getOsHostname } from 'node:os';

const execFileP = promisify(execFile);
const HOME = homedir();
const SETTINGS_FILE = join(HOME, '.config', 'bizar', 'tailscale.json');

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

function loadSettings() {
  try {
    if (!existsSync(SETTINGS_FILE)) return { enabled: false, port: 4321, https: true, hostname: '' };
    return JSON.parse(readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return { enabled: false, port: 4321, https: true, hostname: '' };
  }
}

function saveSettings(s) {
  try {
    mkdirSync(dirname(SETTINGS_FILE), { recursive: true });
    writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2) + '\n', 'utf8');
  } catch {
    /* ignore */
  }
}

async function tailscaleVersion() {
  try {
    const { stdout } = await execFileP('tailscale', ['version'], { timeout: 5000 });
    return stdout.trim().split('\n')[0] || '';
  } catch {
    return null;
  }
}

async function tailscaleStatus() {
  try {
    const { stdout } = await execFileP('tailscale', ['status', '--json'], { timeout: 5000 });
    const data = JSON.parse(stdout);
    return {
      authenticated: !!data.AuthURL || !!data.Self?.Online,
      backend: data.BackendState || 'unknown',
      hostname: data.Self?.HostName || '',
    };
  } catch {
    return { authenticated: false, backend: 'unknown' };
  }
}

export const tailscaleStore = {
  SETTINGS_FILE,

  async status() {
    const version = await tailscaleVersion();
    const installed = !!version;
    let ts = null;
    if (installed) ts = await tailscaleStatus();
    const cfg = loadSettings();
    return {
      installed,
      version,
      ...ts,
      settings: cfg,
    };
  },

  async enable({ port = 4321, https = true, hostname = '' } = {}) {
    if (!existsSync('/usr/bin/tailscale') && !existsSync('/usr/local/bin/tailscale')) {
      // best-effort detection — `tailscale` may be in $PATH elsewhere
    }
    try {
      // Resolve hostname: use provided value, or fall back to current machine hostname
      const resolvedHostname = hostname || getOsHostname();
      const args = ['serve', '--bg'];
      // Pass hostname via --host flag (Tailscale serve uses this for HTTPS certificate)
      if (resolvedHostname) {
        args.push('--host', resolvedHostname);
      }
      args.push(https ? 'https' : 'http', `localhost:${port}`);
      await execFileP('tailscale', args, { timeout: 10000 });
      const cfg = { enabled: true, port, https, hostname: resolvedHostname };
      saveSettings(cfg);
      return { ok: true, settings: cfg };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  async disable() {
    try {
      await execFileP('tailscale', ['serve', 'reset'], { timeout: 10000 });
      const cfg = loadSettings();
      cfg.enabled = false;
      saveSettings(cfg);
      return { ok: true, settings: cfg };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },
};
