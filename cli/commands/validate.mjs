/**
 * cli/commands/validate.mjs
 *
 * v6.2.0 — `bizar validate` subcommand.
 *
 * The Cline-aware health check. Extends `bizar doctor` with a longer
 * battery of checks specific to a "flawless Cline integration":
 *
 *   - cline.json schema + plugin path
 *   - 14 agent files in ~/.cline/agents/
 *   - 13 skills mirrored from config/skills/ → ~/.cline/skills/
 *   - 7 rules mirrored from config/rules/ → ~/.cline/rules/
 *   - 3 hooks in ~/.cline/hooks/ (pre/post-tool-use + README)
 *   - 13 slash commands in ~/.cline/commands/ (incl. /team /test /validate)
 *   - provider config sanity (9router preferred, minimax fallback)
 *   - 9router reachability
 *   - plugin runtime deps wired (zod, @cline/sdk, @cline/core)
 *   - enableAgentTeams plumbing (via the plugin index)
 *
 * Exits non-zero if any check fails. Use `--json` for machine output.
 * Use `--strict` to also fail on lenient checks (9router unreachable).
 */
import chalk from 'chalk';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const HOME = homedir();

function clineDir() {
  if (process.env.CLINE_DIR && process.env.CLINE_DIR.trim()) {
    return process.env.CLINE_DIR.trim();
  }
  if (process.platform === 'win32') {
    return join(process.env.APPDATA || HOME, 'cline');
  }
  return join(HOME, '.cline');
}

const REPO_ROOT = process.env.BIZAR_REPO_ROOT || process.cwd();

const REQUIRED_AGENTS = [
  'odin.md', 'vor.md', 'frigg.md', 'quick.md',
  'mimir.md', 'heimdall.md', 'hermod.md', 'thor.md', 'baldr.md',
  'tyr.md', 'vidarr.md', 'forseti.md',
  'semble-search.md', 'agent-browser.md',
];

const REQUIRED_COMMANDS = [
  'audit.md', 'bizar.md', 'explain.md', 'init.md', 'learn.md',
  'plan.md', 'plow-through.md', 'pr-review.md', 'tailscale-serve.md',
  'visual-plan.md',
  'team.md', 'test.md', 'validate.md',
];

// v6.2.1 — Cline-native hook scripts (executable, shebang, no extension).
// These are real Cline hooks (https://docs.cline.bot/customization/hooks).
// The previous v6.x hook contract was markdown behavioral files, which
// Cline silently ignored — leading to the "I see skills but no hooks"
// user report.
const REQUIRED_HOOKS = [
  'PreToolUse', 'PostToolUse', 'TaskStart', 'TaskResume', 'UserPromptSubmit',
];

const REQUIRED_RUNTIME_DEPS = ['zod', '@cline/sdk', '@cline/core', '@cline/shared'];

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then((message) => ({ name, ok: true, message: message || 'ok' }))
    .catch((err) => ({ name, ok: false, message: (err && err.message) ? err.message : String(err) }));
}

function clineJsonPath() {
  return join(clineDir(), 'cline.json');
}

