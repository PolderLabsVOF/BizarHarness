/**
 * src/server/routes-v2/index.mjs
 *
 * v0.7.0-alpha.1 — Mounts /api/v2/* routes with HTTP basic auth.
 *
 * Public:   GET /health
 * Protected (Basic auth): /sessions, /sessions/:id, /event
 *
 * Also exposes GET /doc — the OpenAPI spec served from
 * `.bizar/research/OPENAPI_SPEC.yaml` (or wherever build copies it).
 */

import express from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2BasicAuth } from './auth.mjs';
import { createV2HealthRouter } from './health.mjs';
import { createV2EventsRouter } from './events.mjs';
import { createV2SessionsRouter } from './sessions.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Locate the OpenAPI spec file.
 * Search order:
 *   1. <package>/.bizar/research/OPENAPI_SPEC.yaml       (development)
 *   2. <package>/OPENAPI_SPEC.yaml                       (when copied at build)
 *   3. <repo-root>/.bizar/research/OPENAPI_SPEC.yaml     (BizarHarness monorepo)
 *   4. <package>/../.bizar/research/OPENAPI_SPEC.yaml    (workspace dev fallback)
 */
function findOpenApiSpec() {
  const packageRoot = join(__dirname, '..', '..', '..'); // src/server/routes-v2 → package root (bizar-dash)
  const candidates = [
    join(packageRoot, '.bizar', 'research', 'OPENAPI_SPEC.yaml'),
    join(packageRoot, 'OPENAPI_SPEC.yaml'),
    join(packageRoot, '..', '.bizar', 'research', 'OPENAPI_SPEC.yaml'),
    join(packageRoot, '..', '..', '.bizar', 'research', 'OPENAPI_SPEC.yaml'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function createV2Router({ eventBus, getPassword, version, startedAt }) {
  const router = express.Router();
  const auth = v2BasicAuth(getPassword);

  // Public health endpoint.
  router.use(createV2HealthRouter({ version, startedAt }));

  // OpenAPI spec.
  router.get('/doc', (_req, res) => {
    const specPath = findOpenApiSpec();
    if (!specPath) {
      return res.status(404).json({
        name: 'DashboardError',
        data: { statusCode: 404, message: 'OpenAPI spec not found' },
      });
    }
    try {
      const content = readFileSync(specPath, 'utf8');
      res.setHeader('Content-Type', 'application/yaml; charset=utf-8');
      res.status(200).send(content);
    } catch (err) {
      res.status(500).json({
        name: 'DashboardError',
        data: { statusCode: 500, message: err instanceof Error ? err.message : String(err) },
      });
    }
  });

  // Protected routes.
  router.use(auth);
  router.use(createV2EventsRouter({ eventBus }));
  router.use(createV2SessionsRouter({ eventBus }));

  return router;
}
