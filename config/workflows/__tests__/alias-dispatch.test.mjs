/**
 * config/workflows/__tests__/alias-dispatch.test.mjs
 *
 * Contract fence for `config/workflows/lib/dispatch.js` after the
 * model-router/picker cutover:
 *
 *   1. The exported alias set is exactly {haiku, sonnet, opus, fable}.
 *   2. `dispatchAgent` forwards an alias `model` field and rejects
 *      raw gateway IDs, `inherit`, and unknown strings.
 *   3. `stableAgentName(role)` returns the known role mapping and
 *      defaults to a stable agent name for unknown roles.
 *   4. `dispatchAgentDryRun` returns the same payload shape without
 *      invoking the underlying agent.
 *
 * Run with `node --test config/workflows/__tests__/alias-dispatch.test.mjs`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ALIASES,
  ROLE_TO_BIZAR_AGENT,
  AliasValidationError,
  assertAlias,
  dispatchAgent,
  dispatchAgentDryRun,
  isAlias,
  stableAgentName,
} from '../lib/dispatch.js';

test('dispatch: ALIASES is exactly the four native aliases', () => {
  assert.deepEqual([...ALIASES].sort(), ['fable', 'haiku', 'opus', 'sonnet']);
});

test('dispatch: isAlias accepts only the four native aliases', () => {
  assert.equal(isAlias('haiku'), true);
  assert.equal(isAlias('sonnet'), true);
  assert.equal(isAlias('opus'), true);
  assert.equal(isAlias('fable'), true);
  assert.equal(isAlias('claude-minimax/MiniMax-M3'), false);
  assert.equal(isAlias('inherit'), false);
  assert.equal(isAlias(''), false);
});

test('dispatch: assertAlias throws AliasValidationError for non-aliases', () => {
  assert.throws(
    () => assertAlias('claude-minimax/MiniMax-M3'),
    (err) => err instanceof AliasValidationError,
  );
  assert.throws(
    () => assertAlias('inherit'),
    (err) => err instanceof AliasValidationError,
  );
});

test('dispatch: stableAgentName maps known roles to Bizar agents', () => {
  assert.equal(stableAgentName('planner'), ROLE_TO_BIZAR_AGENT.planner);
  assert.equal(stableAgentName('verifier'), ROLE_TO_BIZAR_AGENT.verifier);
  assert.equal(stableAgentName('researcher'), ROLE_TO_BIZAR_AGENT.researcher);
});

test('dispatch: stableAgentName falls back to a default agent name', () => {
  const name = stableAgentName('not-a-real-role');
  assert.ok(typeof name === 'string' && name.length > 0);
  assert.notEqual(name, 'not-a-real-role');
});

test('dispatch: dispatchAgent validates the alias and forwards payload', async () => {
  const calls = [];
  const fakeAgent = async (prompt, agentOptions) => {
    calls.push({ prompt, agentOptions });
    return { ok: true };
  };
  const result = await dispatchAgent(
    fakeAgent,
    'planner',
    'plan the work',
    { model: 'opus', role: 'planner' },
  );
  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].prompt, 'plan the work');
  assert.equal(calls[0].agentOptions.model, 'opus');
  assert.equal(calls[0].agentOptions.subagent_type, ROLE_TO_BIZAR_AGENT.planner);
});

test('dispatch: dispatchAgent rejects raw gateway IDs', async () => {
  const fakeAgent = async () => ({ ok: true });
  await assert.rejects(
    () => dispatchAgent(fakeAgent, 'planner', 'plan', { model: 'claude-minimax/MiniMax-M3' }),
    (err) => err instanceof AliasValidationError,
  );
});

test('dispatch: dispatchAgent rejects inherit as a model field', async () => {
  const fakeAgent = async () => ({ ok: true });
  await assert.rejects(
    () => dispatchAgent(fakeAgent, 'planner', 'plan', { model: 'inherit' }),
    (err) => err instanceof AliasValidationError,
  );
});

test('dispatch: dispatchAgentDryRun returns payload without invoking agent', () => {
  const payload = dispatchAgentDryRun('planner', 'plan the work', {
    model: 'sonnet',
    role: 'planner',
  });
  assert.equal(payload.agentName, 'planner');
  assert.equal(payload.prompt, 'plan the work');
  assert.equal(payload.agentOptions.model, 'sonnet');
  assert.equal(payload.agentOptions.subagent_type, ROLE_TO_BIZAR_AGENT.planner);
});