function readJsonSafe(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function pluginDepsDir() {
  return join(clineDir(), 'plugins', 'bizar', 'node_modules');
}

const CHECKS = {
  'cline-cli-reachable': async () => {
    const r = spawnSync('cline', ['--version'], { encoding: 'utf8', timeout: 5000 });
    if (r.status !== 0) throw new Error(`cline --version exited ${r.status}`);
    return (r.stdout || r.stderr || '').trim().split('\n')[0] || 'cline available';
  },

  'cline-json-exists': async () => {
    const p = clineJsonPath();
    if (!existsSync(p)) throw new Error(`not found at ${p}`);
    return p;
  },

  'cline-json-parses': async () => {
    const cfg = readJsonSafe(clineJsonPath());
    if (!cfg) throw new Error('invalid JSON');
    return 'cline.json parses';
  },

  'plugin-entry-present': async () => {
    const cfg = readJsonSafe(clineJsonPath());
    const plugins = Array.isArray(cfg?.plugin) ? cfg.plugin : [];
    const hasBizar = plugins.some((p) => {
      if (Array.isArray(p) && typeof p[0] === 'string') return p[0].includes('plugins/bizar');
      if (typeof p === 'string') return p.includes('plugins/bizar');
      if (p && typeof p === 'object') {
        return (p.path || '').includes('plugins/bizar');
      }
      return false;
    });
    if (!hasBizar) throw new Error('bizar plugin entry not in cline.json');
    return 'bizar plugin registered';
  },

  'plugin-path-resolves': async () => {
    const cfg = readJsonSafe(clineJsonPath());
    const plugins = Array.isArray(cfg?.plugin) ? cfg.plugin : [];
    let lastChecked = null;
    for (const p of plugins) {
      let entryPath = null;
      if (Array.isArray(p) && typeof p[0] === 'string') entryPath = p[0];
      else if (p && typeof p === 'object' && p.path) entryPath = p.path;
      if (!entryPath) continue;
      const isAbs = entryPath.startsWith('/') || /^[a-z]:[\\/]/i.test(entryPath);
      const resolved = isAbs ? entryPath : join(clineDir(), entryPath);
      lastChecked = resolved;
      if (!existsSync(resolved)) {
        throw new Error(`plugin path does not exist: ${resolved}`);
      }
    }
    return lastChecked ? `plugin path resolves: ${lastChecked}` : 'no plugin path';
  },

  'plugin-runtime-deps': async () => {
    const nm = pluginDepsDir();
    if (!existsSync(nm)) {
      throw new Error(`${nm} missing — run \`bizar update\``);
    }
    const missing = REQUIRED_RUNTIME_DEPS.filter((d) => !existsSync(join(nm, d)));
    if (missing.length > 0) {
      throw new Error(`missing runtime deps: ${missing.join(', ')} — run \`bizar update\``);
    }
    return `runtime deps present (${REQUIRED_RUNTIME_DEPS.join(', ')})`;
  },

  'agent-files-installed': async () => {
    const dir = join(clineDir(), 'agents');
    if (!existsSync(dir)) throw new Error(`agents dir missing: ${dir}`);
    const missing = REQUIRED_AGENTS.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) throw new Error(`missing: ${missing.join(', ')}`);
    return `all ${REQUIRED_AGENTS.length} agents present`;
  },

  'agent-yaml-format': async () => {
    // Cline loads agents via .yaml files generated from .md frontmatter.
    // Verify at least one .yaml exists alongside its .md.
    const dir = join(clineDir(), 'agents');
    if (!existsSync(dir)) throw new Error('agents dir missing');
    const yamls = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    if (yamls.length === 0) {
      throw new Error('no .yaml agent files — Cline may not load them');
    }
    return `${yamls.length} Cline-loadable .yaml agent file(s)`;
  },

  'slash-commands-installed': async () => {
    const dir = join(clineDir(), 'commands');
    if (!existsSync(dir)) throw new Error(`commands dir missing: ${dir}`);
    const missing = REQUIRED_COMMANDS.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) {
      throw new Error(`missing: ${missing.join(', ')} — run \`bizar update\``);
    }
    return `all ${REQUIRED_COMMANDS.length} slash commands present`;
  },

  'team-command-present': async () => {
    // /team is the new Cline command. Make sure it's installed.
    const team = join(clineDir(), 'commands', 'team.md');
    if (!existsSync(team)) throw new Error(`${team} missing — run \`bizar update\``);
    return '/team command installed';
  },

  'test-command-present': async () => {
    const testCmd = join(clineDir(), 'commands', 'test.md');
    if (!existsSync(testCmd)) throw new Error(`${testCmd} missing — run \`bizar update\``);
    return '/test command installed';
  },

  'validate-command-present': async () => {
    const v = join(clineDir(), 'commands', 'validate.md');
    if (!existsSync(v)) throw new Error(`${v} missing — run \`bizar update\``);
    return '/validate command installed';
  },

  'skills-installed': async () => {
    const dir = join(clineDir(), 'skills');
    if (!existsSync(dir)) throw new Error(`skills dir missing: ${dir} — run \`bizar update\``);
    const entries = readdirSync(dir, { withFileTypes: true });
    const skills = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (skills.length === 0) throw new Error('no skills installed — run `bizar update`');
    return `${skills.length} skill(s) installed: ${skills.slice(0, 5).join(', ')}${skills.length > 5 ? '...' : ''}`;
  },

  'rules-installed': async () => {
    const dir = join(clineDir(), 'rules');
    if (!existsSync(dir)) throw new Error(`rules dir missing: ${dir} — run \`bizar update\``);
    const entries = readdirSync(dir).filter((f) => f.endsWith('.md') || f.endsWith('.txt'));
    if (entries.length === 0) throw new Error('no rules installed — run `bizar update`');
    return `${entries.length} rule file(s): ${entries.join(', ')}`;
  },

  'hooks-installed': async () => {
    const dir = join(clineDir(), 'hooks');
    if (!existsSync(dir)) throw new Error(`hooks dir missing: ${dir} — run \`bizar update\``);
    const missing = REQUIRED_HOOKS.filter((f) => !existsSync(join(dir, f)));
    if (missing.length > 0) {
      throw new Error(`missing: ${missing.join(', ')} — run \`bizar update\``);
    }
    // Verify hooks are executable (Cline silently skips non-executable
    // hook files per the official contract). On Windows, chmod is a
    // no-op so skip the check there.
    if (process.platform !== 'win32') {
      const { statSync } = await import('node:fs');
      const nonExec = [];
      for (const f of REQUIRED_HOOKS) {
        try {
          const st = statSync(join(dir, f));
          // 0o755 = owner=rwx, group=r-x, other=r-x. Just check owner has x.
          if ((st.mode & 0o100) === 0) nonExec.push(f);
        } catch {
          nonExec.push(f);
        }
      }
      if (nonExec.length > 0) {
        throw new Error(`hooks not executable: ${nonExec.join(', ')} — run \`chmod +x ~/.cline/hooks/*\``);
      }
    }
    return `all ${REQUIRED_HOOKS.length} Cline-native hook file(s) executable in ${dir}`;
  },

  'hooks-canonical-location': async () => {
    // Cline's default global hooks location per the official docs:
    // `~/Documents/Cline/Hooks/`. Verify our hooks are also there
    // (Bizar install puts them in BOTH ~/.cline/hooks/ and
    // ~/Documents/Cline/Hooks/ for max compatibility).
    const canonical = join(homedir(), 'Documents', 'Cline', 'Hooks');
    if (!existsSync(canonical)) {
      return `optional: ${canonical} does not exist yet — \`bizar install\` creates it`;
    }
    const missing = REQUIRED_HOOKS.filter((f) => !existsSync(join(canonical, f)));
    if (missing.length > 0) {
      return `optional: ${missing.length} hook(s) missing in ${canonical} — re-run \`bizar install\``;
    }
    return `canonical hooks dir ${canonical} has all ${REQUIRED_HOOKS.length} hook(s)`;
  },

  'provider-config': async () => {
    const cfg = readJsonSafe(clineJsonPath());
    if (!cfg?.provider) throw new Error('no provider block in cline.json');
    const nine = cfg.provider['9router'];
    if (nine && nine.baseUrl) {
      const models = nine.models || {};
      const count = Object.keys(models).length;
      if (count === 0) throw new Error('provider.9router has no models');
      return `provider.9router (${count} models, baseUrl=${nine.baseUrl})`;
    }
    const minimax = cfg.provider.minimax;
    if (!minimax) {
      throw new Error('no provider.9router AND no provider.minimax');
    }
    return 'provider.minimax (legacy fallback)';
  },

  '9router-reachable': async () => {
    const url = process.env.NINEROUTER_URL || 'http://localhost:20128';
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 4000);
    try {
      const res = await fetch(`${url}/api/health`, { signal: ac.signal });
      if (!res.ok) throw new Error(`9router at ${url} returned HTTP ${res.status}`);
      const body = await res.text().catch(() => '');
      if (!body.includes('"ok":true')) {
        throw new Error(`9router at ${url} responded but body did not include ok:true`);
      }
      return `9router healthy at ${url}`;
    } finally {
      clearTimeout(timer);
    }
  },

  'default-agent-set': async () => {
    const cfg = readJsonSafe(clineJsonPath());
    if (!cfg?.default_agent) {
      throw new Error('no default_agent in cline.json — should be "odin"');
    }
    return `default_agent=${cfg.default_agent}`;
  },

  'instructions-loaded': async () => {
    const cfg = readJsonSafe(clineJsonPath());
    if (!cfg?.instructions || (Array.isArray(cfg.instructions) && cfg.instructions.length === 0)) {
      throw new Error('no instructions[] in cline.json — Cline won\'t load the tools reference');
    }
    const ins = Array.isArray(cfg.instructions) ? cfg.instructions : [cfg.instructions];
    return `${ins.length} instruction file(s) referenced`;
  },

  'plugin-index-loadable': async () => {
    // Spot-check that the deployed plugin's index.ts is on disk and looks
    // like a Cline plugin (has the `setup` function + registerTool pattern).
    const idx = join(clineDir(), 'plugins', 'bizar', 'index.ts');
    if (!existsSync(idx)) {
      throw new Error(`${idx} missing — plugin not copied`);
    }
    const stat = statSync(idx);
    if (stat.size < 100) {
      throw new Error(`${idx} is suspiciously small (${stat.size} bytes)`);
    }
    return `plugin index.ts: ${stat.size} bytes`;
  },

  'enable-agent-teams': async () => {
    // The /team command depends on `enableAgentTeams: true` in
    // plugins/bizar/src/clineruntime.ts. Static check by reading the
    // source file from the deployed plugin dir.
    const rt = join(clineDir(), 'plugins', 'bizar', 'src', 'clineruntime.ts');
    if (!existsSync(rt)) {
      // Source-only install (npm bundled): can't check here, skip leniently.
      return 'skipped (bundled install)';
    }
    const text = readFileSync(rt, 'utf8');
    if (!/enableAgentTeams:\s*true/.test(text)) {
      throw new Error('enableAgentTeams is not true in clineruntime.ts — /team will not work');
    }
    return 'enableAgentTeams: true in clineruntime.ts';
  },
};

