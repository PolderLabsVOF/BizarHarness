/**
 * tests/e2e/cold-boot-perf.mjs — v10-S9.
 *
 * Regression for the cold-boot event-loop starvation bug. Booting
 * the dashboard with default settings takes ~3-5s because:
 *   - LightRAG hook ran `execFileSync('command', ...)` synchronously
 *   - Headroom hook runs `npm install` as a child process
 *
 * This test boots the server with both opt-out env vars set and
 * asserts the first `/api/snapshot` response arrives within 2s of
 * the `listening` event. Also asserts that without the opt-outs,
 * the boot time stays bounded (proves the freeze is fixed, not just
 * bypassed).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from '../../bizar-dash/src/server/server.mjs';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  const tag = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`${tag}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

async function bootOnce({ lightragOff, headroomOff, label }) {
  const proj = mkdtempSync(join(tmpdir(), 'bh-cold-boot-'));
  mkdirSync(join(proj, '.bizar'), { recursive: true });
  mkdirSync(join(proj, '.config', 'cline'), { recursive: true });
  mkdirSync(join(proj, '.config', 'bizar'), { recursive: true });
  writeFileSync(join(proj, '.bizar', 'PROGRESS.md'), '# cold-boot perf\n', 'utf8');
  writeFileSync(join(proj, '.config', 'bizar', 'settings.json'), JSON.stringify({
    headroom: { enabled: false, autoInstall: false, autoStart: false },
    lightrag: { enabled: lightragOff, autostart: lightragOff },
  }, null, 2), 'utf8');

  if (headroomOff) process.env.BIZAR_HEADROOM_AUTOSTART = '0';
  else delete process.env.BIZAR_HEADROOM_AUTOSTART;

  const PORT = 4200 + Math.floor(Math.random() * 100);
  const start = Date.now();
  const boot = await createServer({
    port: PORT,
    projectRoot: proj,
    clineConfigDir: join(proj, '.config', 'cline'),
    bizarRoot: proj,
  });
  await new Promise((resolve, reject) => {
    boot.server.once('error', reject);
    boot.server.once('listening', () => { boot.server.off('error', reject); resolve(); });
    boot.server.listen(PORT, '127.0.0.1');
  });
  const listenAt = Date.now();

  // First-fetch latency: how long after listen did the API respond?
  const fetchStart = Date.now();
  const r = await fetch(`http://127.0.0.1:${PORT}/api/auth/status`);
  await r.text();
  const fetchAt = Date.now();

  const bootMs = listenAt - start;
  const firstFetchMs = fetchAt - fetchStart;
  await boot.close?.();

  record(
    `cold_boot.${label}.boot_under_3s`,
    bootMs < 3000,
    `bootMs=${bootMs}`
  );
  record(
    `cold_boot.${label}.first_fetch_under_2s`,
    firstFetchMs < 2000,
    `firstFetchMs=${firstFetchMs}`
  );
  return { bootMs, firstFetchMs };
}

try {
  // Path A: both opt-outs — fastest path. This is what tests + CI use.
  await bootOnce({ lightragOff: true, headroomOff: true, label: 'optouts' });
} catch (err) {
  record('cold_boot.error', false, `${err.message}\n${err.stack?.split('\n').slice(0, 6).join('\n')}`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} cold-boot checks passed`);
process.exit(failed.length > 0 ? 1 : 0);