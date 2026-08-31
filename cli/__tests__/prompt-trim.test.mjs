/**
 * cli/__tests__/prompt-trim.test.mjs
 *
 * Pin tests for v10.20.0 mechanical trim of the Bizar harness prompt surface.
 *
 * Background: every Bizar agent dispatch re-pays the cost of static prompt
 * text injected into the subagent context. A previous version of the harness
 * shipped ~14-16 KB of recoverable bloat per orchestrator turn — duplicated
 * tool-shape pointers on every agent file, a 700-char grounding payload,
 * 6 KB advisor-context dumps, verbose Mike self-improvement walkthroughs,
 * and Skill-delegate command bodies that grew past their budget.
 *
 * The trims in this release (see docs/plans/2026-08-31-prompt-token-reduction.md,
 * Phase A) reduce that surface to ~50 % of the previous size with zero
 * behavior change. These tests pin the budgets so a future edit cannot
 * silently regress them.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname;
const AGENTS_DIR = join(ROOT, 'config/claude/agents');
const COMMANDS_DIR = join(ROOT, 'config/claude/commands');
const SHARED_BASELINE = join(ROOT, 'config/claude/agents/_shared/AGENT_BASELINE.md');
const GROUNDING_HOOK = join(ROOT, 'config/claude/hooks/agent-grounding.mjs');
const ADVISOR_HOOK = join(ROOT, 'config/claude/hooks/advisor-context.mjs');
const OFFICE_MANAGER = join(ROOT, 'config/claude/agents/office-manager.md');
const PROVISION = join(ROOT, 'cli/provision.mjs');

function agentFiles() {
  return readdirSync(AGENTS_DIR).filter((f) => f.endsWith('.md') && f !== '_shared');
}

function commandFiles() {
  return readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.md'));
}

describe('prompt-trim v10.20.0', () => {
  test('office-manager.md is under 300 lines', () => {
    const lines = readFileSync(OFFICE_MANAGER, 'utf8').split('\n').length;
    assert.ok(lines <= 300, `office-manager.md is ${lines} lines, must be <= 300`);
  });

  test('AGENT_BASELINE.md has External APIs + Git sections', () => {
    const src = readFileSync(SHARED_BASELINE, 'utf8');
    assert.match(src, /## External APIs/);
    assert.match(src, /## Git/);
  });

  test('AGENT_BASELINE.md is under 80 lines', () => {
    const lines = readFileSync(SHARED_BASELINE, 'utf8').split('\n').length;
    assert.ok(lines <= 80, `AGENT_BASELINE.md is ${lines} lines, must be <= 80`);
  });

  test('every agent file has description: <=100 chars AND name/description pairing', () => {
    for (const f of agentFiles()) {
      const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
      const descMatch = src.match(/^description:\s*(.+)$/m);
      assert.ok(descMatch, `${f} missing description:`);
      assert.ok(
        descMatch[1].length <= 100,
        `${f} description is ${descMatch[1].length} chars: ${descMatch[1].slice(0, 60)}...`,
      );
      // Strengthened cross-check: description must start with `<Name> —`
      // where Name is the title-cased `name:` field. Prevents description
      // / name swap regressions that the Phase A suite missed because it
      // only asserted description length.
      const nameMatch = src.match(/^name:\s*(\S+)$/m);
      assert.ok(nameMatch, `${f} missing name:`);
      const expectedPrefix =
        nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1);
      assert.ok(
        descMatch[1].startsWith(`${expectedPrefix} —`),
        `${f} description "${descMatch[1]}" does not match name "${nameMatch[1]}"`,
      );
    }
  });

  test('agent-grounding.mjs hook payload is under 200 chars', () => {
    const src = readFileSync(GROUNDING_HOOK, 'utf8');
    // The payload may be inlined as a string/template literal OR assigned to
    // a `context` variable then forwarded to additionalContext. Match either.
    let payload = null;
    for (const re of [
      /additionalContext:\s*[`'"'"']([^`'"'"']+)[`'"'"']/,
      /const\s+context\s*=\s*[`'"'"']([^`'"'"']+)[`'"'"']/,
    ]) {
      const m = src.match(re);
      if (m) { payload = m[1]; break; }
    }
    assert.ok(payload, 'no additionalContext or context literal found');
    assert.ok(payload.length <= 200, `payload is ${payload.length} chars`);
  });

  test('all Skill-delegate slash commands have a terse body', () => {
    for (const f of commandFiles()) {
      const src = readFileSync(join(COMMANDS_DIR, f), 'utf8');
      // Only check files that are actually Skill delegates — frontmatter
      // must declare `allowed-tools: Skill` (not just mention "Skills" in body).
      if (!/^allowed-tools:\s*Skill\s*$/m.test(src)) continue;
      const bodyLines = src
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('---') && !/^(allowed-tools|description):/.test(l));
      assert.ok(
        bodyLines.length <= 10,
        `${f} skill-delegate body too verbose: ${bodyLines.length} lines`,
      );
    }
  });

  test('advisor-context.mjs TOTAL_CAP is 2048 or less', () => {
    const src = readFileSync(ADVISOR_HOOK, 'utf8');
    assert.match(src, /TOTAL_CAP\s*=\s*2048/);
  });

  test('advisor-context.mjs MAX_RECORDS is 4 or less', () => {
    const src = readFileSync(ADVISOR_HOOK, 'utf8');
    const match = src.match(/MAX_RECORDS\s*=\s*(\d+)/);
    assert.ok(match, 'no MAX_RECORDS found');
    assert.ok(Number(match[1]) <= 4, `MAX_RECORDS = ${match[1]}, must be <= 4`);
  });

  test('no agent body has duplicated tool-shapes or baseline footer', () => {
    for (const f of agentFiles()) {
      const src = readFileSync(join(AGENTS_DIR, f), 'utf8');
      assert.doesNotMatch(src, /Claude Code tool shapes/, `${f} still has tool-shapes footer`);
      assert.doesNotMatch(
        src,
        /Follow `\.claude\/agents\/_shared/,
        `${f} still has duplicated baseline footer`,
      );
    }
  });

  test('syncAgentFiles copies _shared/*.md into the dest tree', () => {
    // Lighter-weight pin: the source of syncAgentFiles in cli/provision.mjs
    // must include the `_shared` copy block added in v10.20.0. End-to-end
    // behavior is exercised by the broader provision test suite; this guards
    // against accidental regression of the precondition (R0) that ships
    // AGENT_BASELINE + CLAUDE_TOOLS + SKILLS to the user's machine.
    const src = readFileSync(PROVISION, 'utf8');
    assert.match(
      src,
      /sharedSrc\s*=\s*join\(src,\s*['_"]_shared['"]\)/,
      'syncAgentFiles must explicitly copy _shared/*.md (R0 precondition)',
    );
    assert.match(
      src,
      /sharedDst\s*=\s*join\(dest,\s*['_"]_shared['"]\)/,
      'syncAgentFiles must write into dest/_shared/',
    );
    assert.match(
      src,
      /sharedSrc\)\)\s*\{[^}]*if\s*\(\s*f\.endsWith\(['"]\.md['"]\)\s*\)/,
      'syncAgentFiles must filter shared copy to .md files',
    );
  });
});