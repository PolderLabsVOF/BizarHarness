/**
 * src/server/routes/graph.mjs
 *
 * /api/graph/status              — graph exists? node/edge/community counts
 * /api/graph/html                — serve .bizar/graph/graph.html (or 404)
 * /api/graph/report              — serve .bizar/graph/GRAPH_REPORT.md
 * /api/graph/build (POST)        — trigger async build, returns { ok, pid }
 * /api/graph/build/:id/status    — poll build progress
 *
 * The graph data lives in the project's .bizar/graph/ directory. We
 * resolve that path from `projectRoot` (passed in via deps) and refuse
 * to read anywhere else — the dashboard serves only the project's own
 * graph, never an arbitrary path the request asks for.
 *
 * The build endpoint shells out to `bizar graph build` (the same CLI
 * users run by hand) so the server inherits all of its offline-fallback
 * behaviour — including the code-only mode that runs without an LLM
 * key. The build runs detached; the caller polls /build/:id/status.
 */
import { Router } from 'express';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, openSync, writeSync, createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { wrap, readSettings } from './_shared.mjs';
import { projectsStore } from '../projects-store.mjs';
import {
  resolveSafePath,
  buildAllowedRootsFromSettings,
} from '../lib/path-safe.mjs';

/**
 * Resolve the active project's root path. We use the projectsStore's
 * active project (the one the operator selected in the dashboard).
 * Falls back to the dashboard's CWD or the settings' projectsDirectory
 * when no project is active yet.
 */
function resolveActiveProjectRoot({ projectRoot }) {
  try {
    const active = projectsStore.active();
    if (active && active.path && existsSync(active.path)) {
      return active.path;
    }
  } catch {
    // projectsStore not initialized — fall through.
  }
  if (projectRoot && existsSync(projectRoot)) return projectRoot;
  return process.cwd();
}

/**
 * Resolve the project's .bizar/graph/ directory.
 */
function resolveGraphDir({ projectRoot }) {
  const root = resolveActiveProjectRoot({ projectRoot });
  return resolve(root, '.bizar', 'graph');
}

/**
 * Parse graph.json stats (nodes, edges, communities, lastBuilt).
 * Returns null when the file is missing or unparseable.
 */
