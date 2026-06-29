/**
 * src/server/memory-git.mjs
 *
 * Thin wrapper around the `git` binary for the Bizar Memory Service.
 * All operations use `child_process.execFileSync` with array args — never
 * string interpolation — to prevent injection vulnerabilities.
 *
 * Operations: isGitInstalled, clone, pull, commit, push, status, acquireLock,
 * addFile, addAll.
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @returns {boolean} true if `git --version` exits 0.
 */
export function isGitInstalled() {
  try {
    execFileSync('git', ['--version'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Clone a remote repository.
 *
 * @param {string} remote — URL or file path of the remote to clone
 * @param {string} targetDir — absolute path to clone into
 * @param {{ branch?: string, depth?: number }} [opts]
 * @returns {{ ok: boolean, output: string, error?: string }}
 */
export function clone(remote, targetDir, { branch = 'main', depth = 1 } = {}) {
  try {
    const args = ['clone', '--branch', branch, '--depth', String(depth), remote, targetDir];
    const output = execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: '', error: err.message };
  }
}

/**
 * Pull changes into a local working directory.
 *
 * @param {string} dir — working directory (must be a git repo)
 * @param {{ rebase?: boolean }} [opts]
 * @returns {{ ok: boolean, output: string, error?: string }}
 */
export function pull(dir, { rebase = true } = {}) {
  try {
    const args = rebase ? ['pull', '--rebase'] : ['pull', '--ff-only'];
    const output = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: '', error: err.message };
  }
}

/**
 * Commit staged changes.
 *
 * @param {string} dir — working directory
 * @param {string} message — commit message
 * @param {{ author?: string }} [opts]
 * @returns {{ ok: boolean, output: string, error?: string }}
 */
export function commit(dir, message, { author } = {}) {
  try {
    const args = ['commit', '-m', message];
    if (author) {
      args.push('--author', author);
    }
    const output = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: '', error: err.message };
  }
}

/**
 * Push commits to a remote.
 *
 * @param {string} dir
 * @param {{ remote?: string, branch?: string }} [opts]
 * @returns {{ ok: boolean, output: string, error?: string }}
 */
export function push(dir, { remote = 'origin', branch = 'main' } = {}) {
  try {
    const output = execFileSync(
      'git',
      ['push', remote, branch],
      { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return { ok: true, output };
  } catch (err) {
    return { ok: false, output: '', error: err.message };
  }
}

/**
 * Get the current git status for a repository.
 *
 * @param {string} dir
 * @returns {{ ok: boolean, clean: boolean, branch: string, ahead: number, behind: number, modified: string[], untracked: string[], error?: string }}
 */
export function status(dir) {
  try {
    // Get branch name
    let branch = 'main';
    try {
      branch = execFileSync('git', ['branch', '--show-current'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch { /* ignore */ }

    // Get status --porcelain
    const raw = execFileSync('git', ['status', '--porcelain'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const modified = [];
    const untracked = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      const path = line.slice(3);
      if (code === '??') {
        untracked.push(path);
      } else {
        modified.push(path);
      }
    }

    // Get ahead/behind vs tracking branch
    let ahead = 0;
    let behind = 0;
    try {
      const revparse = execFileSync('git', ['revparse', '--abbrev-ref', '@{upstream}'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      if (revparse) {
        const aheadBehind = execFileSync('git', ['rev-list', '--left-right', '--count', `${branch}...${revparse}`], {
          cwd: dir,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        const [a, b] = aheadBehind.split('\t').map(Number);
        ahead = a || 0;
        behind = b || 0;
      }
    } catch { /* no upstream */ }

    return {
      ok: true,
      clean: modified.length === 0 && untracked.length === 0,
      branch,
      ahead,
      behind,
      modified,
      untracked,
    };
  } catch (err) {
    return { ok: false, clean: false, branch: 'main', ahead: 0, behind: 0, modified: [], untracked: [], error: err.message };
  }
}

/**
 * Acquire a per-repo mutex lockfile. Returns a release function or an error.
 * The lock file contains { pid, startedAt }. If another live PID holds the lock,
 * returns { error: 'locked' }.
 *
 * @param {string} repoDir — the git repository root
 * @returns {{ release: () => void } | { error: 'locked' }}
 */
export function acquireLock(repoDir) {
  const lockPath = join(repoDir, '.sync.lock');
  const pid = process.pid;
  const startedAt = Date.now();

  if (existsSync(lockPath)) {
    try {
      const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
      // Check if the PID is still alive
      try {
        process.kill(lockData.pid, 0);
        // Still alive — someone else holds the lock
        return { error: 'locked' };
      } catch {
        // PID is dead — stale lock, we'll take over
      }
    } catch { /* corrupt lockfile — take over */ }
  }

  writeFileSync(lockPath, JSON.stringify({ pid, startedAt }), 'utf8');

  const release = () => {
    try {
      if (existsSync(lockPath)) {
        const lockData = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (lockData.pid === pid) {
          unlinkSync(lockPath);
        }
      }
    } catch { /* ignore */ }
  };

  return { release };
}

/**
 * Stage a single file for commit.
 *
 * @param {string} dir — working directory
 * @param {string} filePath — path relative to dir
 * @returns {{ ok: boolean, error?: string }}
 */
export function addFile(dir, filePath) {
  try {
    execFileSync('git', ['add', filePath], { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Stage all changes (including untracked) for commit.
 *
 * @param {string} dir
 * @returns {{ ok: boolean, error?: string }}
 */
export function addAll(dir) {
  try {
    execFileSync('git', ['add', '-A'], { cwd: dir, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
