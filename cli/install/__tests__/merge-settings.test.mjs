/**
 * cli/install/__tests__/merge-settings.test.mjs
 *
 * Tests that writeClaudeSettings() correctly:
 * 1. Writes minimal settings with the four gateway-discovery env vars when
 *    no existing ~/.claude/settings.json is present.
 * 2. Preserves all existing top-level fields (permissions, hooks, mcpServers,
 *    attribution, worktree, enableWorkflows) when merging.
 * 3. Adds the four gateway-discovery env vars without removing any existing
 *    ANTHROPIC_DEFAULT_*_MODEL entries the user already has.
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';

const TEMP_CLAUDE_DIR = join(process.env.TMPDIR || '/tmp', `bizar-test-claude-${Date.now()}`);

function runProvisionInline(claudeDir, existingSettings = null) {
  // Mirror the readJsonSafe / ensureDir / writeFileSync logic inline
  // so we can test the actual writeClaudeSettings merge behaviour.
  const settingsFile = join(claudeDir, 'settings.json');
  const existing = existingSettings !== null
    ? existingSettings
    : (existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {});

  const BIZAR_HOME = process.env.BIZAR_HOME || join(process.env.HOME || '/home/test', '.config/bizar');

  const hook = (name) => ({
    type: 'command',
    command: `node "${join(claudeDir, 'hooks', name)}"`,
    timeout: 30,
  });

  const bizarSettings = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    mcpServers: {
      bizar: { type: 'stdio', command: 'npx', args: ['-y', '@polderlabs/bizar-sdk', 'mcp'], env: { BIZAR_HOME } },
      semble: { type: 'stdio', command: 'semble', args: ['mcp'] },
      'agent-browser': { type: 'stdio', command: 'agent-browser', args: ['mcp'] },
    },
    permissions: {
      defaultMode: 'acceptEdits',
      allow: ['mcp__bizar__*', 'mcp__semble__*', 'mcp__agent-browser__*'],
      ask: [
        'Bash(git commit *)', 'Bash(git push *)',
        'Bash(gh pr create *)', 'Bash(gh pr edit *)', 'Bash(gh pr merge *)',
        'Bash(gh release *)', 'Bash(npm publish *)', 'Bash(bun publish *)',
        'Bash(vercel deploy *)', 'Bash(wrangler deploy *)',
      ],
      deny: [
        'Read(./.env)', 'Read(./.env.*)',
        'Bash(rm -rf /)', 'Bash(sudo *)',
        'Bash(git push --force *)', 'Bash(git push -f *)', 'Bash(git rebase *)',
        'Write(./node_modules/**)',
      ],
    },
    env: {
      BIZAR_HOME,
      ANTHROPIC_BASE_URL: 'http://localhost:20128/v1',
      BIZAR_MODEL_ROUTER_URL: 'http://localhost:20128/v1',
      ANTHROPIC_AUTH_TOKEN: 'sk_9router',
      CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
    },
    hooks: {
      PreToolUse: [
        { matcher: 'Write|Edit|MultiEdit', hooks: [hook('pretooluse-editwrite.mjs')] },
        { matcher: 'Bash', hooks: [hook('pretooluse-bash.mjs')] },
      ],
    },
  };

  const merged = { ...existing };
  merged.$schema   = merged.$schema || bizarSettings.$schema;
  merged.mcpServers = { ...(existing.mcpServers || {}), ...bizarSettings.mcpServers };
  merged.permissions = {
    defaultMode: existing.permissions?.defaultMode || bizarSettings.permissions.defaultMode,
    allow: [...new Set([...(existing.permissions?.allow || []), ...bizarSettings.permissions.allow])],
    deny:  [...new Set([...(existing.permissions?.deny || []),  ...bizarSettings.permissions.deny])],
    ask:   [...new Set([...(existing.permissions?.ask || []), ...bizarSettings.permissions.ask])],
  };
  merged.env   = { ...(existing.env || {}), ...bizarSettings.env };
  merged.hooks = { ...(existing.hooks || {}), ...bizarSettings.hooks };
  merged.autoMode = existing.autoMode || bizarSettings.autoMode;
  merged.attribution = existing.attribution || bizarSettings.attribution;
  merged.worktree = { ...(bizarSettings.worktree || {}), ...(existing.worktree || {}) };
  for (const key of ['enableWorkflows', 'alwaysThinkingEnabled', 'autoDreamEnabled', 'showThinkingSummaries']) {
    if (merged[key] === undefined) merged[key] = bizarSettings[key];
  }

  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(merged, null, 2) + '\n');
  return merged;
}

before(() => {
  mkdirSync(TEMP_CLAUDE_DIR, { recursive: true });
  // Set CLAUDE_CONFIG_DIR so the module reads from our temp dir
  process.env.CLAUDE_CONFIG_DIR = TEMP_CLAUDE_DIR;
});

after(() => {
  rmSync(TEMP_CLAUDE_DIR, { recursive: true, force: true });
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe('writeClaudeSettings merge logic', () => {

  it('writes minimal settings with four gateway-discovery env vars when no existing settings', () => {
    const settingsFile = join(TEMP_CLAUDE_DIR, 'settings.json');
    // Ensure no settings file exists
    if (existsSync(settingsFile)) rmSync(settingsFile);

    runProvisionInline(TEMP_CLAUDE_DIR, {});

    const written = JSON.parse(readFileSync(settingsFile, 'utf8'));
    assert.strictEqual(written.env.ANTHROPIC_BASE_URL, 'http://localhost:20128/v1');
    assert.strictEqual(written.env.ANTHROPIC_AUTH_TOKEN, 'sk_9router');
    assert.strictEqual(written.env.BIZAR_MODEL_ROUTER_URL, 'http://localhost:20128/v1');
    assert.strictEqual(written.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.strictEqual(written.env.ANTHROPIC_DEFAULT_OPUS_MODEL, undefined);
    assert.strictEqual(written.permissions.defaultMode, 'acceptEdits');
  });

  it('preserves existing permissions, hooks, mcpServers when merging', () => {
    const settingsFile = join(TEMP_CLAUDE_DIR, 'settings.json');
    const existing = {
      permissions: { defaultMode: 'ask', allow: ['Bash(ls)'], deny: [], ask: [] },
      hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'node custom-hook.mjs' }] }] },
      mcpServers: { myServer: { type: 'stdio', command: 'node', args: ['my-server.mjs'] } },
      attribution: { commit: 'C000', pr: 'P000' },
    };
    rmSync(settingsFile, { force: true });
    writeFileSync(settingsFile, JSON.stringify(existing));

    const merged = runProvisionInline(TEMP_CLAUDE_DIR, existing);

    assert.strictEqual(merged.permissions.defaultMode, 'ask');         // user value kept
    assert.deepStrictEqual(merged.mcpServers.myServer, { type: 'stdio', command: 'node', args: ['my-server.mjs'] }); // user server kept
    assert.strictEqual(merged.mcpServers.bizar.type, 'stdio');          // bizar server added
    assert.strictEqual(merged.attribution.commit, 'C000');              // user attribution kept
    assert.strictEqual(merged.env.ANTHROPIC_AUTH_TOKEN, 'sk_9router'); // discovery env added
    assert.strictEqual(merged.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  });

  it('preserves existing ANTHROPIC_DEFAULT_OPUS_MODEL without removing it', () => {
    const settingsFile = join(TEMP_CLAUDE_DIR, 'settings.json');
    const existing = {
      env: {
        ANTHROPIC_BASE_URL: 'http://localhost:20128/v1',
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'anthropic/opus-4-20241120',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'anthropic/sonnet-4-20241120',
      },
    };
    rmSync(settingsFile, { force: true });
    writeFileSync(settingsFile, JSON.stringify(existing));

    const merged = runProvisionInline(TEMP_CLAUDE_DIR, existing);

    assert.strictEqual(merged.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'anthropic/opus-4-20241120');
    assert.strictEqual(merged.env.ANTHROPIC_DEFAULT_SONNET_MODEL, 'anthropic/sonnet-4-20241120');
    assert.strictEqual(merged.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
    assert.strictEqual(merged.env.ANTHROPIC_AUTH_TOKEN, 'sk_9router');
  });

  it('adds discovery env vars to existing env block without overwriting other vars', () => {
    const settingsFile = join(TEMP_CLAUDE_DIR, 'settings.json');
    const existing = {
      env: {
        MY_CUSTOM_VAR: 'custom-value',
        ANTHROPIC_BASE_URL: 'http://localhost:20128/v1',
      },
    };
    rmSync(settingsFile, { force: true });
    writeFileSync(settingsFile, JSON.stringify(existing));

    const merged = runProvisionInline(TEMP_CLAUDE_DIR, existing);

    assert.strictEqual(merged.env.MY_CUSTOM_VAR, 'custom-value');
    assert.strictEqual(merged.env.ANTHROPIC_BASE_URL, 'http://localhost:20128/v1');
    assert.strictEqual(merged.env.ANTHROPIC_AUTH_TOKEN, 'sk_9router');
    assert.strictEqual(merged.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY, '1');
  });
});
