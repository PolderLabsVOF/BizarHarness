#!/usr/bin/env node
/**
 * scripts/check-deps.mjs
 *
 * v3.22.0 — Cross-platform dependency detector for BizarHarness.
 *
 * Exports a single async function `checkDeps({ strict })` that probes the
 * environment for required tools (node, bun, opencode, tmux, git) and returns
 * a structured JSON report.  Also runs as a CLI entry: `node check-deps.mjs`.
 *
 * Design:
 *   - No destructive shell-outs.  Only reads `--version` via execFileSync.
 *   - Cross-platform `which(cmd)` helper respects PATHEXT on Windows.
 *   - Semver comparison using Node's built-in `node:semver` (available >= 20)
 *     with a tiny fallback for 18.x.
 *   - Linux distro detection via `/etc/os-release` ID field.
 *   - Each DepReport: { name, status, current?, required, installCmd? }
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ── Semver helpers (works without node:semver on 18.x) ─────────────────────────

function parseSemver(s) {
  const m = String(s).match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [parseInt(m[1], 10) || 0, parseInt(m[2], 10) || 0, parseInt(m[3], 10) || 0];
}

function satisfies(current, required) {
  const c = parseSemver(current);
  const r = parseSemver(required);
  if (!c || !r) return null;
  // r[0] == c[0] && r[1] <= c[1] && r[2] <= c[2]  (simple prefix compare)
  for (let i = 0; i < 3; i++) {
    if (c[i] < r[i]) return false;
    if (c[i] > r[i]) return true;
  }
  return true; // equal
}

// ── Platform info ──────────────────────────────────────────────────────────────

const PLATFORM = process.platform; // 'win32' | 'darwin' | 'linux'

function detectLinuxDistro() {
  if (PLATFORM !== 'linux') return null;
  try {
    const content = readFileSync('/etc/os-release', 'utf8');
    const idMatch = content.match(/^ID=(.+)$/m);
    const idLikeMatch = content.match(/^ID_LIKE=(.+)$/m);
    const id = idMatch ? idMatch[1].trim().replace(/"/g, '') : 'unknown';
    const idLike = idLikeMatch ? idLikeMatch[1].trim().replace(/"/g, '') : '';
    // Normalise common variants
    if (id === 'ubuntu' || id === 'debian' || idLike.includes('debian')) return 'debian';
    if (id === 'fedora' || id === 'rhel' || id === 'centos' || idLike.includes('fedora')) return 'fedora';
    if (id === 'arch' || idLike.includes('arch')) return 'arch';
    if (id === 'opensuse' || id === 'opensuse-leap' || id === 'opensuse-tumbleweed' || idLike.includes('suse')) return 'suse';
    if (id === 'alpine') return 'alpine';
    if (id === 'nixos' || id === 'NixOS') return 'nixos';
    if (id === 'void' || id === 'void_linux') return 'void';
    return id;
  } catch {
    return 'unknown';
  }
}

const LINUX_DISTRO = detectLinuxDistro();

// ── Cross-platform which() ─────────────────────────────────────────────────────

function which(cmd) {
  const isWin = PLATFORM === 'win32';
  const pathext = isWin
    ? (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').toLowerCase().split(';')
    : [''];
  const pathDirs = (process.env.PATH || '').split(isWin ? ';' : ':');

  for (const dir of pathDirs) {
    if (!dir) continue;
    for (const ext of pathext) {
      const full = join(dir, cmd + ext);
      try {
        // existsSync + check executable — we can't do a real access() check
        // cross-platform without stat, but testing with execFileSync on a
        // known subcommand is safer.
        if (existsSync(full)) return full;
      } catch { /* try next */ }
    }
  }
  return null;
}

// ── Version readers ────────────────────────────────────────────────────────────

function safeExec(cmd, args = ['--version'], opts = {}) {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
    return (stdout || '').trim().split('\n')[0] || null;
  } catch {
    return null;
  }
}

function readNodeVersion() {
  return process.version.replace(/^v/, '');
}

function readBunVersion() {
  const raw = safeExec('bun');
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ')[0];
}

function readOpencodeVersion() {
  const raw = safeExec('opencode');
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ')[0];
}

