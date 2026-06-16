import chalk from 'chalk';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

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
    else if (content.includes('fastapi') || content.includes('fastapi')) stack.framework = 'FastAPI';
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

export async function runInit(cwd) {
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
  const skillRepos = [];
  if (stack.language?.toLowerCase().includes('typescript') || stack.framework?.toLowerCase().includes('next') || stack.framework?.toLowerCase().includes('react')) {
    skillRepos.push('skills add vercel-labs/agent-skills --all -y');
    skillRepos.push('skills add shadcn/ui --all -y');
  }
  if (stack.framework?.toLowerCase().includes('django') || stack.framework?.toLowerCase().includes('fastapi') || stack.framework?.toLowerCase().includes('flask')) {
    skillRepos.push('skills add supabase/agent-skills --all -y');
  }
  if (stack.language?.toLowerCase().includes('python')) {
    skillRepos.push('skills add mattpocock/skills -y');
  }
  if (stack.language?.toLowerCase().includes('rust')) {
    skillRepos.push('skills add supabase/agent-skills --all -y');
  }

  for (const cmd of skillRepos) {
    try {
      execSync(cmd, { stdio: 'pipe', timeout: 30000 });
      console.log(chalk.green(`  ✓ ${cmd}`));
    } catch {
      console.log(chalk.dim(`  - ${cmd} (skipped)`));
    }
  }
  console.log();

  // Generate PROJECT.md
  const projectName = cwd.split('/').pop() || 'my-project';
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

  console.log(chalk.dim('\n  Project initialized. Run `@frigg` to ask questions about the codebase.\n'));
  return true;
}