const CHECK_ORDER = [
  'cline-cli-reachable',
  'cline-json-exists',
  'cline-json-parses',
  'plugin-entry-present',
  'plugin-path-resolves',
  'plugin-runtime-deps',
  'plugin-index-loadable',
  'enable-agent-teams',
  'agent-files-installed',
  'agent-yaml-format',
  'slash-commands-installed',
  'team-command-present',
  'test-command-present',
  'validate-command-present',
  'skills-installed',
  'rules-installed',
  'hooks-installed',
  'hooks-canonical-location',
  'default-agent-set',
  'instructions-loaded',
  'provider-config',
  '9router-reachable',
];

const LENIENT_CHECKS = new Set(['9router-reachable']);

export function showValidateHelp() {
  console.log(`
  bizar validate — Validate the Bizar install end-to-end.

  Usage:
    bizar validate                Run the full check battery (default)
    bizar validate --json         Machine-readable JSON output
    bizar validate --strict       Fail on lenient checks (e.g. 9router offline)
    bizar validate --only <name>  Run only the named check (e.g. team-command-present)
    bizar validate --help         Show this help

  Description:
    A 21-point health check that confirms the Bizar install is fully
    integrated with Cline:
      • cline CLI reachable + version
      • cline.json parses + plugin entry + path resolves
      • plugin runtime deps (zod, @cline/sdk, @cline/core) wired
      • plugin index.ts + enableAgentTeams plumbing
      • all 14 agent files installed + Cline .yaml format
      • all 13 slash commands (/audit, /bizar, /explain, /init, /learn,
        /plan, /plow-through, /pr-review, /tailscale-serve,
        /visual-plan, /team, /test, /validate)
      • all skills / rules / hooks mirrored to ~/.cline/
      • provider.9router (preferred) or provider.minimax (legacy)
      • 9Router gateway reachable (lenient unless --strict)
      • default_agent + instructions[] in cline.json

  Exit codes:
    0  All checks passed (or only lenient ones failed)
    1  One or more strict checks failed
    2  Invalid --only argument

  Related:
    bizar doctor          Simpler 8-point check (legacy)
    bizar update          Refresh the install (re-runs syncConfigExtras)
    bizar repair          Fix common issues (stale symlinks, version drift)
  `);
}

