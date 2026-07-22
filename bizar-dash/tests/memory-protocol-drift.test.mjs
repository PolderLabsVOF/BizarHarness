import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

function read(rel) {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8');
}

test('memory-protocol SKILL.md has MANDATORY framing at the top', () => {
  const skill = read('config/skills/memory-protocol/SKILL.md');
  // The "MANDATORY" badge must appear in the first 10 lines
  const head = skill.split('\n').slice(0, 10).join('\n');
  assert.match(head, /MANDATORY/, 'memory-protocol/SKILL.md must mark the protocol as MANDATORY in the first 10 lines');
});

// F-107: AGENT_BASELINE.md is canonical at .claude/agents/_shared/.
// The legacy config/agents/_shared/ copy was removed (Cline-era).
test('AGENT_BASELINE.md section 5 has MANDATORY marker', () => {
  const baseline = read('.claude/agents/_shared/AGENT_BASELINE.md');
  // Find section 5 header and the next 20 lines
  const section5Idx = baseline.indexOf('## 5.');
  assert.ok(section5Idx >= 0, 'AGENT_BASELINE.md must have a section 5');
  const section5Head = baseline.slice(section5Idx, section5Idx + 600);
  // Canonical uses "**Mandatory at session start.**" (mixed case, bold).
  assert.match(section5Head, /[Mm]andatory/, 'AGENT_BASELINE.md section 5 must mark memory check as Mandatory');
});

test('AGENT_BASELINE.md self-improvement section has mandatory language', () => {
  const baseline = read('.claude/agents/_shared/AGENT_BASELINE.md');
  // Canonical has section 12 (Brenda's Records Duty) — not 13.
  // Legacy had a "## 13." stub that was removed during the Claude Code migration.
  const section12Idx = baseline.indexOf('## 12.');
  assert.ok(section12Idx >= 0, 'AGENT_BASELINE.md must have a section 12 (Brenda self-improvement duty)');
  const section12Head = baseline.slice(section12Idx, section12Idx + 3000);
  // Either the canonical "Brenda-only. After every implementation" framing
  // or the legacy "mandatory, not optional" line. The point: enforce that
  // self-improvement is a duty, not optional guidance.
  const hasDuty = /Brenda-only/.test(section12Head) || /mandatory, not optional/i.test(section12Head);
  assert.ok(hasDuty, 'AGENT_BASELINE.md section 12 must contain a duty/mandatory framing for Brenda self-improvement');
});

test('AGENT_BASELINE.md session-start bootstrap commands are present', () => {
  const baseline = read('.claude/agents/_shared/AGENT_BASELINE.md');
  // The actual commands agents must run
  assert.match(baseline, /bizar memory search/, 'AGENT_BASELINE.md must reference `bizar memory search`');
  assert.match(baseline, /bizar memory status/, 'AGENT_BASELINE.md must reference `bizar memory status`');
});