function readGraphStats(graphJsonPath) {
  if (!existsSync(graphJsonPath)) return null;
  try {
    const content = readFileSync(graphJsonPath, 'utf8');
    const graph = JSON.parse(content);
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const links = Array.isArray(graph.links) ? graph.links : [];
    const communities = new Set();
    for (const n of nodes) {
      if (n.community !== undefined && n.community !== null) {
        communities.add(n.community);
      }
    }
    const st = statSync(graphJsonPath);
    return {
      exists: true,
      nodes: nodes.length,
      edges: links.length,
      communities: communities.size,
      lastBuilt: st.mtime.toISOString(),
      sizeBytes: st.size,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Build-job registry (in-memory, process-local)
// ---------------------------------------------------------------------------
//
// The build is invoked via `bizar graph build` which can take 30-120s
// for a mid-size repo. We spawn it detached and track the PID in an
// in-memory map keyed by job id. The caller polls /build/:id/status
// to learn when the spawn child has exited. (A persistent job store
// would survive a dashboard restart; for v3.14.x an in-memory map is
// enough — a restart just orphans the in-flight build, which graphify
// handles idempotently.)

const buildJobs = new Map();

/**
 * @param {object} deps
 * @param {string} deps.projectRoot
 * @param {Function} [deps.broadcast]
 * @returns {import('express').Router}
 */
export function createGraphRouter({ projectRoot, broadcast = () => {} }) {
  const router = Router();
  const graphDir = resolveGraphDir({ projectRoot });

  router.get('/graph/status', wrap(async (_req, res) => {
    const graphJsonPath = join(graphDir, 'graph.json');
    const htmlPath = join(graphDir, 'graph.html');
    const reportPath = join(graphDir, 'GRAPH_REPORT.md');

    const stats = readGraphStats(graphJsonPath);
    const out = {
      exists: stats !== null,
      graphDir: graphDir.replace(homedir(), '~'),
      graphJsonPath,
      htmlPath,
      reportPath,
    };

    if (stats) {
      out.nodes = stats.nodes;
      out.edges = stats.edges;
      out.communities = stats.communities;
      out.lastBuilt = stats.lastBuilt;
      out.sizeBytes = stats.sizeBytes;
      out.hasHtml = existsSync(htmlPath);
      out.hasReport = existsSync(reportPath);
    }

    // Active build jobs for this dashboard process.
    const jobs = [];
    for (const [id, job] of buildJobs.entries()) {
      jobs.push({
        id,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        exitCode: job.exitCode,
        error: job.error,
      });
    }
    out.buildJobs = jobs;

    res.json(out);
  }));

  router.get('/graph/html', wrap(async (_req, res) => {
    const htmlPath = join(graphDir, 'graph.html');
    if (!existsSync(htmlPath)) {
      res.status(404).json({
        error: 'not_built',
        message: 'graph.html not found. Run `bizar graph build` first.',
      });
      return;
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(readFileSync(htmlPath, 'utf8'));
  }));

  router.get('/graph/report', wrap(async (_req, res) => {
    const reportPath = join(graphDir, 'GRAPH_REPORT.md');
    if (!existsSync(reportPath)) {
      res.status(404).json({
        error: 'not_built',
        message: 'GRAPH_REPORT.md not found. Run `bizar graph build` first.',
      });
      return;
    }
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(readFileSync(reportPath, 'utf8'));
  }));

  router.post('/graph/build', wrap(async (req, res) => {
    const jobId = randomUUID().slice(0, 8);
    const startedAt = new Date().toISOString();

    // Resolve the active project root — the build must run in the
    // project directory so graphify finds `.bizar/graph/` and the
    // user's project files (not the dashboard repo).
    const projectRootResolved = resolveActiveProjectRoot({ projectRoot });

    let cmd, args;
    const localCli = join(projectRootResolved, 'cli', 'bin.mjs');
    if (existsSync(localCli)) {
      cmd = process.execPath;
      args = [localCli, 'graph', 'build'];
    } else {
      cmd = 'bizar';
      args = ['graph', 'build'];
    }

    // Spawn detached so the dashboard doesn't block on a 30-120s build.
    // We redirect stdout/stderr to a log file so the operator can see
    // progress via `tail -f`.
    const logDir = join(homedir(), '.cache', 'bizar', 'graph-logs');
    mkdirSync(logDir, { recursive: true });
    const logPath = join(logDir, `graph-build-${jobId}.log`);

    let proc;
    try {
      proc = spawn(cmd, args, {
        cwd: projectRootResolved || process.cwd(),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      res.status(500).json({
        error: 'spawn_failed',
        message: err.message,
      });
      return;
    }
    // Don't keep the dashboard process alive just for the build.
    proc.unref?.();

    const logFd = openSync(logPath, 'a');
    writeSync(logFd, `\n[${startedAt}] bizar graph build (job=${jobId})\n`);
    proc.stdout?.pipe(createWriteStream(logPath, { flags: 'a' }));
    proc.stderr?.pipe(createWriteStream(logPath, { flags: 'a' }));

    buildJobs.set(jobId, {
      id: jobId,
      status: 'running',
      startedAt,
      finishedAt: null,
      exitCode: null,
      error: null,
      logPath,
      pid: proc.pid,
    });

    proc.on('exit', (code, signal) => {
      const finishedAt = new Date().toISOString();
      const job = buildJobs.get(jobId);
      if (!job) return;
      job.finishedAt = finishedAt;
      job.exitCode = code;
      job.status = code === 0 ? 'done' : 'failed';
      if (signal) job.error = `signal: ${signal}`;
      broadcast({ type: 'graph:build:done', jobId, status: job.status, exitCode: code });
      // GC after 1 hour to keep the map small.
      setTimeout(() => buildJobs.delete(jobId), 60 * 60 * 1000);
    });

    res.json({
      ok: true,
      jobId,
      startedAt,
      pid: proc.pid,
      logPath,
      message: 'Build started. Poll /api/graph/build/:jobId/status for completion.',
    });
  }));

  router.get('/graph/build/:jobId/status', wrap(async (req, res) => {
    const { jobId } = req.params;
    const job = buildJobs.get(jobId);
    if (!job) {
      res.status(404).json({
        error: 'unknown_job',
        message: `No build job with id ${jobId}. Jobs are kept in memory; restart the dashboard orphans in-flight builds.`,
      });
      return;
    }
    res.json({
      id: job.id,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      exitCode: job.exitCode,
      error: job.error,
      logPath: job.logPath,
      pid: job.pid,
    });
  }));

  return router;
}