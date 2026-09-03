import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';

export function providerSettingsPath(env = process.env) {
  const root = env.CLAUDE_CONFIG_DIR?.trim()
    || join(env.HOME?.trim() || homedir(), '.claude');
  return join(root, 'settings.json');
}

export function readProviderSettings(path = providerSettingsPath()) {
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function detectProviderConfiguration({ env = process.env, settings = {} } = {}) {
  const settingsEnv = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  const url = env.BIZAR_MODEL_ROUTER_URL?.trim()
    || env.ANTHROPIC_BASE_URL?.trim()
    || settingsEnv.BIZAR_MODEL_ROUTER_URL?.trim()
    || settingsEnv.ANTHROPIC_BASE_URL?.trim()
    || '';
  const key = env.ANTHROPIC_AUTH_TOKEN?.trim()
    || env.ANTHROPIC_API_KEY?.trim()
    || settingsEnv.ANTHROPIC_AUTH_TOKEN?.trim()
    || settingsEnv.ANTHROPIC_API_KEY?.trim()
    || '';
  return { url, key, missing: [...(!url ? ['url'] : []), ...(!key ? ['key'] : [])] };
}

export function isValidProviderUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export async function askLine(prompt, { input = process.stdin, output = process.stdout } = {}) {
  const rl = createInterface({ input, output });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

/** Read a secret through readline without forwarding its terminal redraws. */
export async function askSecret(prompt, { input = process.stdin, output = process.stdout } = {}) {
  const muted = new Writable({
    write(_chunk, _encoding, callback) { callback(); },
  });
  const rl = createInterface({ input, output: muted, terminal: true });
  output.write(prompt);
  try {
    return await rl.question('');
  } finally {
    rl.close();
    output.write('\n');
  }
}

function writeLine(output, value = '') {
  output.write(`${value}\n`);
}

/**
 * Guided install preflight. Credentials are placed only in the current
 * process; the provisioner's settings writer persists them globally with the
 * rest of the install. Injected question functions keep the policy testable.
 */
export async function runInteractiveSetup({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
  enabled = true,
  readSettings = readProviderSettings,
  askText = askLine,
  askHidden = askSecret,
} = {}) {
  let settings;
  try {
    settings = readSettings(providerSettingsPath(env));
  } catch (error) {
    return { ok: false, error: `Cannot read global Claude settings: ${error.message}` };
  }

  const detected = detectProviderConfiguration({ env, settings });
  const interactive = enabled && input.isTTY === true && output.isTTY === true;
  if (!interactive) {
    if (detected.missing.length > 0) {
      const missing = detected.missing.join(' and ');
      const header = `  [BIZAR_PROVIDER_CONFIG_MISSING] Provider ${missing} not configured in this non-interactive run.`;
      const action = `  Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN in the environment, or run \`bizar setup-provider\` interactively.`;
      writeLine(output, '');
      writeLine(output, header);
      writeLine(output, action);
      writeLine(output, '');
      // Also surface to stderr when output is the real stdout so CI runners
      // and operator logs do not silently lose the warning in a flood of
      // piped output. The custom test output streams ignore stderr.
      if (output === process.stdout) {
        process.stderr.write(`${header}\n${action}\n`);
      }
    }
    return { ok: true, interactive: false, configured: detected.missing.length === 0, missing: detected.missing };
  }

  writeLine(output, '');
  writeLine(output, '  Interactive setup');
  const confirmation = (await askText('  Continue with the installation? [Y/n] ', { input, output })).trim().toLowerCase();
  if (confirmation === 'n' || confirmation === 'no') {
    writeLine(output, '  Installation cancelled.');
    return { ok: true, interactive: true, cancelled: true, configured: detected.missing.length === 0 };
  }

  let url = detected.url;
  let key = detected.key;
  if (url) writeLine(output, `  ✓ Provider URL detected: ${url}`);
  while (!url) {
    const answer = (await askText('  Provider URL (for example https://gateway.example/v1): ', { input, output })).trim();
    if (!isValidProviderUrl(answer)) {
      writeLine(output, '  ! Enter a valid http:// or https:// URL.');
      continue;
    }
    url = answer.replace(/\/+$/, '');
  }

  if (key) writeLine(output, '  ✓ Provider key detected (hidden)');
  while (!key) {
    key = (await askHidden('  Provider API key (input hidden): ', { input, output })).trim();
    if (!key) writeLine(output, '  ! Provider key cannot be empty.');
  }

  env.ANTHROPIC_BASE_URL = url;
  env.BIZAR_MODEL_ROUTER_URL = url;
  env.ANTHROPIC_AUTH_TOKEN = key;
  writeLine(output, '  ✓ Provider configuration ready; the key will be stored in global Claude settings.');
  return { ok: true, interactive: true, cancelled: false, configured: true, missing: detected.missing };
}
