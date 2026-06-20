/**
 * src/server/bg-poller.mjs
 *
 * v3.5.5 — Task-completion polling bridge.
 *
 * The plugin writes bg state files to `~/.cache/bizar/bg/<id>.json`
 * as each agent instance runs. When an instance reaches a terminal
 * state (`done` or `failed`), this poller:
 *
 *   1. Updates the linked task's `status` to `done` / `blocked`.
 *   2. Kills the tmux session (Task 3 integration) if one is alive.
 *   3. For `done` instances, scans the final assistant message from
 *      the opencode session for an `html-artifact` fenced block and,
 *      when found, saves it via the artifacts store and links the
 *      artifact id onto the task's `metadata` (Task 5 + 6).
 *   4. Broadcasts a `tasks:change` event so the UI updates in real
 *      time without waiting for a full snapshot.
 *
 * Polling cadence is 3s — long enough to keep idle CPU at zero, short
 * enough that the dashboard reflects completions within a couple of
 * seconds. The poller is started once during server boot and never
 * stopped (it lives for the lifetime of the dashboard).
 *
 * Idempotency: we remember the last status we've seen per instance
 * in a `Map` and only react to transitions, so a `done` instance that
 * reappears in the list (the plugin rewrites the file on every
 * progress event) won't trigger a duplicate task update.
 */
import { backgroundStore } from './background-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { projectsStore } from './projects-store.mjs';
import { artifactsStore, extractArtifactFromMessage } from './artifacts-store.mjs';
import { readServeInfo, listOpencodeMessages, extractContentFromOpencodeMessage, abortSession } from './serve-info.mjs';
import { execSync } from 'node:child_process';

const POLL_INTERVAL_MS = 3_000;
const ARTIFACT_SCAN_TIMEOUT_MS = 6_000;

const trackedStatuses = new Map(); // bgInstanceId -> last known status
const processedArtifacts = new Set(); // bgInstanceId -> "scanned once" guard

let _interval = null;

/**
 * Read the artifact for a finished bg instance from the opencode
 * session. Returns the { html, name } pair or null when:
 *   - the plugin is offline
 *   - the opencode session has no messages
 *   - the final assistant message has no html-artifact block
 *
 * @returns {Promise<{html:string,name:string|null}|null>}
 */
async function scanForArtifact(bg) {
  if (!bg.sessionId) return null;
  const serveInfo = readServeInfo();
  if (!serveInfo) return null;
  // v3.5.5 — `active.path` is the project root; that's the worktree
  // the opencode session was created in. Fall back to the plugin's
  // recorded worktree when the active project has been removed.
  const active = projectsStore.active();
  const directory = (active && active.path) || serveInfo.worktree || '';
  const list = await listOpencodeMessages(serveInfo, bg.sessionId, directory, ARTIFACT_SCAN_TIMEOUT_MS);
  if (!list.ok || !Array.isArray(list.messages) || list.messages.length === 0) {
    return null;
  }
  // Walk newest → oldest; pick the last assistant message.
  const assistants = list.messages
    .filter((m) => (m?.info?.role || m?.role) === 'assistant')
    .sort((a, b) => {
      const ta = a?.info?.time?.created || 0;
      const tb = b?.info?.time?.created || 0;
      return tb - ta;
    });
  for (const m of assistants) {
    const text = extractContentFromOpencodeMessage(m);
    const found = extractArtifactFromMessage(text);
    if (found) return found;
  }
  return null;
}

/**
 * Kill the tmux session for a bg instance, best-effort. Idempotent —
 * returns true when the session is absent (it was already gone).
 */
function killTmuxFor(instanceId) {
  if (!instanceId) return false;
  const session = `bizar-bg-${instanceId}`;
  try {
    execSync(`tmux kill-session -t ${session}`, { stdio: 'ignore', timeout: 4_000 });
    return true;
  } catch {
    return false;
  }
}

