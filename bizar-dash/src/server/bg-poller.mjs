/**
 * src/server/bg-poller.mjs
 *
 * v6.3.0 — Task-completion polling bridge for Claude Code.
 *
 * The bg state files live at `~/.cache/bizar/bg/<id>.json`. When an
 * instance reaches a terminal state (`done` or `failed`), this
 * poller:
 *
 *   1. Updates the linked task's `status` to `done` / `blocked`.
 *   2. Kills the tmux session (Task 3 integration) if one is alive.
 *   3. For `done` instances, scans the final assistant message from
 *      the Claude Code session for an `html-artifact` fenced block
 *      and, when found, saves it via the artifacts store and links
 *      the artifact id onto the task's `metadata`.
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
 * reappears in the list won't trigger a duplicate task update.
 */
import { backgroundStore } from './background-store.mjs';
import { tasksStore } from './tasks-store.mjs';
import { projectsStore } from './projects-store.mjs';
import { artifactsStore, extractArtifactFromMessage } from './artifacts-store.mjs';
import { listClaudeMessages, readLastAssistantText } from './claude-info.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

const POLL_INTERVAL_MS = 3_000;
const ARTIFACT_SCAN_TIMEOUT_MS = 6_000;

const trackedStatuses = new Map(); // bgInstanceId -> last known status
const processedArtifacts = new Set(); // bgInstanceId -> "scanned once" guard
// v3.5.8 — Failure counter per task. Bumps on every update error and
// emits a WS `background:syncError` event at 3, 10, 20, 30, 40, 50, 60
// … so the UI can surface a real badge instead of swallowing the
// problem in console.error. After FAIL_GIVE_UP consecutive failures
// we reset the counter — the poller will keep retrying each tick, but
// we stop spamming the WS.
const taskFailures = new Map(); // taskId -> failure count
const FAIL_GIVE_UP = 50;

function recordPollerFailure(scope, taskId, instanceId, err) {
  const key = String(taskId || instanceId || 'unknown');
  const fails = (taskFailures.get(key) || 0) + 1;
  taskFailures.set(key, fails);
  console.error(`[bg-poller] ${scope} failed for ${key}:`, err.message);
  if (fails === 3 || fails === 10 || fails % 10 === 0) {
    // Lazy import — same pattern as the broadcast calls already in
    // this file. Avoids pulling server.mjs at module load time.
    import('./server.mjs')
      .then(({ broadcast }) => {
        broadcast({
          type: 'background:syncError',
          taskId: taskId || null,
          instanceId: instanceId || null,
          scope,
          failures: fails,
          error: err && err.message ? err.message : String(err),
        });
      })
      .catch(() => {
        /* best effort */
      });
  }
  if (fails > FAIL_GIVE_UP) {
    // Reset so the next batch of failures can notify again.
    taskFailures.set(key, 0);
  }
}

let _interval = null;

/**
 * Read the artifact for a finished bg instance from the Claude Code
 * session. Returns the { html, name } pair or null when:
 *   - the session id is missing
 *   - the session has no messages
 *   - the final assistant message has no html-artifact block
 *
 * @returns {Promise<{html:string,name:string|null}|null>}
 */
