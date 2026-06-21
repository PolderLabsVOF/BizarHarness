/**
 * src/server/routes/providers.mjs
 *
 * /api/providers                         — aggregated list (opencode.json + agent frontmatter + serve HTTP)
 * /api/providers/active                  — current default provider + model
 *
 * The dashboard's Overview card uses these to show what the user
 * can run. The /api/config/providers surface (which CRUDs the
 * registry store) lives in config.mjs.
 */
import { Router } from 'express';
import { providersStore } from '../providers-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createProvidersRouter() {
  const router = Router();

  // Surface-everything endpoint the dashboard uses to populate the
  // Providers card on the Overview tab. Reads from opencode.json +
  // agent frontmatter + (best-effort) the running opencode serve HTTP
  // API, so the list is non-empty even on installs that don't declare
  // a top-level `provider` key in opencode.json.
  router.get('/providers', wrap(async (_req, res) => {
    const providers = await providersStore.listAll();
    res.json({ providers, count: providers.length });
  }));

  // Active default provider + model. null when nothing is configured.
  router.get('/providers/active', wrap(async (_req, res) => {
    const active = await providersStore.getActive();
    res.json(active || { providerId: null, modelId: null, source: null });
  }));

  return router;
}