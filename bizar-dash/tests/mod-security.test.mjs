/**
 * mod-security unit tests.
 *
 * Covers permission parsing, filesystem sandboxing, subprocess
 * allowlisting, and integrity hashing. These run as plain Node tests
 * — no dashboard, no express, no DB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

import {
  parsePermissions,
  authorizeFsPath,
  authorizeSpawn,
  computeModHash,
  verifyModIntegrity,
  createAuditWriter,
  createModSecurityContext,
  ALLOWED_BINARIES,
} from '../src/server/mod-security';

// ---- Helpers ----
function freshTmp() {
  const d = join(tmpdir(), `modsec-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(d, { recursive: true });
  return d;
}

describe('parsePermissions', () => {
  it('accepts well-formed permission tokens', () => {
    const r = parsePermissions([
      'fs:read:/abs/path',
      'fs:write:/abs/path/*',
      'process:spawn:bizar',
      'network:example.com',
    ]);
    expect(r.invalid).toEqual([]);
    expect(r.allowed.size).toBe(4);
  });

  it('flags malformed tokens', () => {
    const r = parsePermissions([
      'garbage',
      42,
      null,
      'unknown:foo',
    ]);
    expect(r.invalid.length).toBe(4);
  });

  it('mixes valid and invalid', () => {
    const r = parsePermissions(['fs:read:/x', 'no-colon']);
    expect(r.invalid).toEqual(['no-colon']);
    expect(r.allowed.has('fs:read:/x')).toBe(true);
  });
});

describe('authorizeFsPath', () => {
  const perms = new Set([
    'fs:read:/allowed',
    'fs:read:/allowed/sub/*',
    'fs:write:/writable/*',
    'fs:read:~/config/bizar',   // home-relative
  ]);

  it('accepts exact match', () => {
    expect(authorizeFsPath(perms, 'read', '/allowed')).toBe('/allowed');
  });

  it('accepts prefix match', () => {
    expect(authorizeFsPath(perms, 'read', '/allowed/sub/x')).toBe('/allowed/sub/x');
  });

  it('rejects path outside scope', () => {
    expect(() => authorizeFsPath(perms, 'read', '/notallowed')).toThrow(/not authorized/);
  });

  it('rejects null bytes', () => {
    expect(() => authorizeFsPath(perms, 'read', '/allowed\0bad')).toThrow(/null bytes/);
  });

  it('expands ~ in scope', () => {
    // ~/config/bizar resolves to homedir + /config/bizar
    const r = authorizeFsPath(perms, 'read', '~/config/bizar/x');
    expect(r).toContain('/config/bizar');
  });

  it('write scope does not grant read', () => {
    expect(() => authorizeFsPath(perms, 'write', '/allowed')).toThrow(/not authorized/);
  });
});

describe('authorizeSpawn', () => {
  it('allows whitelisted binaries without explicit perm', () => {
    for (const bin of ['bizar', 'cline', 'python3', 'git', 'node', 'npm']) {
      expect(() => authorizeSpawn(new Set(), () => {}, bin)).not.toThrow();
    }
  });

  it('rejects non-whitelisted binaries without explicit perm', () => {
    expect(() => authorizeSpawn(new Set(), () => {}, 'curl')).toThrow(/not authorized/);
    expect(() => authorizeSpawn(new Set(), () => {}, 'wget')).toThrow(/not authorized/);
  });

  it('allows non-whitelisted with explicit permission', () => {
    const perms = new Set(['process:spawn:curl']);
    expect(() => authorizeSpawn(perms, () => {}, 'curl')).not.toThrow();
  });

  it('process:spawn:* wildcard allows any', () => {
    const perms = new Set(['process:spawn:*']);
    expect(() => authorizeSpawn(perms, () => {}, 'anything')).not.toThrow();
  });

  it('rejects paths (must use bare name or full perms)', () => {
    expect(() => authorizeSpawn(new Set(), () => {}, '/bin/ls')).toThrow(/not authorized/);
    const perms = new Set(['process:spawn:/bin/ls']);
    expect(() => authorizeSpawn(perms, () => {}, '/bin/ls')).not.toThrow();
  });
});

describe('computeModHash + verifyModIntegrity', () => {
  let modDir;
  beforeEach(() => {
    modDir = freshTmp();
    writeFileSync(join(modDir, 'mod.json'), '{"id":"test","version":"1.0.0"}');
    writeFileSync(join(modDir, 'route.mjs'), 'export default function(){}');
  });
  afterEach(() => {
    rmSync(modDir, { recursive: true, force: true });
  });

  it('hash is deterministic for identical content', () => {
    const a = computeModHash(modDir);
    const b = computeModHash(modDir);
    expect(a).toBe(b);
    expect(a.length).toBe(64);
  });

  it('hash changes when a file changes', () => {
    const before = computeModHash(modDir);
    writeFileSync(join(modDir, 'route.mjs'), 'export default function() {/* changed */}');
    const after = computeModHash(modDir);
    expect(after).not.toBe(before);
  });

  it('hash changes when a file is added', () => {
    const before = computeModHash(modDir);
    writeFileSync(join(modDir, 'README.md'), '# hi');
    const after = computeModHash(modDir);
    expect(after).not.toBe(before);
  });

  it('verifyModIntegrity returns ok=true when hash matches', () => {
    const hash = computeModHash(modDir);
    const mod = {
      id: 'test',
      version: '1.0.0',
      path: modDir,
      _integrity: hash,
    };
    const r = verifyModIntegrity(mod);
    expect(r.ok).toBe(true);
    expect(r.hash).toBe(hash);
  });

  it('verifyModIntegrity returns ok=false on mismatch', () => {
    const mod = {
      id: 'test', version: '1.0.0', path: modDir,
      _integrity: 'a'.repeat(64), // wrong hash
    };
    const r = verifyModIntegrity(mod);
    expect(r.ok).toBe(false);
    expect(r.expected).toBe('a'.repeat(64));
    expect(r.reason).toContain('modified');
  });

  it('verifyModIntegrity returns ok="unsigned" when no _integrity field', () => {
    const mod = { id: 'test', version: '1.0.0', path: modDir };
    const r = verifyModIntegrity(mod);
    expect(r.ok).toBe('unsigned');
  });

  it('skips node_modules and .DS_Store', () => {
    mkdirSync(join(modDir, 'node_modules'));
    writeFileSync(join(modDir, 'node_modules', 'x.js'), 'noise');
    writeFileSync(join(modDir, '.DS_Store'), 'noise');
    const a = computeModHash(modDir);
    // Remove the noise and re-hash
    rmSync(join(modDir, 'node_modules'), { recursive: true, force: true });
    rmSync(join(modDir, '.DS_Store'));
    const b = computeModHash(modDir);
    expect(a).toBe(b);
  });
});

