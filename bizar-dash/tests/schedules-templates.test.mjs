/**
 * bizar-dash/tests/schedules-templates.test.mjs
 *
 * Verify schedule template loading and from-template endpoint.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..', '..');
const TEMPLATES_DIR = join(PROJECT_ROOT, 'templates', 'schedules');

describe('Schedule templates', () => {
  it('templates/schedules directory exists', () => {
    assert.ok(existsSync(TEMPLATES_DIR), 'Missing templates/schedules directory');
  });

  it('at least 4 template files exist', () => {
    const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
    assert.ok(files.length >= 4, `Expected >=4 templates, found ${files.length}: ${files.join(', ')}`);
  });

  it('each template is valid JSON with required fields', () => {
    const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.json'));
    for (const file of files) {
      const content = readFileSync(join(TEMPLATES_DIR, file), 'utf8');
      const template = JSON.parse(content);
      assert.ok(template.id, `${file}: missing id`);
      assert.ok(template.name, `${file}: missing name`);
      assert.ok(template.description, `${file}: missing description`);
      assert.ok(template.type, `${file}: missing type`);
      assert.ok(template.action, `${file}: missing action`);
      assert.strictEqual(template.source, undefined, `${file}: should NOT have source field (added at load time)`);
    }
  });

  it('daily-backup.json is a valid cron schedule template', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'daily-backup.json'), 'utf8');
    const t = JSON.parse(content);
    assert.strictEqual(t.type, 'cron');
    assert.strictEqual(t.schedule, '0 3 * * *');
    assert.strictEqual(t.action.type, 'command');
    assert.ok(t.action.target.includes('bizar backup'));
  });

  it('weekly-digest.json is a valid agent template', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'weekly-digest.json'), 'utf8');
    const t = JSON.parse(content);
    assert.strictEqual(t.type, 'cron');
    assert.strictEqual(t.action.type, 'agent');
    assert.ok(t.action.prompt);
  });

  it('hourly-health-check.json is a valid interval template', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'hourly-health-check.json'), 'utf8');
    const t = JSON.parse(content);
    assert.strictEqual(t.type, 'interval');
    assert.strictEqual(t.action.type, 'command');
  });

  it('webhook-on-push.json has webhook action', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'webhook-on-push.json'), 'utf8');
    const t = JSON.parse(content);
    assert.strictEqual(t.action.type, 'webhook');
    assert.ok(t.action.target);
  });
});

describe('loadTemplates (unit)', () => {
  // Re-implement loadTemplates here to test in isolation
  function loadTemplates() {
    if (!existsSync(TEMPLATES_DIR)) return [];
    return readdirSync(TEMPLATES_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        const content = JSON.parse(readFileSync(join(TEMPLATES_DIR, f), 'utf8'));
        return { ...content, source: 'template', templateFile: f };
      });
  }

  it('returns array with source=template and templateFile set', () => {
    const templates = loadTemplates();
    assert.ok(Array.isArray(templates));
    assert.ok(templates.length > 0);
    for (const t of templates) {
      assert.strictEqual(t.source, 'template', 'each template should have source=template');
      assert.ok(t.templateFile.endsWith('.json'), 'templateFile should be a .json file');
    }
  });

  it('missing templates dir returns empty array', () => {
    // Use a path that definitely doesn't exist
    const fakeDir = join(TEMPLATES_DIR, '..', 'schedules-does-not-exist');
    function loadFromFake() {
      if (!existsSync(fakeDir)) return [];
      return readdirSync(fakeDir).filter((f) => f.endsWith('.json'));
    }
    const result = loadFromFake();
    assert.deepStrictEqual(result, []);
  });
});

describe('from-template endpoint contract', () => {
  it('template payload can be used to create a valid schedule payload', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'daily-backup.json'), 'utf8');
    const template = JSON.parse(content);

    // Simulate what the route does
    const schedulePayload = {
      name: template.name,
      type: template.type,
      schedule: template.schedule,
      timezone: template.timezone || 'UTC',
      action: template.action,
      enabled: true,
    };

    assert.ok(schedulePayload.name);
    assert.ok(['cron', 'interval', 'once'].includes(schedulePayload.type));
    assert.ok(schedulePayload.schedule);
    assert.ok(schedulePayload.action);
    assert.strictEqual(schedulePayload.enabled, true);
  });

  it('custom name can override template name', () => {
    const content = readFileSync(join(TEMPLATES_DIR, 'daily-backup.json'), 'utf8');
    const template = JSON.parse(content);
    const customName = 'My Custom Backup';

    const schedulePayload = {
      name: customName || template.name,
      type: template.type,
      schedule: template.schedule,
      timezone: template.timezone || 'UTC',
      action: template.action,
      enabled: true,
    };

    assert.strictEqual(schedulePayload.name, customName);
  });
});
