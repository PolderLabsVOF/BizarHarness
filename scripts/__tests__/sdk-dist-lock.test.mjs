import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const ROOT = process.cwd();
const LOCK = join(mkdtempSync(join(tmpdir(), 'bizar-sdk-lock-')), 'lock');
const SCRIPT = join(ROOT, 'scripts', 'with-sdk-dist-lock.mjs');

function invoke(args, env = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      // The retained suite itself runs under the production lock. Child
      // processes here must deliberately acquire the temporary test lock.
      env: {
        ...process.env,
        BIZAR_SDK_DIST_LOCK_HELD: '',
        BIZAR_SDK_DIST_LOCK_DIR: LOCK,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('exit', (code) => resolveRun({ code, stderr }));
  });
}

test('SDK dist lock serializes consumers and recovers stale state', async () => {
  const marker = join(LOCK, '..', 'marker');
  const holder = invoke([process.execPath, '-e', `setTimeout(() => process.exit(0), 250)`]);
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  const started = Date.now();
  const waiter = invoke([process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'done')`]);
  assert.equal((await holder).code, 0);
  assert.equal((await waiter).code, 0);
  assert.ok(Date.now() - started >= 150, 'second consumer must wait for the first');
  assert.equal(existsSync(marker), true);

  mkdirSync(LOCK);
  writeFileSync(join(LOCK, 'owner.json'), '{"pid":999999999}\n');
  const recovered = await invoke([process.execPath, '-e', 'process.exit(0)']);
  assert.equal(recovered.code, 0, recovered.stderr);
  assert.equal(existsSync(LOCK), false, 'stale lock must be cleaned after use');
});
