/**
 * cli/post-install-smoke.mjs
 *
 * v5.x — Post-install smoke test for BizarHarness.
 *
 * Verifies the installation is functional by checking:
 *   1. Memory vault exists and is git-initialized
 *   2. `bizar doctor` exits 0
 *   3. Dashboard HTTP responds 200
 *   4. WebSocket connects to dashboard
 *   5. `bizar bg list` returns (even if empty)
 *   6. lightrag-server --version works
 *
 * Each check has a 30s timeout. Exits 0 if all pass, 1 otherwise.
 *
 * Public API:
 *   runSmokeTest({ bizarHome, repoPath })
 *     → Promise<{ ok: boolean, checks: CheckResult[] }>
 *
 *   CheckResult: { name: string, ok: boolean, message: string }
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const HOME = homedir();
const DEFAULT_BIZAR_HOME = join(HOME, '.config', 'bizar');
const DEFAULT_MEMORY_VAULT = join(HOME, '.bizar_memory');
const DEFAULT_DASHBOARD_PORT = 4097;

/**
 * @param {object} opts
 * @param {string} [opts.bizarHome]
 * @param {string} [opts.repoPath]
 * @param {number} [opts.timeoutMs]
 */
export async function runSmokeTest({ bizarHome, repoPath, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const bh = bizarHome || DEFAULT_BIZAR_HOME;
  const mv = process.env.BIZAR_MEMORY_VAULT || DEFAULT_MEMORY_VAULT;
  const port = parseInt(process.env.BIZAR_DASHBOARD_PORT || String(DEFAULT_DASHBOARD_PORT), 10) || DEFAULT_DASHBOARD_PORT;
  const checks = [];

  function check(name, fn) {
    try {
      const result = fn();
      checks.push({ name, ok: result.ok, message: result.message || '' });
    } catch (err) {
      checks.push({ name, ok: false, message: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── 1. Memory vault exists and is git-initialised ───────────────────────
  check('memory vault exists', () => {
    if (!existsSync(mv)) {
      return { ok: false, message: `${mv} does not exist` };
    }
    const gitDir = join(mv, '.git');
    if (!existsSync(gitDir)) {
      return { ok: false, message: `${mv} is not git-initialized (run: git init)` };
    }
    return { ok: true, message: `${mv} present and git-initialized` };
  });

  // ── 2. `bizar doctor` exits 0 ────────────────────────────────────────────
  check('bizar doctor', () => {
    try {
      execSync('bizar doctor', {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        encoding: 'utf8',
      });
      return { ok: true, message: 'bizar doctor passed' };
    } catch (err) {
      const status = err.status;
      const msg = err.stderr || err.message;
      if (status === 0) return { ok: true, message: 'bizar doctor passed' };
      return { ok: false, message: `bizar doctor failed (exit ${status}): ${msg}`.slice(0, 200) };
    }
  });

  // ── 3. Dashboard HTTP responds 200 ─────────────────────────────────────────
  check('dashboard HTTP', async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`, {
          signal: controller.signal,
          method: 'GET',
        });
        clearTimeout(timer);
        if (res.ok) return { ok: true, message: `HTTP ${res.status} on port ${port}` };
        return { ok: false, message: `HTTP ${res.status} on port ${port} (expected 200)` };
      } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
          return { ok: false, message: `dashboard not responding on port ${port} (timeout)` };
        }
        return { ok: false, message: `dashboard unreachable on port ${port}: ${err.message}` };
      }
    } catch (err) {
      return { ok: false, message: `fetch not available: ${err.message}` };
    }
  });

  // ── 4. WebSocket connects ──────────────────────────────────────────────────
  check('dashboard WebSocket', async () => {
    try {
      const { WebSocket } = await import('ws' in globalThis
        ? { ws: globalThis.ws, WebSocket: globalThis.WebSocket }
        : await import(`ws`).then(m => ({ ws: m, WebSocket: m.WebSocket || m.default }))
      );
      const url = `ws://127.0.0.1:${port}/ws`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const ws = new WebSocket(url);
        await new Promise((resolve, reject) => {
          ws.on('open', resolve);
          ws.on('error', reject);
          ws.on('close', () => reject(new Error('closed before open')));
          controller.signal.addEventListener('abort', () => {
            ws.close();
            reject(new Error('timeout'));
          });
        });
        clearTimeout(timer);
        ws.close();
        return { ok: true, message: `WebSocket connected at ${url}` };
      } catch (err) {
        clearTimeout(timer);
        if (err.message === 'timeout') {
          return { ok: false, message: `WebSocket timeout on ${url}` };
        }
        return { ok: false, message: `WebSocket failed on ${url}: ${err.message}` };
      }
    } catch (err) {
      // ws module not available in this environment — skip
      if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('ws')) {
        return { ok: true, message: 'ws module not available — skipping WebSocket check' };
      }
      return { ok: false, message: `WebSocket check failed: ${err.message}` };
    }
  });

  // ── 5. `bizar bg list` returns ────────────────────────────────────────────
  check('background agents', () => {
    try {
      execSync('bizar bg list', {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        encoding: 'utf8',
      });
      return { ok: true, message: 'bizar bg list succeeded' };
    } catch (err) {
      return { ok: false, message: `bizar bg list failed: ${(err.stderr || err.message || '').slice(0, 200)}` };
    }
  });

  // ── 6. lightrag-server --version ──────────────────────────────────────────
  check('lightrag-server', () => {
    const candidates = ['lightrag-server'];
    if (process.env.HOME) {
      candidates.push(join(process.env.HOME, '.local', 'bin', 'lightrag-server'));
    }
    let found = false;
    for (const cmd of candidates) {
      try {
        const out = execFileSync(cmd, ['--version'], {
          encoding: 'utf8',
          timeout: 5000,
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        found = true;
        return { ok: true, message: `${cmd} responds: ${(out || '').trim().slice(0, 100)}` };
      } catch { /* try next */ }
    }
    return { ok: false, message: 'lightrag-server not found in PATH or ~/.local/bin/' };
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  const passed = checks.filter(c => c.ok).length;
  const failed = checks.filter(c => !c.ok).length;
  const allOk = failed === 0;

  for (const c of checks) {
    const marker = c.ok ? '✓' : '✗';
    const msg = c.message ? `  ${marker} ${c.name}: ${c.message}` : `  ${marker} ${c.name}`;
    if (c.ok) {
      console.log(`\x1b[32m${msg}\x1b[0m`);
    } else {
      console.log(`\x1b[31m${msg}\x1b[0m`);
    }
  }

  console.log(`\nSmoke test: ${passed} passed, ${failed} failed`);
  return { ok: allOk, checks, passed, failed };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const isMain = Boolean(process.argv[1]) && process.argv[1].endsWith('post-install-smoke.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const json = args.includes('--json');

  if (dryRun) {
    console.log('[dry-run] would run smoke test');
    process.exit(0);
  }

  runSmokeTest().then(result => {
    if (json) {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    }
    process.exit(result.ok ? 0 : 1);
  }).catch(err => {
    if (json) {
      console.error(JSON.stringify({ error: err.message }));
    } else {
      console.error(`Smoke test error: ${err.message}`);
    }
    process.exit(1);
  });
}