function readPython3Version() {
  const raw = safeExec('python3', ['--version']);
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ').pop();
}

function readJqVersion() {
  const raw = safeExec('jq', ['--version']);
  if (!raw) return null;
  return raw.replace(/^jq-/, '');
}

function readGhVersion() {
  const raw = safeExec('gh', ['--version']);
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ')[0];
}

function readHeadroomVersion() {
  const raw = safeExec('headroom', ['--version']);
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ')[0];
}

function readSembleVersion() {
  const raw = safeExec('semble', ['--version']);
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ')[0];
}

function readSkillsVersion() {
  const raw = safeExec('skills', ['--version']);
  if (!raw) return null;
  const m = raw.match(/(\d+\.\d+\.\d+)/);
  return m ? m[1] : raw.split(' ')[0];
}

// ── Install command builders ───────────────────────────────────────────────────

function installCmdFor(name) {
  const winCmd = windowsInstallCmd(name);
  if (winCmd) return winCmd;
  if (PLATFORM === 'darwin') return macInstallCmd(name);
  if (PLATFORM === 'linux') return linuxInstallCmd(name);
  return null;
}

function windowsInstallCmd(name) {
  switch (name) {
    case 'node':   return 'winget install OpenJS.NodeJS.LTS 2>nul || choco install nodejs -y 2>nul || npm install -g n 2>nul';
    case 'bun':    return 'powershell -c "iwr bun.sh/install.ps1 -useb | iex"';
    case 'opencode': return 'winget install OpenCodeAI.OpenCode 2>nul || npm install -g @opencode-ai/cli 2>nul';
    case 'tmux':   return 'winget install mintty.tmux 2>nul || choco install tmux -y 2>nul';
    case 'git':    return 'winget install Git.Git 2>nul || choco install git -y 2>nul';
    case 'python3': return 'winget install Python.Python.3.12 2>nul || choco install python -y 2>nul';
    case 'pip':    return 'python -m pip install --upgrade pip 2>nul || pip install --upgrade pip 2>nul';
    case 'jq':     return 'winget install jqlang.jq 2>nul || choco install jq -y 2>nul';
    case 'gh':     return 'winget install GitHub.cli 2>nul || choco install gh -y 2>nul';
    case 'headroom':
    case 'semble':
    case 'skills': return 'npm install -g ' + name + ' 2>nul';
    default:       return null;
  }
}

function macInstallCmd(name) {
  switch (name) {
    case 'node':   return 'brew install node@18';
    case 'bun':    return 'brew install oven-sh/bun/bun';
    case 'opencode': return 'brew install opencodeai/tap/opencode';
    case 'tmux':   return 'brew install tmux';
    case 'git':    return null; // pre-installed on macOS
    case 'python3': return 'brew install python@3.12';
    case 'pip':    return 'python3 -m pip install --upgrade pip';
    case 'jq':     return 'brew install jq';
    case 'gh':     return 'brew install gh';
    case 'headroom':
    case 'semble':
    case 'skills': return 'npm install -g ' + name;
    default:       return null;
  }
}