async function tick() {
  let list;
  try {
    list = await backgroundStore.list();
  } catch (err) {
    console.error('[bg-poller] list() failed:', err.message);
    return;
  }
  const seen = new Set();

  for (const bg of list) {
    seen.add(bg.instanceId);
    const prev = trackedStatuses.get(bg.instanceId);
    const curr = bg.status;
    if (prev === curr) continue;
    trackedStatuses.set(bg.instanceId, curr);

    const active = projectsStore.active();
    if (!active) continue;
    const taskId = bg.taskId;
    if (!taskId) continue;

    // Map bg terminal states to task statuses. `done` is a clean
    // success, `failed` / `killed` / `timed_out` map to `blocked`
    // so the operator has to actively move them out of the blocked
    // pile.
    const TERMINAL = new Set(['done', 'failed', 'killed', 'timed_out']);
    if (TERMINAL.has(curr)) {
      // Update the task in-place.
      const newStatus = curr === 'done' ? 'done' : 'blocked';
      const currentStep =
        curr === 'done'
          ? 'Completed'
          : curr === 'failed'
          ? `Failed: ${bg.error || '(no error)'}`
          : curr === 'killed'
          ? 'Killed by operator'
          : `Timed out`;
      try {
        const updated = await tasksStore.update(active.id, taskId, {
          status: newStatus,
          metadata: {
            ...(bg || {}),
            currentStep,
            progress: curr === 'done' ? 100 : (bg.progress ?? 0),
            completedAt: Date.now(),
          },
        });
        if (updated) {
          try {
            const { broadcast } = await import('./server.mjs');
            broadcast({ type: 'tasks:change', task: updated });
            broadcast({ type: 'background:change', id: bg.instanceId, status: curr });
          } catch { /* best effort */ }
        }
      } catch (err) {
        console.error(`[bg-poller] task update failed for ${taskId}:`, err.message);
      }

      // Best-effort: abort the opencode session. Idempotent — a
      // already-finished session just returns 404 and we move on.
      if (bg.sessionId) {
        try {
          const serveInfo = readServeInfo();
          if (serveInfo) {
            await abortSession(serveInfo, bg.sessionId, bg.worktree || serveInfo.worktree);
          }
        } catch { /* best effort */ }

        // v3.5.5 — On `done`, scan for an html-artifact in the
        // final message and save it. Guarded by `processedArtifacts`
        // so a `done` status that lingers in the list doesn't keep
        // re-creating the artifact.
        if (curr === 'done' && !processedArtifacts.has(bg.instanceId)) {
          processedArtifacts.add(bg.instanceId);
          try {
            const found = await scanForArtifact(bg);
            if (found) {
              const meta = artifactsStore.save({
                taskId,
                projectId: active.id,
                name: found.name || `${active.id} artifact`,
                contentType: 'text/html',
                content: found.html,
              });
              // Link the artifact back to the task. The UI looks for
              // `metadata.artifactId` (single) first, then falls back
              // to listing all artifacts by task id.
              const updated2 = await tasksStore.update(active.id, taskId, {
                metadata: {
                  artifactId: meta.id,
                  artifactName: meta.name,
                },
              });
              if (updated2) {
                try {
                  const { broadcast } = await import('./server.mjs');
                  broadcast({ type: 'tasks:change', task: updated2 });
                  broadcast({ type: 'artifact:new', artifact: meta });
                } catch { /* best effort */ }
              }
            }
          } catch (err) {
            console.error(`[bg-poller] artifact scan failed for ${bg.instanceId}:`, err.message);
          }
        }
      }

      // Kill the tmux session if one is attached. Safe to call
      // multiple times — the second call is a no-op.
      killTmuxFor(bg.instanceId);
    } else if (curr === 'running' && (prev === 'pending' || !prev)) {
      // First transition into running — push a status sync.
      try {
        const updated = await tasksStore.update(active.id, taskId, {
          status: 'doing',
          metadata: {
            ...(bg || {}),
            currentStep: 'Agent running',
          },
        });
        if (updated) {
          try {
            const { broadcast } = await import('./server.mjs');
            broadcast({ type: 'tasks:change', task: updated });
          } catch { /* best effort */ }
        }
      } catch { /* best effort */ }
    }
  }

  // Clean up tracking for instances that have been removed from disk.
  for (const id of trackedStatuses.keys()) {
    if (!seen.has(id)) trackedStatuses.delete(id);
  }
  for (const id of processedArtifacts) {
    if (!seen.has(id)) processedArtifacts.delete(id);
  }
}

export function startBgPoller() {
  if (_interval) return; // idempotent
  // Tick once immediately so completions that happened while the
  // dashboard was down are reflected on the first WS snapshot.
  tick().catch((err) => console.error('[bg-poller] initial tick:', err.message));
  _interval = setInterval(() => {
    tick().catch((err) => console.error('[bg-poller] tick:', err.message));
  }, POLL_INTERVAL_MS);
  // Don't keep the event loop alive just for the poller — the http
  // server already does that. `unref()` is safe because we tear down
  // via the parent module's lifecycle.
  if (_interval && typeof _interval.unref === 'function') {
    _interval.unref();
  }
  console.log(`[bg-poller] started (interval=${POLL_INTERVAL_MS}ms)`);
}

export function stopBgPoller() {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}

// Exposed for tests / introspection.
export const _pollerInternals = {
  trackedStatuses,
  processedArtifacts,
  tick,
  POLL_INTERVAL_MS,
};
