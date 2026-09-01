import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveBizarHome } from '../config-paths.mjs';

export function artifactSettingsPath(options = {}) {
  return join(resolveBizarHome(options), 'completion-artifact.json');
}

export function readArtifactSetting(options = {}) {
  const path = artifactSettingsPath(options);
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    return { enabled: value.enabled !== false, path };
  } catch {
    return { enabled: true, path };
  }
}

export function writeArtifactSetting(enabled, options = {}) {
  const path = artifactSettingsPath(options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ enabled: Boolean(enabled), updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  return { enabled: Boolean(enabled), path };
}

function help() {
  process.stdout.write('Usage: bizar artifact <on|off|status> [--json]\n');
}

export async function run(name, args, isHelpRequest) {
  if (name !== 'artifact') return false;
  if (isHelpRequest || args.includes('--help') || args.includes('-h')) { help(); return true; }
  const command = args.find((arg) => !arg.startsWith('-')) || 'status';
  let state;
  if (command === 'on') state = writeArtifactSetting(true);
  else if (command === 'off') state = writeArtifactSetting(false);
  else if (command === 'status') state = readArtifactSetting();
  else { help(); process.exitCode = 64; return true; }
  if (args.includes('--json')) process.stdout.write(`${JSON.stringify(state)}\n`);
  else process.stdout.write(`Completion artifacts: ${state.enabled ? 'on' : 'off'}\nConfig: ${state.path}\n`);
  return true;
}
