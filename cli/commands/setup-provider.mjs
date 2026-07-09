/**
 * cli/commands/setup-provider.mjs
 *
 * v6.2.2 — `bizar setup-provider` subcommand.
 *
 * The Bizar installer no longer touches provider config. This command
 * is the supported way to add or update a provider in `~/.cline/cline.json`.
 *
 * Usage:
 *   bizar setup-provider                     # interactive; default 9Router
 *   bizar setup-provider --list              # print the model catalog
 *   bizar setup-provider --gateway <url>     # override gateway URL
 *   bizar setup-provider --key <key>         # provider API key
 *   bizar setup-provider --provider <name>   # provider name in cline.json
 *   bizar setup-provider --remove <name>     # remove a provider
 *
 * The default gateway is the local 9Router at http://localhost:20128/v1.
 * The catalog is fetched live from `${gateway}/v1/models` so the user
 * always gets the up-to-date list.
 */
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

function clineDir() {
  if (process.env.CLINE_DIR && process.env.CLINE_DIR.trim()) {
    return process.env.CLINE_DIR.trim();
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || homedir(), 'cline');
  }
  return join(homedir(), '.cline');
}

const CLINE_DIR = clineDir();
function clineJsonPath() { return join(clineDir(), 'cline.json'); }
const DEFAULT_GATEWAY = 'http://localhost:20128/v1';
const DEFAULT_PROVIDER = '9router';

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
}

/** Pretty-print the live model catalog from `${gateway}/v1/models`. */
export async function listGatewayModels(gateway) {
  const url = `${gateway.replace(/\/$/, '')}/models`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 10000);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`GET ${url} returned HTTP ${res.status}`);
    const body = await res.json();
    const data = Array.isArray(body?.data) ? body.data : [];
    return data.map((m) => ({
      id: m.id,
      ownedBy: m.owned_by || '(unknown)',
    }));
  } finally {
    clearTimeout(timer);
  }
}

/** Heuristic: an all-caps-with-underscores string is an env var name. */
function looksLikeEnvVar(s) {
  return /^[A-Z][A-Z0-9_]{1,}$/.test(s);
}

/** Build the cline.json provider block. */
export function buildProviderBlock({ name, gateway, apiKey, models }) {
  // Cline supports two ways to express a model:
  //   - just a string modelId under `models`
  //   - an object with metadata (interleaved, reasoning, etc.)
  // We emit the simplest possible form: the bare modelId. The user can
  // add metadata later by editing the file.
  const modelsObj = {};
  for (const m of models) {
    modelsObj[m] = {};
  }
  return {
    [name]: {
      baseUrl: gateway,
      apiKey: looksLikeEnvVar(apiKey) ? `\${env:${apiKey}}` : apiKey,
      models: modelsObj,
    },
  };
}

/** Apply a provider block atomically to ~/.cline/cline.json. */
export function applyProviderBlock(block) {
  if (!existsSync(clineJsonPath())) {
    throw new Error(
      `${clineJsonPath()} not found. Run \`bizar install\` first to set up the Bizar scaffolding.`,
    );
  }
  // Back up the original before mutating.
  const backup = `${clineJsonPath()}.bak`;
  try { copyFileSync(clineJsonPath(), backup); } catch { /* best-effort */ }

  const cfg = readJsonSafe(clineJsonPath(), {});
  if (!cfg.provider || typeof cfg.provider !== 'object') cfg.provider = {};
  for (const [name, body] of Object.entries(block)) {
    cfg.provider[name] = body;
  }
  writeJsonAtomic(clineJsonPath(), cfg);
  return { name: Object.keys(block)[0], path: clineJsonPath(), backup };
}

/** Remove a provider by name. */
export function removeProvider(name) {
  if (!existsSync(clineJsonPath())) {
    throw new Error(`${clineJsonPath()} not found.`);
  }
  const cfg = readJsonSafe(clineJsonPath(), {});
  if (!cfg.provider || !cfg.provider[name]) {
    return { removed: false, name, reason: 'not present' };
  }
  delete cfg.provider[name];
  writeJsonAtomic(clineJsonPath(), cfg);
  return { removed: true, name, path: clineJsonPath() };
}

export function showSetupProviderHelp() {
  console.log(`
  bizar setup-provider — Configure a provider in cline.json

  Usage:
    bizar setup-provider                     Interactive setup (default: 9Router gateway)
    bizar setup-provider --list              Print the live model catalog
    bizar setup-provider --gateway <url>     Override the gateway URL (default: http://localhost:20128/v1)
    bizar setup-provider --key <key>         Provider API key
                                            - All-caps-with-underscores → \${env:KEY}
                                            - Otherwise → literal value
    bizar setup-provider --provider <name>   Provider name in cline.json (default: 9router)
    bizar setup-provider --remove <name>     Remove a provider by name
    bizar setup-provider --help              Show this help

  Description:
    Since v6.2.2 the Bizar installer no longer touches provider config.
    Use this command to add or update a provider in ~/.cline/cline.json.

    The default gateway is the local 9Router at http://localhost:20128/v1.
    The model catalog is fetched live from \${gateway}/v1/models.

  Examples:
    bizar setup-provider
    bizar setup-provider --list
    bizar setup-provider --gateway https://api.anthropic.com/v1 --key sk-ant-...

  Related:
    bizar connect        Interactive TUI for provider setup
    bizar install        Installs the Bizar scaffolding (NOT provider config)
    bizar validate       Confirms provider config is wired correctly
  `);
}

