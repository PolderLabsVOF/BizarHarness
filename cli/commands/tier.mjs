#!/usr/bin/env node
/**
 * cli/commands/tier.mjs
 *
 * `bizar tier` — automatic task-based model selection.
 *
 * Replays the same tier resolution the @mike orchestrator uses:
 *  1. Read the per-agent assignment from ~/.claude/model-router.json
 *     (synced at install time from config/claude/model-router.json).
 *  2. Read the task description and decide whether to escalate or
 *     demote relative to the agent's default tier.
 *  3. Print the exact model id and a short rationale.
 *
 * No silent fallback: the resolver refuses to assign a model the
 * configured gateway cannot serve.
 */

import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const ROUTER_PATHS = [
  process.env.BIZAR_MODEL_ROUTER_PATH,
  join(HOME, '.claude', 'model-router.json'),
  process.env.CLAUDE_CONFIG_DIR && join(process.env.CLAUDE_CONFIG_DIR, 'model-router.json'),
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

  Returns the exact gateway model id assigned to the named agent
  (defaults to "mike") for the given task, or escalates / demotes
  based on the task's content.
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
    const agents = Object.entries(config.agents || {}).sort(([a], [b]) => a.localeCompare(b));
    for (const [name, entry] of agents) {
      console.log(`  ${name.padEnd(20)} ${entry.tier.padEnd(12)} ${entry.model}`);
    }
    return;
  }

  const agent = config.agents?.[agentName];
  if (!agent) {
    console.error(chalk.red(`  ✗ unknown agent '${agentName}' — run \`bizar tier --list\``));
    process.exit(2);
  }

  if (!task) {
    console.error(chalk.red('  ✗ task description required (or pass --list)'));
    process.exit(2);
  }

  const adjusted = adjustTier(agent.tier, task);
  const chosenTier = adjusted.tier === 'high' && agent.tier === 'premium'
    ? 'premium'
    : adjusted.tier;
  const tierEntry = config.tiers?.[chosenTier];
  const modelId = (tierEntry?.models || [agent.model])[0];
  const endpoint = process.env.BIZAR_MODEL_ROUTER_URL
    || process.env.ANTHROPIC_BASE_URL
    || config.endpoint;

  if (cmdArgs.includes('--json')) {
    console.log(JSON.stringify({
      agent: agentName,
      defaultTier: agent.tier,
      defaultModel: agent.model,
      chosenTier,
      chosenModel: modelId,
      endpoint,
      source: path,
      reason: adjusted.reason,
      task,
    }, null, 2));
    return;
  }

  console.log(chalk.bold(`  task     ${task}`));
  console.log(`  agent    ${agentName} (default tier: ${agent.tier})`);
  console.log(`  tier     ${chosenTier} — ${adjusted.reason}`);
  console.log(`  model    ${modelId}`);
  console.log(`  endpoint ${endpoint}`);
  console.log(`  source   ${path}`);
}