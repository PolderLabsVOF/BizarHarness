import chalk from 'chalk';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { detectSkillsCli } from './utils.mjs';

function detectStack(cwd) {
  const stack = { language: null, framework: null, database: null, tools: [], build: null, test: null, runner: null };

  // Language detection
  if (existsSync(join(cwd, 'package.json'))) {
    stack.language = 'JavaScript/TypeScript';
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps.next) stack.framework = 'Next.js';
      else if (deps.react) stack.framework = 'React';
      else if (deps.vue) stack.framework = 'Vue';
      else if (deps.express) stack.framework = 'Express';
      else if (deps.nest) stack.framework = 'NestJS';
      if (deps.prisma) stack.database = 'PostgreSQL (Prisma)';
      else if (deps['@prisma/client']) stack.database = 'PostgreSQL (Prisma)';
      else if (deps.drizzle) stack.database = 'PostgreSQL (Drizzle)';
      else if (deps.typeorm) stack.database = 'PostgreSQL (TypeORM)';
      if (pkg.scripts) {
        if (pkg.scripts.test) stack.test = pkg.scripts.test;
        if (pkg.scripts.build) stack.build = pkg.scripts.build;
        if (pkg.scripts.dev) stack.runner = pkg.scripts.dev;
      }
      if (existsSync(join(cwd, 'tsconfig.json'))) stack.language = 'TypeScript';
    } catch { /* ignore parse errors */ }
  }

  if (existsSync(join(cwd, 'pyproject.toml'))) {
    stack.language = 'Python';
    const content = readFileSync(join(cwd, 'pyproject.toml'), 'utf-8');
    if (content.includes('django')) stack.framework = 'Django';
    else if (content.includes('fastapi')) stack.framework = 'FastAPI';
    else if (content.includes('flask')) stack.framework = 'Flask';
  }

  if (existsSync(join(cwd, 'Cargo.toml'))) {
    stack.language = 'Rust';
  }

  if (existsSync(join(cwd, 'go.mod'))) {
    stack.language = 'Go';
  }

  // Tool detection
  if (existsSync(join(cwd, '.github/workflows'))) stack.tools.push('GitHub Actions');
  if (existsSync(join(cwd, 'Dockerfile'))) stack.tools.push('Docker');
  if (existsSync(join(cwd, 'docker-compose.yml')) || existsSync(join(cwd, 'docker-compose.yaml'))) stack.tools.push('Docker Compose');
  if (existsSync(join(cwd, '.nvmrc'))) stack.tools.push('nvm');

  return stack;
}

/**
 * Write the .bizar/PRE_PUSH_NOTES.md template file.
 * Created during `bizar init` with empty active/resolved sections.
 */
export function writePrePushNotesFile(bizarDir) {
  const ppnPath = join(bizarDir, 'PRE_PUSH_NOTES.md');
  const template = `# Pre-push / Pre-release Heads-up

> File for tracking gotchas, risks, and things-to-verify before pushing or publishing.
> Each entry is archived (moved to \`_archive/\`) after the push that resolves it.

## Active heads-ups

<!--
  ## [YYYY-MM-DD] Short title
  Severity: blocker | warning | info
  Area: cli | dash | plugin | npm | docs | build
  Affected versions: v3.20.0–v3.21.0
  Description: What could go wrong. Be specific.
  Mitigation: What to do before pushing.
  Verified: ☐
-->

## Resolved

<!-- Entries moved here after the push that resolved them. Keep last 5. -->
`;
  writeFileSync(ppnPath, template);
  console.log(chalk.green(`  ✓ Created ${ppnPath}`));
}

