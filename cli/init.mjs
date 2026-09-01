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
  Area: cli | sdk | hooks | agents | npm | docs | build
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

export function initializeProjectLearningStore(bizarDir) {
  const learningDir = join(bizarDir, 'learning');
  mkdirSync(learningDir, { recursive: true, mode: 0o700 });
  const projectLessons = join(learningDir, 'project-lessons.json');
  if (!existsSync(projectLessons)) {
    writeFileSync(projectLessons, `${JSON.stringify({ schema: 'bizar.learning.v1', scope: 'project', items: [], updatedAt: null }, null, 2)}\n`, { mode: 0o600 });
    return { created: true, path: projectLessons };
  }
  return { created: false, path: projectLessons };
}

export async function runInit(cwd, opts = {}) {
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

  const projectLearning = initializeProjectLearningStore(bizarDir);
  if (projectLearning.created) process.stdout.write(`${chalk.green(`  ✓ Created ${projectLearning.path}`)}\n`);

  // Generate PRE_PUSH_NOTES.md
  writePrePushNotesFile(bizarDir);

  console.log(chalk.dim('\n  Project initialized. Run `@susan` to ask questions about the codebase.\n'));
  return true;
}