export function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--list') flags.list = true;
    else if (a === '--gateway' && i + 1 < args.length) { flags.gateway = args[++i]; }
    else if (a.startsWith('--gateway=')) flags.gateway = a.slice('--gateway='.length);
    else if (a === '--key' && i + 1 < args.length) { flags.key = args[++i]; }
    else if (a.startsWith('--key=')) flags.key = a.slice('--key='.length);
    else if (a === '--provider' && i + 1 < args.length) { flags.provider = args[++i]; }
    else if (a.startsWith('--provider=')) flags.provider = a.slice('--provider='.length);
    else if (a === '--remove' && i + 1 < args.length) { flags.remove = args[++i]; }
    else if (a.startsWith('--remove=')) flags.remove = a.slice('--remove='.length);
  }
  return flags;
}

export async function runSetupProvider(args = []) {
  if (args.includes('--help') || args.includes('-h')) {
    showSetupProviderHelp();
    return;
  }
  const flags = parseFlags(args);

  // --list — print the catalog and exit
  if (flags.list) {
    const gateway = flags.gateway || DEFAULT_GATEWAY;
    console.log(chalk.cyan(`\n  Model catalog from ${gateway}/models:\n`));
    try {
      const models = await listGatewayModels(gateway);
      if (models.length === 0) {
        console.log(chalk.yellow('  (catalog is empty)'));
        return;
      }
      // Group by owner.
      const byOwner = new Map();
      for (const m of models) {
        if (!byOwner.has(m.ownedBy)) byOwner.set(m.ownedBy, []);
        byOwner.get(m.ownedBy).push(m.id);
      }
      for (const [owner, ids] of byOwner) {
        console.log(chalk.bold(`  ${owner}:`));
        for (const id of ids) {
          console.log(`    ${id}`);
        }
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ Failed to fetch catalog: ${err.message}`));
      process.exit(1);
    }
    return;
  }

  // --remove <name>
  if (flags.remove) {
    try {
      const r = removeProvider(flags.remove);
      if (r.removed) {
        console.log(chalk.green(`  ✓ Removed provider '${r.name}' from ${r.path}`));
      } else {
        console.log(chalk.yellow(`  ! Provider '${r.name}' was not present`));
      }
    } catch (err) {
      console.log(chalk.red(`  ✗ ${err.message}`));
      process.exit(1);
    }
    return;
  }

  // Default flow — set up a provider
  const gateway = flags.gateway || DEFAULT_GATEWAY;
  const name = flags.provider || DEFAULT_PROVIDER;
  const apiKey = flags.key || process.env.NINEROUTER_KEY || process.env.OPENAI_API_KEY || 'sk-replace-me';

  // Interactive prompt for the key if missing and we're on a TTY.
  if (!flags.key && !process.env.NINEROUTER_KEY && !process.env.OPENAI_API_KEY &&
      process.stdin.isTTY && process.stdout.isTTY) {
    const { createInterface } = await import('node:readline/promises');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await rl.question(`  Enter API key for ${name} (or env var name like NINEROUTER_KEY): `);
      if (answer.trim()) {
        Object.assign(flags, parseFlags(['--key', answer.trim()]));
      }
    } finally {
      rl.close();
    }
  }

  const finalKey = flags.key || apiKey;

  console.log(chalk.cyan(`\n  Fetching model catalog from ${gateway}...`));
  let models = [];
  try {
    const catalog = await listGatewayModels(gateway);
    models = catalog.map((m) => m.id);
    console.log(chalk.green(`  ✓ Found ${models.length} model(s)`));
  } catch (err) {
    console.log(chalk.yellow(`  ! Could not fetch catalog (${err.message})`));
    console.log(chalk.yellow(`    Continuing with a minimal catalog.`));
    models = ['minimax/MiniMax-M3', 'minimax/MiniMax-M2.7'];
  }

  const block = buildProviderBlock({ name, gateway, apiKey: finalKey, models });
  try {
    const result = applyProviderBlock(block);
    console.log(chalk.green(`\n  ✓ Provider '${result.name}' written to ${result.path}`));
    console.log(chalk.dim(`    backup: ${result.backup}`));
    console.log(chalk.dim(`    baseUrl: ${gateway}`));
    console.log(chalk.dim(`    models: ${models.length}`));
    console.log('');
    console.log(chalk.cyan('  Next: run `bizar validate` to confirm everything is wired up.'));
  } catch (err) {
    console.log(chalk.red(`  ✗ ${err.message}`));
    process.exit(1);
  }
}

// ── run() entry point (used by bin.mjs dispatcher) ─────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name !== 'setup-provider') return false;
  await runSetupProvider(args);
  return true;
}