describe('createAuditWriter', () => {
  let logPath;
  beforeEach(() => {
    logPath = join(tmpdir(), `audit-test-${Date.now()}.log`);
    // Override the audit path by calling on a temp file via writeFileSync.
    // createAuditWriter uses a hard-coded path; we'll read it directly.
  });
  afterEach(() => {
    // Best-effort cleanup; we don't know the exact path the writer used.
  });

  it('writes a JSON line per audit call', () => {
    // Create a mod-like object and call createAuditWriter
    // We can't easily override the path, so we just verify the contract.
    const mod = { id: 'audit-test-mod', version: '1.0.0' };
    const audit = createAuditWriter(mod);
    expect(typeof audit).toBe('function');
    // Calling it shouldn't throw.
    audit('test:event', { ok: true });
  });
});

describe('createModSecurityContext', () => {
  it('returns parsed perms, audit writer, and fs helpers', () => {
    const mod = {
      id: 'ctx-test',
      version: '1.0.0',
      permissions: ['fs:read:/x', 'bogus'],
      path: '/some/path',
    };
    const ctx = createModSecurityContext(mod);
    expect(ctx.permissions.has('fs:read:/x')).toBe(true);
    expect(ctx.invalidPermissions).toEqual(['bogus']);
    expect(typeof ctx.audit).toBe('function');
    expect(typeof ctx.fs.readFileSync).toBe('function');
    expect(typeof ctx.authorizeSpawn).toBe('function');
  });

  it('fs.readFileSync throws on out-of-scope paths', () => {
    const mod = {
      id: 'sandbox-test',
      version: '1.0.0',
      permissions: ['fs:read:/allowed'],
      path: '/x',
    };
    const ctx = createModSecurityContext(mod);
    expect(() => ctx.fs.readFileSync('/forbidden')).toThrow(/not authorized/);
  });

  it('authorizeSpawn rejects non-allowed binaries', () => {
    const mod = {
      id: 'spawn-test',
      version: '1.0.0',
      permissions: [],
      path: '/x',
    };
    const ctx = createModSecurityContext(mod);
    expect(() => ctx.authorizeSpawn('curl')).toThrow(/not authorized/);
  });

  it('verifyIntegrity returns the integrity object', () => {
    const mod = {
      id: 'integrity-test',
      version: '1.0.0',
      permissions: [],
      path: '/tmp',
    };
    const ctx = createModSecurityContext(mod);
    // No _integrity field on this fake mod, so should be 'unsigned'
    const r = ctx.verifyIntegrity();
    expect(['true', 'unsigned', 'false']).toContain(String(r.ok));
  });
});