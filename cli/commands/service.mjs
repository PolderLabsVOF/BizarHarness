/**
 * cli/commands/service.mjs
 *
 * Service command dispatcher — delegates to ../service.mjs.
 * The service subcommand help text needs bizarConfigDir(), which we inline here
 * (service.mjs owns its own bizarConfigDir for internal use).
 */
import chalk from 'chalk';
import { homedir } from 'node:os';
import { join } from 'node:path';

function getBizarConfigDir() {
  if (process.platform === 'win32') {
    return process.env.APPDATA
      ? join(process.env.APPDATA, 'bizar')
      : join(homedir(), '.config', 'bizar');
  }
  return process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, 'bizar')
    : join(homedir(), '.config', 'bizar');
}

export function showServiceHelp() {
  const bizarConfigDir = getBizarConfigDir();
  console.log(`
  bizar service — Manage the background service daemon

  Usage:
    bizar service start            Start the service in background
    bizar service stop             Stop the running service
    bizar service status           Show whether the service is running
    bizar service logs             Tail the service log
    bizar service follow           Follow the service log until Ctrl-C
    bizar service install          Register with systemd / launchd / scheduled task
    bizar service install --force  Re-install even when the unit matches
    bizar service uninstall        Remove the OS-level autostart
    bizar service uninstall --force  Force-uninstall even when nothing is registered

  Description:
    The service watches per-project schedules (cron / interval / once)
    and runs them at the right time. It logs to
    ${bizarConfigDir}/service.log and writes its PID to
    ${bizarConfigDir}/service.pid.

    install registers the daemon under the OS init system — systemd user
    unit on Linux, launchd LaunchAgent on macOS, scheduled task
    ("BizarDashboardService", ONSTART, HIGHEST) on Windows. After
    install, a normal user does not need to run \`bizar service start\`
    for the dashboard background process — the OS does it at login.
  `);
}

export async function runServiceCommand(sub) {
  const { runService } = await import('../service.mjs');
  await runService(sub || 'status', process.argv.slice(2));
}

export async function run(name, args, isHelpRequest) {
  if (isHelpRequest) {
    showServiceHelp();
    return;
  }
  const { runService } = await import('../service.mjs');
  await runService(args[0] || 'status', args.slice(1));
}
