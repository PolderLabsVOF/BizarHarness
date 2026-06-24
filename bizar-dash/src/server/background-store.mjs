/**
 * src/server/background-store.mjs
 *
 * v3.2.0 — Bridge from the dashboard to the opencode plugin's
 * background-agent infrastructure.
 *
 * What this store actually does:
 *   1. Lists bg instances by walking the plugin's bg state directory
 *      (defaults to `~/.cache/bizar/bg/` per the plugin spec).
 *   2. Optionally attaches tmux session hints when a tmux session
 *      named `bizar-bg-<id>` happens to exist. The plugin does NOT
 *      itself use tmux — instances are HTTP sessions — but tmux
 *      sessions may be attached by operators running the plugin
 *      under `bizar serve` for live monitoring. We surface them
 *      when present and degrade gracefully when not.
 *   3. Supports best-effort `sendMessage` / `kill` via tmux when the
 *      session exists. Both operations are no-ops when there's no
 *      tmux session — they NEVER fail the request.
 *
 * All I/O is defensive: missing files, corrupt JSON, missing tmux —
 * everything is handled silently and the API returns an empty list
 * rather than a 500.
 */

import {
  readFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HOME = homedir();

// Bg state directories, ordered by likelihood. First match wins.
// Matches plugins/bizar/src/background-state.ts (default `~/.cache/bizar`).
const BG_DIRS = [
  join(HOME, '.cache', 'bizar', 'bg'),
  join(HOME, '.config', 'opencode', 'bg'),
  join(HOME, '.bizar', 'bg'),
];

function pickBgDir() {
  for (const dir of BG_DIRS) {
    if (existsSync(dir)) return dir;
  }
  return BG_DIRS[0];
}

function safeReadJSON(file, fallback = null) {
  try {
    if (!existsSync(file)) return fallback;
    const text = readFileSync(file, 'utf8');
    if (!text.trim()) return fallback;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function tmuxSessionFor(instanceId) {
  return `bizar-bg-${instanceId}`;
}

function tmuxHasSession(sessionName) {
  try {
    execFileSync('tmux', ['has-session', '-t', sessionName], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export const backgroundStore = {
  BG_DIRS,

  /**
   * List all bg instances across the candidate dirs. Each entry is
   * the raw plugin state file enriched with tmux hints (when
   * applicable).
   */
  list() {
    const out = [];
    for (const dir of BG_DIRS) {
      if (!existsSync(dir)) continue;
      let files;
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      for (const f of files) {
        const full = join(dir, f);
        let st;
        try {
          st = statSync(full);
        } catch {
          continue;
        }
        const data = safeReadJSON(full, null);
        if (!data) continue;
        const instanceId = data.instanceId || f.replace(/\.json$/, '');
        const sessionName = tmuxSessionFor(instanceId);
        const tmuxActive = tmuxHasSession(sessionName);
        out.push({
          ...data,
          _bgDir: dir,
          _mtime: st.mtimeMs,
          _file: full,
          tmuxSession: sessionName,
          tmuxActive,
        });
      }
    }
    // Sort: pending/running first, then by start time desc.
    out.sort((a, b) => {
      const order = { pending: 0, running: 1, done: 2, failed: 3, killed: 4, timed_out: 5 };
      const ao = order[a.status] ?? 9;
      const bo = order[b.status] ?? 9;
      if (ao !== bo) return ao - bo;
      return (b.startedAt || b._mtime || 0) - (a.startedAt || a._mtime || 0);
    });
    return out;
  },

  /**
   * Read a single bg instance by id. Searches all candidate dirs.
   */
  get(instanceId) {
    for (const dir of BG_DIRS) {
      const file = join(dir, `${instanceId}.json`);
      if (existsSync(file)) {
        const data = safeReadJSON(file, null);
        if (data) {
          const sessionName = tmuxSessionFor(instanceId);
          return {
            ...data,
            _bgDir: dir,
            _file: file,
            tmuxSession: sessionName,
            tmuxActive: tmuxHasSession(sessionName),
          };
        }
      }
    }
    return null;
  },

  /**
   * Best-effort: send a line of text into the tmux session for an
   * instance. No-op when there's no session.
   */
  sendMessage(instanceId, message) {
    const session = tmuxSessionFor(instanceId);
    if (!tmuxHasSession(session)) {
      return { ok: false, error: 'no tmux session for instance', session };
    }
    try {
      const msg = String(message || '');
      // Use tmux's literal mode (`-l`) and pass the message as a single
      // arg via execFileSync — no shell interpolation, so payloads like
      // `"; cat /etc/passwd #` cannot break out.
      execFileSync(
        'tmux',
        ['send-keys', '-l', '-t', session, msg, 'Enter'],
        { stdio: 'pipe', timeout: 5_000 },
      );
      return { ok: true, session };
    } catch (err) {
      return { ok: false, error: err.message, session };
    }
  },

  /**
   * Best-effort: kill the tmux session for an instance.
   * The plugin's session is HTTP-based, so this only stops the
   * terminal attach; the underlying opencode session continues
   * unless the operator also aborts it.
   */
  async kill(instanceId) {
    const steps = [];
    const inst = this.get(instanceId);
    if (!inst) {
      return { ok: false, error: 'instance not found', instanceId, steps };
    }

    let ok = true;
    const session = tmuxSessionFor(instanceId);

    if (inst.sessionId) {
      try {
        const { readServeInfo, abortSession } = await import('./serve-info.mjs');
        const serveInfo = readServeInfo();
        if (!serveInfo) {
          ok = false;
          steps.push({ step: 'abort-session', ok: false, note: 'serve-info unavailable' });
        } else {
          const aborted = await abortSession(
            serveInfo,
            inst.sessionId,
            inst.worktree || serveInfo.worktree,
          );
          steps.push({ step: 'abort-session', ...aborted });
          if (!aborted.ok) ok = false;
        }
      } catch (err) {
        ok = false;
        steps.push({ step: 'abort-session', ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ step: 'abort-session', ok: true, note: 'no opencode session id present' });
    }

    if (inst._file && existsSync(inst._file)) {
      try {
        unlinkSync(inst._file);
        steps.push({ step: 'delete-state-file', ok: true, file: inst._file });
      } catch (err) {
        ok = false;
        steps.push({ step: 'delete-state-file', ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ step: 'delete-state-file', ok: true, note: 'state file already absent' });
    }

    if (tmuxHasSession(session)) {
      try {
        execFileSync('tmux', ['kill-session', '-t', session], { stdio: 'pipe', timeout: 5_000 });
        steps.push({ step: 'kill-tmux', ok: true, session });
      } catch (err) {
        ok = false;
        steps.push({ step: 'kill-tmux', ok: false, session, error: err instanceof Error ? err.message : String(err) });
      }
    } else {
      steps.push({ step: 'kill-tmux', ok: true, session, note: 'no tmux session present' });
    }

    return { ok, instanceId, session, steps };
  },

  /**
   * v3.5.5 — Return tmux session metadata for the API layer to
   * expose as `GET /api/background/:id/tmux`. Always returns the
   * computed session name so the UI can render an "Attach" button
   * even when the session doesn't exist (the button just opens a
   * new detached session that shares the same name).
   *
   * @param {string} instanceId
   * @returns {{ exists: boolean, session: string, attachCommand: string, attachUrl: string }}
   */
  tmuxAttachInfo(instanceId) {
    const session = tmuxSessionFor(instanceId);
    return {
      exists: tmuxHasSession(session),
      session,
      attachCommand: `tmux attach -t ${session}`,
      attachUrl: `tmux://${session}`,
    };
  },

  /**
   * v3.5.5 — Spawn a tmux session that wraps the agent run. Used
   * by the task delegator so operators can `tmux attach -t …` and
   * watch the opencode process in real time. The session is named
   * `bizar-bg-<id>` and runs the supplied shell command inside
   * the optional `cwd`.
   *
   * Returns `{ ok, session, error? }`. Never throws — failures are
   * logged and reported so the dispatch path can keep going.
   *
   * @param {string} instanceId
   * @param {string} command
   * @param {string} [cwd]
   */
  spawnTmuxFor(instanceId, command, cwd) {
    const session = tmuxSessionFor(instanceId);
    if (tmuxHasSession(session)) {
      return { ok: true, session, note: 'session already existed' };
    }
    const spec =
      command && typeof command === 'object' && !Array.isArray(command)
        ? command
        : { command, args: [] };
    const executable = typeof spec.command === 'string' ? spec.command.trim() : '';
    const args = Array.isArray(spec.args) ? spec.args.map((arg) => String(arg)) : [];
    const workdir = cwd && typeof cwd === 'string' ? cwd : '';
    if (!executable) {
      return {
        ok: false,
        session,
        error: 'command is required',
      };
    }
    try {
      const tmuxArgs = ['new-session', '-d', '-s', session, '-x', '220', '-y', '50'];
      if (workdir) tmuxArgs.push('-c', workdir);
      tmuxArgs.push(executable, ...args);
      execFileSync(
        'tmux',
        tmuxArgs,
        { stdio: 'ignore', timeout: 5_000 },
      );
      return { ok: true, session };
    } catch (err) {
      return { ok: false, session, error: err instanceof Error ? err.message : String(err) };
    }
  },

  /**
   * Capture the tail of the tmux session for an instance.
   */
  captureOutput(instanceId, lines = 50) {
    const session = tmuxSessionFor(instanceId);
    if (!tmuxHasSession(session)) {
      return { ok: false, error: 'no tmux session for instance', session, output: '' };
    }
    try {
      const safeLines = String(Math.max(1, Math.min(500, lines)));
      const out = execFileSync(
        'tmux',
        ['capture-pane', '-t', session, '-p', '-S', `-${safeLines}`],
        { encoding: 'utf8', timeout: 5_000 },
      );
      return { ok: true, session, output: out };
    } catch (err) {
      return { ok: false, error: err.message, session, output: '' };
    }
  },

  /**
   * v3.11.1 — Kill the tmux session for an instance if one exists.
   * No-op when the session is absent or tmux is not installed. Returns
   * `{ ok, session, killed, error? }` so callers can log a structured
   * result. Used by the bg-retry janitor and `cleanup()` to ensure
   * terminal instances don't leave dangling tmux panes.
   *
   * @param {string} instanceId
   * @returns {{ ok: boolean, session: string, killed: boolean, error?: string }}
   */
  killTmuxFor(instanceId) {
    const session = tmuxSessionFor(instanceId);
    if (!tmuxHasSession(session)) {
      return { ok: true, session, killed: false, note: 'no session present' };
    }
    try {
      execFileSync('tmux', ['kill-session', '-t', session], { stdio: 'pipe', timeout: 5_000 });
      return { ok: true, session, killed: true };
    } catch (err) {
      return {
        ok: false,
        session,
        killed: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  /** The attach command (for the UI to display). */
  attachCommand(instanceId) {
    return `tmux attach -t ${tmuxSessionFor(instanceId)}`;
  },

  /** Diagnostics: which bg dir is being used right now. */
  status() {
    const dir = pickBgDir();
    const exists = existsSync(dir);
    let count = 0;
    if (exists) {
      try {
        count = readdirSync(dir).filter((f) => f.endsWith('.json')).length;
      } catch {
        count = 0;
      }
    }
    return { dir, exists, count };
  },

  /**
   * v0.5.5 — Delete state files for terminal instances older than
   * `maxAgeDays`. Iterates all BG_DIRS. Non-terminal instances are
   * NEVER removed. Returns the total deleted count.
   *
   * v3.11.1 — Also kills the tmux session for each terminal instance
   * (even those NOT yet old enough for state-file deletion) so the
   * operator's `tmux ls` doesn't grow unboundedly. Returns
   * `{ deleted, tmuxKilled }`.
   */
  cleanup(maxAgeDays = 7) {
    let deleted = 0;
    let tmuxKilled = 0;
    const cutoff = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
    const TERMINAL = new Set(['done', 'failed', 'killed', 'timed_out']);
    const seen = new Set();
    for (const dir of BG_DIRS) {
      if (!existsSync(dir)) continue;
      let files;
      try {
        files = readdirSync(dir).filter((f) => f.endsWith('.json'));
      } catch {
        continue;
      }
      for (const f of files) {
        const full = join(dir, f);
        const data = safeReadJSON(full, null);
        if (!data) continue;
        if (!TERMINAL.has(data.status)) continue;

        // Kill the tmux session for every terminal instance, regardless
        // of age — prevents tmux-session pile-up in long-running hosts.
        const instanceId = data.instanceId || f.replace(/\.json$/, '');
        if (!seen.has(instanceId)) {
          seen.add(instanceId);
          const tmuxRes = this.killTmuxFor(instanceId);
          if (tmuxRes.killed) tmuxKilled += 1;
        }

        const ts = new Date(data.updatedAt || data.completedAt || 0).getTime();
        if (ts < cutoff) {
          try {
            unlinkSync(full);
            deleted += 1;
          } catch {
            // race — file already gone, skip
          }
        }
      }
    }
    return { deleted, tmuxKilled };
  },

  /**
   * v0.5.5 — List all instances with summary status counts. Wraps
   * `list()` and computes a breakdown.
   */
  listWithStatusCounts() {
    const instances = this.list();
    const counts = { pending: 0, running: 0, done: 0, failed: 0, killed: 0, timed_out: 0 };
    for (const inst of instances) {
      const s = inst.status;
      if (s in counts) counts[s] += 1;
    }
    return { instances, counts, total: instances.length };
  },
};
