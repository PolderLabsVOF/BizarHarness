/**
 * src/server/plugins/permission-audit.mjs
 *
 * v5.3.0 — Audit log for plugin permission uses.
 *
 * Every call to `safeInvoke` (and every successful run after the
 * permission check) emits one entry here. The audit log is in-memory
 * (bounded to 1000 entries — older entries are evicted FIFO) because
 * it is meant for live UI ("who invoked what on which plugin in the
 * last hour") and for incident triage, not for permanent record
 * keeping. For long-term storage, extend this module with a sink that
 * writes to disk or to a structured-log aggregator.
 *
 * Why a separate module?
 *   - `sandbox.mjs` stays focused on the execution boundary.
 *   - `routes/plugins.mjs` and any future admin UI can read the log
 *     without importing the entire sandbox.
 *   - Tests can `clearPermissionAuditLog()` between cases.
 */
import * as logger from '../logger.mjs';

/** Bounded ring buffer of audit entries; trimmed at 1000. */
const auditLog = [];

/** Hard cap to bound memory; oldest entries fall off. */
const MAX_AUDIT_ENTRIES = 1000;

/**
 * @typedef {{
 *   timestamp: string,
 *   pluginId: string,
 *   method: string,
 *   permission: string,
 *   allowed: boolean
 * }} PermissionAuditEntry
 */

/**
 * Record a permission use (allowed or denied) for one method call.
 *
 * @param {string} pluginId    plugin identifier (matches `loaded.id` or
 *                             `installed.id`)
 * @param {string} method      method name invoked
 * @param {string} permission  comma-joined permission names that the
 *                             method was checked against; pass `'none'`
 *                             if no permissions were required
 * @param {boolean} allowed    true if the call was allowed, false if it
 *                             was rejected with permission_denied
 */
export function logPermissionUse(pluginId, method, permission, allowed) {
  const entry = {
    timestamp: new Date().toISOString(),
    pluginId: pluginId || 'unknown',
    method: method || '',
    permission: permission || 'none',
    allowed: !!allowed,
  };
  auditLog.push(entry);
  // FIFO eviction — keep memory bounded without losing the most recent
  // activity, which is what the UI typically wants.
  while (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.shift();
  }
  logger.info('plugin.permission.use', {
    module: 'plugin-audit',
    pluginId: entry.pluginId,
    method: entry.method,
    permission: entry.permission,
    allowed: entry.allowed,
  });
}

/**
 * Read recent audit entries, optionally filtered by plugin.
 * Returns newest-first so the UI can render a live list directly.
 *
 * @param {object} [opts]
 * @param {string} [opts.pluginId]  if set, only entries for this plugin
 * @param {number} [opts.limit=50]  max entries to return
 * @returns {PermissionAuditEntry[]}
 */
export function getPermissionAuditLog({ pluginId, limit = 50 } = {}) {
  let entries = auditLog;
  if (pluginId) {
    entries = entries.filter((e) => e.pluginId === pluginId);
  }
  // `slice(-limit)` gives the last `limit` entries in chronological order;
  // reversing once gives newest-first for the API consumer.
  return entries.slice(-limit).reverse();
}

/**
 * Wipe all audit entries. Used by tests in `beforeEach` so cases are
 * isolated. Not exposed via any HTTP route — admin tools that want to
 * reset the buffer should not exist (the audit log is read-only).
 */
export function clearPermissionAuditLog() {
  auditLog.length = 0;
}

/**
 * Test/internal: expose the current entry count so routes can detect
 * when the buffer was emptied by an outside test runner. Not exported
 * in the public surface; consumers should treat the audit log as
 * opaque.
 */
export function _permissionAuditLength() {
  return auditLog.length;
}
