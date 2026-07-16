/**
 * Smoke test for /api/model-router. Verifies:
 *  - the route resolves and returns the agent→model map
 *  - live model probe gracefully degrades when the endpoint is unreachable
 *  - the policy file is read from `.claude/model-router.json`
 *
 * Run with: bun test src/server/routes/model-router.test.mjs
 * or:       node --test src/server/routes/model-router.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createModelRouterRouter } from './model-router.mjs';

function buildApp() {
  const app = express();
  // Mount under /api to match the dashboard's mount prefix.
  app.use('/api', createModelRouterRouter({ state: {} }));
  return app;
}

async function getJson(app, path) {
  const server = app.listen(0);
  try {
    const port = server.address().port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: await res.json() };
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('GET /api/model-router returns agent→model map from .claude/model-router.json', async () => {
  const app = buildApp();
  const { status, body } = await getJson(app, '/api/model-router');
  assert.equal(status, 200);
  assert.ok(typeof body.endpoint === 'string' && body.endpoint.length > 0, 'endpoint present');
  assert.ok(body.policy, 'policy present');
  assert.ok(body.agents, 'agents map present');
  // Forseti / Baldr / Vidarr must be GPT (premium tier per the routing rules).
  assert.match(body.agents.forseti.model, /gpt-5\.6-sol/, 'forseti uses premium GPT');
  assert.match(body.agents.baldr.model, /gpt-5\.6-sol/, 'baldr uses premium GPT');
  assert.match(body.agents.vidarr.model, /gpt-5\.6-sol/, 'vidarr uses premium GPT');
  // Tyr + Odin use the high-tier terra model.
  assert.match(body.agents.tyr.model, /gpt-5\.6-terra/, 'tyr uses high-tier GPT');
  assert.match(body.agents.odin.model, /gpt-5\.6-terra/, 'odin uses high-tier GPT');
  // Everyday default agents use MiniMax-M3.
  assert.equal(body.agents.frigg.model, 'bizar/MiniMax-M3', 'frigg uses default');
  assert.equal(body.agents.hermod.model, 'bizar/MiniMax-M3', 'hermod uses default');
  // Vor uses the budget tier.
  assert.match(body.agents.vor.model, /mimo|deepseek/, 'vor uses budget tier');
});

test('GET /api/model-router/agents returns just the agents+tiers map', async () => {
  const app = buildApp();
  const { status, body } = await getJson(app, '/api/model-router/agents');
  assert.equal(status, 200);
  assert.ok(body.agents.thor, 'thor present');
  assert.ok(body.tiers.default, 'default tier present');
});

test('GET /api/model-router/models probe handles unreachable endpoint gracefully', async () => {
  // Override env to a guaranteed-unreachable port.
  const prev = process.env.BIZAR_MODEL_ROUTER_URL;
  process.env.BIZAR_MODEL_ROUTER_URL = 'http://127.0.0.1:1';
  try {
    const app = buildApp();
    const { status, body } = await getJson(app, '/api/model-router/models');
    assert.equal(status, 200);
    assert.equal(body.reachable, false);
    assert.ok(typeof body.error === 'string', 'error string present');
  } finally {
    if (prev === undefined) delete process.env.BIZAR_MODEL_ROUTER_URL;
    else process.env.BIZAR_MODEL_ROUTER_URL = prev;
  }
});