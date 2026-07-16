/**
 * cli/install.mjs
 *
 * v10.0.0 — Back-compat shim. The real implementation lives under cli/install/.
 * Re-exports the public API so external callers (npm postinstall hook,
 * bizarre install/update CLI commands) keep working without modification.
 *
 * New code should import from the submodules directly:
 *   cli/install/index.mjs      — runInstaller()
 *   cli/install/plugin.mjs     — installPluginFromGlobal()
 *   cli/install/postinstall.mjs — runPostInstall()
 */

export { runInstaller } from './install/index.mjs';
export { installPluginFromGlobal } from './install/plugin.mjs';
export { runPostInstall } from './install/postinstall.mjs';

// Default export for backward compatibility with `import install from './install.mjs'`
export { runInstaller as default } from './install/index.mjs';
