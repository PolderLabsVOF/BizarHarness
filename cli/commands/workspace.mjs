/**
 * cli/commands/workspace.mjs
 *
 * v5.0.0 — Workspace management CLI — talks to the running dashboard's HTTP API.
 */
import chalk from 'chalk';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

// ── Config dir helper ──────────────────────────────────────────────────────────

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

function getDashboardPort() {
  const portFile = join(getBizarConfigDir(), 'dashboard.port');
  try {
    const port = parseInt(readFileSync(portFile, 'utf8').trim(), 10);
    if (Number.isFinite(port) && port > 0) return port;
  } catch {
    /* fall through */
  }
  return null;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function postJson(baseUrl, path, body) {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function getJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`);
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

async function delJson(baseUrl, path) {
  const res = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const msg = json?.message || json?.error || text || `HTTP ${res.status}`;
    throw new Error(`${path} failed: ${msg}`);
  }
  return json;
}

// ── Help ───────────────────────────────────────────────────────────────────────

export function showWorkspaceHelp() {
  console.log(`
  bizar workspace — Manage workspaces (via the dashboard's HTTP API)

  Usage:
    bizar workspace list                    List all workspaces
    bizar workspace create <name>           Create a new workspace
    bizar workspace switch <id>             Set active workspace
    bizar workspace invite <email> [role]   Generate invite URL (role: admin|editor|viewer)
    bizar workspace accept <token>          Accept an invite
    bizar workspace members                 List workspace members
    bizar workspace remove-member <userId>  Remove a member

  Description:
    Subcommands call the running dashboard's HTTP API. If no dashboard is
    reachable, you'll be told to run \`bizar dash start\` first.

    Workspaces let you share access with team members. Each workspace has
    its own members, settings, and data.

  Examples:
    bizar workspace list
    bizar workspace create "Engineering"
    bizar workspace invite alice@example.com editor
    bizar workspace accept abc123def456
    bizar workspace members
    bizar workspace remove-member usr_abc123
  `);
}

// ── Command runner ───────────────────────────────────────────────────────────

export async function runWorkspaceCommand(args) {
  const sub = args[0];
  const positional = args.slice(1).filter((a) => !a.startsWith('-'));
  const flags = args.slice(1).filter((a) => a.startsWith('-'));

  if (!sub || sub === '--help' || sub === '-h' || flags.includes('--help') || flags.includes('-h')) {
    showWorkspaceHelp();
    return;
  }

  const port = getDashboardPort();
  if (!port) {
    console.error(chalk.red('  ✗ Dashboard is not running (no port file).'));
    console.error(chalk.dim('  Start it first: `bizar dash start --bg`'));
    process.exit(1);
  }
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    if (sub === 'list') {
      const r = await getJson(baseUrl, '/api/workspaces');
      const workspaces = r.workspaces || [];
      if (workspaces.length === 0) {
        console.log(chalk.dim('  (no workspaces)'));
        return;
      }
      console.log(chalk.bold('  Workspaces:'));
      for (const { workspace, role } of workspaces) {
        const badge = role === 'admin' ? chalk.green('admin') : role === 'editor' ? chalk.yellow('editor') : chalk.blue('viewer');
        console.log(`  ${workspace.id.padEnd(20)} ${workspace.name.padEnd(30)} ${badge}`);
      }
    } else if (sub === 'create') {
      const name = positional[0];
      if (!name) {
        console.error(chalk.red('  ✗ Missing workspace name. Usage: bizar workspace create <name>'));
        process.exit(1);
      }
      const r = await postJson(baseUrl, '/api/workspaces', { name });
      console.log(chalk.green(`  ✓ Created workspace "${r.workspace.name}" (${r.workspace.id})`));
    } else if (sub === 'switch') {
      const wsId = positional[0];
      if (!wsId) {
        console.error(chalk.red('  ✗ Missing workspace id. Usage: bizar workspace switch <id>'));
        process.exit(1);
      }
      // Verify workspace exists
      try {
        await getJson(baseUrl, `/api/workspaces/${wsId}`);
      } catch {
        console.error(chalk.red(`  ✗ Workspace not found: ${wsId}`));
        process.exit(1);
      }
      console.log(chalk.green(`  ✓ Switched to workspace ${wsId}`));
      console.log(chalk.dim('  Note: Run `bizar workspace list` to see workspace ids'));
    } else if (sub === 'invite') {
      const email = positional[0];
      if (!email) {
        console.error(chalk.red('  ✗ Missing email. Usage: bizar workspace invite <email> [role]'));
        process.exit(1);
      }
      const role = positional[1] || 'editor';
      if (!['admin', 'editor', 'viewer'].includes(role)) {
        console.error(chalk.red(`  ✗ Invalid role: ${role}. Must be admin, editor, or viewer.`));
        process.exit(1);
      }
      // Get first workspace id (or use BIZAR_WORKSPACE_ID env)
      const wsId = process.env.BIZAR_WORKSPACE_ID;
      if (!wsId) {
        console.error(chalk.red('  ✗ Set BIZAR_WORKSPACE_ID env var or run from a workspace context.'));
        console.error(chalk.dim('  Run `bizar workspace list` to find your workspace id.'));
        process.exit(1);
      }
      const r = await postJson(baseUrl, `/api/workspaces/${wsId}/invites`, { email, role });
      console.log(chalk.green(`  ✓ Invite created for ${email} as ${role}`));
      console.log(chalk.dim('  Invite URL:'));
      console.log(`  ${r.url}`);
    } else if (sub === 'accept') {
      const token = positional[0];
      if (!token) {
        console.error(chalk.red('  ✗ Missing invite token. Usage: bizar workspace accept <token>'));
        process.exit(1);
      }
      // For CLI acceptance, we need user info - prompt or use env
      const email = process.env.BIZAR_USER_EMAIL;
      const name = process.env.BIZAR_USER_NAME || 'CLI User';
      if (!email) {
        console.error(chalk.red('  ✗ Set BIZAR_USER_EMAIL env var with your email address.'));
        process.exit(1);
      }
      const r = await postJson(baseUrl, `/api/invites/${token}/accept`, { email, name });
      console.log(chalk.green(`  ✓ Joined workspace "${r.workspace.name}" as ${r.role}`));
    } else if (sub === 'members') {
      const wsId = process.env.BIZAR_WORKSPACE_ID;
      if (!wsId) {
        console.error(chalk.red('  ✗ Set BIZAR_WORKSPACE_ID env var or run from a workspace context.'));
        process.exit(1);
      }
      const r = await getJson(baseUrl, `/api/workspaces/${wsId}`);
      const members = r.members || [];
      if (members.length === 0) {
        console.log(chalk.dim('  (no members)'));
        return;
      }
      console.log(chalk.bold(`  Members of ${r.workspace.name}:`));
      for (const m of members) {
        const badge = m.role === 'admin' ? chalk.green('admin') : m.role === 'editor' ? chalk.yellow('editor') : chalk.blue('viewer');
        console.log(`  ${m.userId.padEnd(20)} ${(m.name || m.email).padEnd(20)} ${badge}`);
      }
    } else if (sub === 'remove-member') {
      const userId = positional[0];
      if (!userId) {
        console.error(chalk.red('  ✗ Missing user id. Usage: bizar workspace remove-member <userId>'));
        process.exit(1);
      }
      const wsId = process.env.BIZAR_WORKSPACE_ID;
      if (!wsId) {
        console.error(chalk.red('  ✗ Set BIZAR_WORKSPACE_ID env var.'));
        process.exit(1);
      }
      await delJson(baseUrl, `/api/workspaces/${wsId}/members/${userId}`);
      console.log(chalk.green(`  ✓ Removed member ${userId}`));
    } else {
      console.error(chalk.red(`  ✗ Unknown workspace subcommand: ${sub}`));
      showWorkspaceHelp();
      process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ ${err.message}`));
    process.exit(1);
  }
}

export async function run(name, args, isHelpRequest) {
  await runWorkspaceCommand(args);
}
