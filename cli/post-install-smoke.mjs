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
 *   6. lightrag-server installed
 *
 * Each check has a 30s timeout. Exits 0 if all pass, 1 otherwise.
 *
 * Public API:
 *   runSmokeTest({ bizarHome, repoPath })
 *     → Promise<{ ok: boolean, checks: CheckResult[] }>
 *
 *   CheckResult: { name: string, ok: boolean, message: string }
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 30_000;
const HOME = homedir();
const DEFAULT_BIZAR_HOME = join(HOME, '.config', 'bizar');
const DEFAULT_MEMORY_VAULT = join(HOME, '.bizar_memory');
const DEFAULT_DASHBOARD_PORT = 4097;
const CLAUDE_DIR = join(HOME, '.claude');

function readJsonSafe(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

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

  // ── 3. Dashboard HTTP responds 200 (with retry) ─────────────────────────────────
  check('dashboard HTTP', async () => {
    const maxAttempts = 5;
    const delayMs = 2000;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, {
            signal: controller.signal,
            method: 'GET',
          });
          clearTimeout(timer);
          if (res.ok) {
            if (attempt > 1) {
              return { ok: true, message: `HTTP ${res.status} on port ${port} (tried ${attempt}x)` };
            }
            return { ok: true, message: `HTTP ${res.status} on port ${port}` };
          }
          lastErr = `HTTP ${res.status} on port ${port} (expected 200)`;
        } catch (err) {
          clearTimeout(timer);
          lastErr = err.name === 'AbortError'
            ? `dashboard not responding on port ${port} (timeout)`
            : `dashboard unreachable on port ${port}: ${err.message}`;
        }
      } catch (err) {
        lastErr = `fetch not available: ${err.message}`;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return { ok: false, message: lastErr || 'dashboard HTTP failed' };
  });

  // ── 4. WebSocket connects (with retry) ────────────────────────────────────────
  check('dashboard WebSocket', async () => {
    const maxAttempts = 5;
    const delayMs = 2000;
    let lastErr = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
          if (attempt > 1) {
            return { ok: true, message: `WebSocket connected at ${url} (tried ${attempt}x)` };
          }
          return { ok: true, message: `WebSocket connected at ${url}` };
        } catch (err) {
          clearTimeout(timer);
          lastErr = err.message === 'timeout'
            ? `WebSocket timeout on ${url}`
            : `WebSocket failed on ${url}: ${err.message}`;
        }
      } catch (err) {
        // ws module not available in this environment — skip
        if (err.code === 'MODULE_NOT_FOUND' || err.message?.includes('ws')) {
          return { ok: true, message: 'ws module not available — skipping WebSocket check' };
        }
        lastErr = `WebSocket check failed: ${err.message}`;
      }
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    return { ok: false, message: lastErr || 'WebSocket failed' };
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

  // ── 6. Premium agents (@paul, @ria) registered at user-level ────────────
  // F-113: syncAgentFiles copies .claude/agents/*.md to ~/.claude/agents/.
  // Without these, the Agent tool cannot resolve @paul / @ria from any
  // session — including the one running this smoke test.
  check('@paul agent registered', () => {
    const fp = join(CLAUDE_DIR, 'agents', 'planner.md');
    if (!existsSync(fp)) {
      return { ok: false, message: `${fp} missing — re-run ./install.sh` };
    }
    return { ok: true, message: '@paul agent registered' };
  });

  check('@ria agent registered', () => {
    const fp = join(CLAUDE_DIR, 'agents', 'ui-designer.md');
    if (!existsSync(fp)) {
      return { ok: false, message: `${fp} missing — re-run ./install.sh` };
    }
    return { ok: true, message: '@ria agent registered' };
  });

  check('@carl agent registered', () => {
    const fp = join(CLAUDE_DIR, 'agents', 'debug-specialist.md');
    if (!existsSync(fp)) {
      return { ok: false, message: `${fp} missing — re-run ./install.sh` };
    }
    return { ok: true, message: '@carl agent registered (last-resort debug, premium)' };
  });

  check('model-router.json synced', () => {
    const fp = join(CLAUDE_DIR, 'model-router.json');
    if (!existsSync(fp)) return { ok: false, message: `${fp} missing — re-run ./install.sh` };
    const data = readJsonSafe(fp, null);
    if (!data || !data.agents || !data.agents.paul || !data.agents.ria || !data.agents.carl) {
      return { ok: false, message: 'paul/ria/carl missing from model-router.json' };
    }
    if (
      data.agents.paul.tier !== 'premium' ||
      data.agents.ria.tier !== 'premium' ||
      data.agents.carl.tier !== 'premium'
    ) {
      return { ok: false, message: 'paul/ria/carl not all at premium tier' };
    }
    return { ok: true, message: 'paul + ria + carl in model-router.json (premium)' };
  });

  check('ANTHROPIC_BASE_URL set in user settings', () => {
    const fp = join(CLAUDE_DIR, 'settings.json');
    if (!existsSync(fp)) return { ok: false, message: `${fp} missing` };
    const data = readJsonSafe(fp, null);
    const url = data?.env?.ANTHROPIC_BASE_URL;
    if (!url || url === 'null') {
      return { ok: false, message: 'ANTHROPIC_BASE_URL not configured' };
    }
    return { ok: true, message: `ANTHROPIC_BASE_URL=${url}` };
  });

  // ── 7. lightrag-server installed ─────────────────────────────────────────
  // Just verify the binary exists — `lightrag-hku` (uv tool) does not
  // reliably support --version across all versions, so we check file
  // presence instead of running it.
  check('lightrag-server', () => {
    const localBin = join(HOME, '.local', 'bin', 'lightrag-server');
    if (existsSync(localBin)) {
      return { ok: true, message: `${localBin} exists` };
    }
    // Also check PATH via shell (covers shims installed by uv tool)
    try {
      const out = execSync('command -v lightrag-server', {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 5000,
        encoding: 'utf8',
      });
      const resolved = (out || '').trim();
      if (resolved) {
        return { ok: true, message: `lightrag-server on PATH: ${resolved}` };
      }
    } catch { /* not on PATH */ }
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
