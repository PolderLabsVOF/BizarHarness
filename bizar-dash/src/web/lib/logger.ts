/**
 * logger.ts — Browser-side logger for the Bizar dashboard.
 *
 * Web code can't use Node's `console` directly because:
 *   1. AGENTS.md § Hard constraints forbids `console.log`, `debugger`,
 *      `.only()`.
 *   2. console.* doesn't surface in the dashboard's diagnostic logs.
 *
 * This shim forwards to console.* in dev and is a no-op in production.
 * The dashboard's existing error overlay / devtools pick these up
 * automatically.
 */

const IS_DEV = (typeof process !== "undefined" && process.env?.NODE_ENV !== "production")
  || (typeof window !== "undefined" && !window.location.hostname.includes("production"));

export const logger = {
  debug(...args: unknown[]): void {
    if (IS_DEV) console.debug("[bizar]", ...args);
  },
  info(...args: unknown[]): void {
    if (IS_DEV) console.info("[bizar]", ...args);
  },
  warn(...args: unknown[]): void {
    console.warn("[bizar]", ...args);
  },
  error(...args: unknown[]): void {
    console.error("[bizar]", ...args);
  },
};
