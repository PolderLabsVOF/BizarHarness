/**
 * cli/commands/deploy.mjs
 *
 * v5.0 — One-click deploy to Vercel, Cloudflare, Fly.io, or Docker registry.
 *
 * Usage:
 *   bizar deploy --to vercel [--token <token>] [--project-name <name>]
 *   bizar deploy --to cloudflare [--token <token>] [--project-name <name>]
 *   bizar deploy --to fly [--token <token>] [--app-name <name>] [--region <region>]
 *   bizar deploy --to docker [--registry <ghcr.io|docker.io|...>] [--image-name <name>]
 *   bizar deploy --to docker --compose
 */
import chalk from 'chalk';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');

// ── Help text ──────────────────────────────────────────────────────────────────

export function showDeployHelp() {
  console.log(`
  bizar deploy — One-click deploy to your hosting platform of choice

  Usage:
    bizar deploy --to <platform> [options]

  Platforms:
    vercel       Deploy to Vercel (serverless)
    cloudflare   Deploy to Cloudflare Pages + Workers
    fly          Deploy to Fly.io
    docker       Build & push to a Docker registry (ghcr.io, docker.io, …)

  Options:
    --to <platform>            Required. Target platform.
    --token <token>            API token for the platform.
    --project-name <name>      Project / site name (Vercel, Cloudflare).
    --app-name <name>          Fly.io app name.
    --region <region>          Fly.io region (default: iad).
    --registry <url>           Docker registry URL (default: ghcr.io).
    --image-name <name>        Docker image name.
    --compose                  Generate docker-compose.yml + .env template.
    --out-dir <path>           Output directory for scaffold files
                               (default: ./bizar-deploy/).
    --help                     Show this help.

  Environment variables (fallback when --token is omitted):
    VERCEL_TOKEN               Vercel API token
    CLOUDFLARE_API_TOKEN       Cloudflare API token
    FLY_API_TOKEN              Fly.io API token

  Examples:
    bizar deploy --to vercel --token \$(cat ~/.vercel/token)
    bizar deploy --to cloudflare --project-name my-dash
    bizar deploy --to fly --app-name bizar-dash --region lhr
    bizar deploy --to docker --registry ghcr.io/my-org --image-name bizar-dash
    bizar deploy --to docker --compose
  `);
}

// ── Option parsing ────────────────────────────────────────────────────────────

function parseDeployOpts(args) {
  const opts = {
    to: null,
    token: null,
    projectName: null,
    appName: null,
    region: null,
    registry: null,
    imageName: null,
    compose: false,
    outDir: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    switch (a) {
      case '--to':
        opts.to = args[++i];
        break;
      case '--token':
        opts.token = args[++i];
        break;
      case '--project-name':
        opts.projectName = args[++i];
        break;
      case '--app-name':
        opts.appName = args[++i];
        break;
      case '--region':
        opts.region = args[++i];
        break;
      case '--registry':
        opts.registry = args[++i];
        break;
      case '--image-name':
        opts.imageName = args[++i];
        break;
      case '--out-dir':
        opts.outDir = args[++i];
        break;
      case '--compose':
        opts.compose = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
    }
  }

  return opts;
}

// ── Prerequisite checks ──────────────────────────────────────────────────────

/**
 * Check that required CLI tools are on PATH.
 * Returns array of missing tool names.
 */
function checkPrerequisites(required) {
  const { execFileSync } = require_node('child_process');
  const missing = [];
  for (const tool of required) {
    try {
      execFileSync('which', [tool], { encoding: 'utf8', timeout: 3000, stdio: 'pipe' });
    } catch {
      missing.push(tool);
    }
  }
  return missing;
}

function require_node(mod) {
  // eslint-disable-next-line no-new-func
  return Function('return require("' + mod + '")')();
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

export async function runDeploy(deployArgs) {
  const opts = parseDeployOpts(deployArgs);

  if (opts.help || !opts.to) {
    showDeployHelp();
    if (!opts.to) {
      console.error(chalk.red('  ✗ --to <platform> is required.'));
      process.exit(1);
    }
    return;
  }

  const platform = opts.to.toLowerCase();
  const outDir = opts.outDir || join(process.cwd(), 'bizar-deploy');

  // Resolve tokens from env if not provided
  if (!opts.token) {
    const envMap = {
      vercel: 'VERCEL_TOKEN',
      cloudflare: 'CLOUDFLARE_API_TOKEN',
      fly: 'FLY_API_TOKEN',
    };
    const envVar = envMap[platform];
    if (envVar && process.env[envVar]) {
      opts.token = process.env[envVar];
    }
  }

  const context = {
    ...opts,
    projectRoot: PROJECT_ROOT,
    outDir,
  };

  try {
    switch (platform) {
      case 'vercel': {
        const { deployToVercel } = await import('./deploy/vercel.mjs');
        const result = await deployToVercel(context);
        printResult('Vercel', result);
        break;
      }
      case 'cloudflare': {
        const { deployToCloudflare } = await import('./deploy/cloudflare.mjs');
        const result = await deployToCloudflare(context);
        printResult('Cloudflare', result);
        break;
      }
      case 'fly': {
        const { deployToFly } = await import('./deploy/fly.mjs');
        const result = await deployToFly(context);
        printResult('Fly.io', result);
        break;
      }
      case 'docker': {
        const { deployToDocker } = await import('./deploy/docker.mjs');
        const result = await deployToDocker(context);
        printResult('Docker', result);
        break;
      }
      default:
        console.error(chalk.red(`  ✗ Unknown platform: ${platform}`));
        showDeployHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error(chalk.red(`  ✗ Deploy failed: ${err.message}`));
    if (err.stderr) {
      console.error(chalk.dim(err.stderr));
    }
    process.exit(1);
  }
}

function printResult(platformName, result) {
  console.log(chalk.green(`  ✓ Deployed to ${platformName}`));
  if (result.url) {
    console.log(`    URL: ${chalk.cyan(result.url)}`);
  }
  if (result.deploymentId) {
    console.log(`    ID:  ${chalk.dim(result.deploymentId)}`);
  }
  if (result.notes && result.notes.length > 0) {
    for (const note of result.notes) {
      console.log(chalk.dim(`    ${note}`));
    }
  }
}

export async function run(name, args, isHelpRequest) {
  if (args.length === 0 || isHelpRequest) {
    showDeployHelp();
    return;
  }
  await runDeploy(args);
}
