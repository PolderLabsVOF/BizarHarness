/**
 * mods-examples/graphify/route.mjs
 *
 * Mounted at `/api/mods/graphify`. Replicates the routes that lived in
 * `bizar-dash/src/server/routes/graph.mjs` before the graphify mod was
 * extracted.
 *
 * The router exposes:
 *   GET    /status                 graph exists + counts
 *   GET    /html                   serve graph.html
 *   GET    /report                 serve GRAPH_REPORT.md
 *   POST   /build                  kick off async build
 *   GET    /build/:jobId/status    poll build progress
 *
 * Express is injected by the mod loader (mods-loader.mjs:loadModRouters)
 * via a temp-file shim — mods can't `import { Router } from 'express'`
 * directly because they live outside the package tree.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

// Active build jobs (in-memory; restart orphans in-flight builds).
const buildJobs = new Map();

function resolveActiveProjectRoot() {
  try {
    const active = globalThis.__bizarProjectsStore?.active?.();
    if (active && active.path && fs.existsSync(active.path)) return active.path;
  } catch { /* ignore */ }
  return process.cwd();
}

function resolveGraphDir() {
  const root = resolveActiveProjectRoot();
  return path.resolve(root, '.bizar', 'graph');
}

function readGraphStats(graphJsonPath) {
  if (!fs.existsSync(graphJsonPath)) return null;
  try {
    const graph = JSON.parse(fs.readFileSync(graphJsonPath, 'utf8'));
    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const links = Array.isArray(graph.links) ? graph.links : [];
    const communities = new Set();
    for (const n of nodes) {
      if (n.community !== undefined && n.community !== null) communities.add(n.community);
    }
    const st = fs.statSync(graphJsonPath);
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

export default function register({ router, broadcast = () => {} }) {
  // GET /status
  router.get('/status', (req, res) => {
    const graphDir = resolveGraphDir();
    const graphJsonPath = path.join(graphDir, 'graph.json');
    const htmlPath = path.join(graphDir, 'graph.html');
    const reportPath = path.join(graphDir, 'GRAPH_REPORT.md');
    const stats = readGraphStats(graphJsonPath);
    const out = { exists: stats !== null, graphDir: graphDir.replace(os.homedir(), '~') };
    if (stats) {
      out.nodes = stats.nodes;
      out.edges = stats.edges;
      out.communities = stats.communities;
      out.lastBuilt = stats.lastBuilt;
      out.sizeBytes = stats.sizeBytes;
      out.hasHtml = fs.existsSync(htmlPath);
      out.hasReport = fs.existsSync(reportPath);
    }
    const jobs = [];
    for (const [id, job] of buildJobs.entries()) {
      jobs.push({ id, status: job.status, startedAt: job.startedAt, finishedAt: job.finishedAt, exitCode: job.exitCode });
    }
    out.buildJobs = jobs;
    res.json(out);
  });

  // GET /html
  router.get('/html', (req, res) => {
    const htmlPath = path.join(resolveGraphDir(), 'graph.html');
    if (!fs.existsSync(htmlPath)) {
      res.status(404).json({ error: 'not_built', message: 'graph.html not found. Run `bizar graph build` first.' });
      return;
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(fs.readFileSync(htmlPath, 'utf8'));
  });

  // GET /report
  router.get('/report', (req, res) => {
    const reportPath = path.join(resolveGraphDir(), 'GRAPH_REPORT.md');
    if (!fs.existsSync(reportPath)) {
      res.status(404).json({ error: 'not_built', message: 'GRAPH_REPORT.md not found.' });
      return;
    }
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.send(fs.readFileSync(reportPath, 'utf8'));
  });

  // POST /build
  router.post('/build', (req, res) => {
    const jobId = crypto.randomUUID().slice(0, 8);
    const startedAt = new Date().toISOString();
    const projectRoot = resolveActiveProjectRoot();
    const localCli = path.join(projectRoot, 'cli', 'bin.mjs');
    const cmd = fs.existsSync(localCli) ? process.execPath : 'bizar';
    const args = fs.existsSync(localCli) ? [localCli, 'graph', 'build'] : ['graph', 'build'];

    const logDir = path.join(os.homedir(), '.cache', 'bizar', 'graph-logs');
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.join(logDir, `graph-build-${jobId}.log`);
    const logFd = fs.openSync(logPath, 'a');
    fs.writeSync(logFd, `\n[${startedAt}] bizar graph build (job=${jobId})\n`);

    let proc;
    try {
      proc = spawn(cmd, args, {
        cwd: projectRoot,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      res.status(500).json({ error: 'spawn_failed', message: err.message });
      return;
    }
    proc.unref?.();
    proc.stdout?.pipe(fs.createWriteStream(logPath, { flags: 'a' }));
    proc.stderr?.pipe(fs.createWriteStream(logPath, { flags: 'a' }));

    buildJobs.set(jobId, {
      id: jobId, status: 'running', startedAt, finishedAt: null, exitCode: null,
      logPath, pid: proc.pid,
    });

    proc.on('exit', (code, signal) => {
      const finishedAt = new Date().toISOString();
      const job = buildJobs.get(jobId);
      if (!job) return;
      job.finishedAt = finishedAt;
      job.exitCode = code;
      job.status = code === 0 ? 'done' : 'failed';
      if (signal) job.error = `signal: ${signal}`;
      broadcast({ type: 'graphify:build:done', jobId, status: job.status, exitCode: code });
      setTimeout(() => buildJobs.delete(jobId), 60 * 60 * 1000);
    });

    res.json({
      ok: true, jobId, startedAt, pid: proc.pid, logPath,
      message: 'Build started. Poll /api/mods/graphify/build/:jobId/status for completion.',
    });
  });

  // GET /build/:jobId/status
  router.get('/build/:jobId/status', (req, res) => {
    const { jobId } = req.params;
    const job = buildJobs.get(jobId);
    if (!job) {
      res.status(404).json({ error: 'unknown_job', message: `No build job with id ${jobId}.` });
      return;
    }
    res.json({
      id: job.id, status: job.status, startedAt: job.startedAt,
      finishedAt: job.finishedAt, exitCode: job.exitCode, logPath: job.logPath, pid: job.pid,
    });
  });

  // GET /health — useful for the dashboard to confirm the mod loaded
  router.get('/health', (req, res) => {
    res.json({ ok: true, mod: 'graphify', version: '1.0.0' });
  });
}