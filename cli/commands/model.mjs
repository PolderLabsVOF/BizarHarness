/**
 * cli/commands/model.mjs
 *
 * `bizar model` subcommands:
 *   list  — fetch all models from the configured provider gateway and group
 *           by provider family.
 *
 * The gateway URL is read from `BIZAR_MODEL_ROUTER_URL` or
 * `ANTHROPIC_BASE_URL`. If neither is set, the command errors out with a
 * clear message instead of guessing a default. Bizar is provider-agnostic
 * and ships no default gateway.
 *
 * Gateway model discovery (CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY=1)
 * makes the /model picker surface only IDs prefixed with "claude" or
 * "anthropic". This command shows the FULL set including cx/, oc/, and
 * unprefixed IDs.
 *
 * 10.22.0 / Phase 4 spirit-of-constraint fix: this command used to carry a
 * hardcoded `PROVIDER_GROUPS` prefix list that duplicated the canonical
 * provider family detection in `cli/commands/models.mjs#classifyKind`.
 * It now imports `classifyKind` from there (single source of truth) and
 * filters the operator's `disabledProviders` list using the same
 * case-sensitive prefix match as every other read site — adding a new
 * provider family no longer requires touching this file.
 */
import chalk from 'chalk';

import { classifyKind, filterCandidatesByDisabledProviders, readDisabledProviders } from './models.mjs';

const BIZAR_MODEL_ROUTER_URL = process.env.BIZAR_MODEL_ROUTER_URL
  || process.env.ANTHROPIC_BASE_URL
  || null;
const ANTHROPIC_AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || null;

function showHelp() {
  const gatewayDisplay = BIZAR_MODEL_ROUTER_URL ?? '(not configured)';
  console.log(`
  bizar model — List all available models from the provider gateway

  Usage:
    bizar model list         List all models grouped by provider (default)
    bizar model list --json  Emit machine-readable JSON

  Description:
    Fetches GET ${gatewayDisplay}/models?limit=1000
    and prints a table of provider | id | display_name.
    The /model picker inside Claude Code shows only "claude"/"anthropic" prefixed
    IDs. This command exposes the full set (cx/, claude-minimax/, claude-qwen/, oc/, etc.).

    The list honours the operator's \`disabledProviders\` list from
    model-router.json (10.22.0 / Phase 4) — same source of truth as
    \`bizar models\`.

  Gateway configuration:
    Set BIZAR_MODEL_ROUTER_URL or ANTHROPIC_BASE_URL to your provider gateway
    (e.g. https://router.example.com/v1). If neither is set, this command
    exits with a configuration error.

  Flags:
    --json   Emit { providers: { "<family>": [...], ... }, total: N }
  `);
}

/**
 * Fetch models from the gateway. Try authenticated first; on 401 retry without auth.
 * @returns {Promise<{ id: string, display_name?: string }[]>}
 */
async function fetchModels() {
  if (!BIZAR_MODEL_ROUTER_URL) {
    throw new Error(
      'no gateway configured — set BIZAR_MODEL_ROUTER_URL or ANTHROPIC_BASE_URL',
    );
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3_000);

  const doFetch = async (auth) => {
    const headers = auth
      ? { Authorization: `Bearer ${ANTHROPIC_AUTH_TOKEN}`, Accept: 'application/json' }
      : { Accept: 'application/json' };
    const res = await fetch(`${BIZAR_MODEL_ROUTER_URL}/models?limit=1000`, {
      headers,
      signal: controller.signal,
    });
    if (res.status === 401 && auth) return null; // signal retry without auth
    if (!res.ok) {
      throw new Error(`gateway returned ${res.status} ${res.statusText}`);
    }
    const json = await res.json();
    return json.data ?? [];
  };

  try {
    // Try with auth first
    let models = await doFetch(true);
    if (models === null) {
      // 401 — retry without auth
      models = await doFetch(false);
    }
    return models;
  } finally {
    clearTimeout(timeout);
  }
}

function groupByProvider(models) {
  // 10.22.0 / Phase 4: filter the operator's `disabledProviders` first,
  // then group by the canonical `classifyKind` family name. No
  // hardcoded prefix list lives in this file.
  const ids = models.map((m) => (typeof m?.id === 'string' ? m.id : ''));
  const disabled = readDisabledProviders();
  const { kept } = filterCandidatesByDisabledProviders(ids, disabled);
  const keptSet = new Set(kept);

  const groups = {};
  for (const m of models) {
    const id = typeof m?.id === 'string' ? m.id : '';
    if (!id || !keptSet.has(id)) continue;
    const family = classifyKind(id);
    const key = family || '(unclassified)';
    if (!groups[key]) groups[key] = [];
    groups[key].push({ id, display_name: m.display_name ?? id });
  }
  return groups;
}

function printTable(groups) {
  const colWidths = { provider: 16, id: 50, display_name: 30 };

  const header = [
    'provider'.padEnd(colWidths.provider),
    'id'.padEnd(colWidths.id),
    'display_name'.padEnd(colWidths.display_name),
  ].join('  ');
  console.log(chalk.bold(header));
  console.log(chalk.dim('-'.repeat(header.length)));

  for (const [provider, models] of Object.entries(groups)) {
    for (const m of models) {
      const row = [
        provider.padEnd(colWidths.provider),
        m.id.padEnd(colWidths.id),
        (m.display_name ?? '').padEnd(colWidths.display_name),
      ].join('  ');
      console.log(row);
    }
  }

  const total = Object.values(groups).reduce((s, g) => s + g.length, 0);
  console.log(chalk.dim(`\n${total} model(s) across ${Object.keys(groups).length} group(s)`));
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'model') return false;
  if (isHelpRequest || args.includes('--help') || args.includes('-h')) {
    showHelp();
    return true;
  }

  const wantJson = args.includes('--json');
  const subcommand = args.find(a => !a.startsWith('-')) || 'list';

  if (subcommand !== 'list') {
    console.error(chalk.red(`  ✗ Unknown subcommand: ${subcommand}`));
    showHelp();
    return false;
  }

  let models;
  try {
    models = await fetchModels();
  } catch (err) {
    if (err.name === 'AbortError' || err.message?.includes('aborted')) {
      console.error(chalk.red(`  ✗ Request timed out after 3s`));
    } else {
      console.error(chalk.red(`  ✗ Failed to fetch models: ${err.message}`));
    }
    process.exit(1);
  }

  const groups = groupByProvider(models);

  if (wantJson) {
    process.stdout.write(JSON.stringify({ providers: groups, total: models.length }, null, 2) + '\n');
  } else {
    printTable(groups);
  }
  return true;
}
