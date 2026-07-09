/**
 * cli/commands/setup-provider.mjs
 *
 * v6.2.3 — `bizar setup-provider` subcommand.
 *
 * v6.2.2 wrote to `~/.cline/cline.json` (the harness config). That was
 * the wrong place — the Cline CLI and kanban mode read from
 * `~/.cline/data/settings/providers.json` (the real Cline settings
 * file). v6.2.3 fixes this.
 *
 * The default providerId is `litellm` because:
 *   - It's a real entry in Cline's built-in provider catalog (works
 *     in both Cline CLI AND kanban mode)
 *   - It's `family: "openai-compatible"` and accepts a custom
 *     baseUrl — the perfect match for the local 9Router gateway
 *   - The previous v6.2.2 default `9router` (and the user's hand-
 *     written `openai-compatible`) are NOT in Cline's catalog, so
 *     kanban mode fails with "Unknown or disabled provider".
 *
 * Usage:
 *   bizar setup-provider                     # default 9Router gateway, litellm provider
 *   bizar setup-provider --list              # print the live model catalog
 *   bizar setup-provider --gateway <url>     # override gateway URL
 *   bizar setup-provider --key <key>         # provider API key
 *   bizar setup-provider --provider <name>   # built-in providerId (default: litellm)
 *   bizar setup-provider --discover          # auto-detect a local gateway and configure
 *   bizar setup-provider --remove <name>     # remove a provider
 *
 * The default gateway is the local 9Router at http://localhost:20128/v1.
 * The model catalog is fetched live from `${gateway}/v1/models`.
 */
import chalk from 'chalk';
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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

function dataDir() {
  if (process.env.CLINE_DATA_DIR && process.env.CLINE_DATA_DIR.trim()) {
    return process.env.CLINE_DATA_DIR.trim();
  }
  return join(clineDir(), 'data');
}

/** Path to the Cline settings file the CLI + kanban actually read. */
function settingsPath() {
  if (process.env.CLINE_PROVIDER_SETTINGS_PATH && process.env.CLINE_PROVIDER_SETTINGS_PATH.trim()) {
    return process.env.CLINE_PROVIDER_SETTINGS_PATH.trim();
  }
  return join(dataDir(), 'settings', 'providers.json');
}

const DEFAULT_GATEWAY = 'http://localhost:20128/v1';
// v6.2.3 — `litellm` is the right built-in providerId for a custom
// OpenAI-compatible endpoint. It's in Cline's catalog (so kanban
// mode recognizes it) and accepts a custom baseUrl.
const DEFAULT_PROVIDER = 'litellm';

// v6.2.3 — Built-in Cline providerIds that support `family: "openai-compatible"`
// with a custom baseUrl. These are the ones the user can pick for
// "I have my own OpenAI-compatible endpoint". `9router`, `openai-compatible`
// and other fake IDs are NOT in this list — they fail in kanban mode.
export const OPENAI_COMPATIBLE_PROVIDERS = [
  'litellm',      // best fit: defaults to localhost:4000, openai-responses
  'cline',        // Cline's own API (can be overridden)
  'ollama',       // localhost:11434
  'lmstudio',     // localhost:1234
  'huggingface',  // api-inference.huggingface.co
];

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  mkdirSync(dirname(file), { recursive: true });
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

/**
 * v6.2.3 — Build the Cline settings.json entry for one provider.
 *
 * The shape matches `~/.cline/data/settings/providers.json`:
 *   { "version": 1, "lastUsedProvider": "litellm", "providers": { "litellm": { ... } } }
 */
export function buildProviderBlock({ name, gateway, apiKey, model, reason = false }) {
  return {
    settings: {
      provider: name,
      model,
      apiKey: looksLikeEnvVar(apiKey) ? `\${env:${apiKey}}` : apiKey,
      baseUrl: gateway,
      ...(reason ? { reasoning: { enabled: true, effort: 'medium' } } : { reasoning: { enabled: false, effort: 'medium' } }),
    },
    updatedAt: new Date().toISOString(),
    tokenSource: 'manual',
  };
}

/** Apply (create or update) one provider in the settings file. */
export function applyProviderBlock(name, body) {
  const file = settingsPath();
  if (!existsSync(file)) {
    // Bootstrap with a minimal but valid providers.json
    const bootstrap = { version: 1, providers: {}, lastUsedProvider: name };
    writeJsonAtomic(file, bootstrap);
  }
  const backup = `${file}.bak`;
  try { copyFileSync(file, backup); } catch { /* best-effort */ }

  const cfg = readJsonSafe(file, { version: 1, providers: {} });
  if (!cfg.providers || typeof cfg.providers !== 'object') cfg.providers = {};
  cfg.providers[name] = body;
  // v6.2.3 — Always set lastUsedProvider to the most recently applied
  // provider. The user is actively configuring this one; they want
  // it to be the active one. (Previous v6.2.2 only set it when missing,
  // which left stale `lastUsedProvider: "openai-compatible"` entries
  // in the file when the user upgraded.)
  cfg.lastUsedProvider = name;
  cfg.version = cfg.version || 1;
  writeJsonAtomic(file, cfg);
  return { name, path: file, backup };
}

