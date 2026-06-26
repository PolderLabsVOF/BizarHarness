/**
 * mods/impeccable/route.mjs
 *
 * Wraps `impeccable detect` and stores results in the project's Obsidian
 * vault under `.obsidian/impeccable/`. Agents that read the vault can
 * surface the most recent scan results at session start.
 *
 * Endpoints
 *   GET  /state          — last scan summary + config
 *   POST /scan           — run impeccable detect on the configured scope
 *   GET  /report         — return last full JSON report
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

function resolveActiveProjectRoot() {
  try {
    const active = globalThis.__bizarProjectsStore?.active?.();
    if (active && active.path && fs.existsSync(active.path)) return active.path;
  } catch { /* ignore */ }
  return process.cwd();
}

function scanDir(projectRoot) {
  return path.resolve(projectRoot, '.obsidian', 'impeccable');
}

function stateFile(projectRoot) {
  return path.resolve(scanDir(projectRoot), 'state.json');
}

function reportFile(projectRoot) {
  return path.resolve(scanDir(projectRoot), 'last-report.json');
}

function readState(projectRoot) {
  const p = stateFile(projectRoot);
  if (!fs.existsSync(p)) return { lastScanAt: null, lastFindings: 0, lastExitCode: null, scope: 'src' };
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return { lastScanAt: null, lastFindings: 0, lastExitCode: null, scope: 'src' };
  }
}

function writeState(projectRoot, data) {
  fs.mkdirSync(scanDir(projectRoot), { recursive: true });
  fs.writeFileSync(stateFile(projectRoot), JSON.stringify(data, null, 2), 'utf8');
}

function runImpeccable(projectRoot, scope) {
  return new Promise((resolve, reject) => {
    const args = ['--yes', 'impeccable', 'detect', '--json', scope];
    const proc = spawn('npx', args, {
      cwd: projectRoot,
      env: { ...process.env },
      timeout: 5 * 60 * 1000,
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('close', (code) => resolve({ code, stdout, stderr }));
    proc.on('error', reject);
  });
}

export default function register({ router }) {
  const projectRoot = resolveActiveProjectRoot();

  router.get('/state', (req, res) => {
    const state = readState(projectRoot);
    res.json({
      ...state,
      package: 'impeccable',
      installCommand: 'npx --yes impeccable skills install -y --scope=user',
      repoUrl: 'https://github.com/pbakaus/impeccable',
    });
  });

  router.post('/scan', async (req, res) => {
    const state = readState(projectRoot);
    const scope = (req.body?.scope || state.scope || 'src');
    try {
      const { code, stdout, stderr } = await runImpeccable(projectRoot, scope);
      // Try to parse JSON; impeccable's --json output should be valid JSON
      let findings = [];
      let parsed = null;
      const lines = stdout.split('\n').filter(Boolean);
      // Find the JSON block (last complete {...} block)
      const jsonStart = stdout.indexOf('{');
      const jsonEnd = stdout.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd > jsonStart) {
        try {
          parsed = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
          findings = Array.isArray(parsed) ? parsed : (parsed.findings || parsed.issues || []);
        } catch { /* imperfect JSON, fall back to counting lines */ }
      }
      if (findings.length === 0) {
        // Crude line-based count
        const lines2 = stdout.split('\n').filter((l) => /\bfail|warn|anti-pattern/i.test(l));
        findings = lines2.map((l) => ({ message: l.trim() }));
      }
      const summary = {
        lastScanAt: new Date().toISOString(),
        lastExitCode: code,
        lastFindings: findings.length,
        scope,
      };
      fs.mkdirSync(scanDir(projectRoot), { recursive: true });
      writeState(projectRoot, { ...state, ...summary });
      fs.writeFileSync(reportFile(projectRoot), JSON.stringify({
        ...summary,
        findings,
        stderr: stderr.slice(-2000),
      }, null, 2), 'utf8');
      res.json({ ok: code === 0 || code === 2, ...summary, findings: findings.slice(0, 200) });
    } catch (err) {
      res.status(500).json({ error: 'scan_failed', message: err.message });
    }
  });

  router.get('/report', (req, res) => {
    const p = reportFile(projectRoot);
    if (!fs.existsSync(p)) {
      res.status(404).json({ error: 'no_report', message: 'Run a scan first via POST /scan' });
      return;
    }
    try {
      res.json(JSON.parse(fs.readFileSync(p, 'utf8')));
    } catch (err) {
      res.status(500).json({ error: 'parse_failed', message: err.message });
    }
  });
}