/**
 * cli/dashboard/browser.mjs
 *
 * Cross-platform best-effort browser launcher. On failure (no graphical
 * session, headless server), we just log the URL so the user can open it
 * manually.
 */
import { spawn } from 'node:child_process';

export async function launchBrowser(url) {
  const platform = process.platform;
  let cmd;
  let args;

  if (platform === 'darwin') {
    cmd = 'open';
    args = [url];
  } else if (platform === 'win32') {
    // Windows `start` is a shell builtin; spawn it via cmd.exe.
    cmd = 'cmd';
    args = ['/c', 'start', '""', url];
  } else {
    cmd = 'xdg-open';
    args = [url];
  }

  try {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => {
      /* swallowed — best effort */
    });
    child.unref();
  } catch (_err) {
    // Browser launch failed — print URL for manual opening
    console.log(`Open ${url} in your browser`);
  }
}
