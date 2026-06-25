/**
 * cli/providers-detect.mjs
 *
 * v3.16.0 — Auto-detect providers from environment variables and
 * opencode.json. Surfaces which providers have working API keys,
 * which have keys in unexpected formats, and which need configuration.
 *
 * Usage:
 *   bizar providers detect                  — probe + print
 *   bizar providers detect --no-probe       — skip the /models probe
 *   bizar providers detect --json           — machine-readable
 *   bizar providers detect --install <id>   — auto-add to opencode.json
 *
 * Recognised env vars: ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * GEMINI_API_KEY, GOOGLE_API_KEY, MISTRAL_API_KEY, GROQ_API_KEY,
 * COHERE_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY,
 * MINIMAX_API_KEY.
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import chalk from 'chalk';

const HOME = homedir();
const OPENCODE_JSON = join(HOME, '.config', 'opencode', 'opencode.json');

const KNOWN_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic', envKeys: ['ANTHROPIC_API_KEY'], baseURL: 'https://api.anthropic.com/v1', keyPattern: /^sk-ant-[A-Za-z0-9_-]{20,}$/ },
  { id: 'openai', name: 'OpenAI', envKeys: ['OPENAI_API_KEY'], baseURL: 'https://api.openai.com/v1', keyPattern: /^sk-[A-Za-z0-9]{20,}$/ },
  { id: 'google', name: 'Google AI', envKeys: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], baseURL: 'https://generativelanguage.googleapis.com/v1beta', keyPattern: /^AIza[A-Za-z0-9_-]{30,}$/ },
  { id: 'mistral', name: 'Mistral', envKeys: ['MISTRAL_API_KEY'], baseURL: 'https://api.mistral.ai/v1', keyPattern: /^[A-Za-z0-9]{20,}$/ },
  { id: 'groq', name: 'Groq', envKeys: ['GROQ_API_KEY'], baseURL: 'https://api.groq.com/openai/v1', keyPattern: /^gsk_[A-Za-z0-9]{20,}$/ },
  { id: 'cohere', name: 'Cohere', envKeys: ['COHERE_API_KEY'], baseURL: 'https://api.cohere.com/v1', keyPattern: /^[A-Za-z0-9]{20,}$/ },
  { id: 'openrouter', name: 'OpenRouter', envKeys: ['OPENROUTER_API_KEY'], baseURL: 'https://openrouter.ai/api/v1', keyPattern: /^sk-or-[A-Za-z0-9_-]{20,}$/ },
  { id: 'deepseek', name: 'DeepSeek', envKeys: ['DEEPSEEK_API_KEY'], baseURL: 'https://api.deepseek.com/v1', keyPattern: /^sk-[A-Za-z0-9]{20,}$/ },
  { id: 'minimax', name: 'MiniMax', envKeys: ['MINIMAX_API_KEY', 'ANTHROPIC_API_KEY'], baseURL: 'https://api.minimax.chat/v1', keyPattern: /^[A-Za-z0-9]{20,}$/ },
];

function loadOpencodeConfig() {
  try {
    if (!existsSync(OPENCODE_JSON)) return {};
    return JSON.parse(readFileSync(OPENCODE_JSON, 'utf8')) || {};
  } catch {
    return {};
  }
}

function saveOpencodeConfig(cfg) {
  mkdirSync(dirname(OPENCODE_JSON), { recursive: true });
  const tmp = `${OPENCODE_JSON}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
  renameSync(tmp, OPENCODE_JSON);
}

async function probe(spec, apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const resp = await fetch(`${spec.baseURL}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (resp.ok) {
      let modelCount = 0;
      try {
        const body = await resp.json();
        if (Array.isArray(body?.data)) modelCount = body.data.length;
        else if (Array.isArray(body)) modelCount = body.length;
      } catch { /* ignore */ }
      return { ok: true, status: resp.status, modelCount };
    }
    return { ok: false, status: resp.status, reason: `HTTP ${resp.status}` };
  } catch (err) {
    return { ok: false, reason: err?.name === 'AbortError' ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function detect({ probe: doProbe }) {
  const cfg = loadOpencodeConfig();
  const out = [];
  for (const spec of KNOWN_PROVIDERS) {
    let apiKey = '';
    let keySource = '';
    const cfgProvider = cfg.provider?.[spec.id];
    if (cfgProvider?.apiKey) {
      apiKey = cfgProvider.apiKey;
      keySource = 'config';
    } else if (cfgProvider?.options?.apiKey) {
      apiKey = cfgProvider.options.apiKey;
      keySource = 'config';
    }
    for (const k of spec.envKeys) {
      const v = process.env[k];
      if (typeof v === 'string' && v.length > 0) {
        apiKey = v;
        keySource = 'env';
        break;
      }
    }
    let status;
    if (!apiKey) {
      status = 'no-key';
    } else if (spec.keyPattern && !spec.keyPattern.test(apiKey)) {
      status = 'unknown';
    } else {
      status = 'configured';
    }
    let probed = null;
    if (doProbe && status === 'configured') {
      probed = await probe(spec, apiKey);
      if (!probed.ok && probed.status) status = 'unknown';
    }
    out.push({
      id: spec.id,
      name: spec.name,
      baseURL: spec.baseURL,
      status,
      keySource,
      hasKey: !!apiKey,
      probed,
    });
  }
  return out;
}

function printTable(results) {
  const pad = (s, n) => String(s).padEnd(n);
  const idW = Math.max(2, ...results.map((r) => r.id.length));
  const nameW = Math.max(4, ...results.map((r) => r.name.length));
  const statusW = Math.max(6, ...results.map((r) => r.status.length));
  const sourceW = Math.max(6, ...results.map((r) => r.keySource.length || 1));
  console.log();
  console.log(chalk.bold(`  ${pad('ID', idW)}  ${pad('NAME', nameW)}  ${pad('STATUS', statusW)}  ${pad('SOURCE', sourceW)}  PROBE`));
  console.log(chalk.dim(`  ${'-'.repeat(idW)}  ${'-'.repeat(nameW)}  ${'-'.repeat(statusW)}  ${'-'.repeat(sourceW)}  ${'-'.repeat(20)}`));
  for (const r of results) {
    const id = pad(r.id, idW);
    const name = pad(r.name, nameW);
    const status = pad(r.status, statusW);
    const source = pad(r.keySource || '-', sourceW);
    const statusColored =
      r.status === 'configured' ? chalk.green(status) :
      r.status === 'unknown' ? chalk.yellow(status) :
      chalk.dim(status);
    const probeTxt = r.probed
      ? (r.probed.modelCount != null ? chalk.green(`${r.probed.modelCount} models`) : chalk.dim(r.probed.reason || 'ok'))
      : chalk.dim('-');
    console.log(`  ${id}  ${name}  ${statusColored}  ${pad(source, sourceW)}  ${probeTxt}`);
  }
  console.log();
  const configured = results.filter((r) => r.status === 'configured').length;
  const unknown = results.filter((r) => r.status === 'unknown').length;
  const noKey = results.filter((r) => r.status === 'no-key').length;
  console.log(chalk.bold(`  ${configured} configured, ${unknown} unknown, ${noKey} no-key`));
  console.log();
}

function installProvider(id) {
  const spec = KNOWN_PROVIDERS.find((s) => s.id === id);
  if (!spec) {
    console.error(chalk.red(`  ✗ unknown provider: ${id}`));
    console.error(chalk.dim(`    Available: ${KNOWN_PROVIDERS.map((s) => s.id).join(', ')}`));
    process.exit(1);
  }
  // Get the apiKey from env or config
  let apiKey = '';
  for (const k of spec.envKeys) {
    const v = process.env[k];
    if (typeof v === 'string' && v.length > 0) {
      apiKey = v;
      break;
    }
  }
  if (!apiKey) {
    console.error(chalk.red(`  ✗ no API key found in env (${spec.envKeys.join(', ')})`));
    process.exit(1);
  }
  const cfg = loadOpencodeConfig();
  cfg.provider = cfg.provider || {};
  cfg.provider[spec.id] = {
    name: spec.name,
    baseURL: spec.baseURL,
    apiKey,
    enabled: true,
  };
  saveOpencodeConfig(cfg);
  console.log(chalk.green(`  ✓ ${spec.name} (${spec.id}) added to opencode.json`));
}

function showHelp() {
  console.log(`
  ${chalk.bold('bizar providers detect')} — auto-detect provider API keys

  Usage:
    bizar providers detect                  Probe env + opencode.json, print table
    bizar providers detect --no-probe       Skip the /models probe
    bizar providers detect --json           Print JSON instead of a table
    bizar providers detect --install <id>   Add a configured provider to opencode.json

  Recognised env vars:
    ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY,
    MISTRAL_API_KEY, GROQ_API_KEY, COHERE_API_KEY, OPENROUTER_API_KEY,
    DEEPSEEK_API_KEY, MINIMAX_API_KEY
`);
}

export async function runProvidersDetect(args) {
  const doProbe = !args.includes('--no-probe');
  const json = args.includes('--json');
  const help = args.includes('--help') || args.includes('-h');

  if (help) {
    showHelp();
    return;
  }

  const installIdx = args.indexOf('--install');
  const installId = installIdx >= 0 ? args[installIdx + 1] : null;
  if (installId) {
    installProvider(installId);
    return;
  }

  const results = await detect({ probe: doProbe });
  if (json) {
    console.log(JSON.stringify(results, null, 2));
    return;
  }
  console.log(chalk.bold.cyan('\n  Provider auto-detect\n'));
  console.log(chalk.dim(`  Probing ${KNOWN_PROVIDERS.length} providers...`));
  printTable(results);
}
