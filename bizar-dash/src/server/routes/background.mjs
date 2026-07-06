/**
 * src/server/routes/background.mjs
 *
 * /api/background                          — list
 * /api/background (POST)                   — spawn from UI (v5.x)
 * /api/background/:id                      — single instance
 * /api/background/:id/output               — tail captured output
 * /api/background/:id/tool-calls (GET)     — tool call history (v5.x)
 * /api/background/:id/tmux                 — tmux attach metadata
 * /api/background/:id/message (POST)       — send a follow-up message
 * /api/background/:id/pause (POST)         — pause subprocess (v5.x)
 * /api/background/:id/resume (POST)        — resume subprocess (v5.x)
 * /api/background/:id/steer (POST)         — kill+respawn with new prompt (v5.x)
 * /api/background/:id/retry (POST)         — manual unstick (v3.11.0)
 * /api/background/:id (DELETE)             — kill
 *
 * Backed by the opencode-plugin's bg instance store. Imports the
 * store lazily so this module loads even when the plugin is offline.
 */
import { Router } from 'express';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {Function} deps.broadcast
 * @returns {import('express').Router}
 */
export function createBackgroundRouter({ broadcast }) {
  const router = Router();

  // Wire bg-spawner's broadcast so spawned agents broadcast on the
  // existing WS bus (mirroring the way `bg-poller.mjs` does it).
  import('../bg-spawner.mjs').then((m) => {
    if (m && typeof m.configureSpawner === 'function') {
      m.configureSpawner({ broadcast });
    }
  }).catch(() => { /* ignore — spawner optional */ });

  router.get('/background', wrap(async (_req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const instances = await backgroundStore.list();
    res.json({ instances, status: backgroundStore.status() });
  }));

  // v5.x — Spawn from UI. Body: { agent, prompt, model?, persistent?, maxRestarts?, tags?, timeoutMs?, worktree? }
  router.post('/background', wrap(async (req, res) => {
    const body = req.body || {};
    const agent = String(body.agent || '').trim();
    const prompt = String(body.prompt || '').trim();
    const worktree = body.worktree ? String(body.worktree) : process.cwd();
    if (!agent || !prompt) {
      res.status(400).json({ error: 'bad_request', message: 'agent and prompt are required' });
      return;
    }
    let model;
    if (body.model && typeof body.model === 'string') {
      const idx = body.model.indexOf('/');
      if (idx > 0) {
        model = {
          providerID: body.model.slice(0, idx).trim(),
          modelID: body.model.slice(idx + 1).trim(),
        };
      }
    }
    const tags = Array.isArray(body.tags)
      ? body.tags.filter((t) => typeof t === 'string').slice(0, 10)
      : undefined;
    const { spawnBgAgent } = await import('../bg-spawner.mjs');
    const result = await spawnBgAgent({
      agent,
      prompt,
      worktree,
      model,
      timeoutMs: Number(body.timeoutMs) || 300_000,
      persistent: Boolean(body.persistent),
      maxRestarts: Number(body.maxRestarts) || 3,
      tags,
    });
    if (result.error) {
      res.status(500).json({ error: 'spawn_failed', message: result.error, instanceId: result.instanceId });
      return;
    }
    res.status(201).json({
      instanceId: result.instanceId,
      sessionId: result.sessionId ?? null,
      processId: result.processId ?? null,
      status: 'pending',
      agent,
      worktree,
    });
  }));

  router.get('/background/:id', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const inst = backgroundStore.get(req.params.id);
    if (!inst) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(inst);
  }));

  router.get('/background/:id/output', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const lines = Math.min(500, Math.max(1, parseInt(req.query.lines || '50', 10) || 50));
    const result = backgroundStore.captureOutput(req.params.id, lines);
    res.json(result);
  }));

  // v5.x — Tool-call history. The state file carries a `toolCalls`
  // array populated by the plugin's InstanceManager as it observes
  // opencode events. This endpoint is read-only; the plugin owns the
  // shape.
  router.get('/background/:id/tool-calls', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const inst = backgroundStore.get(req.params.id);
    if (!inst) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const calls = Array.isArray(inst.toolCalls) ? inst.toolCalls : [];
    res.json({ instanceId: req.params.id, toolCalls: calls, count: calls.length });
  }));

  // v5.x — Pause. SIGSTOP the subprocess.
  router.post('/background/:id/pause', wrap(async (req, res) => {
    const { pauseBgAgent } = await import('../bg-spawner.mjs');
    const result = pauseBgAgent(req.params.id);
    if (!result.ok) {
      res.status(result.error === 'unsupported_on_win32' ? 501 : 400).json({ ok: false, error: result.error });
      return;
    }
    broadcast({ type: 'background:change', id: req.params.id, status: 'paused' });
    res.json({ ok: true, status: 'paused' });
  }));

  // v5.x — Resume. SIGCONT the subprocess.
  router.post('/background/:id/resume', wrap(async (req, res) => {
    const { resumeBgAgent } = await import('../bg-spawner.mjs');
    const result = resumeBgAgent(req.params.id);
    if (!result.ok) {
      res.status(result.error === 'unsupported_on_win32' ? 501 : 400).json({ ok: false, error: result.error });
      return;
    }
    broadcast({ type: 'background:change', id: req.params.id, status: 'running' });
    res.json({ ok: true, status: 'running' });
  }));

  // v5.x — Steer (kill+restart with appended prompt). Body: { message }.
  router.post('/background/:id/steer', wrap(async (req, res) => {
    const message = String((req.body && req.body.message) || '').trim();
    if (!message) {
      res.status(400).json({ ok: false, error: 'message_empty' });
      return;
    }
    const { steerBgAgent } = await import('../bg-spawner.mjs');
    const result = await steerBgAgent(req.params.id, message);
    if (!result.ok) {
      res.status(400).json({ ok: false, error: result.error });
      return;
    }
    broadcast({
      type: 'background:change',
      id: req.params.id,
      status: 'steered',
      newInstanceId: result.newInstanceId,
    });
    broadcast({
      type: 'background:change',
      id: result.newInstanceId,
      status: 'pending',
      parentInstanceId: req.params.id,
    });
    res.json({ ok: true, status: 'steered', newInstanceId: result.newInstanceId, processId: result.processId });
  }));

  // v3.5.5 — Tmux session metadata. The UI uses this to render an
  // "Attach" button next to a running bg instance. Returns the
  // computed session name, the local attach command, and whether
  // the session actually exists right now. Always 200 — the caller
  // can tell `exists: false` apart from a missing instance.
  router.get('/background/:id/tmux', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const info = backgroundStore.tmuxAttachInfo(req.params.id);
    res.json(info);
  }));

  router.post('/background/:id/message', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const message = (req.body?.message || '').toString();
    if (!message.trim()) {
      res.status(400).json({ error: 'bad_request', message: 'message required' });
      return;
    }
    const result = backgroundStore.sendMessage(req.params.id, message);
    res.json(result);
  }));

  // v3.11.0 — Manual unstick for a bg instance stuck in
  // `dispatchPending: true`. The periodic retry loop covers most
  // cases, but operators (and the UI) sometimes want to recover a
  // specific instance immediately without waiting for the next tick.
  //
  // Behavior:
  //   - Resets `dispatchPending: true`, `retryCount: 0` so the
  //     instance qualifies for a fresh retry.
  //   - Calls `retryDispatchOnce(instanceId)` synchronously.
  //   - Returns the same shape the periodic loop logs:
  //     `{ ok, reason?, retryCount?, sessionId?, logPath? }`.
  //
  // This endpoint NEVER deletes the bg state file. A failed retry
  // leaves the instance in a recoverable state.
  router.post('/background/:id/retry', wrap(async (req, res) => {
    const id = req.params.id;
    const { readBgInstance, listBgInstances } = await import('../task-delegator.mjs');
    const inst = readBgInstance(id);
    if (!inst) {
      res.status(404).json({ ok: false, error: 'not_found', message: `bg instance ${id} not found` });
      return;
    }
    // Reset retry bookkeeping so a manual retry starts from a clean
    // slate. The atomic rewrite goes through the same path the
    // periodic loop uses; failures here are reported back to the
    // caller.
    try {
      const fs = await import('node:fs');
      const file = inst._file;
      if (file && fs.existsSync(file)) {
        const fresh = { ...inst, dispatchPending: true, retryCount: 0, lastRetryAt: Date.now() };
        delete fresh._file;
        delete fresh._bgDir;
        delete fresh._mtime;
        const tmp = `${file}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(fresh, null, 2), 'utf8');
        try {
          fs.renameSync(tmp, file);
        } catch {
          fs.writeFileSync(file, JSON.stringify(fresh, null, 2), 'utf8');
        }
      }
    } catch {
      /* best-effort reset; retryDispatchOnce still runs */
    }
    const { retryDispatchOnce } = await import('../bg-retry.mjs');
    const result = await retryDispatchOnce(id);
    if (result.ok) {
      broadcast({ type: 'background:change', action: 'retry', id, sessionId: result.sessionId });
      // Re-list so the UI snapshot picks up the new sessionId.
      const refreshed = (listBgInstances() || []).find((i) => i.instanceId === id) || null;
      res.json({ ...result, instance: refreshed });
      return;
    }
    res.json({ ...result, instance: inst });
  }));

  router.delete('/background/:id', wrap(async (req, res) => {
    // v5.x — Prefer the dashboard-side spawner's kill for instances
    // that we own (spawned via POST /background). Falls back to the
    // plugin's tmux/abort path for instances spawned by the plugin.
    try {
      const { isAlive: spawnerAlive, killBgAgent } = await import('../bg-spawner.mjs');
      if (spawnerAlive(req.params.id)) {
        const r = await killBgAgent(req.params.id, { signal: 'SIGTERM' });
        if (r.ok) {
          broadcast({ type: 'background:change', action: 'kill', id: req.params.id, source: 'dashboard' });
          res.json({ ok: true, instanceId: req.params.id, source: 'dashboard' });
          return;
        }
      }
    } catch { /* ignore — fall through to legacy */ }

    const { backgroundStore } = await import('../background-store.mjs');
    // v3.5.4 (bug #3) — `kill()` is now async (it awaits the abortSession
    // HTTP call to opencode serve, then deletes the state file, then
    // best-effort tmux). The result includes a `steps[]` array so the UI
    // can report exactly what happened.
    //
    // We always return 200 — the result body's `ok` distinguishes
    // success from partial failure (e.g. abort succeeded but tmux kill
    // did not). Returning 502 would force the fetch wrapper into its
    // error branch and we'd lose the `steps[]` diagnostic.
    const result = await backgroundStore.kill(req.params.id);
    if (result.ok) {
      broadcast({ type: 'background:change', action: 'kill', id: req.params.id });
    }
    res.json(result);
  }));

  // v0.5.5 — Cleanup old terminal instances. The UI calls this from
  // the Settings "Background Agents" card.
  router.post('/background/cleanup', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const maxAgeDays = Number(req.body?.maxAgeDays) || 7;
    const result = backgroundStore.cleanup(maxAgeDays);
    broadcast({ type: 'background:cleanup', deleted: result.deleted });
    res.json(result);
  }));

  // v0.5.5 — Summary with status counts. The UI calls this for the
  // Background Agents overview in Settings.
  router.get('/background/summary', wrap(async (_req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const summary = backgroundStore.listWithStatusCounts();
    res.json(summary);
  }));

  // v3.22.0 — Open-terminal endpoint. The frontend calls this when the
  // operator clicks "Open in terminal" on a TmuxAttachCard. The server
  // spawns the platform's terminal emulator with the tmux attach command.
  // Whitelisted emulators: 'system' (auto-detect), 'tmux-iterm' (macOS
  // iTerm2), 'tmux-wt' (Windows Terminal).
  //
  // The endpoint ALWAYS returns 200 with `{ ok, command }` or
  // `{ ok: false, error }` — never a raw 5xx, so the frontend can fall
  // back to clipboard copy.
  router.post('/background/:id/open-terminal', wrap(async (req, res) => {
    const { backgroundStore } = await import('../background-store.mjs');
    const info = backgroundStore.tmuxAttachInfo(req.params.id);

    if (!info || !info.session) {
      res.json({ ok: false, error: 'no_tmux_session' });
      return;
    }

    // Validate actual tmux session name matches the bgr_<hex> pattern.
    if (!/^bgr_[A-Za-z0-9_-]{1,24}$/.test(info.session)) {
      res.json({ ok: false, error: 'invalid_session_name' });
      return;
    }

    // Whitelist emulator selection.
    const emulator = (req.body?.emulator || 'system').toString();
    const ALLOWED_EMULATORS = ['system', 'tmux-iterm', 'tmux-wt'];
    if (!ALLOWED_EMULATORS.includes(emulator)) {
      res.json({ ok: false, error: 'unknown_emulator', allowed: ALLOWED_EMULATORS });
      return;
    }

    const { execFileSync, spawn } = await import('node:child_process');
    const platform = process.platform;
    const command = `tmux attach -t ${info.session}`;

    if (emulator === 'system') {
      // Auto-detect platform terminal.
      if (platform === 'darwin') {
        spawn('osascript', [
          '-e', `tell application "Terminal" to do script "${command}"`,
          '-e', 'activate application "Terminal"',
        ], { detached: true, stdio: 'ignore' }).unref();
      } else if (platform === 'linux') {
        const candidates = [
          ['gnome-terminal', '--', ...command.split(' ')],
          ['konsole', '-e', command],
          ['xterm', '-e', command],
          ['x-terminal-emulator', '-e', command],
        ];
        let launched = false;
        for (const [cmd, ...args] of candidates) {
          try {
            execFileSync('which', [cmd], { stdio: 'pipe' });
            spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
            launched = true;
            break;
          } catch { /* try next */ }
        }
        if (!launched) {
          res.json({ ok: false, error: 'no_terminal_emulator_found' });
          return;
        }
      } else if (platform === 'win32') {
        try {
          execFileSync('where', ['wt.exe'], { stdio: 'pipe' });
          spawn('wt.exe', ['-e', ...command.split(' ')], { detached: true, stdio: 'ignore' }).unref();
        } catch {
          spawn('cmd', ['/c', 'start', '', 'cmd', '/k', ...command.split(' ')], { detached: true, stdio: 'ignore' }).unref();
        }
      } else {
        res.json({ ok: false, error: `unsupported_platform: ${platform}` });
        return;
      }
    } else if (emulator === 'tmux-iterm') {
      if (platform !== 'darwin') {
        res.json({ ok: false, error: 'tmux-iterm requires macOS' });
        return;
      }
      // iTerm2 has a "tmux integration" mode; open -a iTerm sends the command.
      spawn('open', ['-a', 'iTerm2', command], { detached: true, stdio: 'ignore' }).unref();
    } else if (emulator === 'tmux-wt') {
      if (platform !== 'win32') {
        res.json({ ok: false, error: 'tmux-wt requires Windows' });
        return;
      }
      spawn('wt.exe', ['-e', ...command.split(' ')], { detached: true, stdio: 'ignore' }).unref();
    }

    res.json({ ok: true, command });
  }));

  return router;
}