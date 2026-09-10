import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAdvisorArgs,
  validateAdvisorPairing,
  resolveMainModel,
  updateAdvisorSettings,
  ADVISOR_PAIRINGS,
  isAgentContext,
} from './advisor.mjs';

const ENV = process.env;

describe('parseAdvisorArgs', () => {
  test('defaults to pick', () => {
    const result = parseAdvisorArgs([]);
    assert.equal(result.subcommand, 'pick');
  });

  test('parses subcommands', () => {
    assert.equal(parseAdvisorArgs(['show']).subcommand, 'show');
    assert.equal(parseAdvisorArgs(['clear']).subcommand, 'clear');
    assert.equal(parseAdvisorArgs(['disable']).subcommand, 'disable');
    assert.equal(parseAdvisorArgs(['validate']).subcommand, 'validate');
  });

  test('parses flags', () => {
    const result = parseAdvisorArgs(['show', '--json', '--yes']);
    assert.equal(result.subcommand, 'show');
    assert.equal(result.json, true);
    assert.equal(result.yes, true);
  });

  test('detects help', () => {
    assert.equal(parseAdvisorArgs(['--help']).help, true);
    assert.equal(parseAdvisorArgs(['-h']).help, true);
  });
});

describe('ADVISOR_PAIRINGS', () => {
  test('covers all documented pairings', () => {
    assert.deepEqual(ADVISOR_PAIRINGS['haiku-4-5'], ['fable', 'opus-4-5', 'sonnet-4-5']);
    assert.deepEqual(ADVISOR_PAIRINGS['sonnet-4-6'], ['fable', 'opus-4-5', 'sonnet-4-5']);
    assert.deepEqual(ADVISOR_PAIRINGS['sonnet-5'], ['fable', 'opus-4-5', 'sonnet-5']);
    assert.deepEqual(ADVISOR_PAIRINGS['opus-4-6'], ['fable', 'opus-4-5', 'sonnet-5']);
    assert.deepEqual(ADVISOR_PAIRINGS['opus-4-7+'], ['fable', 'opus-4-7+']);
    assert.deepEqual(ADVISOR_PAIRINGS['fable-5'], ['fable-5']);
    assert.deepEqual(ADVISOR_PAIRINGS['fable-5-1'], ['fable-5-1']);
  });
});

describe('validateAdvisorPairing', () => {
  test('accepts valid haiku pairings', () => {
    assert.equal(validateAdvisorPairing('claude-haiku-4-5-20250501', 'claude-opus-4-5-20250501').verdict, 'ok');
    assert.equal(validateAdvisorPairing('claude-haiku-4-5-20250501', 'claude-sonnet-4-5-20250501').verdict, 'ok');
  });

  test('rejects invalid haiku pairings', () => {
    assert.equal(validateAdvisorPairing('claude-haiku-4-5-20250501', 'claude-opus-4-7-20250501').verdict, 'rejected');
  });

  test('accepts valid sonnet-5 pairings', () => {
    assert.equal(validateAdvisorPairing('claude-sonnet-5-20250501', 'claude-opus-4-5-20250501').verdict, 'ok');
    assert.equal(validateAdvisorPairing('claude-sonnet-5-20250501', 'claude-fable-5-20250501').verdict, 'ok');
  });

  test('rejects opus-4-7 to sonnet pairings', () => {
    assert.equal(validateAdvisorPairing('claude-opus-4-7-20250501', 'claude-sonnet-4-5-20250501').verdict, 'rejected');
  });

  test('accepts opus-4-7+ to opus-4-7+', () => {
    assert.equal(validateAdvisorPairing('claude-opus-4-7-20250501', 'claude-opus-4-7-20250501').verdict, 'ok');
    assert.equal(validateAdvisorPairing('claude-opus-4-8-20250501', 'claude-opus-4-8-20250501').verdict, 'ok');
  });

  test('accepts fable to fable', () => {
    assert.equal(validateAdvisorPairing('claude-fable-5-20250501', 'claude-fable-5-20250501').verdict, 'ok');
    assert.equal(validateAdvisorPairing('claude-fable-5-1-20250501', 'claude-fable-5-1-20250501').verdict, 'ok');
  });

  test('unknown main returns unknown-main', () => {
    const result = validateAdvisorPairing('unknown-model', 'claude-opus-5');
    assert.equal(result.verdict, 'unknown-main');
    assert.equal(result.accepted.length, 0);
  });

  test('fable prefixes match', () => {
    assert.equal(validateAdvisorPairing('claude-sonnet-5-20250501', 'claude-fable-5').verdict, 'ok');
    assert.equal(validateAdvisorPairing('claude-haiku-4-5-20250501', 'fable').verdict, 'ok');
  });
});

describe('resolveMainModel', () => {
  test('returns ANTHROPIC_MODEL when set', () => {
    const settings = { env: { ANTHROPIC_MODEL: 'claude-opus-5' } };
    assert.equal(resolveMainModel(settings), 'claude-opus-5');
  });

  test('falls back to default aliases', () => {
    assert.equal(resolveMainModel({ env: { ANTHROPIC_DEFAULT_OPUS_MODEL: 'claude-opus-5' } }), 'claude-opus-5');
    assert.equal(resolveMainModel({ env: { ANTHROPIC_DEFAULT_MODEL: 'claude-sonnet-5' } }), 'claude-sonnet-5');
  });

  test('returns undefined when unset', () => {
    assert.equal(resolveMainModel({}), undefined);
    assert.equal(resolveMainModel({ env: {} }), undefined);
  });
});

describe('updateAdvisorSettings', () => {
  test('pick writes advisorModel and preserves disable state', () => {
    const current = { advisorModel: 'old', env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1' } };
    const next = updateAdvisorSettings(current, { action: 'pick', model: 'new-model' });
    assert.equal(next.advisorModel, 'new-model');
    assert.equal(next.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, '1');
  });

  test('disable writes env flag', () => {
    const next = updateAdvisorSettings({}, { action: 'disable' });
    assert.equal(next.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, '1');
  });

  test('clear removes both keys', () => {
    const current = { advisorModel: 'some-model', env: { CLAUDE_CODE_DISABLE_ADVISOR_TOOL: '1', OTHER: 'keep' } };
    const next = updateAdvisorSettings(current, { action: 'clear' });
    assert.equal(next.advisorModel, undefined);
    assert.equal(next.env.CLAUDE_CODE_DISABLE_ADVISOR_TOOL, undefined);
    assert.equal(next.env.OTHER, 'keep');
  });

  test('preserves unrelated settings', () => {
    const current = { permissions: { defaultMode: 'acceptEdits' }, env: { KEEP: 'yes' } };
    const next = updateAdvisorSettings(current, { action: 'pick', model: 'claude-opus-5' });
    assert.equal(next.permissions.defaultMode, 'acceptEdits');
    assert.equal(next.env.KEEP, 'yes');
  });
});

describe('isAgentContext', () => {
  test('detects BIZAR_AGENT', () => {
    process.env.BIZAR_AGENT = 'todd';
    assert.equal(isAgentContext(), true);
    delete process.env.BIZAR_AGENT;
  });

  test('detects CLAUDE_CODE_AGENT_NAME', () => {
    process.env.CLAUDE_CODE_AGENT_NAME = 'greg';
    assert.equal(isAgentContext(), true);
    delete process.env.CLAUDE_CODE_AGENT_NAME;
  });

  test('returns false when unset', () => {
    delete process.env.BIZAR_AGENT;
    delete process.env.CLAUDE_CODE_AGENT_NAME;
    assert.equal(isAgentContext(), false);
  });
});
