/**
 * src/server/backup-store.mjs
 *
 * v4.8.0 — Backup/restore core for BizarHarness state.
 *
 * Manages timestamped backup directories under
 * ~/.local/share/bizar/backups/ containing copies of config, memory,
 * usage logs, and project state. Each backup has a manifest.json
 * tracking version, platform, and included paths.
 */
import {
  existsSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  lstatSync,
} from 'node:fs';
import { join, resolve, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

// ── Constants ─────────────────────────────────────────────────────────────────

const BACKUP_PATHS = [
  { src: '~/.config/bizar/', label: 'config', required: true },
  { src: '~/.config/bizar/env.json', label: 'env', required: false },
  { src: '~/.config/cline/cline.json', label: 'cline', required: false },
  { src: '~/.config/cline/projects/', label: 'projects', required: false },
  // v5.x — Default memory vault moved from `~/.local/share/bizar/memory` to
  // `~/.bizar_memory`. Back up the new default; the legacy path is only
  // used when the user has set `BIZAR_MEMORY_VAULT` to it, in which case
  // they're still pointing at the old location and a separate backup is
  // not needed (their data is already covered by the override).
  { src: '~/.bizar_memory/', label: 'memory', required: false },
  { src: '~/.local/share/bizar/usage.jsonl', label: 'usage', required: false },
];

// Project-level paths (resolved relative to projectRoot at call time)
const PROJECT_BACKUP_PATHS = [
  { src: '.bizar/', label: 'project-state', required: false },
  { src: '.cline/skills/', label: 'project-skills', required: false },
  { src: '.agents/skills/', label: 'project-agents', required: false },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Expand ~ to home directory. */
function expandPath(p) {
  return p.replace(/^~\//, homedir() + '/');
}

/** Resolve a potentially-~ path to an absolute path. */
function resolvePath(p) {
  return resolve(expandPath(p));
}

/** Recursive directory size in bytes. */
function dirSize(dir) {
  let size = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      size += dirSize(full);
    } else {
      size += statSync(full).size;
    }
  }
  return size;
}

/**
 * Safely copy a directory recursively, handling broken symlinks.
 * Returns the number of items copied, or -1 on error.
 */
function safeCopyDir(src, dst) {
  let count = 0;
  try {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      const srcPath = join(src, entry.name);
      const dstPath = join(dst, entry.name);
      try {
        if (entry.isDirectory()) {
          count += safeCopyDir(srcPath, dstPath);
        } else if (entry.isSymbolicLink()) {
          // Check if symlink target exists before copying
          const linkTarget = readlinkSync(srcPath);
          if (existsSync(join(src, linkTarget)) || existsSync(linkTarget)) {
            copyFileSync(srcPath, dstPath);
            count++;
          }
          // Skip broken symlinks
        } else {
          copyFileSync(srcPath, dstPath);
          count++;
        }
      } catch (err) {
        console.warn(`[backup-store] Failed to copy ${srcPath}: ${err.message}`);
      }
    }
  } catch (err) {
    console.warn(`[backup-store] Failed to copy directory ${src}: ${err.message}`);
    return -1;
  }
  return count;
}

/**
 * Copy a file or directory to a destination, creating parent dirs.
 * Returns true if something was copied, false if source didn't exist.
 * Errors during copy are logged but don't fail the entire backup.
 */
function copyItem(src, dst, options = {}) {
  const { onprogress } = options;
  src = expandPath(src);
  if (!existsSync(src)) return false;

  try {
    const stat = lstatSync(src);
    mkdirSync(dirname(dst), { recursive: true });

    if (stat.isDirectory()) {
      const result = safeCopyDir(src, dst);
      if (result >= 0 && onprogress) onprogress(src, dst);
      return result >= 0;
    } else if (stat.isSymbolicLink()) {
      // Check if symlink target exists before copying
      const linkTarget = readlinkSync(src);
      if (!existsSync(linkTarget)) {
        console.warn(`[backup-store] Skipping broken symlink: ${src}`);
        return false;
      }
      copyFileSync(src, dst);
    } else {
      copyFileSync(src, dst);
    }
    // Enforce mode 0600 on the written file
    try { writeFileSync(dst, readFileSync(dst), { mode: 0o600 }); } catch { /* ignore */ }
    if (onprogress) onprogress(src, dst);
    return true;
  } catch (err) {
    console.warn(`[backup-store] Failed to copy ${src} -> ${dst}: ${err.message}`);
    return false;
  }
}

/** Compute SHA-256 hex digest of a file. */
function fileHash(file) {
  return crypto.createHash('sha256').update(readFileSync(file)).digest('hex');
}

