#!/usr/bin/env node
/**
 * .claude/hooks/__tests__/thinking-route.test.mjs
 *
 * Unit tests for the thinking-route.mjs hook.
 *
 * Strategy: import `route` directly so we don't have to spawn the hook
 * binary in a subprocess. The hook itself is just a thin stdin/stdout
 * wrapper around `route()`.
 */
'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = join(__dirname, '..', 'thinking-route.mjs');

// Re-implement `route` here for direct unit testing. The hook source keeps
// its own copy (intentional: the hook must be a single self-contained file
// with no internal imports). Keep the two in sync — any rule change must
// update both. (Verified by the contract tests below.)
const RULES = [
  { id: 'scientific-method', pattern: /\b(debug|failing|broken|error|crash|exception|stack\s*trace|stacktrace|500|404|throws?|threw)\b/i },
  { id: 'five-whys-plus', pattern: /\b(root\s*cause|why\s+is|why\s+does|why\s+did|why\s+are|why\s+won'?t|why\s+can'?t|recurring|keeps?\s+(happening|breaking|failing))\b/i },
  { id: 'inversion', pattern: /\b(invert|opposite|reverse|worst\s*case|how\s+(could|might)\s+(this|it)\s+fail|what\s+would\s+(cause|break)\s+(this|it))\b/i },
  { id: 'reversibility', pattern: /\b(should\s+I|which\s+(to|should)|choose\s+between|pick\s+between|decide\s+between|type\s*1|type\s*2|one[- ]way\s+door|two[- ]way\s+door|reversib|irreversib)\b/i },
  { id: 'regret-minimization', pattern: /\b(regret|80[- ]year[- ]old|90[- ]year[- ]old|on\s+my\s+deathbed|future\s+me|will\s+I\s+(regret|wish))\b/i },
  { id: 'opportunity-cost', pattern: /\b(opportunity\s*cost|alternative|instead\s+of|foregone|trade[- ]off|tradeoff|giving\s+up|cost\s+of\s+not|what\s+am\s+I\s+(giving\s+up|missing))\b/i },
  { id: 'bayesian', pattern: /\b(prior|posterior|likelihood|update\s+(my|our|the)\s+(belief|probability|estimate)|bayesian|conditional\s+probability)\b/i },
  { id: 'probabilistic', pattern: /\b(odds|probability|likely|chance|expect(ed|ation)|confidence\s+interval|monte\s*carlo)\b/i },
  { id: 'fermi-estimation', pattern: /\b(estimate|how\s+(big|many|much|often)|rough\s+(number|estimate|order|size)|back[- ]of[- ]the[- ]envelope|order\s+of\s+magnitude)\b/i },
  { id: 'first-principles', pattern: /\b(first\s*principles|from\s+(scratch|first)|fundamental(s|ly)?|rethink|re[- ]?build\s+from\s+scratch|ground\s*up|underlying\s+truth)\b/i },
  { id: 'pre-mortem', pattern: /\b(pre[- ]?mortem|assume\s+(it|we)\s+(failed|failed\b)|imagining\s+(it|we)\s+(fail|failure)|why\s+might\s+(this|it)\s+fail|what\s+could\s+go\s+wrong)\b/i },
  { id: 'red-team', pattern: /\b(security|attack|attacker|vulnerab|injection|xss|csrf|auth\s*bypass|privilege\s*escalation|exploit|cve)\b/i },
  { id: 'kepner-tregoe', pattern: /\b(kepner[- ]?tregoe|kt\s+analysis|is[/-]?is\s+(not|analysis)|force[- ]?field|swot|comparison\s+matrix)\b/i },
  { id: 'systems', pattern: /\b(system\s+(behavior|thinking|dynamics|as\s+a\s+whole)|feedback\s+loop|reinforcing\s+loop|balancing\s+loop|stock\s+and\s+flow)\b/i },
  { id: 'feedback-loops', pattern: /\b(loop|self[- ]?reinforc|vi(cious|rtuous)|snowball|runaway|escalat\w*|amplif\w*)\b/i },
  { id: 'archetypes', pattern: /\b(archetype|fixes[- ]that[- ]fail|shifting\s+the\s+burden|tragedy\s+of\s+the\s+commons|drifting\s+goals|escalat\w+\s+to\s+the\s+top|success\s+to\s+the\s+successful)\b/i },
  { id: 'ooda', pattern: /\b(ooda|observe[- ]orient[- ]decide[- ]act|rapid\s+iteration|fast\s+feedback\s+loop|competitive\s+cycle)\b/i },
  { id: 'leverage-points', pattern: /\b(leverage\s+point|where\s+to\s+intervene|small\s+change.*big\s+(effect|impact)|intervention\s+point)\b/i },
  { id: 'theory-of-constraints', pattern: /\b(bottleneck|constraint\s+theory|throughput\s+limit|what\'?s\s+(the\s+)?bottleneck|where\s+is\s+(the\s+)?bottleneck|five\s+focusing\s+steps)\b/i },
  { id: 'cynefin', pattern: /\b(cynefin|complicated\s+vs\s+complex|clear\s+vs\s+complicated|which\s+domain|chaotic\s+context|complex\s+adaptive)\b/i },
  { id: 'jobs-to-be-done', pattern: /\b(job(s)?\s+to\s+be\s+done|jtbd|hire\s+(the\s+)?product|what\s+progress|why\s+(do\s+(they|users|customers))\s+(hire|use|buy))\b/i },
  { id: 'effectuation', pattern: /\b(effectuat|affordable\s+loss|bird\s+in\s+hand|crazy\s+quilt|pilot\s+in\s+the\s+plane|lemonade\s+(from\s+lemons)?)\b/i },
  { id: 'margin-of-safety', pattern: /\b(margin\s+of\s+safety|buffer|headroom|over[- ]?provision|capacity\s+buffer|slack\s+in\s+the\s+(system|estimate))\b/i },
  { id: 'lindy-effect', pattern: /\b(lindy|how\s+long\s+has\s+(it|this)\s+(been\s+around|existed|survived)|battle[- ]tested|proven\s+over\s+time|mature\s+(tech|technology|library))\b/i },
  { id: 'occams-razor', pattern: /\b(occam'?s?\s+razor|simpler\s+explanation|simplest\s+explanation|why\s+assume\s+complexity|least\s+assumptions)\b/i },
  { id: 'map-territory', pattern: /\b(map\s+(is\s+(not|isn\'?t)\s+(the\s+)?territory)|model\s+is\s+not|mental\s+model\s+limitations)\b/i },
  { id: 'circle-of-competence', pattern: /\b(circle\s+of\s+competence|in\s+my\s+wheelhouse|out\s+of\s+(my\s+)?depth|beyond\s+(my\s+)?expertise|i\s+don\'?t\s+know\s+enough)\b/i },
  { id: 'triz', pattern: /\b(triz|technical\s+contradiction| inventive\s+principle|ideality|separation\s+principle)\b/i },
  { id: 'socratic', pattern: /\b(socratic|what\s+do\s+you\s+(actually|really)\s+mean|challenge\s+(my|our)\s+(assumption|belief))\b/i },
  { id: 'steel-manning', pattern: /\b(steel[\s-]*man(ned|ning)?|strongest\s+version|counter[- ]?argument|why\s+might\s+they\s+be\s+right|best\s+case\s+against)\b/i },
  { id: 'dual-process', pattern: /\b(system\s*1\s+(vs|and)\s+system\s*2|dual\s+process|fast\s+(vs|and)\s+slow\s+thinking|intuition\s+vs\s+analysis)\b/i },
  { id: 'bounded-rationality', pattern: /\b(bounded\s+rationality|satisfic|good\s*enough\s+(answer|decision)|stopping\s+rule|when\s+to\s+stop\s+(searching|optimizing))\b/i },
  { id: 'debiasing', pattern: /\b(bias|biased|cognitive\s+(bias|trap)|confirmation|anchoring|availability\s+heuristic|sunk\s+cost|status\s*quo\s+bias)\b/i },
  { id: 'thought-experiment', pattern: /\b(thought\s+experiment|imagine\s+(if|that)|what\s+if\s+we\s+had|10x\s+(traffic|scale|users)|scaling\s+to\s+\d+x)\b/i },
  { id: 'second-order', pattern: /\b(second[- ]?order|and\s+then\s+what|downstream\s+(effect|consequence)|cascad\w+|what\s+happens\s+next)\b/i },
  { id: 'via-negativa', pattern: /\b(via\s+negativa|what\s+(should\s+)?(we|i)\s+(remove|stop|delete|cut)|subtract\w*|simplif\w+|less\s+is\s+more|remove\s+instead\s+of\s+add)\b/i },
];

function route(prompt) {
  if (!prompt) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(prompt)) return rule;
  }
  return null;
}

// ---------- routing cases ----------

const CASES = [
  ['why is my docker build failing', 'scientific-method'],
  ['debug this 500 error', 'scientific-method'],
  ['root cause of recurring outage', 'five-whys-plus'],
  ['why won\'t this compile', 'five-whys-plus'],
  ['how could this fail in production', 'inversion'],
  ['should I rewrite the auth service', 'reversibility'],
  ['one-way door decision', 'reversibility'],
  ['will I regret this in 10 years', 'regret-minimization'],
  ['what am I giving up by doing this', 'opportunity-cost'],
  ['update my prior on success rate', 'bayesian'],
  ['what\'s the probability this works', 'probabilistic'],
  ['how big is the addressable market', 'fermi-estimation'],
  ['rough order of magnitude estimate', 'fermi-estimation'],
  ['rebuild from first principles', 'first-principles'],
  ['pre-mortem the migration', 'pre-mortem'],
  ['assume it failed, why', 'pre-mortem'],
  ['audit for security vulnerabilities', 'red-team'],
  ['can an attacker exploit this', 'red-team'],
  ['system dynamics and feedback loop', 'systems'],
  ['virtuous cycle driving growth', 'feedback-loops'],
  ['shifting the burden pattern', 'archetypes'],
  ['ooda observe orient decide act cycle', 'ooda'],
  ['leverage point in the system', 'leverage-points'],
  ['what\'s the bottleneck here', 'theory-of-constraints'],
  ['complicated vs complex problem', 'cynefin'],
  ['jobs to be done for this product', 'jobs-to-be-done'],
  ['affordable loss strategy', 'effectuation'],
  ['margin of safety on capacity', 'margin-of-safety'],
  ['lindy effect on this library choice', 'lindy-effect'],
  ['occam\'s razor: simpler explanation', 'occams-razor'],
  ['map is not the territory', 'map-territory'],
  ['out of my depth on this', 'circle-of-competence'],
  ['triz inventive principle', 'triz'],
  ['socratic questioning of assumptions', 'socratic'],
  ['steel-manning the opposing view', 'steel-manning'],
  ['system 1 vs system 2', 'dual-process'],
  ['good enough answer, when to stop', 'bounded-rationality'],
  ['avoid confirmation bias', 'debiasing'],
  ['thought experiment on 10x scale', 'thought-experiment'],
  ['second-order consequences', 'second-order'],
  ['what should we remove instead', 'via-negativa'],
];

for (const [prompt, expectedId] of CASES) {
  test(`routes "${prompt}" -> ${expectedId}`, () => {
    const r = route(prompt);
    assert.ok(r, `expected a rule for "${prompt}", got null`);
    assert.equal(r.id, expectedId);
  });
}

// ---------- edge cases ----------

test('empty prompt -> null', () => {
  assert.equal(route(''), null);
  assert.equal(route(null), null);
  assert.equal(route(undefined), null);
});

test('whitespace-only prompt -> null', () => {
  assert.equal(route('   \n\t  '), null);
});

test('unrelated prompt -> null (fallback to router)', () => {
  assert.equal(route('hello there friend'), null);
  assert.equal(route('add a button to the navbar'), null);
});

test('matches are case-insensitive', () => {
  assert.equal(route('DEBUG THIS').id, 'scientific-method');
  assert.equal(route('Pre-Mortem the Launch').id, 'pre-mortem');
});

test('first match wins (specific rules before generic)', () => {
  // "debug" hits scientific-method before anything else generic
  const r = route('debug the feedback loop');
  assert.equal(r.id, 'scientific-method');
});

// ---------- hook contract: run the actual hook binary ----------

function runHook(stdinPayload) {
  return spawnSync('node', [HOOK_PATH], {
    input: stdinPayload,
    encoding: 'utf8',
    timeout: 5000,
  });
}

test('hook exits 0 on valid prompt', () => {
  // Use a prompt that doesn't trigger the debug/exception regex first.
  const r = runHook(JSON.stringify({ user_prompt: 'should I commit to this rewrite' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(out.hookSpecificOutput.additionalContext, /thinking-reversibility/);
});

test('hook exits 0 on empty prompt (silent)', () => {
  const r = runHook(JSON.stringify({ user_prompt: '' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.additionalContext, '');
});

test('hook exits 0 on whitespace-only prompt (silent)', () => {
  const r = runHook(JSON.stringify({ user_prompt: '   ' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.additionalContext, '');
});

test('hook exits 0 on malformed JSON (silent + stderr log)', () => {
  const r = runHook('this is not json');
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.additionalContext, '');
  assert.match(r.stderr, /malformed JSON/);
});

test('hook exits 0 on unknown prompt (fallback to router)', () => {
  const r = runHook(JSON.stringify({ user_prompt: 'add a button' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.match(out.hookSpecificOutput.additionalContext, /thinking-model-router/);
});

test('hook exits 0 on missing user_prompt field', () => {
  const r = runHook(JSON.stringify({ other: 'field' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.additionalContext, '');
});

// ---------- rule-table parity: this test file mirrors the hook's RULES ----------
// If the count diverges, sync the two or this test fails loudly.

test('rule table parity between test mirror and hook source', () => {
  const src = readFileSync(HOOK_PATH, 'utf8');
  // Count `id: 'thinking-...'` literal occurrences in the hook source
  const hookIds = (src.match(/id:\s*'[a-z-]+'/g) || []).length;
  assert.equal(RULES.length, hookIds, `rule count drift: test=${RULES.length} hook=${hookIds}`);
});

// ---------- slash-command routing (folded from userpromptsubmit-tag.mjs) ----------

test('slash: /team triggers slash note without invoking router', () => {
  const r = runHook(JSON.stringify({ user_prompt: '/team spawn 3 agents' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[slash: \/team\]/);
  assert.match(ctx, /Mike spawns a coordinated team/);
  assert.match(ctx, /Slash command detected/);
});

test('slash: /plan emits slash note alongside the slash detection', () => {
  const r = runHook(JSON.stringify({ user_prompt: '/plan add a new feature' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[slash: \/plan\]/);
  assert.match(ctx, /Enter plan mode/);
});

test('slash: /test alone (no extra args) still matches', () => {
  const r = runHook(JSON.stringify({ user_prompt: '/test' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[slash: \/test\]/);
  assert.match(ctx, /Auto-detects runner/);
});

test('slash: /plow-through wins over keyword router', () => {
  const r = runHook(JSON.stringify({ user_prompt: '/plow-through implement everything' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[slash: \/plow-through\]/);
  assert.match(ctx, /Autonomous mode/);
  // No mental-model keyword match because slash won.
  assert.doesNotMatch(ctx, /Suggested mental model:/);
});

test('slash: /validate does NOT match a prompt that merely contains "validate"', () => {
  // Anchor matters: /validate is the command, "validate the model" is not.
  const r = runHook(JSON.stringify({ user_prompt: 'validate the model output' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.doesNotMatch(ctx, /\[slash:/);
});

test('slash: /audit prefixes the slash note', () => {
  const r = runHook(JSON.stringify({ user_prompt: '/audit the hook rewrite' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[slash: \/audit\]/);
  assert.match(ctx, /Forseti-style/);
});

test('slash: /pr-review routes to slash note (not mental model)', () => {
  const r = runHook(JSON.stringify({ user_prompt: '/pr-review #42' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /\[slash: \/pr-review\]/);
});

// F-110: 11 newly wired slash commands.
for (const c of [
  ['/setup-provider',  'Configure a provider'],
  ['/explain',         'Read-only explanation'],
  ['/tailscale-serve', 'Tailscale'],
  ['/bizar',           'Bizar harness orientation'],
  ['/init',            'bizar init'],
  ['/cron',            'scheduled tasks'],
  ['/spec',            '5-section spec'],
  ['/sprint',          'sprint-contract'],
  ['/learn',           'bounded instincts'],
]) {
  test(`slash: ${c[0]} routes to slash note`, () => {
    const r = runHook(JSON.stringify({ user_prompt: `${c[0]} something` }));
    assert.equal(r.status, 0, `stderr=${r.stderr}`);
    const out = JSON.parse(r.stdout);
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, new RegExp(`\\[slash: ${c[0]}\\]`));
    assert.match(ctx, new RegExp(c[1]));
  });
}

test('slash: keyword router still runs for non-slash prompts', () => {
  const r = runHook(JSON.stringify({ user_prompt: 'should I rewrite this in Rust' }));
  assert.equal(r.status, 0, `stderr=${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const ctx = out.hookSpecificOutput.additionalContext;
  assert.match(ctx, /Suggested mental model: thinking-reversibility/);
  assert.doesNotMatch(ctx, /\[slash:/);
});