export async function runInit(cwd, opts = {}) {
  // Extract memory-related non-interactive flags from opts.
  // Acceptable shapes:
  //   opts = { skipMemory: true }
  //   opts = { memoryMode: 'managed', memoryRepoName: 'my-repo' }
  //   opts = { memoryMode: 'local-only' }
  // (We also accept `args` for callers that pass raw argv — uncommon since
  // bin.mjs only calls runInit(process.cwd()) today.)
  const skipMemory = !!opts.skipMemory || process.env.BIZAR_SKIP_INSTALL;
  const memoryModeOpt = opts.memoryMode || null;
  const memoryRepoNameOpt = opts.memoryRepoName || null;
  console.log(chalk.bold.hex('#10b981')('\n  ᛗ BIZARHARNESS INIT ᛗ\n'));

  const bizarDir = join(cwd, '.bizar');
  mkdirSync(bizarDir, { recursive: true });

  // Detect stack
  console.log(chalk.dim('  Detecting project stack...'));
  const stack = detectStack(cwd);
  console.log(`  Language:  ${stack.language || chalk.yellow('unknown')}`);
  console.log(`  Framework: ${stack.framework || chalk.yellow('none detected')}`);
  console.log(`  Database:  ${stack.database || chalk.yellow('none detected')}`);
  if (stack.tools.length > 0) console.log(`  Tools:     ${stack.tools.join(', ')}`);
  console.log();

  // Install relevant skills via Skills CLI
  console.log(chalk.dim('  Installing relevant skills...'));
  const skillCommands = [];
  if (stack.language?.toLowerCase().includes('typescript') || stack.framework?.toLowerCase().includes('next') || stack.framework?.toLowerCase().includes('react')) {
    skillCommands.push(['add', 'vercel-labs/agent-skills', '--all', '-y']);
    skillCommands.push(['add', 'shadcn/ui', '--all', '-y']);
  }
  if (stack.framework?.toLowerCase().includes('django') || stack.framework?.toLowerCase().includes('fastapi') || stack.framework?.toLowerCase().includes('flask')) {
    skillCommands.push(['add', 'supabase/agent-skills', '--all', '-y']);
  }
  if (stack.language?.toLowerCase().includes('python')) {
    skillCommands.push(['add', 'mattpocock/skills', '-y']);
  }
  if (stack.language?.toLowerCase().includes('rust')) {
    skillCommands.push(['add', 'supabase/agent-skills', '--all', '-y']);
  }

  if (!(await detectSkillsCli())) {
    console.log(chalk.dim('  - skills CLI not detected (skipped)'));
  } else {
    for (const args of skillCommands) {
      const result = spawnSync('skills', args, {
        stdio: 'pipe',
        timeout: 30000,
      });
      if (result.status === 0) {
        console.log(chalk.green(`  ✓ skills ${args.join(' ')}`));
      } else {
        console.log(chalk.dim(`  - skills ${args.join(' ')} (skipped)`));
      }
    }
  }
  console.log();

  // Generate PROJECT.md
  const projectName = basename(cwd) || 'my-project';
  const projectMd = `# ${projectName}

${stack.framework ? `${stack.framework} ` : ''}${stack.language || ''} project.

## Stack
- Language: ${stack.language || 'unknown'}
${stack.framework ? `- Framework: ${stack.framework}` : ''}
${stack.database ? `- Database: ${stack.database}` : ''}
${stack.tools.length > 0 ? `- Tools: ${stack.tools.join(', ')}` : ''}
${stack.build ? `- Build: \`${stack.build}\`` : ''}
${stack.test ? `- Test: \`${stack.test}\`` : ''}
${stack.runner ? `- Dev: \`${stack.runner}\`` : ''}

