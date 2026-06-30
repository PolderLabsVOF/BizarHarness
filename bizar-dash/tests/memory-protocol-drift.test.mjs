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

test('AGENT_BASELINE.md section 5 has MANDATORY marker', () => {
  const baseline = read('config/agents/_shared/AGENT_BASELINE.md');
  // Find section 5 header and the next 20 lines
  const section5Idx = baseline.indexOf('## 5.');
  assert.ok(section5Idx >= 0, 'AGENT_BASELINE.md must have a section 5');
  const section5Head = baseline.slice(section5Idx, section5Idx + 600);
  assert.match(section5Head, /MANDATORY/, 'AGENT_BASELINE.md section 5 must mark memory check as MANDATORY');
});

test('AGENT_BASELINE.md section 13 has mandatory language', () => {
  const baseline = read('config/agents/_shared/AGENT_BASELINE.md');
  const section13Idx = baseline.indexOf('## 13.');
  assert.ok(section13Idx >= 0, 'AGENT_BASELINE.md must have a section 13');
  const section13Head = baseline.slice(section13Idx, section13Idx + 3000);
  // Either the ⚠️ ENFORCED marker we just added, or the existing "mandatory, not optional" line
  const hasMandatory = /MANDATORY/.test(section13Head) || /mandatory, not optional/i.test(section13Head);
  assert.ok(hasMandatory, 'AGENT_BASELINE.md section 13 must contain MANDATORY framing or the existing "mandatory, not optional" language');
});

test('AGENT_BASELINE.md session-start bootstrap commands are present', () => {
  const baseline = read('config/agents/_shared/AGENT_BASELINE.md');
  // The actual commands agents must run
  assert.match(baseline, /bizar memory search/, 'AGENT_BASELINE.md must reference `bizar memory search`');
  assert.match(baseline, /bizar memory status/, 'AGENT_BASELINE.md must reference `bizar memory status`');
});
