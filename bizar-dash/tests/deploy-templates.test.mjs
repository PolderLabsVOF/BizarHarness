/**
 * bizar-dash/tests/deploy-templates.test.mjs
 *
 * Verify that deploy templates exist and are valid.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'deploy');

// Lazy-import toml/yaml only if needed (they're devDependencies)
let toml;
let yaml;

function getToml() {
  if (!toml) {
    toml = import('smol-toml').then((m) => m.parse || m.default?.parse || m.default);
  }
  // synchronous wrapper
  return { parse: (s) => { throw new Error('use async version'); } };
}

async function parseToml(content) {
  const mod = await import('smol-toml');
  return (mod.parse || mod.default?.parse || mod.default)(content);
}

async function parseYaml(content) {
  const mod = await import('js-yaml');
  return (mod.load || mod.default?.load || mod.default)(content);
}

describe('Deploy templates', () => {
  const platforms = ['vercel', 'cloudflare', 'fly', 'docker'];
  const requiredFiles = {
    vercel: ['vercel.json.template', 'api-index.template.js', 'README.md'],
    cloudflare: ['wrangler.toml.template', 'functions-index.template.js', 'README.md'],
    fly: ['fly.toml.template', 'README.md'],
    docker: ['docker-compose.template.yml', '.env.template', 'README.md'],
  };

  for (const platform of platforms) {
    it(platform + ' template directory exists', () => {
      const dir = join(TEMPLATES_DIR, platform);
      assert.ok(existsSync(dir), 'Directory missing: templates/deploy/' + platform);
    });

    it(platform + ' has at least 2 files', () => {
      const dir = join(TEMPLATES_DIR, platform);
      const entries = readdirSync(dir).filter((f) => {
        return statSync(join(dir, f)).isFile();
      });
      assert.ok(entries.length >= 2, platform + ' has ' + entries.length + ' files (need >=2): ' + entries.join(', '));
    });

    for (const file of (requiredFiles[platform] || [])) {
      it(platform + '/' + file + ' exists', () => {
        const fpath = join(TEMPLATES_DIR, platform, file);
        assert.ok(existsSync(fpath), 'Missing file: templates/deploy/' + platform + '/' + file);
      });
    }
  }

  it('vercel.json.template is valid JSON', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'vercel', 'vercel.json.template'), 'utf8');
    const parsed = JSON.parse(content);
    assert.ok(parsed.name);
    assert.strictEqual(parsed.version, 2);
    assert.ok(Array.isArray(parsed.routes));
  });

  it('wrangler.toml.template is valid TOML', { timeout: 10000 }, async () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'cloudflare', 'wrangler.toml.template'), 'utf8');
    const parsed = await parseToml(content);
    assert.ok(parsed);
    assert.ok(parsed.name);
    assert.ok(parsed.site);
  });

  it('fly.toml.template is valid TOML', { timeout: 10000 }, async () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'fly', 'fly.toml.template'), 'utf8');
    const parsed = await parseToml(content);
    assert.ok(parsed);
    assert.ok(parsed.app);
    assert.ok(parsed.http_service);
  });

  it('docker-compose.template.yml is valid YAML', { timeout: 10000 }, async () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'docker', 'docker-compose.template.yml'), 'utf8');
    const parsed = await parseYaml(content);
    assert.ok(parsed);
    assert.ok(parsed.services);
    assert.ok(parsed.services['bizar-dash']);
  });
});
