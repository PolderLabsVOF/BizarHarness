/**
 * cli/dashboard/watcher.mjs
 *
 * chokidar-backed file watcher. Translates low-level fs events into the
 * shape the dashboard's WebSocket layer expects.
 *
 * The watcher ignores initial add events (the UI doesn't need a "you just
 * started, here are 200 files that already existed" flood on connect).
 */
import chokidar from 'chokidar';

/**
 * @param {object} opts
 * @param {string[]} opts.paths - files or directories to watch
 * @param {(event: 'add'|'change'|'unlink', path: string) => void} opts.onChange
 * @param {object} [opts.options] - extra chokidar options
 * @param {(event: {event: string, path: string}) => void} [opts.onTimelineEvent]
 *   v6.6.0 — F-042 hook. When supplied, every chokidar event also
 *   forwards through this callback so the timeline aggregator can
 *   record the change. Best-effort: a throw inside the callback
 *   never crashes the watcher.
 */
export function createWatcher({ paths, onChange, options = {}, onTimelineEvent = null } = {}) {
  if (!Array.isArray(paths) || paths.length === 0) {
    throw new Error('createWatcher requires a non-empty paths array');
  }
  if (typeof onChange !== 'function') {
    throw new Error('createWatcher requires an onChange callback');
  }

  const watcher = chokidar.watch(paths, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    // Ignore: any path segment named `node_modules` (anywhere), and any
    // file/dir whose IMMEDIATE basename starts with `.` (covers .DS_Store,
    // .swp, .bak, etc.). We must NOT walk the whole path — the watched
    // root `~/.config/cline/agents` contains the segment `.config`
    // which would otherwise match and silently disable the watch.
    ignored: (p) => {
      const s = String(p);
      const parts = s.split(/[\\/]/);
      // Walk all segments — `node_modules` is fine to match anywhere.
      if (parts.includes('node_modules')) return true;
      // Last segment is the basename — check that ONLY, so `.config`
      // in parent dirs doesn't disqualify the watched root.
      const basename = parts[parts.length - 1] || '';
      return basename.startsWith('.');
    },
    ...options,
  });

  const safe = (event, p) => {
    try {
      onChange(event, p);
    } catch (err) {
      // A faulty onChange must not crash the watcher
      console.error('[dashboard watcher] onChange error:', err);
    }
    if (typeof onTimelineEvent === 'function') {
      try {
        onTimelineEvent({ event, path: p });
      } catch (err) {
        try { console.error('[dashboard watcher] onTimelineEvent error:', err); }
        catch { /* ignore */ }
      }
    }
  };

  watcher.on('add', (p) => safe('add', p));
  watcher.on('change', (p) => safe('change', p));
  watcher.on('unlink', (p) => safe('unlink', p));
  watcher.on('error', (err) => {
    console.error('[dashboard watcher] chokidar error:', err);
  });

  return {
    /** @returns {chokidar.FSWatcher} */
    start() {
      return watcher;
    },
    async stop() {
      try {
        await watcher.close();
      } catch (err) {
        console.warn('swallowed in watcher.close:', err.message);
      }
    },
    /** Force a synthetic broadcast — useful after a self-mutation. */
    poke(event = 'change', path = '<synthetic>') {
      safe(event, path);
    },
  };
}