async function scanForArtifact(bg) {
  if (!bg.sessionId) return null;
  const result = listClaudeMessages(bg.sessionId);
  if (!result.ok || !Array.isArray(result.messages) || result.messages.length === 0) {
    return null;
  }
  // Walk newest → oldest; pick the last assistant message.
  const assistants = result.messages
    .filter((m) => m.role === 'assistant')
    .sort((a, b) => (b.ts || 0) - (a.ts || 0));
  for (const m of assistants) {
    const text = m.content || '';
    if (!text) continue;
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
    execFileSync('tmux', ['kill-session', '-t', session], { stdio: 'ignore', timeout: 4_000 });
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
    const projectId = bg.projectId || active?.id || null;
    if (!projectId) continue;
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
        const updated = await tasksStore.update(projectId, taskId, {
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
        recordPollerFailure('task-update', taskId, bg.instanceId, err);
      }

      // Best-effort: kill the Claude Code session via the
      // bg-spawner if it's still tracked. Idempotent — a
      // already-finished session is a no-op.
      if (bg.sessionId) {
        try {
          const { isAlive, killBgAgent } = await import('./claude-bg-spawner.mjs').catch(() => ({}));
          if (isAlive && isAlive(bg.sessionId)) {
            await killBgAgent(bg.sessionId);
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
                projectId,
                name: found.name || `${projectId} artifact`,
                contentType: 'text/html',
                content: found.html,
              });
              // Link the artifact back to the task. The UI looks for
              // `metadata.artifactId` (single) first, then falls back
              // to listing all artifacts by task id.
              const updated2 = await tasksStore.update(projectId, taskId, {
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
            recordPollerFailure('artifact-scan', taskId, bg.instanceId, err);
          }
        }
      }

      // Kill the tmux session if one is attached. Safe to call
      // multiple times — the second call is a no-op.
      killTmuxFor(bg.instanceId);
    } else if (curr === 'running' && (prev === 'pending' || !prev)) {
      // First transition into running — push a status sync.
      try {
        const updated = await tasksStore.update(projectId, taskId, {
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
  tickCCAgents().catch(() => { /* best effort */ });
  _interval = setInterval(() => {
    tick().catch((err) => console.error('[bg-poller] tick:', err.message));
    tickCCAgents().catch(() => { /* best effort */ });
  }, POLL_INTERVAL_MS);
  // Don't keep the event loop alive just for the poller — the http
  // server already does that. `unref()` is safe because we tear down
  // via the parent module's lifecycle.
  if (_interval && typeof _interval.unref === 'function') {
    _interval.unref();
  }
  console.log(`[bg-poller] started (interval=${POLL_INTERVAL_MS}ms)`);
}

// ── Sprint S10 — CC background agent change detection ────────────────────
// Polls `claude agents --json --all` on the same cadence and emits
// `agents:change` when the digest changes (so the unified Agents
// view updates without the browser polling).

let _lastCCDigest = null;
const CC_TIMEOUT_MS = 4_000;

function runClaudeAgentsJson() {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let proc;
    try {
      proc = spawn('claude', ['agents', '--json', '--all'], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { proc.kill('SIGTERM'); } catch { /* */ }
      resolve({ ok: false, error: 'timeout', stderr: stderr.slice(0, 200) });
    }, CC_TIMEOUT_MS);
    proc.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    proc.on('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, error: err.message });
    });
    proc.on('exit', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, error: `exit ${code}`, stderr: stderr.slice(0, 200) });
        return;
      }
      try {
        const parsed = JSON.parse(stdout || '[]');
        resolve({ ok: true, agents: Array.isArray(parsed) ? parsed : [] });
      } catch (err) {
        resolve({ ok: false, error: `parse: ${err.message}` });
      }
    });
  });
}

function digestAgents(agents) {
  const h = createHash('sha1');
  // Sort by id so the digest is order-independent — `claude agents --json`
  // may return background agents in any order.
  const sorted = [...agents].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const a of sorted) {
    h.update(`${a.id}|${a.status || ''}|${a.state || ''}|${a.cwd || ''}|${a.name || ''}\n`);
  }
  return h.digest('hex').slice(0, 16);
}

export async function tickCCAgents() {
  const r = await runClaudeAgentsJson();
  if (!r.ok) return; // CC not on PATH or timed out — leave the previous digest alone.
  const d = digestAgents(r.agents);
  if (d === _lastCCDigest) return;
  _lastCCDigest = d;
  try {
    const { broadcast } = await import('./server.mjs');
    broadcast({ type: 'agents:change', source: 'claude-code', digest: d });
  } catch { /* server not ready yet — swallow */ }
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
  tickCCAgents,
  POLL_INTERVAL_MS,
  digestAgents,
};
