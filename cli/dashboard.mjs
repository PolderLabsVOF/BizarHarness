/**
 * cli/dashboard.mjs
 *
 * v2.5.0 — Dashboard launcher.
 *
 * Picks a free port (preferred: 4321), starts an Express + WebSocket server,
 * writes port + PID files under ~/.config/bizar/, and opens the user's
 * default browser. The server is created and returned; the caller decides
 * whether to keep the process alive.
 *
 * Returns: { url, port, close }
 */
import { createServer } from './dashboard/server.mjs';
import { launchBrowser } from './dashboard/browser.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import net from 'node:net';

const DEFAULT_PORT = 4321;
const BIZAR_HOME = join(homedir(), '.config', 'bizar');
const PORT_FILE = join(BIZAR_HOME, 'dashboard.port');
const PID_FILE = join(BIZAR_HOME, 'dashboard.pid');

export async function launchDashboard(options = {}) {
  // 1. Find a free port
  const port = await findFreePort(options.port || DEFAULT_PORT);

  // 2. Create the server (does not listen yet)
  const { server, wss, close } = createServer({
    port,
    projectRoot: options.projectRoot || process.cwd(),
    opencodeConfigDir:
      options.opencodeConfigDir || join(homedir(), '.config', 'opencode'),
    bizarRoot: options.bizarRoot || new URL('../..', import.meta.url).pathname,
  });

  // 3. Start listening on loopback only
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  // 4. Persist port + PID so the CLI subcommand can find/stop us
  mkdirSync(BIZAR_HOME, { recursive: true });
  writeFileSync(PORT_FILE, String(port), 'utf8');
  writeFileSync(PID_FILE, String(process.pid), 'utf8');

  // 5. Open the browser (best effort — non-fatal)
  const url = `http://localhost:${port}/`;
  await launchBrowser(url);

  // 6. Friendly log
  console.log(`Bizar dashboard: ${url}`);

  return {
    url,
    port,
    close,
    wss,
  };
}

/**
 * Try the preferred port first, then walk upward up to 100 slots. If still
 * no luck, surface an error so the caller can decide what to do.
 */
async function findFreePort(preferred) {
  for (let p = preferred; p < preferred + 100; p++) {
    if (await isPortFree(p)) return p;
  }
  throw new Error(
    `No free port found in range ${preferred}..${preferred + 99}`,
  );
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    server.once('error', () => finish(false));
    server.once('listening', () => server.close(() => finish(true)));
    // Defensive timeout — don't hang on a wedged port
    const timer = setTimeout(() => finish(false), 1000);
    server.listen(port, '127.0.0.1', () => clearTimeout(timer));
  });
}

export { PORT_FILE, PID_FILE, DEFAULT_PORT };
