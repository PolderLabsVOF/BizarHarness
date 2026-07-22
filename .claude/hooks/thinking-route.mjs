#!/usr/bin/env node
/**
 * .claude/hooks/thinking-route.mjs
 *
 * Bizar Thinking-Route — UserPromptSubmit hook.
 *
 * Runs on every user prompt. Performs a deterministic keyword/regex match
 * against the prompt and emits a one-line suggestion pointing the agent at
 * the most relevant `thinking-*` mental-model skill.
 *
 * No LLM call here — this is a *hint*, not a router call. The router skill
 * itself (thinking-model-router) does LLM-driven routing when invoked. The
 * hook just primes the next turn with a likely-relevant model name.
 *
 * Claude Code stdin shape (UserPromptSubmit):
 *   { "user_prompt": "raw prompt text", ... }
 *
 * Claude Code stdout shape (hookSpecificOutput.additionalContext):
 *   { "hookSpecificOutput": {
 *       "hookEventName": "UserPromptSubmit",
 *       "additionalContext": "Suggested mental model: ..."
 *   }}
 *
 * Always exits 0 — suggestion, not gate.
 */
'use strict';

// First-match wins. Order matters: more specific patterns come first.
const RULES = [
  {
    id: 'scientific-method',
    pattern: /\b(debug|failing|broken|error|crash|exception|stack\s*trace|stacktrace|500|404|throws?|threw)\b/i,
    rationale: 'a debugging symptom that needs ranking of falsifiable hypotheses before patching',
  },
  {
    id: 'five-whys-plus',
    pattern: /\b(root\s*cause|why\s+is|why\s+does|why\s+did|why\s+are|why\s+won'?t|why\s+can'?t|recurring|keeps?\s+(happening|breaking|failing))\b/i,
    rationale: 'an iterative drill into a recurring root cause',
  },
  {
    id: 'inversion',
    pattern: /\b(invert|opposite|reverse|worst\s*case|how\s+(could|might)\s+(this|it)\s+fail|what\s+would\s+(cause|break)\s+(this|it))\b/i,
    rationale: 'inverting the problem to find hidden failure modes',
  },
  {
    id: 'reversibility',
    pattern: /\b(should\s+I|which\s+(to|should)|choose\s+between|pick\s+between|decide\s+between|type\s*1|type\s*2|one[- ]way\s+door|two[- ]way\s+door|reversib|irreversib)\b/i,
    rationale: 'a Type 1 vs Type 2 decision that hinges on reversibility',
  },
  {
    id: 'regret-minimization',
    pattern: /\b(regret|80[- ]year[- ]old|90[- ]year[- ]old|on\s+my\s+deathbed|future\s+me|will\s+I\s+(regret|wish))\b/i,
    rationale: 'a high-stakes choice where minimizing long-term regret matters',
  },
  {
    id: 'opportunity-cost',
    pattern: /\b(opportunity\s*cost|alternative|instead\s+of|foregone|trade[- ]off|tradeoff|giving\s+up|cost\s+of\s+not|what\s+am\s+I\s+(giving\s+up|missing))\b/i,
    rationale: 'a choice where the value of the next-best alternative matters',
  },
  {
    id: 'bayesian',
    pattern: /\b(prior|posterior|likelihood|update\s+(my|our|the)\s+(belief|probability|estimate)|bayesian|conditional\s+probability)\b/i,
    rationale: 'updating a belief given new evidence',
  },
  {
    id: 'probabilistic',
    pattern: /\b(odds|probability|likely|chance|expect(ed|ation)|confidence\s+interval|monte\s*carlo)\b/i,
    rationale: 'reasoning under quantified uncertainty',
  },
  {
    id: 'fermi-estimation',
    pattern: /\b(estimate|how\s+(big|many|much|often)|rough\s+(number|estimate|order|size)|back[- ]of[- ]the[- ]envelope|order\s+of\s+magnitude)\b/i,
    rationale: 'a number you can\'t measure but can decompose and bound',
  },
  {
    id: 'first-principles',
    pattern: /\b(first\s*principles|from\s+(scratch|first)|fundamental(s|ly)?|rethink|re[- ]?build\s+from\s+scratch|ground\s*up|underlying\s+truth)\b/i,
    rationale: 'breaking an assumption to rebuild from fundamentals',
  },
  {
    id: 'pre-mortem',
    pattern: /\b(pre[- ]?mortem|assume\s+(it|we)\s+(failed|failed\b)|imagining\s+(it|we)\s+(fail|failure)|why\s+might\s+(this|it)\s+fail|what\s+could\s+go\s+wrong)\b/i,
    rationale: 'imagining failure before launch to surface risks early',
  },
  {
    id: 'red-team',
    pattern: /\b(security|attack|attacker|vulnerab|injection|xss|csrf|auth\s*bypass|privilege\s*escalation|exploit|cve)\b/i,
    rationale: 'a security review that needs an attacker mindset with reproducible attack paths',
  },
  {
    id: 'kepner-tregoe',
    pattern: /\b(kepner[- ]?tregoe|kt\s+analysis|is[/-]?is\s+(not|analysis)|force[- ]?field|swot|comparison\s+matrix)\b/i,
    rationale: 'a structured decision or problem analysis across multiple alternatives',
  },
  {
    id: 'systems',
    pattern: /\b(system\s+(behavior|thinking|dynamics|as\s+a\s+whole)|feedback\s+loop|reinforcing\s+loop|balancing\s+loop|stock\s+and\s+flow)\b/i,
    rationale: 'system-level behavior driven by feedback dynamics',
  },
  {
    id: 'feedback-loops',
    pattern: /\b(loop|self[- ]?reinforc|vi(cious|rtuous)|snowball|runaway|escalat\w*|amplif\w*)\b/i,
    rationale: 'a reinforcing/balancing feedback loop driving the behavior',
  },
  {
    id: 'archetypes',
    pattern: /\b(archetype|fixes[- ]that[- ]fail|shifting\s+the\s+burden|tragedy\s+of\s+the\s+commons|drifting\s+goals|escalat\w+\s+to\s+the\s+top|success\s+to\s+the\s+successful)\b/i,
    rationale: 'a recognizable system archetype pattern',
  },
  {
    id: 'ooda',
    pattern: /\b(ooda|observe[- ]orient[- ]decide[- ]act|rapid\s+iteration|fast\s+feedback\s+loop|competitive\s+cycle)\b/i,
    rationale: 'rapid observe–orient–decide–act cycles under competitive pressure',
  },
  {
    id: 'leverage-points',
    pattern: /\b(leverage\s+point|where\s+to\s+intervene|small\s+change.*big\s+(effect|impact)|intervention\s+point)\b/i,
    rationale: 'finding where a small change produces a large system-level effect',
  },
  {
    id: 'theory-of-constraints',
    pattern: /\b(bottleneck|constraint\s+theory|throughput\s+limit|what\'?s\s+(the\s+)?bottleneck|where\s+is\s+(the\s+)?bottleneck|five\s+focusing\s+steps)\b/i,
    rationale: 'identifying the single constraint that limits throughput',
  },
  {
    id: 'cynefin',
    pattern: /\b(cynefin|complicated\s+vs\s+complex|clear\s+vs\s+complicated|which\s+domain|chaotic\s+context|complex\s+adaptive)\b/i,
    rationale: 'classifying the problem domain to pick the right response approach',
  },
  {
    id: 'jobs-to-be-done',
    pattern: /\b(job(s)?\s+to\s+be\s+done|jtbd|hire\s+(the\s+)?product|what\s+progress|why\s+(do\s+(they|users|customers))\s+(hire|use|buy))\b/i,
    rationale: 'reframing the feature around the user\'s underlying job',
  },
  {
    id: 'effectuation',
    pattern: /\b(effectuat|affordable\s+loss|bird\s+in\s+hand|crazy\s+quilt|pilot\s+in\s+the\s+plane|lemonade\s+(from\s+lemons)?)\b/i,
    rationale: 'starting from means (not goals) under genuine uncertainty',
  },
  {
    id: 'margin-of-safety',
    pattern: /\b(margin\s+of\s+safety|buffer|headroom|over[- ]?provision|capacity\s+buffer|slack\s+in\s+the\s+(system|estimate))\b/i,
    rationale: 'sizing a buffer to the cost of being wrong under uncertainty',
  },
  {
    id: 'lindy-effect',
    pattern: /\b(lindy|how\s+long\s+has\s+(it|this)\s+(been\s+around|existed|survived)|battle[- ]tested|proven\s+over\s+time|mature\s+(tech|technology|library))\b/i,
    rationale: 'favoring the proven technology under a longevity lens',
  },
  {
    id: 'occams-razor',
    pattern: /\b(occam'?s?\s+razor|simpler\s+explanation|simplest\s+explanation|why\s+assume\s+complexity|least\s+assumptions)\b/i,
    rationale: 'picking the simplest explanation consistent with the evidence',
  },
  {
    id: 'map-territory',
    pattern: /\b(map\s+(is\s+(not|isn\'?t)\s+(the\s+)?territory)|model\s+is\s+not|mental\s+model\s+limitations)\b/i,
    rationale: 'recognizing that every model is a simplification of reality',
  },
  {
    id: 'circle-of-competence',
    pattern: /\b(circle\s+of\s+competence|in\s+my\s+wheelhouse|out\s+of\s+(my\s+)?depth|beyond\s+(my\s+)?expertise|i\s+don\'?t\s+know\s+enough)\b/i,
    rationale: 'checking whether the question sits inside your expertise',
  },
  {
    id: 'triz',
    pattern: /\b(triz|technical\s+contradiction| inventive\s+principle|ideality|separation\s+principle)\b/i,
    rationale: 'resolving a technical contradiction via inventive principles',
  },
  {
    id: 'socratic',
    pattern: /\b(socratic|what\s+do\s+you\s+(actually|really)\s+mean|challenge\s+(my|our)\s+(assumption|belief))\b/i,
    rationale: 'using disciplined questioning to surface hidden assumptions',
  },
  {
    id: 'steel-manning',
    pattern: /\b(steel[\s-]*man(ned|ning)?|strongest\s+version|counter[- ]?argument|why\s+might\s+they\s+be\s+right|best\s+case\s+against)\b/i,
    rationale: 'rebuilding the opposing argument in its strongest form before rebutting',
  },
  {
    id: 'dual-process',
    pattern: /\b(system\s*1\s+(vs|and)\s+system\s*2|dual\s+process|fast\s+(vs|and)\s+slow\s+thinking|intuition\s+vs\s+analysis)\b/i,
    rationale: 'separating intuitive (fast) from analytical (slow) reasoning modes',
  },
  {
    id: 'bounded-rationality',
    pattern: /\b(bounded\s+rationality|satisfic|good\s*enough\s+(answer|decision)|stopping\s+rule|when\s+to\s+stop\s+(searching|optimizing))\b/i,
    rationale: 'choosing a good-enough answer under search-cost limits',
  },
  {
    id: 'debiasing',
    pattern: /\b(bias|biased|cognitive\s+(bias|trap)|confirmation|anchoring|availability\s+heuristic|sunk\s+cost|status\s*quo\s+bias)\b/i,
    rationale: 'naming the bias at risk and neutralizing it',
  },
  {
    id: 'thought-experiment',
    pattern: /\b(thought\s+experiment|imagine\s+(if|that)|what\s+if\s+we\s+had|10x\s+(traffic|scale|users)|scaling\s+to\s+\d+x)\b/i,
    rationale: 'imagining a scenario to walk the consequence chain',
  },
  {
    id: 'second-order',
    pattern: /\b(second[- ]?order|and\s+then\s+what|downstream\s+(effect|consequence)|cascad\w+|what\s+happens\s+next)\b/i,
    rationale: 'tracing second- and third-order consequences of a decision',
  },
  {
    id: 'via-negativa',
    pattern: /\b(via\s+negativa|what\s+(should\s+)?(we|i)\s+(remove|stop|delete|cut)|subtract\w*|simplif\w+|less\s+is\s+more|remove\s+instead\s+of\s+add)\b/i,
    rationale: 'asking what to remove before adding anything new',
  },
];

function route(prompt) {
  if (!prompt) return null;
  for (const rule of RULES) {
    if (rule.pattern.test(prompt)) return rule;
  }
  return null;
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let input = {};
  try {
    input = JSON.parse(raw || '{}');
  } catch (err) {
    process.stderr.write(
      `[bizar.thinking-route] WARN: malformed JSON on stdin: ${
        err && err.message ? err.message : String(err)
      }\n`,
    );
    input = {};
  }

  const prompt = String(input.user_prompt || '').trim();

  // Empty / whitespace-only → silent. No commit, no model.
  if (prompt.length === 0) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'UserPromptSubmit',
        additionalContext: '',
      },
    }) + '\n');
    process.exit(0);
    return;
  }

  // Slash-command routing — fires BEFORE the mental-model router.
  // First-match-wins: longer / more specific commands listed first.
  const SLASH = [
    { cmd: '/plow-through',    note: 'Autonomous mode — dispatch 2+ parallel agents when possible; run /test before claiming done.' },
    { cmd: '/pr-review',       note: 'Review a PR — read the diff, score against the rubric, write findings.' },
    { cmd: '/setup-provider',  note: 'Configure a provider (Anthropic / OpenRouter / Bedrock / Vertex / Foundry) for this Bizar install.' },
    { cmd: '/validate',        note: 'Runs the 21-point Bizar install health check.' },
    { cmd: '/team',            note: 'Odin spawns a coordinated team — confirm disjoint file scopes before dispatch.' },
    { cmd: '/plan',            note: 'Enter plan mode — no edits until ExitPlanMode; write the plan file first.' },
    { cmd: '/audit',           note: 'Run Forseti-style code-review audit on the current diff.' },
    { cmd: '/test',            note: 'Auto-detects runner (jest/vitest/bun/pytest/cargo/go); streams output.' },
    { cmd: '/explain',         note: 'Read-only explanation — dispatch susan (or general-purpose) to look up the answer with file:line refs.' },
    { cmd: '/visual-plan',     note: 'Toggle the Bizar visual plan canvas or check its status.' },
    { cmd: '/tailscale-serve', note: 'Authenticate Tailscale and configure `tailscale serve` for a local port.' },
    { cmd: '/bizar',           note: 'Bizar SDK passthrough — `npx bizar <subcommand>` (memory, plan, loops, graph).' },
    { cmd: '/init',            note: 'Run `bizar init` to scaffold memory vault, project context, and graph index in this repo.' },
    { cmd: '/cron',            note: 'Manage scheduled tasks via the Bizar SDK cron API — list / add / remove / pause.' },
    { cmd: '/spec',            note: 'Generate a 5-section spec (Goal, Scope, DoD, Out-of-Scope, Open Questions); checks for duplicates first.' },
    { cmd: '/sprint',          note: 'Read the next goal from `.bizar/PROGRESS.md` and pre-fill `templates/sprint-contract.md`.' },
    { cmd: '/goal',            note: 'Add or update a long-term goal — Heimdall writes it to `.bizar/GOALS.md`.' },
    { cmd: '/learn',           note: 'Heimdall reviews recent instincts + session transcripts and writes a self-improvement entry.' },
  ];

  let slashNote = '';
  for (const s of SLASH) {
    if (prompt === s.cmd || prompt.startsWith(s.cmd + ' ') || prompt.startsWith(s.cmd + '\t')) {
      slashNote = `[slash: ${s.cmd}] ${s.note}`;
      break;
    }
  }

  let rule;
  try {
    rule = route(prompt);
  } catch (err) {
    process.stderr.write(
      `[bizar.thinking-route] WARN: route() threw: ${
        err && err.message ? err.message : String(err)
      }\n`,
    );
    rule = null;
  }

  let modelNote;
  if (rule) {
    modelNote = `Suggested mental model: thinking-${rule.id} — ${rule.rationale}. ` +
      `Invoke via the Skill tool, or run thinking-model-router for a fuller classification.`;
  } else if (slashNote) {
    modelNote = 'Slash command detected — model router not invoked.';
  } else {
    modelNote = 'No keyword match. Use thinking-model-router (the upstream meta-skill) to classify this prompt and pick a thinking-* skill.';
  }

  const note = slashNote
    ? `${slashNote} ${modelNote}`
    : modelNote;

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: note,
    },
  }) + '\n');
  process.exit(0);
});