## Conventions
- Follow BizarHarness Always-On Rules (see \`rules/\`)
- Use TDD for all new features
- Conventional commits

## Entry Points
- \`${stack.runner || 'npm run dev'}\` — development
- \`${stack.test || 'npm test'}\` — testing
- \`${stack.build || 'npm run build'}\` — build
`;

  const projPath = join(bizarDir, 'PROJECT.md');
  writeFileSync(projPath, projectMd);
  console.log(chalk.green(`  ✓ Created ${projPath}`));

  // Generate AGENTS_SELF_IMPROVEMENT.md if not exists
  const siPath = join(bizarDir, 'AGENTS_SELF_IMPROVEMENT.md');
  if (!existsSync(siPath)) {
    writeFileSync(siPath, `# Agents Self-Improvement Log

## Active Rules
- Use BizarHarness Always-On Rules
- Cost-aware routing: prefer cheapest capable agent
- Always split implementation across 2+ parallel agents

## Entries
`);
    console.log(chalk.green(`  ✓ Created ${siPath}`));
  }

  // Generate PRE_PUSH_NOTES.md
  writePrePushNotesFile(bizarDir);

  // Build per-project knowledge graph (graphify -> .bizar/graph/)
  // Soft step: never fails init. If graphify is missing or build errors,
  // the user can retry manually with `bizar graph build`.
  console.log(chalk.bold('\n--- Graph ---\n'));

  // Check for the graphify binary on PATH first (uv tool install shim).
  // Falls back to python -m for pip/pipx installs.
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const whichCheck = spawnSync(whichCmd, ['graphify'], { encoding: 'utf8', timeout: 5000 });
  let graphifyAvailable = whichCheck.status === 0 && (whichCheck.stdout || '').trim().length > 0;

  if (!graphifyAvailable) {
    const python = process.platform === 'win32' ? 'py' : 'python3';
    const detectGraphify = spawnSync(python, ['-c', 'import graphify; print(graphify.__version__)'], {
      cwd,
      encoding: 'utf8',
      timeout: 5000,
    });
    graphifyAvailable = detectGraphify.status === 0 && (detectGraphify.stdout || '').trim().length > 0;
  }

  if (!graphifyAvailable) {
    console.log(chalk.yellow('  graphify not detected — skipping project graph build.'));
    console.log(chalk.dim('  Install with: pip install graphifyy  (or pipx install graphifyy)'));
    console.log(chalk.dim('  Then re-run:  bizar graph build'));
    console.log(chalk.dim('  The graph will land in .bizar/graph/ inside this project.'));
  } else {
    console.log(chalk.dim('  Building project knowledge graph (.bizar/graph/)...'));
    // npx resolves "bizar" via local package.json bin field (or global install).
    // Fallback for environments without global bizar: node <repo>/cli/bin.mjs graph build
    const buildResult = spawnSync('npx', ['bizar', 'graph', 'build'], {
      cwd,
      stdio: 'inherit',
      timeout: 5 * 60 * 1000,
    });
    if (buildResult.status === 0) {
      console.log(chalk.green('  ✓ Graph built at .bizar/graph/ — query with: bizar graph query "<concept>"'));
    } else {
      const code = buildResult.status !== null ? buildResult.status : (buildResult.signal || '?');
      console.log(chalk.yellow(`  Graph build failed (exit ${code}). You can retry manually:`));
      console.log(chalk.dim('    bizar graph build'));
      console.log(chalk.dim('  The graph will land in .bizar/graph/ inside this project.'));
    }
  }

  // ── Memory configuration (Bizar Memory Service Phase 1) ──────────────────
  // Writes `.bizar/memory.json` so the dashboard / API knows where the vault
  // lives and which mode we're in. Gated on `BIZAR_SKIP_INSTALL` and the
  // explicit `--skip-memory` opt (callers that pre-supply a config file pass
  // `skipMemory: true` to avoid the interactive prompt).
  console.log(chalk.bold('\n--- Memory ---\n'));
  const memoryJsonPath = join(bizarDir, 'memory.json');
  if (existsSync(memoryJsonPath)) {
    console.log(chalk.dim(`  - memory config already exists at ${memoryJsonPath} (skipped)`));
  } else if (skipMemory) {
    console.log(chalk.dim('  - memory config: skipped (BIZAR_SKIP_INSTALL or skipMemory opt)'));
  } else {
    try {
      const inquirer = (await import('inquirer')).default;
      const initialMode = memoryModeOpt
        ? memoryModeOpt
        : (await inquirer.prompt([{
            type: 'list',
            name: 'memoryMode',
            message: 'Memory backend',
            choices: [
              { name: 'managed (shared user-level repo at ~/.bizar_memory/bizar-memory/)', value: 'managed' },
              { name: 'local-only (vault stays in this project at .obsidian/)', value: 'local-only' },
            ],
            default: 'managed',
          }])).memoryMode;
      const memoryMode = initialMode === 'managed' ? 'managed' : 'local-only';

      let repoName = memoryMode === 'managed'
        ? (memoryRepoNameOpt || 'bizar-memory')
        : null;
      if (memoryMode === 'managed' && !memoryRepoNameOpt) {
        const answer = await inquirer.prompt([{
          type: 'input',
          name: 'repoName',
          message: 'Memory repo name',
          default: 'bizar-memory',
        }]);
        repoName = answer.repoName || 'bizar-memory';
      }

      const projectId = basename(cwd) || 'project';
      const home = process.env.HOME || process.env.USERPROFILE || process.cwd();
      const managedPath = join(home, '.local', 'share', 'bizar', 'memory', repoName || 'bizar-memory');
      const vaultPath = memoryMode === 'managed' ? managedPath : join(cwd, '.obsidian');

      const { atomicWriteJson } = await import('./atomic.mjs');
      const config = {
        version: 1,
        backend: 'bizar-local',
        projectId,
        memoryRepo: {
          mode: memoryMode,
          path: vaultPath,
          remote: null,
          branch: 'main',
          namespace: memoryMode === 'managed' ? `projects/${projectId}` : null,
        },
        namespaces: {
          project: `projects/${projectId}`,
          global: 'global/bizar',
          user: `users/${process.env.USER || process.env.USERNAME || 'local'}`,
        },
        lightrag: {
          enabled: false,
          host: '127.0.0.1',
          port: 9621,
          workingDir: join(cwd, '.bizar', 'lightrag'),
        },
        git: {
          autoPullOnSessionStart: false,
          autoCommitOnMemoryWrite: false,
          autoPushOnSessionEnd: false,
          commitAuthor: 'Bizar Memory <bizar-memory@local>',
          commitMessageTemplate: `memory(${projectId}): {summary}`,
        },
      };
      atomicWriteJson(memoryJsonPath, config);
      console.log(chalk.green(`  ✓ Created ${memoryJsonPath} (mode: ${memoryMode})`));
      if (memoryMode === 'managed') {
        console.log(chalk.dim(`  Vault path: ${vaultPath} (shared user-level repo)`));
      } else {
        console.log(chalk.dim(`  Vault path: ${vaultPath} (local-only)`));
      }
    } catch (err) {
      // Inquirer prompt can throw if stdin is not a TTY (CI). Fall back to
      // a minimal local-only config so init still completes cleanly.
      console.log(chalk.yellow(`  ⚠ Memory config prompt failed (${err.message || err}); defaulting to local-only.`));
      try {
        const projectId = basename(cwd) || 'project';
        const { atomicWriteJson } = await import('./atomic.mjs');
        const fallback = {
          version: 1,
          backend: 'bizar-local',
          projectId,
          memoryRepo: {
            mode: 'local-only',
            path: join(cwd, '.obsidian'),
            remote: null,
            branch: 'main',
            namespace: null,
          },
          namespaces: {
            project: `projects/${projectId}`,
            global: 'global/bizar',
            user: `users/${process.env.USER || process.env.USERNAME || 'local'}`,
          },
          lightrag: { enabled: false, host: '127.0.0.1', port: 9621, workingDir: join(cwd, '.bizar', 'lightrag') },
          git: {
            autoPullOnSessionStart: false,
            autoCommitOnMemoryWrite: false,
            autoPushOnSessionEnd: false,
            commitAuthor: 'Bizar Memory <bizar-memory@local>',
            commitMessageTemplate: `memory(${projectId}): {summary}`,
          },
        };
        atomicWriteJson(memoryJsonPath, fallback);
        console.log(chalk.green(`  ✓ Created ${memoryJsonPath} (mode: local-only — fallback)`));
      } catch (innerErr) {
        console.log(chalk.dim(`  - memory config write failed (${innerErr.message || innerErr}); skipping`));
      }
    }
  }

  console.log(chalk.dim('\n  Project initialized. Run `@susan` to ask questions about the codebase.\n'));
  return true;
}