/** Remove a provider by name from the settings file. */
export function removeProvider(name) {
  const file = settingsPath();
  if (!existsSync(file)) return { removed: false, name, reason: 'no settings file' };
  const cfg = readJsonSafe(file, { version: 1, providers: {} });
  if (!cfg.providers || !cfg.providers[name]) {
    return { removed: false, name, reason: 'not present' };
  }
  delete cfg.providers[name];
  if (cfg.lastUsedProvider === name) {
    cfg.lastUsedProvider = Object.keys(cfg.providers)[0] || undefined;
  }
  writeJsonAtomic(file, cfg);
  return { removed: true, name, path: file };
}

/**
 * v6.2.3 — Detect the broken `openai-compatible` providerId pattern
 * from earlier installs and the Cline v6.0.1 migration shim.
 *
 * Background: v6.0.1's Cline auto-migration created synthetic providers
 * with `provider: "openai-compatible"` (the `family`, not a real
 * `id`). Cline CLI accepts this, but Cline kanban mode looks up the
 * provider in its built-in catalog and fails with:
 *   "Unknown or disabled provider \"openai-compatible\"."
 *
 * The fix: if the settings file has a `provider: "openai-compatible"`
 * entry, rename it to a real catalog ID (default `litellm`) so
 * kanban mode recognizes it. We do this IN-PLACE without losing the
 * user's baseUrl, apiKey, or model.
 */
export function migrateLegacyOpenaiCompatible(targetName = 'litellm') {
  const file = settingsPath();
  if (!existsSync(file)) return { migrated: false, reason: 'no settings file' };
  const cfg = readJsonSafe(file, { version: 1, providers: {} });
  const broken = cfg.providers && cfg.providers['openai-compatible'];
  if (!broken) return { migrated: false, reason: 'no legacy entry' };

  // Move the entry to a real providerId.
  const newBody = { ...broken };
  // Strip the `provider: "openai-compatible"` field (replaced by the
  // real providerId at the top level) and keep the rest (baseUrl,
  // apiKey, model, reasoning, etc.).
  if (newBody.settings) {
    newBody.settings.provider = targetName;
  }
  cfg.providers[targetName] = newBody;
  delete cfg.providers['openai-compatible'];
  // If the broken entry was the active one, switch the new one in.
  if (cfg.lastUsedProvider === 'openai-compatible' || !cfg.lastUsedProvider) {
    cfg.lastUsedProvider = targetName;
  }
  writeJsonAtomic(file, cfg);
  return { migrated: true, from: 'openai-compatible', to: targetName, path: file };
}

/**
 * v6.2.3 — `bizar setup-provider --discover`.
 *
 * Probe a list of well-known local gateway URLs and use the first one
 * that responds. Then write the provider block with the discovered URL.
 */
export async function discoverLocalGateway() {
  const candidates = [
    'http://localhost:20128/v1', // 9Router (Bizar default)
    'http://127.0.0.1:20128/v1',
    'http://localhost:4000/v1',  // LiteLLM
    'http://localhost:11434/v1', // Ollama
    'http://localhost:1234/v1',  // LM Studio
  ];
  for (const url of candidates) {
    try {
      const models = await listGatewayModels(url);
      if (models.length > 0) {
        return { url, modelCount: models.length, models };
      }
    } catch {
      // Try the next one
    }
  }
  return null;
}