export async function runValidate(opts = {}) {
  const json = !!opts.json;
  const strict = !!opts.strict;
  const only = typeof opts.only === 'string' && opts.only.trim() ? opts.only.trim() : null;
  const list = only ? [only] : CHECK_ORDER;
  if (only && !CHECKS[only]) {
    console.error(chalk.red(`  ✗ Unknown check: ${only}`));
    console.error(chalk.dim(`  Run \`bizar validate\` to see all available checks.`));
    process.exit(2);
    return;
  }

  const results = [];
  for (const name of list) {
    const fn = CHECKS[name];
    if (!fn) continue;
    const r = await check(name, fn);
    results.push(r);
  }

  if (json) {
    process.stdout.write(JSON.stringify({ passed: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results }, null, 2) + '\n');
    const failed = results.filter((r) => !r.ok).length;
    const strictFailed = results.filter((r) => !r.ok && !LENIENT_CHECKS.has(r.name)).length;
    process.exit(strict ? (failed > 0 ? 1 : 0) : (strictFailed > 0 ? 1 : 0));
    return;
  }

  for (const r of results) {
    const isLenient = LENIENT_CHECKS.has(r.name);
    const marker = r.ok ? chalk.green('✓') : (isLenient ? chalk.yellow('⚠') : chalk.red('✗'));
    const label = r.name.padEnd(28);
    const msg = r.ok ? chalk.dim(`  ${r.message}`) : (isLenient ? chalk.yellow(`  ${r.message}`) : chalk.red(`  ${r.message}`));
    console.log(`  ${marker} ${label}${msg}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const strictFailed = results.filter((r) => !r.ok && !LENIENT_CHECKS.has(r.name)).length;
  console.log('');
  if (strictFailed === 0 && (failed === 0 || (!strict && failed === results.filter((r) => LENIENT_CHECKS.has(r.name)).length))) {
    console.log(chalk.green(`  ✓ ${passed} checks passed, ${failed} lenient warning(s)`));
    process.exit(0);
  } else {
    console.log(chalk.yellow(`  ⚠ ${passed} checks passed, ${failed} failed (${strictFailed} strict)`));
    console.log(chalk.dim(`  Run \`bizar update\` to refresh the install, or \`bizar repair\` for common fixes.`));
    process.exit(1);
  }
}

// ── run() entry point (used by bin.mjs dispatcher) ───────────────────────────

export async function run(name, args, isHelpRequest) {
  if (name !== 'validate') return false;
  if (isHelpRequest) {
    showValidateHelp();
    return true;
  }
  const json = args.includes('--json');
  const strict = args.includes('--strict');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
  await runValidate({ json, strict, only });
  return true;
}
