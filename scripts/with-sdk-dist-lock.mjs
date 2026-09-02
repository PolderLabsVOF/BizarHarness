#!/usr/bin/env node
/**
 * Serialise commands that rebuild or consume packages/sdk/dist.
 *
 * TypeScript output is deliberately rebuilt from scratch, so overlapping
 * build-and-test processes can otherwise observe an empty or partial dist/
 * directory. The lock is kept in node_modules/.cache: it is local to this
 * checkout, ignored by Git, and never enters a package tarball.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const LOCK_DIR = process.env.BIZAR_SDK_DIST_LOCK_DIR
  || join(ROOT, 'node_modules', '.cache', 'bizar-sdk-dist.lock');
const OWNER_FILE = join(LOCK_DIR, 'owner.json');
const RETRY_MS = 25;
const TIMEOUT_MS = Number(process.env.BIZAR_SDK_DIST_LOCK_TIMEOUT_MS || 120_000);

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function ownerIsAlive() {
  try {
    const { pid } = JSON.parse(readFileSync(OWNER_FILE, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return false;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means a real process exists but belongs to another user. Any parse,
    // read, or ESRCH failure is stale lock state and is safe to recover.
    return error?.code === 'EPERM';
  }
}

async function acquire() {
  const deadline = Date.now() + TIMEOUT_MS;
  mkdirSync(dirname(LOCK_DIR), { recursive: true });
  while (true) {
    try {
      mkdirSync(LOCK_DIR);
      writeFileSync(OWNER_FILE, `${JSON.stringify({ pid: process.pid })}\n`, { mode: 0o600 });
      return;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      if (!ownerIsAlive()) {
        // Rename claims stale state atomically. Deleting LOCK_DIR directly
        // would let two waiters erase a newly acquired lock between checks.
        const staleDir = `${LOCK_DIR}.stale-${process.pid}-${randomUUID()}`;
        try {
          renameSync(LOCK_DIR, staleDir);
          rmSync(staleDir, { recursive: true, force: true });
        } catch (recoveryError) {
          if (recoveryError?.code !== 'ENOENT') throw recoveryError;
        }
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`timed out waiting for SDK dist lock: ${LOCK_DIR}`);
      }
      await sleep(RETRY_MS);
    }
  }
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      env: { ...process.env, BIZAR_SDK_DIST_LOCK_HELD: '1' },
      stdio: 'inherit',
    });
    child.once('error', rejectRun);
    child.once('exit', (code, signal) => resolveRun(code ?? (signal ? 1 : 0)));
  });
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: with-sdk-dist-lock.mjs <command> [args...]');
  process.exitCode = 2;
} else if (process.env.BIZAR_SDK_DIST_LOCK_HELD === '1') {
  process.exitCode = await run(command, args);
} else {
  let acquired = false;
  try {
    await acquire();
    acquired = true;
    process.exitCode = await run(command, args);
  } finally {
    if (acquired) rmSync(LOCK_DIR, { recursive: true, force: true });
  }
}
