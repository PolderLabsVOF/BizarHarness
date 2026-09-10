/**
 * cli/install/provider.mjs
 *
 * Pure provider-config helpers + the readline-based interactive setup
 * prompt flow. Extracted from `cli/install/interactive-setup.mjs` so the
 * provider read/write logic is testable in isolation and so future
 * wizards (the clack-based `wizard.mjs`) can reuse the helpers without
 * pulling in the readline contract.
 *
 * Behavior is byte-equivalent to the prior `interactive-setup.mjs`
 * implementation. `cli/install/interactive-setup.mjs` becomes a thin
 * re-export shim that delegates here so existing imports of
 * `runInteractiveSetup`, `providerSettingsPath`, `readProviderSettings`,
 * `detectProviderConfiguration`, and `detectAdvancedConfiguration`
 * continue to resolve.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline/promises';
import { resolveOpenKanHome } from '../openkan.mjs';

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
  // The picker surface is gone; we no longer consult a separate
  // BIZAR_MODEL_ROUTER_URL. The install only configures
  // ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN; the four aliases
  // (sonnet/haiku/opus/fable) are bound by the shipped settings template.
  const url = env.ANTHROPIC_BASE_URL?.trim()
    || settingsEnv.ANTHROPIC_BASE_URL?.trim()
    || '';
  const key = env.ANTHROPIC_AUTH_TOKEN?.trim()
    || env.ANTHROPIC_API_KEY?.trim()
    || settingsEnv.ANTHROPIC_AUTH_TOKEN?.trim()
    || settingsEnv.ANTHROPIC_API_KEY?.trim()
    || '';
  return { url, key, missing: [...(!url ? ['url'] : []), ...(!key ? ['key'] : [])] };
}

export function detectAdvancedConfiguration({ env = process.env, settings = {} } = {}) {
  const settingsEnv = settings?.env && typeof settings.env === 'object' ? settings.env : {};
  return {
    model: env.ANTHROPIC_MODEL?.trim() || settingsEnv.ANTHROPIC_MODEL?.trim() || '',
    teams: env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS?.trim()
      || settingsEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS?.trim()
      || '',
  };
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

function answer(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function askYesNo(prompt, defaultValue, deps) {
  while (true) {
    const suffix = defaultValue ? '[Y/n]' : '[y/N]';
    const value = answer(await deps.askText(`${prompt} ${suffix} `, deps.io));
    if (!value) return defaultValue;
    if (['y', 'yes'].includes(value.toLowerCase())) return true;
    if (['n', 'no'].includes(value.toLowerCase())) return false;
    writeLine(deps.output, '  ! Please answer yes or no.');
  }
}

function expandHome(value, env) {
  const home = env.HOME?.trim() || homedir();
  return value === '~' ? home : value.startsWith('~/') ? join(home, value.slice(2)) : value;
}

export function isValidOpenKanHome(value) {
  return Boolean(value && !value.includes('\0'));
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
  cwd = process.cwd(),
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
  const advanced = detectAdvancedConfiguration({ env, settings });
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
  const confirmation = answer(await askText('  Continue with the installation? [Y/n] ', { input, output })).toLowerCase();
  if (confirmation === 'n' || confirmation === 'no') {
    writeLine(output, '  Installation cancelled.');
    return { ok: true, interactive: true, cancelled: true, configured: detected.missing.length === 0 };
  }

  let url = detected.url;
  let key = detected.key;
  if (url) writeLine(output, `  ✓ Provider URL detected: ${url}`);
  while (!url) {
    const value = answer(await askText('  Provider URL (for example https://gateway.example/v1): ', { input, output }));
    if (!isValidProviderUrl(value)) {
      writeLine(output, '  ! Enter a valid http:// or https:// URL.');
      continue;
    }
    url = value.replace(/\/+$/, '');
  }

  if (key) writeLine(output, '  ✓ Provider key detected (hidden)');
  while (!key) {
    key = (await askHidden('  Provider API key (input hidden): ', { input, output })).trim();
    if (!key) writeLine(output, '  ! Provider key cannot be empty.');
  }

  env.ANTHROPIC_BASE_URL = url;
  env.ANTHROPIC_AUTH_TOKEN = key;
  writeLine(output, '  ✓ Provider configuration ready; the key will be stored in global Claude settings.');

  // Keep the common already-configured path quick. Fresh provider setup gets
  // the extra choices that materially affect the first Bizar session.
  let model = advanced.model;
  let teams = advanced.teams
    ? advanced.teams === '1' || advanced.teams.toLowerCase() === 'true'
    : null;
  let openkanHome = resolveOpenKanHome({ cwd, env });
  let initializeOpenKanProject = false;
  if (detected.missing.length > 0) {
    if (model) writeLine(output, `  ✓ Default model detected: ${model}`);
    else {
      model = answer(await askText('  Default Claude model (optional; press Enter to choose later): ', { input, output }));
      if (model) writeLine(output, `  ✓ Default model: ${model}`);
    }

    const teamsEnabled = await askYesNo('  Enable Claude Code agent teams?', true, {
      askText: async (prompt, io) => askText(prompt, io), io: { input, output }, output,
    });
    teams = teamsEnabled;
    writeLine(output, `  ✓ Agent teams ${teams ? 'enabled' : 'disabled'}.`);

    const homeAnswer = answer(await askText(`  OpenKan install directory [${openkanHome}]: `, { input, output }));
    if (homeAnswer) {
      const expanded = expandHome(homeAnswer, env);
      if (!isValidOpenKanHome(expanded)) {
        writeLine(output, '  ! OpenKan directory cannot be empty or contain NUL bytes; using the default.');
      } else {
        openkanHome = resolve(cwd, expanded);
      }
    }
    writeLine(output, `  ✓ OpenKan will be installed at ${openkanHome}.`);

    const projectHasOpenKan = existsSync(join(cwd, '.ok', 'index.json'));
    if (projectHasOpenKan) {
      writeLine(output, '  ✓ OpenKan project workspace already exists.');
    } else {
      initializeOpenKanProject = await askYesNo('  Initialise OpenKan planning in this project?', true, {
        askText: async (prompt, io) => askText(prompt, io), io: { input, output }, output,
      });
    }
  }
  if (detected.missing.length > 0) {
    if (model) env.ANTHROPIC_MODEL = model;
    env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = teams ? '1' : '0';
  }
  env.BIZAR_OPENKAN_HOME = openkanHome;
  return {
    ok: true,
    interactive: true,
    cancelled: false,
    configured: true,
    missing: detected.missing,
    model: model || null,
    agentTeams: teams,
    openkanHome,
    initializeOpenKanProject,
  };
}
