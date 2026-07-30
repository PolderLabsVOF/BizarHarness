/**
 * cli/install.mjs
 *
 * Back-compat shim. The real implementation lives under cli/install/.
 * Re-exports the public API for the install/update CLI commands.
 *
 * New code should import from the submodules directly:
 *   cli/install/index.mjs      — runInstaller()
 */

export { runInstaller } from './install/index.mjs';

// Default export for backward compatibility with `import install from './install.mjs'`
export { runInstaller as default } from './install/index.mjs';
