#!/usr/bin/env node
/**
 * scripts/run-dev.mjs — boots the dashboard backend (port 4098) and
 * Vite dev server (port 5174) in the same process tree.
 *
 * The backend has no built-in CLI entrypoint, so we invoke
 * `createServer({ port, projectRoot, clineConfigDir, bizarRoot })` here
 * and call `server.listen` directly (mirrors tui.mjs:892).
 */
import { spawn } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DASH = resolve(ROOT, 'bizar-dash');
const PORT = Number(process.env.PORT || '4098');
const VITE_PORT = Number(process.env.VITE_PORT || '5174');
const HOME = homedir();
const PROJECT_ROOT = process.cwd();
const CLINE_CONFIG_DIR = join(HOME, '.config', 'cline');
const BIZAR_ROOT = DASH;

function run(name, cmd, args, cwd, env) {
  const child = spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const tag = `[${name}]`;
  child.stdout.on('data', (d) => process.stdout.write(`${tag} ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`${tag} ${d}`));
  child.on('exit', (code, sig) => {
    console.error(`${tag} exited (code=${code}, signal=${sig})`);
  });
  return child;
}

async function startBackend() {
  const serverPath = pathToFileURL(join(DASH, 'src/server/server.mjs')).href;
  const serverMod = await import(serverPath);
  const { server, close } = await serverMod.createServer({
    port: PORT,
    projectRoot: PROJECT_ROOT,
    clineConfigDir: CLINE_CONFIG_DIR,
    bizarRoot: BIZAR_ROOT,
  });
  await new Promise((resolve, reject) => {
    const onErr = (err) => { server.off('listening', onOk); reject(err); };
    const onOk = () => { server.off('error', onErr); resolve(); };
    server.once('error', onErr);
    server.once('listening', onOk);
    server.listen(PORT, '127.0.0.1');
  });
  console.log(`[backend] listening on http://127.0.0.1:${PORT}`);
  return { close };
}

const backendHandle = await startBackend().catch((err) => {
  console.error('[backend] failed to start:', err?.message || err);
  process.exit(1);
});

const frontend = run(
  'frontend',
  process.execPath,
  [
    resolve(ROOT, 'node_modules/vite/bin/vite.js'),
    '--port', String(VITE_PORT),
    '--host', '127.0.0.1',
    '--strictPort',
  ],
  DASH,
  { VITE_PORT: String(VITE_PORT) },
);

const shutdown = async (sig) => {
  console.error(`\n[run-dev] ${sig} — stopping both`);
  try { frontend.kill('SIGTERM'); } catch { /* */ }
  try { await backendHandle.close(); } catch { /* */ }
  setTimeout(() => process.exit(0), 600);
};
process.on('SIGINT', () => { void shutdown('SIGINT'); });
process.on('SIGTERM', () => { void shutdown('SIGTERM'); });