function linuxInstallCmd(name) {
  if (LINUX_DISTRO === 'nixos') {
    // NixOS: everything via nix-shell or nix-env
    switch (name) {
      case 'node':   return 'nix-shell -p nodejs';
      case 'python3': return 'nix-shell -p python3';
      case 'jq':     return 'nix-shell -p jq';
      case 'git':    return 'nix-shell -p git';
      case 'gh':     return 'nix-shell -p gh';
      case 'headroom':
      case 'semble':
      case 'skills': return `nix-env -iA nixpkgs.${name}`;
      default: return null;
    }
  }
  const pm = LINUX_DISTRO === 'debian' ? 'apt-get' :
             LINUX_DISTRO === 'fedora' ? 'dnf' :
             LINUX_DISTRO === 'arch'   ? 'pacman' :
             LINUX_DISTRO === 'suse'   ? 'zypper' :
             LINUX_DISTRO === 'alpine' ? 'apk' :
             LINUX_DISTRO === 'void'   ? 'xbps-install' : null;
  if (!pm) return null;

  const sudo = process.getuid?.() === 0 ? '' : 'sudo ';

  switch (name) {
    case 'node': {
      // Prefer the official NodeSource script; fallback to distro packages.
      return `curl -fsSL https://deb.nodesource.com/setup_20.x | ${sudo}bash - && ${sudo}${pm} install -y nodejs`;
    }
    case 'bun':
      return 'curl -fsSL https://bun.sh/install | bash';
    case 'opencode':
      return 'curl -fsSL https://opencode.ai/install | sh';
    case 'tmux':
      return `${sudo}${pm} install -y tmux`;
    case 'git':
      return `${sudo}${pm} install -y git`;
    case 'python3':
      if (LINUX_DISTRO === 'alpine') return `${sudo}apk add --no-cache python3 py3-pip`;
      if (LINUX_DISTRO === 'void') return `${sudo}xbps-install -S python3 python3-pip`;
      return `${sudo}${pm} install -y python3 python3-pip`;
    case 'pip':
      if (LINUX_DISTRO === 'alpine') return `${sudo}apk add --no-cache py3-pip || ${sudo}python3 -m pip install --upgrade pip`;
      if (LINUX_DISTRO === 'void') return `${sudo}xbps-install -S python3-pip || ${sudo}python3 -m pip install --upgrade pip`;
      return `${sudo}${pm} install -y python3-pip || ${sudo}python3 -m pip install --upgrade pip`;
    case 'jq':
      if (LINUX_DISTRO === 'alpine') return `${sudo}apk add --no-cache jq`;
      if (LINUX_DISTRO === 'void') return `${sudo}xbps-install -S jq`;
      return `${sudo}${pm} install -y jq`;
    case 'gh':
      if (LINUX_DISTRO === 'alpine') return `${sudo}apk add --no-cache gh`;
      if (LINUX_DISTRO === 'void') return `${sudo}xbps-install -S gh`;
      return `${sudo}${pm} install -y gh`;
    case 'headroom':
    case 'semble':
    case 'skills':
      return `npm install -g ${name}`;
    default:
      return null;
  }
}

// ── Required versions ──────────────────────────────────────────────────────────

const REQUIRED = {
  node:    { raw: '>=18',    min: '18.0.0' },
  bun:     { raw: '>=1.0.0', min: '1.0.0' },
  opencode: { raw: '>=0.4.0', min: '0.4.0' },
};

// ── Main check ─────────────────────────────────────────────────────────────────

