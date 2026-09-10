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

/**
 * Resolve the Claude Desktop configLibrary directory for the current
 * platform. Pure over `env` and `cwd`; reads `process.platform` for the
 * OS branch (Linux / macOS / Windows / fallback to Linux XDG).
 *
 * - macOS:    `$HOME/Library/Application Support/Claude-3p/configLibrary`
 * - Windows:  `%LOCALAPPDATA%\Claude-3p\configLibrary` (falls back to
 *             `$HOME/AppData/Local/Claude-3p/configLibrary` when
 *             `LOCALAPPDATA` is unset)
 * - Linux / other: `$XDG_CONFIG_HOME/Claude-3p/configLibrary` (resolved
 *                   against `cwd` when relative) or
 *                   `$HOME/.config/Claude-3p/configLibrary`
 */
export function resolveDesktopConfigLibrary({ env = process.env, cwd = process.cwd() } = {}) {
  const platform = process.platform; // 'linux' | 'darwin' | 'win32' | other
  const home = typeof env.HOME === 'string' && env.HOME.trim() ? env.HOME.trim() : homedir();
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude-3p', 'configLibrary');
  }
  if (platform === 'win32') {
    const localAppData = (env.LOCALAPPDATA || '').trim() || join(home, 'AppData', 'Local');
    return join(localAppData, 'Claude-3p', 'configLibrary');
  }
  // linux + others
  const xdg = (env.XDG_CONFIG_HOME || '').trim();
  const configRoot = xdg ? (isAbsolute(xdg) ? xdg : resolve(cwd, xdg)) : join(home, '.config');
  return join(configRoot, 'Claude-3p', 'configLibrary');
}
