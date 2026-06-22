/**
 * cli/graph.mjs
 *
 * `bizar graph` — Per-project knowledge graph powered by graphify.
 * Graph data lives in .bizar/graph/ inside the project.
 */

import chalk from 'chalk';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── Constants ─────────────────────────────────────────────────────────────────

export const GRAPH_DIR = '.bizar/graph';
export const GRAPHIFY_OUT_ENV = 'GRAPHIFY_OUT';

// ── Python detection ───────────────────────────────────────────────────────────

/**
 * Find a Python 3 interpreter on PATH.
 * Returns the absolute path string, or null if none found.
 */
export function findPython() {
  // Prefer python3, fall back to python
  for (const name of ['python3', 'python']) {
    try {
      const result = spawnSync(name, ['--version'], { encoding: 'utf8', timeout: 5000 });
      if (result.status === 0 && result.stdout.includes('Python 3')) {
        return name;
      }
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Check whether graphify is available via `python3 -m graphify --version`.
 * Returns true if available, false otherwise.
 */
function checkGraphify(python) {
  try {
    const result = spawnSync(python, ['-m', 'graphify', '--version'], {
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env },
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

// ── Graph stats parsing ────────────────────────────────────────────────────────

/**
 * Parse .bizar/graph/graph.json and return stats.
 * Returns null if the file does not exist or cannot be parsed.
 *
 * Expected NetworkX node-link JSON shape:
 * {
 *   "directed": false,
 *   "multigraph": false,
 *   "graph": {},
 *   "nodes": [{ "id": "...", "community": 0, ... }],
 *   "links": [{ "source": "...", "target": "...", ... }]
 * }
 */
export function parseGraphStats(jsonPath) {
  if (!existsSync(jsonPath)) return null;
  try {
    const content = readFileSync(jsonPath, 'utf8');
    const graph = JSON.parse(content);

    const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
    const links = Array.isArray(graph.links) ? graph.links : [];

    // Count unique community values among nodes
    const communitySet = new Set();
    for (const node of nodes) {
      if (node.community !== undefined && node.community !== null) {
        communitySet.add(node.community);
      }
    }

    const stats = statSync(jsonPath);

    return {
      nodes: nodes.length,
      edges: links.length,
      communities: communitySet.size,
      lastModified: stats.mtime.toISOString(),
      sizeBytes: stats.size,
    };
  } catch {
    return null;
  }
}

// ── Gitignore guard ────────────────────────────────────────────────────────────

const GRAPH_GITIGNORE = `cache/
.graphify_python
cost.json
`;

/**
 * Ensure .bizar/graph/.gitignore exists so heavy cache artefacts are not committed.
 * Called after a successful first build.
 */
function ensureGitignore(graphDir) {
  const gitignorePath = join(graphDir, '.gitignore');
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, GRAPH_GITIGNORE, 'utf8');
  }
}

// ── Run helpers ───────────────────────────────────────────────────────────────

/**
 * Spawn a graphify command with GRAPHIFY_OUT set to GRAPH_DIR.
 * Streams stdout/stderr to the terminal. Returns the exit code.
 */
function runGraphify(python, subArgs, extraEnv = {}) {
  const env = { ...process.env, [GRAPHIFY_OUT_ENV]: GRAPH_DIR };
  const result = spawnSync(python, ['-m', 'graphify', ...subArgs], {
    stdio: 'inherit',
    env,
    timeout: 0, // no timeout — user may run long builds
  });
  return result.status ?? 1;
}

// ── Subcommand handlers ────────────────────────────────────────────────────────

async function cmdBuild(python) {
  console.log(chalk.dim('  Running full graphify pipeline...'));
  const code = runGraphify(python, ['.']);
  if (code === 0) {
    ensureGitignore(GRAPH_DIR);
    console.log(chalk.green(`\n  ✓ Graph built → ${GRAPH_DIR}/\n`));
  }
  return code;
}

async function cmdUpdate(python) {
  console.log(chalk.dim('  Running incremental graph update...'));
  return runGraphify(python, ['.', '--update']);
}

async function cmdQuery(python, query) {
  if (!query) {
    console.log(chalk.red('  Error: query text required.'));
    console.log(chalk.dim('  Usage: bizar graph query "<search term>"\n'));
    return 1;
  }
  return runGraphify(python, ['query', query]);
}

async function cmdPath(python, a, b) {
  if (!a || !b) {
    console.log(chalk.red('  Error: two concept names required.'));
    console.log(chalk.dim('  Usage: bizar graph path "<A>" "<B>"\n'));
    return 1;
  }
  return runGraphify(python, ['path', a, b]);
}

async function cmdExplain(python, concept) {
  if (!concept) {
    console.log(chalk.red('  Error: concept name required.'));
    console.log(chalk.dim('  Usage: bizar graph explain "<X>"\n'));
    return 1;
  }
  return runGraphify(python, ['explain', concept]);
}

async function cmdWatch(python) {
  console.log(chalk.dim('  Starting graphify watch mode (Ctrl-C to stop)...'));
  return runGraphify(python, ['.', '--watch']);
}

async function cmdStatus() {
  const graphJsonPath = join(GRAPH_DIR, 'graph.json');
  const stats = parseGraphStats(graphJsonPath);

  console.log(chalk.bold.hex('#10b981')('\n  ᛗ BIZAR GRAPH STATUS ᛗ\n'));
  console.log(`  Path:       ${GRAPH_DIR}/`);

  if (!existsSync(GRAPH_DIR)) {
    console.log(`  Exists:     ${chalk.yellow('no')}  (run \`bizar graph build\` first)`);
    console.log();
    return 0;
  }

  if (!stats) {
    console.log(`  Exists:     ${chalk.yellow('no graph.json found')}`);
    console.log();
    return 0;
  }

  console.log(`  Exists:     ${chalk.green('yes')}`);
  console.log(`  Size:       ${(stats.sizeBytes / 1024).toFixed(1)} KB`);
  console.log(`  Last built: ${stats.lastModified}`);
  console.log(`  Nodes:      ${stats.nodes}`);
  console.log(`  Edges:      ${stats.edges}`);
  console.log(`  Communities:${stats.communities}`);
  console.log();
  return 0;
}

async function cmdInstall() {
  const python = findPython();
  if (!python) {
    console.error(chalk.red('  Error: graphify requires Python 3.10+.'));
    console.error(chalk.dim('  Install Python from https://python.org or via your package manager, then re-run.\n'));
    return 1;
  }

  console.log(chalk.dim('  Installing graphify via pip...\n'));

  // pip install graphifyy
  console.log(chalk.dim('  $ pip install graphifyy'));
  let result = spawnSync('pip', ['install', 'graphifyy'], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.log(chalk.red('  ✗ pip install graphifyy failed.\n'));
    return 1;
  }

  // graphify install --platform opencode --project
  console.log(chalk.dim('\n  $ graphify install --platform opencode --project'));
  result = spawnSync('graphify', ['install', '--platform', 'opencode', '--project'], {
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.log(chalk.red('  ✗ graphify install failed.\n'));
    return 1;
  }

  console.log(chalk.green('\n  ✓ graphify installed and OpenCode plugin configured.\n'));
  return 0;
}

// ── Help ──────────────────────────────────────────────────────────────────────

export function showGraphHelp() {
  console.log(`
  ${chalk.bold.hex('#10b981')('bizar graph')} — Per-project knowledge graph (powered by graphify)

  ${chalk.dim('Usage:')}
    ${chalk.cyan('bizar graph build')}              # full build of the project graph
    ${chalk.cyan('bizar graph update')}              # incremental rebuild
    ${chalk.cyan('bizar graph query "<text>"')}    # query the graph
    ${chalk.cyan('bizar graph path "<A>" "<B>"')}  # shortest path between concepts
    ${chalk.cyan('bizar graph explain "<X>"')}     # all nodes related to a concept
    ${chalk.cyan('bizar graph watch')}              # watch for changes and rebuild
    ${chalk.cyan('bizar graph status')}             # show graph path, size, node/edge/community counts
    ${chalk.cyan('bizar graph install')}            # install graphify + drop OpenCode skill/plugin

  ${chalk.dim('Requires:')} Python 3.10+ and \`graphify\` (${chalk.cyan('pip install graphifyy')})

  ${chalk.dim('Graph data lives in')} ${chalk.cyan('.bizar/graph/')} ${chalk.dim('inside this project.')}
  `);
}

// ── Main entry point ───────────────────────────────────────────────────────────

/**
 * `bizar graph` entry point.
 *
 * @param {string[]} args — subcommand + args after 'graph'
 */
export async function runGraph(args) {
  // Show help when called with no args or --help / -h
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    showGraphHelp();
    return 0;
  }

  const sub = args[0];

  // status and install are the only subcommands that don't need graphify
  if (sub !== 'status' && sub !== 'install') {
    // Detect Python
    const python = findPython();
    if (!python) {
      console.error(chalk.red('  Error: graphify requires Python 3.10+.'));
      console.error(chalk.dim('  Install Python from https://python.org or via your package manager, then re-run.\n'));
      return 1;
    }

    // Detect graphify
    if (!checkGraphify(python)) {
      console.error(chalk.red('  Error: graphify is not installed.'));
      console.error(chalk.dim('  Install it with:'));
      console.error(chalk.cyan('    pip install graphifyy\n'));
      console.error(chalk.dim('  Or run:'));
      console.error(chalk.cyan('    bizar graph install\n'));
      return 1;
    }

    // Ensure .bizar/ directory exists (graphify will create graph/ inside it)
    mkdirSync(GRAPH_DIR, { recursive: true });

    switch (sub) {
      case 'build':
        return await cmdBuild(python);
      case 'update':
        return await cmdUpdate(python);
      case 'query':
        return await cmdQuery(python, args.slice(1).join(' '));
      case 'path':
        return await cmdPath(python, args[1], args[2]);
      case 'explain':
        return await cmdExplain(python, args[1]);
      case 'watch':
        return await cmdWatch(python);
      default:
        console.error(chalk.red(`  Error: unknown subcommand '${sub}'.\n`));
        showGraphHelp();
        return 1;
    }
  }

  // subcommands that don't need graphify
  switch (sub) {
    case 'status':
      return await cmdStatus();
    case 'install':
      return await cmdInstall();
    default:
      // unreachable — already caught unknown subcommands above
      return 1;
  }
}