export async function checkDeps({ strict = false } = {}) {
  const missing = [];
  const present = [];
  const platform = `${PLATFORM}${PLATFORM === 'linux' ? '/' + LINUX_DISTRO : ''}`;

  // --- node ---
  {
    const current = readNodeVersion();
    const ok = current && satisfies(current, REQUIRED.node.min);
    const entry = { name: 'node', status: 'missing', current, required: REQUIRED.node.raw };
    if (!current) {
      entry.status = 'missing';
      entry.installCmd = installCmdFor('node');
      missing.push(entry);
    } else if (!ok) {
      entry.status = 'outdated';
      entry.installCmd = installCmdFor('node');
      missing.push(entry);
    } else {
      entry.status = 'present';
      present.push(entry);
    }
  }

  // --- bun ---
  {
    const current = readBunVersion();
    const entry = { name: 'bun', status: 'missing', current, required: REQUIRED.bun.raw };
    if (!current) {
      entry.status = 'missing';
      entry.installCmd = installCmdFor('bun');
      missing.push(entry);
    } else if (!satisfies(current, REQUIRED.bun.min)) {
      entry.status = 'outdated';
      entry.installCmd = installCmdFor('bun');
      missing.push(entry);
    } else {
      entry.status = 'present';
      present.push(entry);
    }
  }

  // --- opencode ---
  {
    const current = readOpencodeVersion();
    const entry = { name: 'opencode', status: 'missing', current, required: REQUIRED.opencode.raw };
    if (!current) {
      entry.status = 'missing';
      entry.installCmd = installCmdFor('opencode');
      missing.push(entry);
    } else if (!satisfies(current, REQUIRED.opencode.min)) {
      entry.status = 'outdated';
      entry.installCmd = installCmdFor('opencode');
      missing.push(entry);
    } else {
      entry.status = 'present';
      present.push(entry);
    }
  }

  // --- tmux (optional, recommended) ---
  {
    const current = null; // no version check — just presence
    const tmuxPath = which('tmux');
    const entry = { name: 'tmux', status: 'missing', current: null, required: 'recommended' };
    if (tmuxPath) {
      entry.status = 'present';
      entry.current = 'found';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('tmux');
      missing.push(entry);
    }
  }

  // --- git ---
  {
    const raw = safeExec('git');
    const gitPath = which('git');
    const entry = { name: 'git', status: 'missing', current: null, required: '*' };
    if (gitPath && raw) {
      const m = raw.match(/(\d+\.\d+\.\d+)/);
      entry.status = 'present';
      entry.current = m ? m[1] : raw.split(' ')[0];
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('git');
      missing.push(entry);
    }
  }

  // --- python3 ---
  {
    const current = readPython3Version();
    const entry = { name: 'python3', status: 'missing', current, required: 'recommended' };
    if (which('python3')) {
      entry.status = 'present';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('python3');
      missing.push(entry);
    }
  }

  // --- pip ---
  {
    const entry = { name: 'pip', status: 'missing', current: null, required: 'recommended' };
    if (which('pip') || which('pip3')) {
      entry.status = 'present';
      entry.current = 'found';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('pip');
      missing.push(entry);
    }
  }

  // --- jq ---
  {
    const current = readJqVersion();
    const entry = { name: 'jq', status: 'missing', current, required: 'recommended' };
    if (which('jq')) {
      entry.status = 'present';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('jq');
      missing.push(entry);
    }
  }

  // --- gh (GitHub CLI) ---
  {
    const current = readGhVersion();
    const entry = { name: 'gh', status: 'missing', current, required: 'recommended' };
    if (which('gh')) {
      entry.status = 'present';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('gh');
      missing.push(entry);
    }
  }

  // --- headroom ---
  {
    const current = readHeadroomVersion();
    const entry = { name: 'headroom', status: 'missing', current, required: 'recommended' };
    if (which('headroom')) {
      entry.status = 'present';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('headroom');
      missing.push(entry);
    }
  }

  // --- semble ---
  {
    const current = readSembleVersion();
    const entry = { name: 'semble', status: 'missing', current, required: 'recommended' };
    if (which('semble')) {
      entry.status = 'present';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('semble');
      missing.push(entry);
    }
  }

  // --- skills CLI ---
  {
    const current = readSkillsVersion();
    const entry = { name: 'skills', status: 'missing', current, required: 'recommended' };
    if (which('skills')) {
      entry.status = 'present';
      present.push(entry);
    } else {
      entry.installCmd = installCmdFor('skills');
      missing.push(entry);
    }
  }

  const ok = strict
    ? missing.filter(d => d.name !== 'tmux').length === 0
    : true;

  return { ok, missing, present, platform };
}

// ── CLI entry ──────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && (
  process.argv[1] === import.meta.filename ||
  process.argv[1].endsWith('/check-deps.mjs')
);

if (isMain) {
  const strict = process.argv.includes('--strict') || process.argv.includes('-s');
  const pretty = process.argv.includes('--pretty') || process.argv.includes('-p');
  const wantJson = process.argv.includes('--json') || pretty;
  checkDeps({ strict }).then(r => {
    if (wantJson) {
      process.stdout.write(JSON.stringify(r, null, pretty ? 2 : 0) + '\n');
    } else {
      // human-readable output when neither --json nor --pretty is set
      console.log(`platform: ${r.platform}`);
      for (const d of r.present) {
        const v = d.current ? `@${d.current}` : '';
        console.log(`  ${d.name}${v}  ${d.status}`);
      }
      for (const d of r.missing) {
        console.log(`  ${d.name}  missing${d.installCmd ? `  (install: ${d.installCmd})` : ''}`);
      }
    }
    // exit non-zero when strict mode finds missing required deps
    if (strict && !r.ok) process.exit(1);
  }).catch(err => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
}
