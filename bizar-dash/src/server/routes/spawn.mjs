/**
 * src/server/routes/spawn.mjs
 *
 * POST /api/spawn/agent — spawn a Claude Code background agent for
 * the dashboard's ⌘K palette ("Spawn · Coder" etc.).
 *
 * Wraps `spawnAgent` from claude-runner.mjs and broadcasts an
 * `agents:change` over the WS bus so other tabs see the new agent.
 */
import { Router } from 'express';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { wrap } from './_shared.mjs';
import { spawnAgent } from '../claude-runner.mjs';

const VALID_AGENTS = new Set(['coder', 'researcher', 'planner', 'reviewer']);

/**
 * @param {{ broadcast?: Function }} deps
 */
export function createSpawnRouter({ broadcast = () => {} } = {}) {
  const router = Router();

  router.post('/spawn/agent', wrap(async (req, res) => {
    const body = req.body || {};
    const agent = String(body.agent || 'coder');
    if (!VALID_AGENTS.has(agent)) {
      res.status(400).json({ error: 'bad_request', message: `unknown agent "${agent}"` });
      return;
    }
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
    if (!prompt) {
      res.status(400).json({ error: 'bad_request', message: 'prompt required' });
      return;
    }
    const worktree = typeof body.worktree === 'string' && body.worktree.length > 0
      ? body.worktree
      : process.cwd();
    const logDir = join(homedir(), '.bizar', 'logs');
    const logPath = join(logDir, `spawn-${Date.now()}.log`);
    const result = await spawnAgent({
      agent,
      prompt,
      background: body.background !== false,
      worktree,
      model: typeof body.model === 'string' ? body.model : undefined,
      title: typeof body.title === 'string' ? body.title : `dashboard · ${agent}`,
      logPath,
    });
    if (!result.ok) {
      res.status(500).json({ error: 'spawn_failed', message: result.error });
      return;
    }
    broadcast({ type: 'agents:change', agent: result });
    res.status(201).json(result);
  }));

  return router;
}
