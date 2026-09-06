import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

/** Resolve Bizar's single user-global configuration root. */
export function resolveBizarHome({ env = process.env, cwd = process.cwd() } = {}) {
  const configured = typeof env.BIZAR_HOME === 'string' ? env.BIZAR_HOME.trim() : '';
  if (configured) return isAbsolute(configured) ? configured : resolve(cwd, configured);
  const xdg = typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME.trim() : '';
  if (xdg) {
    const root = isAbsolute(xdg) ? xdg : resolve(cwd, xdg);
    return join(root, 'bizar');
  }
  const home = typeof env.HOME === 'string' && env.HOME.trim() ? env.HOME.trim() : homedir();
  return join(home, '.config', 'bizar');
}

export function resolveGlobalLearningDir(options = {}) {
  return join(resolveBizarHome(options), 'learning');
}

export function resolveGlobalArtifactsDir(options = {}) {
  return join(resolveBizarHome(options), 'artifacts');
}

export function resolveClaudeConfigDir({ env = process.env, cwd = process.cwd() } = {}) {
  const configured = typeof env.CLAUDE_CONFIG_DIR === 'string' ? env.CLAUDE_CONFIG_DIR.trim() : '';
  if (configured) return isAbsolute(configured) ? configured : resolve(cwd, configured);
  const home = typeof env.HOME === 'string' && env.HOME.trim() ? env.HOME.trim() : homedir();
  return join(home, '.claude');
}
