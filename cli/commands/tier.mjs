#!/usr/bin/env node
/**
 * cli/commands/tier.mjs
 *
 * `bizar tier` — automatic task-based model selection.
 *
 * Replays the same tier resolution the @mike orchestrator uses:
 *  1. Read the role default from the global Bizar model router.
 *  2. Adjust the tier from current task risk and complexity.
 *  3. Print ordered candidates; dispatch uses a candidate only when live
 *     discovery proves it, otherwise Agent omits model and inherits the session.
 *
 * A failed dispatch is never retried by cycling aliases or providers.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { resolveGlobalModelRouter } from '../config-paths.mjs';

const ROUTER_PATHS = [
  process.env.BIZAR_MODEL_ROUTER_PATH,
  resolveGlobalModelRouter(),
].filter(Boolean);

function loadRouter() {
  for (const path of ROUTER_PATHS) {
    if (existsSync(path)) {
      try {
        return { path, config: JSON.parse(readFileSync(path, 'utf8')) };
      } catch (err) {
        throw new Error(`failed to parse ${path}: ${err.message}`);
      }
    }
  }
  throw new Error('no model-router.json found — run `bizar install` first');
}

const ESCALATE_KEYWORDS = [
  'design', 'review', 'audit', 'plan', 'spec', 'architecture',
  'security', 'refactor', 'trade-off', 'tradeoff', 'reason',
  'verify', 'compare', 'analyze', 'analyse', 'explain why',
];
const DEMOTE_KEYWORDS = [
  'rename', 'format', 'lint', 'chmod', 'reformat', 'stub',
  'comment', 'docstring', 'wording', 'spell', 'typo',
];

function adjustTier(baseTier, task) {
  const lower = task.toLowerCase();
  const wantEscalate = ESCALATE_KEYWORDS.some((kw) => lower.includes(kw));
  const wantDemote = DEMOTE_KEYWORDS.some((kw) => lower.includes(kw));
  if (wantEscalate && wantDemote) return { tier: baseTier, reason: 'mixed signals — default tier wins' };
  if (wantEscalate) return { tier: 'high', reason: 'task requires reasoning / review' };
  if (wantDemote) return { tier: 'budget', reason: 'task is a deterministic mechanical edit' };
  return { tier: baseTier, reason: 'task matches default tier' };
}

const TIER_ORDER = ['budget', 'mid', 'default', 'mid-design', 'high', 'premium'];

function liftTier(tier) {
  const i = TIER_ORDER.indexOf(tier);
  if (i === -1 || i === TIER_ORDER.length - 1) return tier;
  return TIER_ORDER[i + 1];
}

export async function runTier(cmdArgs) {
  if (cmdArgs.includes('--help') || cmdArgs.includes('-h')) {
    console.log(`
  bizar tier — automatic task-based model selection

  Usage:
    bizar tier [--agent <name>] [--list] [--json] <task-description>
    bizar tier --list        List every shipped agent and its default tier.

  Returns the dynamic tier and ordered model candidates for the named role
  (defaults to "mike"). Mike uses a concrete candidate only after live
  routing. Every dispatch keeps an explicit configured model.
`);
    return;
  }

  const { path, config } = loadRouter();
  const agentName = (() => {
    const idx = cmdArgs.indexOf('--agent');
    return idx !== -1 ? cmdArgs[idx + 1] : 'mike';
  })();
  const taskParts = [];
  for (let i = 0; i < cmdArgs.length; i++) {
    if (cmdArgs[i] === '--agent') { i += 1; continue; }
    if (cmdArgs[i].startsWith('--')) continue;
    taskParts.push(cmdArgs[i]);
  }
  const task = taskParts.join(' ').trim();

  if (cmdArgs.includes('--list')) {
    const roles = Object.entries(config.roleDefaults || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, tier] of roles) {
      console.log(`  ${name.padEnd(20)} ${String(tier).padEnd(12)} ${(config.tiers?.[tier]?.models || []).join(', ')}`);
    }
    return;
  }

  const defaultTier = config.roleDefaults?.[agentName] || 'default';

  if (!task) {
    console.error(chalk.red('  ✗ task description required (or pass --list)'));
    process.exit(2);
  }

  const adjusted = adjustTier(defaultTier, task);
  const chosenTier = adjusted.tier === 'high' && defaultTier === 'premium'
    ? 'premium'
    : adjusted.tier;
  const disabled = (config.disabledProviders || []).map((value) => String(value).toLowerCase());
  const enabled = (id) => !disabled.some((prefix) => String(id).toLowerCase().startsWith(prefix));
  const selected = (config.userSelected?.models || []).filter(enabled);
  const hints = config.userSelected?.tierHints || {};
  const preferred = selected.filter((id) => hints[id] === chosenTier);
  const candidates = [...new Set([...(preferred.length ? preferred : selected), ...(config.tiers?.[chosenTier]?.models || []).filter(enabled)])];
  const endpoint = process.env.BIZAR_MODEL_ROUTER_URL
    || process.env.ANTHROPIC_BASE_URL
    || config.endpoint;

  if (cmdArgs.includes('--json')) {
    console.log(JSON.stringify({
      agent: agentName,
      defaultTier,
      chosenTier,
      candidates,
      selection: 'first-enabled-configured-candidate',
      endpoint,
      source: path,
      reason: adjusted.reason,
      task,
    }, null, 2));
    return;
  }

  console.log(chalk.bold(`  task       ${task}`));
  console.log(`  role       ${agentName} (default tier: ${defaultTier})`);
  console.log(`  tier       ${chosenTier} — ${adjusted.reason}`);
  process.stdout.write(`  candidates ${candidates.join(', ') || '(none configured — dispatch blocked)'}\n`);
  process.stdout.write('  selection  first enabled configured candidate; always explicit\n');
  console.log(`  endpoint   ${endpoint}`);
  console.log(`  source     ${path}`);
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'tier') return false;
  await runTier(isHelpRequest ? ['--help'] : args);
  return true;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  runTier(process.argv.slice(2)).catch((error) => {
    console.error(chalk.red(`  ✗ ${error?.message || error}`));
    process.exitCode = 1;
  });
}
