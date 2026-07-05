/**
 * src/server/logger.mjs
 *
 * v4.7.0 — Structured JSON logger with level filtering.
 *
 * Replaces ad-hoc `console.log('[module] message')` calls across the
 * server with a single, level-gated logger that emits one JSON object
 * per line. Output goes to the matching console.* stream (log/warn/
 * error) so existing terminal capture keeps working, but the body is
 * machine-parseable.
 *
 * Level selection: BIZAR_LOG_LEVEL env var (debug | info | warn | error).
 * Default `info` matches the existing behaviour — everything but debug
 * is visible. Set `debug` to surface verbose tracing during development.
 *
 * Usage:
 *   import { info, warn, error, child } from './logger.mjs';
 *   info('server started', { port: 4317 });
 *   warn('rate limited', { module: 'lightrag', err: e.message });
 *   const log = child({ module: 'overview' });
 *   log.info('snapshot built', { size: 1234 });
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ENV_LEVEL = process.env.BIZAR_LOG_LEVEL;
const currentLevel = LEVELS[ENV_LEVEL] !== undefined ? ENV_LEVEL : 'info';

function format(level, msg, ctx) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(ctx && typeof ctx === 'object' ? ctx : {}),
  };
  return JSON.stringify(entry);
}

function shouldLog(level) {
  return LEVELS[currentLevel] <= LEVELS[level];
}

export function debug(msg, ctx) {
  if (shouldLog('debug')) console.log(format('debug', msg, ctx));
}

export function info(msg, ctx) {
  if (shouldLog('info')) console.log(format('info', msg, ctx));
}

export function warn(msg, ctx) {
  if (shouldLog('warn')) console.warn(format('warn', msg, ctx));
}

export function error(msg, ctx) {
  if (shouldLog('error')) console.error(format('error', msg, ctx));
}

/**
 * Build a child logger that binds a context object to every log call.
 * Useful for tagging a series of related entries with a module/session id.
 */
export function child(ctx) {
  return {
    debug: (m, c) => debug(m, { ...ctx, ...(c && typeof c === 'object' ? c : {}) }),
    info: (m, c) => info(m, { ...ctx, ...(c && typeof c === 'object' ? c : {}) }),
    warn: (m, c) => warn(m, { ...ctx, ...(c && typeof c === 'object' ? c : {}) }),
    error: (m, c) => error(m, { ...ctx, ...(c && typeof c === 'object' ? c : {}) }),
  };
}

export { currentLevel };