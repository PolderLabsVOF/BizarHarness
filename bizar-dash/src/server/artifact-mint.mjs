// src/server/artifact-mint.mjs
//
// v10.0.6 — Auto-mint artifacts on lifecycle events.
//
// Goals → finish:   mint `goal-finished-<goal-id>` artifact
// Dialogs → user input needed: mint `dialog-needs-input-<dialog-id>` artifact
//
// Both broadcasts an `artifact:change` WS event so the dashboard
// refreshes without polling.
//
// Idempotency: `artifactsStore.create` 409s on collision; that's a no-op
// signal we deliberately swallow (re-emitting an event would be noise).

import { artifactsStore } from './artifacts-store.mjs';

const MAX_SLUG_LEN = 63;

/** Lowercase + dashify so the slug matches artifactsStore.VALID_SLUG. */
function slugifyId(id) {
  return String(id || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LEN);
}

/**
 * Mint an artifact on the projectRoot. Best-effort — never throws.
 *
 * @param {object} opts
 * @param {string} opts.kind — 'goal-finished' | 'dialog-needs-input' | …
 * @param {string} opts.entityId — source entity id (goal/dialog/…)
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {object} [opts.frontmatter] — additional meta fields
 * @param {string} opts.projectRoot
 * @param {(msg: object) => void} [opts.broadcast]
 * @returns {object|null} the created artifact, or null on skip/error.
 */
export function mintArtifact({ kind, entityId, title, description, frontmatter, projectRoot, broadcast }) {
  if (!kind || !entityId || !projectRoot) return null;
  const slug = `${kind}-${slugifyId(entityId)}`;
  try {
    const body = {
      title: title || `${kind}: ${entityId}`,
      description: description || '',
      tags: ['auto', kind],
      kind,
      source: 'auto',
      ...(frontmatter || {}),
    };
    const artifact = artifactsStore.create(slug, body, projectRoot);
    if (typeof broadcast === 'function') {
      broadcast({ type: 'artifact:change', slug, kind });
    }
    return artifact;
  } catch (err) {
    // 409 collision — already minted; treat as a no-op.
    if (err && err.status === 409) return null;
    // Anything else: surface as a non-fatal artifacts:error event so the
    // dashboard can show it without the server blowing up.
    if (typeof broadcast === 'function') {
      try {
        broadcast({ type: 'artifacts:error', kind, entityId, message: err?.message || String(err) });
      } catch { /* ignore */ }
    }
    return null;
  }
}