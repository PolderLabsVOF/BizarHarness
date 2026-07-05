/**
 * src/server/routes/lightrag.mjs
 *
 * v4.6.0 — LightRAG settings endpoints.
 *
 * Mounted at /api/lightrag/*. Used by the Settings view (handled by
 * the sibling thor-settings agent) to surface and override the
 * free-tier opencode Zen defaults that lightrag starts with.
 *
 * Endpoints:
 *   GET  /lightrag/defaults      — current default models + provenance
 *   PUT  /lightrag/defaults      — set env-var overrides (process-scoped, not persisted)
 *   GET  /lightrag/status        — current running config (delegates to resolveLightRAGConfig)
 *
 * The PUT endpoint mutates `process.env` for the lifetime of the
 * dashboard server process. We do NOT persist this to disk because:
 *   1. env-var overrides are conventionally process-scoped, and
 *   2. the proper way to persist is via PUT /api/memory/config which
 *      writes to .bizar/memory.json (see routes/memory.mjs).
 */
import { Router } from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  getDefaultLightRAGConfig,
  LIGHTRAG_DEFAULT_LLM,
  LIGHTRAG_DEFAULT_EMBEDDING,
} from '../memory-store.mjs';
import { resolveLightRAGConfig } from '../memory-lightrag.mjs';
import { warn as logWarn } from '../logger.mjs';
import { wrap } from './_shared.mjs';

/**
 * @param {object} deps
 * @param {string} deps.projectRoot
 * @returns {import('express').Router}
 */
export function createLightragRouter({ projectRoot }) {
  const router = Router();

  // GET /api/lightrag/defaults — current defaults + where they came from.
  router.get('/lightrag/defaults', wrap(async (_req, res) => {
    const cfg = getDefaultLightRAGConfig();
    res.json({
      llm: cfg.llm,
      embedding: cfg.embedding,
      source: cfg.source,
      llmSource: cfg.llmSource,
      embeddingSource: cfg.embeddingSource,
      builtin: {
        llm: LIGHTRAG_DEFAULT_LLM,
        embedding: LIGHTRAG_DEFAULT_EMBEDDING,
      },
      envVars: {
        BIZAR_LIGHTRAG_LLM: process.env.BIZAR_LIGHTRAG_LLM || null,
        BIZAR_LIGHTRAG_EMBEDDING: process.env.BIZAR_LIGHTRAG_EMBEDDING || null,
      },
    });
  }));

  // PUT /api/lightrag/defaults — set env-var overrides.
  // Body: { llm?: string, embedding?: string }
  // Both fields are optional; only the supplied ones are set. To clear
  // an override, send an empty string ''.
  router.put('/lightrag/defaults', wrap(async (req, res) => {
    const body = req.body || {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, 'llm')) {
      const v = typeof body.llm === 'string' ? body.llm.trim() : '';
      if (v) {
        process.env.BIZAR_LIGHTRAG_LLM = v;
        updates.llm = v;
      } else {
        delete process.env.BIZAR_LIGHTRAG_LLM;
        updates.llmCleared = true;
      }
    }
    if (Object.prototype.hasOwnProperty.call(body, 'embedding')) {
      const v = typeof body.embedding === 'string' ? body.embedding.trim() : '';
      if (v) {
        process.env.BIZAR_LIGHTRAG_EMBEDDING = v;
        updates.embedding = v;
      } else {
        delete process.env.BIZAR_LIGHTRAG_EMBEDDING;
        updates.embeddingCleared = true;
      }
    }
    const next = getDefaultLightRAGConfig();
    res.json({
      ok: true,
      applied: updates,
      llm: next.llm,
      embedding: next.embedding,
      source: next.source,
    });
  }));

  // GET /api/lightrag/status — current resolved config + server status.
  // Mirrors /api/memory/lightrag/status but is the canonical surface
  // for the Settings view.
  router.get('/lightrag/status', wrap(async (_req, res) => {
    const cfg = resolveLightRAGConfig(projectRoot);
    const pidFile = join(cfg.workingDir, 'lightrag.pid');
    let pid = null;
    let alive = false;
    if (existsSync(pidFile)) {
      try {
        pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          try {
            process.kill(pid, 0);
            alive = true;
          } catch {
            alive = false;
          }
        } else {
          pid = null;
        }
      } catch {
        pid = null;
      }
    }

    const logFile = join(cfg.workingDir, 'lightrag.log');
    const logTail = [];
    if (existsSync(logFile)) {
      try {
        const content = readFileSync(logFile, 'utf8');
        const lines = content.split('\n');
        logTail.push(...lines.slice(-30));
      } catch (err) {
        logWarn('swallowed in lightrag log tail', { module: 'lightrag', err: err.message });
      }
    }

    let logSize = 0;
    try {
      if (existsSync(logFile)) logSize = statSync(logFile).size;
    } catch (err) {
      logWarn('swallowed in lightrag log stat', { module: 'lightrag', err: err.message });
    }

    res.json({
      running: alive,
      pid: alive ? pid : null,
      host: cfg.host,
      port: cfg.port,
      llmBinding: cfg.llmBinding,
      embeddingBinding: cfg.embeddingBinding,
      llmModel: cfg.llmModel,
      embeddingModel: cfg.embeddingModel,
      workingDir: cfg.workingDir,
      logSize,
      logTail,
    });
  }));

  return router;
}