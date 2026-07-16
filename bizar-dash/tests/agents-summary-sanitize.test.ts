/**
 * tests/agents-summary-sanitize.test.ts
 *
 * Bug C1 — Sanitize leaked LLM reasoning monologue from agent card labels.
 * Verifies sanitizeSummary():
 *   1. Clips at first sentence, strips worktree:[Premise, code blocks
 *   2. Short normal summary passes through unchanged
 *   3. 200-char summary gets capped at 140 + ellipsis
 */
import { describe, it, expect } from 'vitest';
import { sanitizeSummary } from '../src/web/v8/views/Agents/AgentsView.js';

describe('sanitizeSummary', () => {
  it('clips leaked monologue and strips CC-reasoning artifacts', () => {
    const leaked = '[Premise — User likely wanted a quick answer. Already shown above. worktree: /home/drb0rk/projects/BizarHarness (the project dir). Reason: the user asked.';
    const result = sanitizeSummary(leaked);
    expect(result).not.toContain('worktree:');
    expect(result).not.toContain('[Premise');
    expect(result).toBe('User likely wanted a quick answer.');
  });

  it('strips fenced code blocks', () => {
    const input = 'Here is the plan:\n```\ncd /tmp\nrm -rf /\n```\nFinal decision.';
    const result = sanitizeSummary(input);
    expect(result).not.toContain('```');
    expect(result).toContain('Final decision.');
  });

  it('strips <thinking> blocks', () => {
    const input = 'Answer here.<thinking>Let me reconsider this...</thinking>More text.';
    const result = sanitizeSummary(input);
    expect(result).not.toContain('<thinking>');
    expect(result).toContain('Answer here.');
  });

  it('passes short normal summary unchanged', () => {
    const input = 'Fixed the auth middleware token check.';
    expect(sanitizeSummary(input)).toBe(input);
  });

  it('caps 200-char summary at 140 + ellipsis', () => {
    const long = 'A'.repeat(200);
    const result = sanitizeSummary(long);
    expect(result.length).toBeLessThanOrEqual(140);
    expect(result.endsWith('…')).toBe(true);
  });

  it('returns empty string for undefined input', () => {
    expect(sanitizeSummary(undefined as unknown as string)).toBe('');
  });
});
