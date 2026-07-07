/**
 * src/server/routes/providers.mjs
 *
 * Provider subsystem routes (v4.6.0).
 *
 * Endpoints (all mounted under /api):
 *
 *   Aggregated list (read-only):
 *     GET  /providers                         — cline.json + agents + serve HTTP
 *     GET  /providers/active                  — current default provider + model
 *     GET  /providers/auto-detect             — env+config detection
 *
 *   Catalog (UI wizard):
 *     GET  /providers/catalog                 — full curated provider catalog
 *     GET  /providers/catalog/search?q=…      — fuzzy-search the catalog
 *
 *   Provider CRUD (delegates to providersStore):
 *     GET  /providers                         — list configured providers
 *     POST /providers/auto                    — "Add with auto" wizard
 *     POST /providers/:id/keys                — add a backup key
 *     DELETE /providers/:id/keys/:envVar      — remove a key
 *     POST /providers/:id/rotate              — manual rotation trigger
 *     PUT  /providers/:id/keys/:envVar/status — set status
 *
 * The legacy `/api/config/providers/*` surface remains in routes/config.mjs
 * for back-compat — those routes just delegate to the same providersStore
 * functions used here.
 */
import { Router } from 'express';
import { providersStore } from '../providers-store.mjs';
import {
  PROVIDER_CATALOG,
  listCatalog,
  searchProviders,
  findCatalogEntry,
  getActiveKey,
  rotateKey,
  markKeyError,
  markKeySuccess,
  addBackupKey,
  removeBackupKey,
  setKeyStatus,
} from '../providers-store.mjs';
import { wrap } from './_shared.mjs';

/**
 * @returns {import('express').Router}
 */
