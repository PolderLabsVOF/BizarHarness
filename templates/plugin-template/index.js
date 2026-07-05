/**
 * Echo plugin — the minimal marketplace plugin.
 *
 * Plugins export their public methods via `module.exports`. Each
 * method receives `(args..., { config, api, plugin })`. The host
 * (bizar-dash's plugin store) handles sandboxing, timeouts, and
 * permission enforcement — your code just needs to focus on the
 * domain logic.
 *
 * What you CAN do from inside a plugin:
 *   - console.log / console.error    → routed through the dashboard's logger
 *   - api.http.get(url)              → only if you declare "net" permission
 *   - api.fs.read(path)              → only if you declare "fs:read" permission
 *   - api.config.get(key) / set(key, value)   → in-memory + persisted to disk
 *   - api.log(level, msg)            → structured logger with your plugin id
 *
 * What you CANNOT do (the sandbox strips these globals):
 *   - require('node:fs') directly    → use api.fs.read instead
 *   - require('node:child_process')  → not allowed in v1
 *   - process.exit / process.kill    → use api.log instead
 *   - require('node:net')            → use api.http instead
 */
'use strict';

/**
 * The plugin's `init` hook. Called once after install and on every
 * dashboard start (the host caches the loaded plugin). Use it to
 * warm caches, validate config, or subscribe to events.
 *
 * Returning a Promise is fine — the host awaits it.
 */
async function init() {
  // Pull a config value the user may have set.
  const greeting = api.config.get('greeting') || 'echo';
  api.log('info', `${plugin.id} v${plugin.version} initialized (greeting="${greeting}")`);
}

/**
 * The simplest possible plugin method: return the input verbatim,
 * prefixed with the configured greeting.
 *
 * @param {string} message
 */
async function echo(message) {
  if (typeof message !== 'string') {
    throw new Error(`echo: expected string, got ${typeof message}`);
  }
  const greeting = api.config.get('greeting') || 'echo';
  return `${greeting}: ${message}`;
}

/**
 * Upper-cased variant — demonstrates that async / await / Promises
 * all work transparently inside the sandbox.
 *
 * @param {string} message
 */
async function shout(message) {
  return `SHOUT: ${String(message).toUpperCase()}`;
}

module.exports = {
  init,
  echo,
  shout,
};