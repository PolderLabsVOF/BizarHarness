/**
 * _update-test-helpers.mjs — shared test helpers for update route tests.
 *
 * Exports a pre-loaded module instance so all test files share the same
 * module state (important for ESM module caching in Node.js).
 */
import { resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..', '..');

export const { createUpdateRouter, resetUpdateCache, resetConcurrencyGuard } = await import(
  `${REPO}/bizar-dash/src/server/routes/update.mjs`
);