export function showSetupProviderHelp() {
  console.log(`
  bizar setup-provider — Configure a provider in Cline's settings

  Usage:
    bizar setup-provider                     Interactive setup (default: litellm + 9Router gateway)
    bizar setup-provider --list              Print the live model catalog
    bizar setup-provider --gateway <url>     Override the gateway URL (default: http://localhost:20128/v1)
    bizar setup-provider --key <key>         Provider API key
                                            - All-caps-with-underscores → \${env:KEY}
                                            - Otherwise → literal value
    bizar setup-provider --provider <name>   Built-in providerId (default: litellm)
                                            See OPENAI_COMPATIBLE_PROVIDERS for the supported list
    bizar setup-provider --model <id>        Model ID (default: first model from \${gateway}/v1/models)
    bizar setup-provider --discover          Auto-detect a local gateway and configure
    bizar setup-provider --remove <name>     Remove a provider by name
    bizar setup-provider --help              Show this help

  Description:
    Since v6.2.2 the Bizar installer no longer touches provider config.
    Use this command to add or update a provider in
    \`~/.cline/data/settings/providers.json\` (the file the Cline CLI
    and kanban mode both read).

    v6.2.3 changed the default providerId from \`9router\` to \`litellm\`.
    \`litellm\` is a real entry in Cline's built-in catalog (so it works
    in kanban mode), \`family: "openai-compatible"\`, and accepts a
    custom baseUrl — perfect for the local 9Router gateway.

    The previous v6.2.2 default \`9router\` and any hand-written
    providerId like \`openai-compatible\` are NOT in Cline's catalog,
    so they fail in kanban mode with:
      "Unknown or disabled provider \\"openai-compatible\\"."

  Examples:
    bizar setup-provider
    bizar setup-provider --list
    bizar setup-provider --discover
    bizar setup-provider --provider ollama --gateway http://localhost:11434/v1

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
    else if (a === '--discover') flags.discover = true;
    else if (a === '--gateway' && i + 1 < args.length) { flags.gateway = args[++i]; }
    else if (a.startsWith('--gateway=')) flags.gateway = a.slice('--gateway='.length);
    else if (a === '--key' && i + 1 < args.length) { flags.key = args[++i]; }
    else if (a.startsWith('--key=')) flags.key = a.slice('--key='.length);
    else if (a === '--provider' && i + 1 < args.length) { flags.provider = args[++i]; }
    else if (a.startsWith('--provider=')) flags.provider = a.slice('--provider='.length);
    else if (a === '--model' && i + 1 < args.length) { flags.model = args[++i]; }
    else if (a.startsWith('--model=')) flags.model = a.slice('--model='.length);
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

  // v6.2.3 — Auto-migrate the legacy `openai-compatible` providerId
  // shim. This runs on every invocation (except --help/--list/--remove)
  // because it's idempotent and fixes a real bug. Users who hit
  // "Unknown or disabled provider openai-compatible" in kanban mode
  // get healed automatically the next time they run setup-provider.
  if (!flags.list && !flags.remove) {
    const mig = migrateLegacyOpenaiCompatible(DEFAULT_PROVIDER);
    if (mig.migrated) {
      console.log(chalk.yellow(`\n  ⚠ Migrated legacy '${mig.from}' → '${mig.to}'`));
      console.log(chalk.yellow('    (kanban mode requires a built-in providerId; litellm works for any OpenAI-compatible endpoint.)'));
    }
  }

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

  // --discover — auto-detect a local gateway
  let gateway = flags.gateway;
  if (flags.discover || (!gateway && !flags.key)) {
    console.log(chalk.cyan('\n  Probing for local gateways...'));
    const found = await discoverLocalGateway();
    if (found) {
      gateway = found.url;
      console.log(chalk.green(`  ✓ Found ${found.modelCount} model(s) at ${found.url}`));
    } else if (flags.discover) {
      console.log(chalk.red('  ✗ No local gateway found. Tried:'));
      for (const c of ['20128 (9Router)', '4000 (LiteLLM)', '11434 (Ollama)', '1234 (LM Studio)']) {
        console.log(chalk.red(`    - localhost:${c.split(' ')[0]}`));
      }
      process.exit(1);
    } else {
      gateway = DEFAULT_GATEWAY;
      console.log(chalk.dim(`  ! No local gateway detected, using default ${gateway}`));
    }
  }
  gateway = gateway || DEFAULT_GATEWAY;

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

  // Pick the model: explicit > first from catalog > sensible default.
  let model = flags.model;
  if (!model) {
    console.log(chalk.cyan(`\n  Fetching model catalog from ${gateway}...`));
    try {
      const catalog = await listGatewayModels(gateway);
      if (catalog.length > 0) {
        // Prefer minimaxcustom/MiniMax-M3 if available (the Bizar default model)
        const preferred = catalog.find((m) => m.id === 'minimaxcustom/MiniMax-M3');
        model = preferred ? preferred.id : catalog[0].id;
        console.log(chalk.green(`  ✓ Found ${catalog.length} model(s); using '${model}'`));
      } else {
        model = 'minimaxcustom/MiniMax-M3';
        console.log(chalk.yellow(`  ! Empty catalog; defaulting to ${model}`));
      }
    } catch (err) {
      model = 'minimaxcustom/MiniMax-M3';
      console.log(chalk.yellow(`  ! Could not fetch catalog (${err.message}); defaulting to ${model}`));
    }
  }

  const body = buildProviderBlock({ name, gateway, apiKey: finalKey, model });
  try {
    const result = applyProviderBlock(name, body);
    console.log(chalk.green(`\n  ✓ Provider '${result.name}' written to ${result.path}`));
    console.log(chalk.dim(`    backup: ${result.backup}`));
    console.log(chalk.dim(`    baseUrl: ${gateway}`));
    console.log(chalk.dim(`    model: ${model}`));
    console.log(chalk.dim(`    apiKey: ${looksLikeEnvVar(finalKey) ? `\${env:${finalKey}}` : (finalKey.length > 12 ? finalKey.slice(0, 8) + '...' : finalKey)}`));
    console.log('');
    console.log(chalk.cyan('  Next:'));
    console.log(chalk.cyan('    • Run `bizar validate` to confirm everything is wired up.'));
    console.log(chalk.cyan('    • The same provider now works in both `cline` CLI and `cline --kanban` mode.'));
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