/** Format bytes as human-readable string. */
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Read dashboard version from package.json. */
function getBizarVersion() {
  try {
    const { dirname: dir } = fileURLToPath(import.meta.url);
    const pkg = JSON.parse(
      readFileSync(join(dir, '..', '..', '..', 'package.json'), 'utf8'),
    );
    return pkg?.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** Format a date as YYYY-MM-DD-HHMMSS. */
function stamp(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${d}-${hh}${mm}${ss}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a new timestamped backup.
 *
 * @param {object} opts
 * @param {string} [opts.outDir='~/.local/share/bizar/backups'] — backup root
 * @param {string} [opts.label] — optional human label
 * @param {string} [opts.projectRoot] — if set, also backs up project-level paths
 * @returns {Promise<{ ok: boolean, path: string, manifest: object, sizeBytes: number, durationMs: number }>}
 */
export async function createBackup({ outDir = '~/.local/share/bizar/backups', label = null, projectRoot = null } = {}) {
  const startedAt = Date.now();
  outDir = expandPath(outDir);
  mkdirSync(outDir, { recursive: true });

  const ts = stamp();
  const name = label ? `bizar-${ts}-${label}` : `bizar-${ts}`;
  const backupPath = join(outDir, name);
  mkdirSync(backupPath, { recursive: true });

  const backed = [];
  const skipped = [];

  for (const item of BACKUP_PATHS) {
    const src = expandPath(item.src);
    const dst = join(backupPath, item.label);
    if (existsSync(src)) {
      copyItem(src, dst);
      backed.push({ label: item.label, src: item.src });
    } else if (item.required) {
      skipped.push({ label: item.label, reason: 'required source missing' });
    } else {
      skipped.push({ label: item.label, reason: 'optional source not present' });
    }
  }

  // Project-level paths if projectRoot provided
  if (projectRoot) {
    const resolvedProject = resolve(projectRoot);
    for (const item of PROJECT_BACKUP_PATHS) {
      const src = join(resolvedProject, item.src);
      const dst = join(backupPath, item.label);
      if (existsSync(src)) {
        copyItem(src, dst);
        backed.push({ label: item.label, src: item.src });
      } else {
        skipped.push({ label: item.label, reason: 'optional source not present' });
      }
    }
  }

  const manifest = {
    version: getBizarVersion(),
    createdAt: new Date().toISOString(),
    name,
    label,
    // Store full path entries so restore knows where files came from
    paths: backed.map((b) => ({ label: b.label, src: b.src })),
    skipped,
    bizarVersion: getBizarVersion(),
    platform: process.platform,
    nodeVersion: process.version,
  };

  writeFileSync(join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });

  let sizeBytes = 0;
  try { sizeBytes = dirSize(backupPath); } catch { /* ignore */ }

  return {
    ok: true,
    path: backupPath,
    manifest,
    sizeBytes,
    durationMs: Date.now() - startedAt,
  };
}

/**
 * List all available backups.
 *
 * @param {object} opts
 * @param {string} [opts.inDir='~/.local/share/bizar/backups']
 * @returns {Promise<Array<{ path: string, createdAt: string, sizeBytes: number, sizeFormatted: string, manifest: object | null }>>}
 */
export async function listBackups({ inDir = '~/.local/share/bizar/backups' } = {}) {
  inDir = expandPath(inDir);
  if (!existsSync(inDir)) return [];

  const entries = readdirSync(inDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((n) => n.startsWith('bizar-'))
    .sort()
    .reverse();

  return entries.map((name) => {
    const backupPath = join(inDir, name);
    const manifestPath = join(backupPath, 'manifest.json');
    let manifest = null;
    try {
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
      }
    } catch { /* corrupt manifest — treat as unknown */ }

    let sizeBytes = 0;
    try { sizeBytes = dirSize(backupPath); } catch { /* ignore */ }

    return {
      path: backupPath,
      name,
      createdAt: manifest?.createdAt || new Date(0).toISOString(),
      sizeBytes,
      sizeFormatted: formatBytes(sizeBytes),
      manifest,
    };
  });
}

/**
 * Restore files from a backup.
 *
 * @param {object} opts
 * @param {string} opts.backupPath — absolute path to the backup directory
 * @param {boolean} [opts.dryRun=false] — if true, report without modifying
 * @param {'overwrite'|'merge'|'skip'} [opts.conflictStrategy='merge']
 * @param {string} [opts.projectRoot] — if set, restore project-level paths to this root
 * @returns {Promise<{ ok: boolean, restored: string[], skipped: string[], errors: string[] }>}
 */
export async function restoreBackup({
  backupPath,
  dryRun = false,
  conflictStrategy = 'merge',
  projectRoot = null,
}) {
  backupPath = resolve(backupPath);
  const manifestPath = join(backupPath, 'manifest.json');

  if (!existsSync(backupPath)) {
    return { ok: false, restored: [], skipped: [], errors: [`Backup not found: ${backupPath}`] };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return { ok: false, restored: [], skipped: [], errors: ['manifest.json is missing or corrupt'] };
  }

  const restored = [];
  const skipped = [];
  const errors = [];

  for (const entry of manifest.paths || []) {
    // Support both old format (string[]) and new format ({label, src}[])
    const label = typeof entry === 'string' ? entry : entry.label;
    const originalSrc = typeof entry === 'string' ? null : entry.src;

    const src = join(backupPath, label);
    if (!existsSync(src)) {
      errors.push(`Backup entry missing: ${label}`);
      continue;
    }

    // Determine destination
    let dst;
    if (PROJECT_BACKUP_PATHS.some((p) => p.label === label) && projectRoot) {
      // Project-level path — restore relative to projectRoot using original source path
      const srcPath = originalSrc || label;
      dst = join(resolve(projectRoot), srcPath);
    } else {
      // Global path — restore to original location
      const original = BACKUP_PATHS.find((p) => p.label === label);
      if (!original) {
        errors.push(`Unknown label in manifest: ${label}`);
        continue;
      }
      dst = expandPath(originalSrc || original.src);
    }

    const targetExists = existsSync(dst);

    if (dryRun) {
      restored.push(`${label} (dry-run: would ${targetExists ? conflictStrategy : 'create'})`);
      continue;
    }

    if (!targetExists) {
      // Target doesn't exist — just copy
      try {
        copyItem(src, dst);
        restored.push(label);
      } catch (err) {
        errors.push(`Failed to restore ${label}: ${err.message}`);
      }
      continue;
    }

    // Target exists — apply conflict strategy
    if (conflictStrategy === 'skip') {
      skipped.push(label);
    } else if (conflictStrategy === 'overwrite') {
      try {
        if (statSync(dst).isDirectory()) rmSync(dst, { recursive: true, force: true });
        copyItem(src, dst);
        restored.push(label);
      } catch (err) {
        errors.push(`Failed to overwrite ${label}: ${err.message}`);
      }
    } else {
      // merge: overlay newer files
      try {
        overlayDir(src, dst);
        restored.push(label);
      } catch (err) {
        errors.push(`Failed to merge ${label}: ${err.message}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    restored,
    skipped,
    errors,
  };
}

/**
 * Overlay newer files from srcDir onto dstDir (merge strategy).
 * Files in src newer than dst are copied; dst-only files are preserved.
 */
function overlayDir(srcDir, dstDir) {
  mkdirSync(dstDir, { recursive: true });
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const src = join(srcDir, entry.name);
    const dst = join(dstDir, entry.name);
    if (entry.isDirectory()) {
      overlayDir(src, dst);
    } else {
      const srcTime = statSync(src).mtimeMs;
      const dstTime = existsSync(dst) ? statSync(dst).mtimeMs : 0;
      if (srcTime > dstTime) {
        mkdirSync(dirname(dst), { recursive: true });
        copyFileSync(src, dst);
        try { writeFileSync(dst, readFileSync(dst), { mode: 0o600 }); } catch { /* ignore */ }
      }
    }
  }
}

/**
 * Delete a backup directory.
 *
 * @param {object} opts
 * @param {string} opts.backupPath
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function deleteBackup({ backupPath }) {
  backupPath = resolve(backupPath);
  if (!existsSync(backupPath)) {
    return { ok: false, error: 'Backup not found' };
  }
  try {
    rmSync(backupPath, { recursive: true, force: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Verify a backup's integrity.
 *
 * @param {object} opts
 * @param {string} opts.backupPath
 * @returns {Promise<{ ok: boolean, issues: string[] }>}
 */
export async function verifyBackup({ backupPath }) {
  backupPath = resolve(backupPath);
  const issues = [];

  if (!existsSync(backupPath)) {
    return { ok: false, issues: ['Backup directory does not exist'] };
  }

  const manifestPath = join(backupPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    issues.push('manifest.json is missing');
    return { ok: false, issues };
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    issues.push('manifest.json is not valid JSON');
    return { ok: false, issues };
  }

  // Collect labels (support both old string[] and new {label}[] format)
  const labels = (manifest.paths || []).map((p) => (typeof p === 'string' ? p : p.label));

  for (const label of labels) {
    const entryPath = join(backupPath, label);
    if (!existsSync(entryPath)) {
      issues.push(`Expected backup entry is missing: ${label}`);
    }
  }

  // Check for unexpected entries
  const unexpected = readdirSync(backupPath).filter(
    (n) => n !== 'manifest.json' && !labels.includes(n),
  );
  if (unexpected.length > 0) {
    issues.push(`Unexpected files in backup: ${unexpected.join(', ')}`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Get manifest for a backup without full verify.
 */
export async function getManifest({ backupPath }) {
  backupPath = resolve(backupPath);
  const manifestPath = join(backupPath, 'manifest.json');
  if (!existsSync(manifestPath)) {
    return { ok: false, error: 'manifest.json not found' };
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    return { ok: true, manifest };
  } catch {
    return { ok: false, error: 'Failed to parse manifest.json' };
  }
}