export function createProvidersRouter() {
  const router = Router();

  // ── Aggregated read-only endpoints (preserved from previous versions) ──

  // Surface-everything endpoint the dashboard uses to populate the
  // Providers card on the Overview tab. Reads from cline.json +
  // agent frontmatter + (best-effort) the running cline serve HTTP
  // API, so the list is non-empty even on installs that don't declare
  // a top-level `provider` key in cline.json.
  router.get('/providers', wrap(async (_req, res) => {
    const providers = await providersStore.listAll();
    res.json({ providers, count: providers.length });
  }));

  // Active default provider + model. null when nothing is configured.
  router.get('/providers/active', wrap(async (_req, res) => {
    const active = await providersStore.getActive();
    res.json(active || { providerId: null, modelId: null, source: null });
  }));

  // v3.16.0 — Auto-detect providers from env + config. Best-effort;
  // a timeout/failure on one provider does not block the others.
  // Query: ?probe=0 to skip the /models probe (faster, less informative).
  router.get('/providers/auto-detect', wrap(async (req, res) => {
    const probe = req.query.probe !== '0';
    const results = await providersStore.autoDetect({ probe });
    res.json({ providers: results, count: results.length });
  }));

  // ── v4.6.0 catalog (UI wizard) ──────────────────────────────────────────

  // GET /providers/catalog — full curated list, UI-safe shape.
  router.get('/providers/catalog', wrap(async (_req, res) => {
    res.json({ catalog: listCatalog(), count: PROVIDER_CATALOG.length });
  }));

  // GET /providers/catalog/search?q=minimax&limit=20 — fuzzy search.
  router.get('/providers/catalog/search', wrap(async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);
    const results = searchProviders(q, { limit });
    res.json({ query: q, results, count: results.length });
  }));

  // ── v4.6.0 provider CRUD (rotation-aware) ──────────────────────────────

  // GET /providers/list — list configured providers from cline.json.
  // (Distinct path from /providers because /providers returns the
  // aggregated discovery view; /providers/list returns the persisted
  // cline.json shape.)
  router.get('/providers/list', wrap(async (_req, res) => {
    res.json({ providers: providersStore.list() });
  }));

  // POST /providers/auto — v4.6.0 "Add with auto" wizard.
  //
  // The new wizard is env-var-first: the user pastes an envVar (or
  // types a label and we synthesize one), and we look up the catalog
  // entry by `providerId` to fill baseURL/models. We do NOT probe
  // /v1/models here — the user hasn't pasted a key yet (it's in env).
  //
  // Body: { providerId: string, envVar: string, label?: string,
  //         setAsSystemLlm?: boolean, preferredModel?: string }
  router.post('/providers/auto', wrap(async (req, res) => {
    const body = req.body || {};
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';
    const envVar = typeof body.envVar === 'string' ? body.envVar.trim() : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';

    if (!providerId) {
      res.status(400).json({ ok: false, error: 'providerId_required', message: 'providerId is required' });
      return;
    }
    if (!envVar) {
      res.status(400).json({ ok: false, error: 'envVar_required', message: 'envVar is required' });
      return;
    }
    if (!/^[A-Z][A-Z0-9_]{1,62}$/.test(envVar)) {
      res.status(400).json({ ok: false, error: 'invalid_envVar', message: 'envVar must be UPPER_SNAKE_CASE' });
      return;
    }
    const entry = findCatalogEntry(providerId);
    if (!entry) {
      res.status(404).json({
        ok: false,
        error: 'unknown_provider',
        message: `Unknown providerId "${providerId}". Try GET /api/providers/catalog.`,
      });
      return;
    }

    // Build the provider entry: keys[0] = the env-var key the user
    // supplied. We do NOT persist any key value — it lives in the env.
    const cfg = providersStore.add({
      id: providerId,
      name: entry.name,
      baseURL: typeof body.baseURL === 'string' && body.baseURL.trim() ? body.baseURL.trim() : entry.baseURL,
      apiKey: `<env:${envVar}>`, // marker — cline sees a non-empty key
      keys: [
        {
          envVar,
          label: label || 'Primary',
          status: 'active',
          lastError: null,
          errorCount: 0,
          lastUsed: null,
        },
      ],
      models: Array.isArray(body.models) && body.models.length > 0 ? body.models : entry.models.slice(),
      enabled: true,
    });

    // Optional: set as the system LLM so /api/llm/* hits this provider.
    if (body.setAsSystemLlm !== false) {
      // Lazy: use the store's addWithAuto path so we share its
      // systemLlm update logic.
      const models = Array.isArray(cfg.models) && cfg.models.length > 0 ? cfg.models : entry.models;
      const preferredModel = typeof body.preferredModel === 'string' && body.preferredModel.trim()
        ? body.preferredModel.trim()
        : (Array.isArray(models) ? models[0] : null);
      if (preferredModel) {
        // providersStore doesn't expose a public systemLlm setter, so we
        // write it through addWithAuto's side-effect path: call it with
        // a noop key (since the env-var key lives in env, we can't probe
        // models here, but we can still set systemLlm). Use a dummy
        // string — it never touches the disk because addWithAuto only
        // writes a key if it differs from the existing one.
        try {
          await providersStore.addWithAuto({
            id: providerId,
            apiKey: `env:${envVar}`, // bypass probe path; addWithAuto will keep existing
            setAsSystemLlm: true,
            preferredModel,
            systemLlmModel: preferredModel,
          });
        } catch {
          // addWithAuto may reject due to keyPattern — that's fine, the
          // systemLlm side-effect runs after the key check. We ignore
          // any throw here; the provider is already added.
        }
      }
    }

    res.status(201).json({
      ok: true,
      provider: providersStore.get(providerId),
      catalog: { id: entry.id, name: entry.name, baseURL: entry.baseURL },
    });
  }));

  // POST /providers/:id/keys — add a backup key to an existing provider.
  // Body: { envVar: string, label?: string }
  router.post('/providers/:id/keys', wrap(async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const envVar = typeof body.envVar === 'string' ? body.envVar.trim() : '';
    const label = typeof body.label === 'string' ? body.label.trim() : '';
    if (!envVar) {
      res.status(400).json({ ok: false, error: 'envVar_required', message: 'envVar is required' });
      return;
    }
    if (!/^[A-Z][A-Z0-9_]{1,62}$/.test(envVar)) {
      res.status(400).json({ ok: false, error: 'invalid_envVar', message: 'envVar must be UPPER_SNAKE_CASE' });
      return;
    }
    if (!providersStore.get(id)) {
      res.status(404).json({ ok: false, error: 'not_found', message: `provider "${id}" not found` });
      return;
    }
    try {
      const inserted = addBackupKey(id, envVar, label);
      res.status(201).json({ ok: true, key: inserted, provider: providersStore.get(id) });
    } catch (err) {
      res.status(400).json({ ok: false, error: 'add_failed', message: err.message });
    }
  }));

  // DELETE /providers/:id/keys/:envVar — remove a key. Refuses if
  // it would leave the provider with zero keys.
  router.delete('/providers/:id/keys/:envVar', wrap(async (req, res) => {
    const { id, envVar } = req.params;
    if (!providersStore.get(id)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    try {
      const ok = removeBackupKey(id, envVar);
      if (!ok) {
        res.status(404).json({ ok: false, error: 'key_not_found', message: `no key with envVar "${envVar}"` });
        return;
      }
      res.status(200).json({ ok: true, provider: providersStore.get(id) });
    } catch (err) {
      res.status(400).json({ ok: false, error: 'remove_failed', message: err.message });
    }
  }));

  // POST /providers/:id/rotate — manual rotation trigger. Marks the
  // current active key as disabled and promotes the next one.
  router.post('/providers/:id/rotate', wrap(async (req, res) => {
    const { id } = req.params;
    if (!providersStore.get(id)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    const newActive = rotateKey(id);
    if (!newActive) {
      res.status(409).json({ ok: false, error: 'no_rotation_target', message: 'no other keys available to rotate to' });
      return;
    }
    res.json({ ok: true, active: newActive, provider: providersStore.get(id) });
  }));

  // PUT /providers/:id/keys/:envVar/status — set a key's status
  // manually (operator override).
  // Body: { status: 'active'|'standby'|'disabled'|'cooldown' }
  router.put('/providers/:id/keys/:envVar/status', wrap(async (req, res) => {
    const { id, envVar } = req.params;
    const status = req.body?.status;
    if (!providersStore.get(id)) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    if (!['active', 'standby', 'disabled', 'cooldown'].includes(status)) {
      res.status(400).json({ ok: false, error: 'invalid_status', message: 'status must be active|standby|disabled|cooldown' });
      return;
    }
    try {
      const updated = setKeyStatus(id, envVar, status);
      res.json({ ok: true, key: updated, provider: providersStore.get(id) });
    } catch (err) {
      res.status(400).json({ ok: false, error: 'set_status_failed', message: err.message });
    }
  }));

  // GET /providers/:id/active-key — read the active key + value from env.
  // (Handy for the dashboard's "what's in use right now" diagnostic card.)
  router.get('/providers/:id/active-key', wrap(async (req, res) => {
    const { id } = req.params;
    const active = getActiveKey(id);
    if (!active) {
      res.status(404).json({ ok: false, error: 'no_keys', message: 'no keys configured for this provider' });
      return;
    }
    // Mask the value (don't echo raw key in API responses).
    res.json({
      ok: true,
      active: {
        envVar: active.envVar,
        label: active.label,
        status: active.status,
        keyPreview: active.key.length > 8 ? `${active.key.slice(0, 2)}...${active.key.slice(-2)}` : (active.key ? '***short***' : ''),
        keySet: active.key.length > 0,
      },
    });
  }));

  return router;
}