/**
 * cli/install/wizard.test.mjs
 *
 * Tests for cli/install/wizard.mjs (commit 5 of the installer
 * redesign). Coverage target ≥90%.
 *
 * The wizard accepts the entire @clack/prompts surface via a
 * `promptLib` injection. Tests build a tiny scripted mock so the
 * state machine can be driven without depending on a TTY (clack's
 * internal readline path emits keypress events on TTY streams only,
 * which makes piped Readable.from streams unreliable). The mock
 * matches the actual clack function signatures closely enough that
 * the wizard can be exercised end-to-end.
 *
 * Style matches cli/install/desktop-config.test.mjs: `node:test`,
 * `assert/strict`, with no real I/O.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  STATES,
  _internal,
  getExitCode,
  runInstallWizard,
} from './wizard.mjs';

// ─── scripted-prompt mock ─────────────────────────────────────────────────

const CANCEL_TOKEN = Symbol('clack.cancel');

/**
 * Build a scripted `promptLib` mock. Each clack function reads the
 * next entry from a per-call queue and returns it. `isCancel` matches
 * the CANCEL_TOKEN.
 *
 * The mock also records every call so tests can assert on prompts
 * that fired (intro, note, spinner, etc.).
 */
function makePromptLib(scripts = {}) {
  const record = {
    intro: [],
    outro: [],
    note: [],
    cancel: [],
    spinner: [],
    multiselect: [],
    confirm: [],
    text: [],
    password: [],
    path: [],
    tasks: [],
  };
  const queue = {
    intro: [],
    outro: [],
    note: [],
    cancel: [],
    spinner: [],
    multiselect: [...(scripts.multiselect || [])],
    confirm: [...(scripts.confirm || [])],
    text: [...(scripts.text || [])],
    password: [...(scripts.password || [])],
    path: [...(scripts.path || [])],
    tasks: [...(scripts.tasks || [])],
  };

  const next = (key) => {
    const arr = queue[key];
    if (!arr || arr.length === 0) {
      throw new Error(`promptLib mock: no scripted answer for ${key}`);
    }
    return arr.shift();
  };

  const push = (key, args) => {
    if (record[key]) record[key].push(args);
  };

  return {
    record,
    isCancel: (v) => v === CANCEL_TOKEN,
    intro: (...args) => { push('intro', args); },
    outro: (...args) => { push('outro', args); },
    note: (...args) => { push('note', args); },
    cancel: (...args) => { push('cancel', args); },
    spinner: (...args) => {
      push('spinner', args);
      return {
        start: () => {},
        stop: () => {},
        cancel: () => {},
        error: () => {},
        message: () => {},
        clear: () => {},
        isCancelled: false,
      };
    },
    multiselect: async (...args) => {
      push('multiselect', args);
      return next('multiselect');
    },
    confirm: async (...args) => {
      push('confirm', args);
      return next('confirm');
    },
    text: async (...args) => {
      push('text', args);
      return next('text');
    },
    password: async (...args) => {
      push('password', args);
      return next('password');
    },
    path: async (...args) => {
      push('path', args);
      return next('path');
    },
    tasks: async (tasks, ...rest) => {
      push('tasks', [tasks, rest]);
      // Drive each task like clack's `tasks` helper: invoke the
      // task function with a no-op message callback and capture
      // the first error if any.
      let firstError = null;
      for (const t of tasks) {
        if (t && t.enabled === false) continue;
        try {
          await t.task(() => {});
        } catch (err) {
          firstError = firstError || err;
        }
      }
      if (firstError) throw firstError;
      if (queue.tasks && queue.tasks.length) {
        const scripted = next('tasks');
        if (scripted instanceof Error) throw scripted;
      }
    },
  };
}

// ─── test fixtures ────────────────────────────────────────────────────────

function fakeDetected(overrides = {}) {
  return {
    claudeCode: {
      present: true,
      binPath: '/usr/local/bin/claude',
      configDir: '/home/test/.claude',
      gatewayConfigured: false,
    },
    desktop: {
      present: false,
      configLibraryPath: '/home/test/.config/claude-desktop',
      activeConfigPath: null,
      activeConfigId: null,
      gatewayConfigured: false,
    },
    openkan: {
      present: true,
      home: '/home/test/.ok',
    },
    ...overrides,
  };
}

function makeCapturingFs() {
  const calls = { existsSync: [], readFileSync: [], writeFileSync: [] };
  return {
    calls,
    existsSync: (p) => { calls.existsSync.push(p); return false; },
    readFileSync: (p) => { calls.readFileSync.push(p); throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); },
    writeFileSync: (p, data) => { calls.writeFileSync.push([p, data]); },
  };
}

// ─── STATES / getExitCode ─────────────────────────────────────────────────

describe('STATES', () => {
  test('exports the documented state labels', () => {
    assert.equal(STATES.IDLE, 'idle');
    assert.equal(STATES.PROBING, 'probing');
    assert.equal(STATES.NEEDS_PROVIDER, 'needs-provider');
    assert.equal(STATES.NEEDS_DESKTOP_CONFIG, 'needs-desktop-config');
    assert.equal(STATES.NEEDS_CONFIRM, 'needs-confirm');
    assert.equal(STATES.WRITING, 'writing');
    assert.equal(STATES.DONE, 'done');
    assert.equal(STATES.CANCELLED, 'cancelled');
    assert.equal(STATES.FAILED, 'failed');
  });
});

describe('getExitCode()', () => {
  test('returns 0 for DONE', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.DONE }), 0);
  });
  test('returns 130 for CANCELLED', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.CANCELLED }), 130);
  });
  test('returns 2 for FAILED detection-zero', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.FAILED, failureReason: 'detection-zero' }), 2);
  });
  test('returns 3 for FAILED write-settings-failed', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.FAILED, failureReason: 'write-settings-failed' }), 3);
  });
  test('returns 3 for FAILED provisioner-throw', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.FAILED, failureReason: 'provisioner-throw' }), 3);
  });
  test('returns 4 for FAILED desktop-partial-write-rollback', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.FAILED, failureReason: 'desktop-partial-write-rollback' }), 4);
  });
  test('returns 1 for FAILED with unknown reason', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.FAILED, failureReason: 'something-else' }), 1);
  });
  test('returns 0 for null/undefined state (defensive)', () => {
    assert.equal(getExitCode(null), 0);
    assert.equal(getExitCode(undefined), 0);
  });

  test('returns 0 for an in-progress state (defensive default)', () => {
    assert.equal(getExitCode({ wizardStatus: STATES.PROBING }), 0);
  });
});

// ─── internal helpers ──────────────────────────────────────────────────────

describe('_internal.buildTargetOptions()', () => {
  test('returns only present targets', () => {
    const opts = _internal.buildTargetOptions(fakeDetected());
    assert.deepEqual(opts.map((o) => o.value), ['claude-code']);
  });
  test('returns both targets when both present', () => {
    const opts = _internal.buildTargetOptions(fakeDetected({
      desktop: { present: true, activeConfigId: 'abc123', configLibraryPath: '/x' },
    }));
    assert.deepEqual(opts.map((o) => o.value), ['claude-code', 'claude-desktop']);
    assert.equal(opts[1].hint, 'abc123.json');
  });
  test('returns empty list when neither present', () => {
    const opts = _internal.buildTargetOptions({
      claudeCode: { present: false },
      desktop: { present: false },
    });
    assert.equal(opts.length, 0);
  });
});

describe('_internal.formatDetectionSummary()', () => {
  test('marks each agent present/absent', () => {
    const summary = _internal.formatDetectionSummary({
      claudeCode: { present: true, binPath: '/bin/claude' },
      desktop: { present: false },
      openkan: { present: true, home: '/x' },
    });
    assert.match(summary, /✓ Claude Code CLI \(\/bin\/claude\)/);
    assert.match(summary, /✗ Claude Desktop/);
    assert.match(summary, /✓ OpenKan runtime \(\/x\)/);
  });
});

describe('_internal.formatPlan()', () => {
  test('mentions claude-code target + claude-cli opt-in', () => {
    const plan = _internal.formatPlan({
      detected: { claudeCode: { configDir: '/cfg' } },
      selectedTargets: ['claude-code'],
      installClaudeCli: true,
      claudeCodeConfigDir: '/cfg',
      gatewayValues: null,
    });
    assert.match(plan, /Claude Code/);
    assert.match(plan, /Claude Code CLI binary/);
  });
  test('mentions desktop gateway preserve when not set', () => {
    const plan = _internal.formatPlan({
      detected: { desktop: { activeConfigId: 'xyz', gatewayConfigured: true } },
      selectedTargets: ['claude-desktop'],
      installClaudeCli: false,
      claudeCodeConfigDir: null,
      gatewayValues: null,
    });
    assert.match(plan, /Claude Desktop/);
    assert.match(plan, /preserve existing/);
  });
  test('mentions new gateway URL when set', () => {
    const plan = _internal.formatPlan({
      detected: { desktop: { activeConfigId: 'xyz', gatewayConfigured: false } },
      selectedTargets: ['claude-desktop'],
      installClaudeCli: false,
      claudeCodeConfigDir: null,
      gatewayValues: { url: 'https://gw.test', key: 'k', authScheme: 'bearer' },
    });
    assert.match(plan, /https:\/\/gw\.test/);
    assert.match(plan, /API key: set/);
  });
  test('mentions no-gateway fallback when gateway not configured and no values', () => {
    const plan = _internal.formatPlan({
      detected: { desktop: { activeConfigId: 'xyz', gatewayConfigured: false } },
      selectedTargets: ['claude-desktop'],
      installClaudeCli: false,
      claudeCodeConfigDir: null,
      gatewayValues: null,
    });
    assert.match(plan, /no values; skipped/);
  });
  test('mentions claude-code without cli opt-in when not requested', () => {
    const plan = _internal.formatPlan({
      detected: { claudeCode: { configDir: '/cfg' } },
      selectedTargets: ['claude-code'],
      installClaudeCli: false,
      claudeCodeConfigDir: '/cfg',
      gatewayValues: null,
    });
    assert.match(plan, /Claude Code/);
    assert.doesNotMatch(plan, /Claude Code CLI binary/);
  });
});

// ─── runInstallWizard: detection-zero ─────────────────────────────────────

describe('runInstallWizard(): detect-zero', () => {
  test('exits FAILED with reason detection-zero when no agents detected', async () => {
    const detected = {
      claudeCode: { present: false },
      desktop: { present: false },
      openkan: { present: true, home: '/x' },
    };
    const promptLib = makePromptLib();
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: () => { throw new Error('should not be called'); },
      desktop: { detectManagedOverride: () => false, mergeGatewayIntoDesktopConfig: () => ({}), writeDesktopConfigWithBackup: () => ({ ok: true }), readActiveDesktopConfig: () => ({ exists: false }) },
    });
    assert.equal(state.wizardStatus, STATES.FAILED);
    assert.equal(state.failureReason, 'detection-zero');
    assert.equal(getExitCode(state), 2);
    assert.equal(promptLib.record.outro.length, 1);
    assert.match(promptLib.record.outro[0][0], /No supported agent surfaces detected/);
    // Wizard should NOT have prompted past detection page.
    assert.equal(promptLib.record.multiselect.length, 0);
    assert.equal(promptLib.record.confirm.length, 0);
  });
});

// ─── runInstallWizard: single-target ───────────────────────────────────────

describe('runInstallWizard(): single-target Claude Code only', () => {
  test('provisions claude-code target; installClaudeCli defaults to false', async () => {
    const detected = fakeDetected(); // only claude-code present
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [
        false,   // decline "install Claude Code CLI"
        true,    // page 7 proceed? YES
      ],
      path: ['/home/test/.claude'],
    });
    const provisionCalls = [];
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async (opts) => {
        provisionCalls.push(opts);
        return { ok: true };
      },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true, backupPath: '/tmp/bak' }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.DONE);
    assert.equal(state.installClaudeCli, false);
    assert.deepEqual(state.selectedTargets, ['claude-code']);
    assert.equal(provisionCalls.length, 1);
    assert.deepEqual(provisionCalls[0].targets, ['claude-code']);
    assert.equal(provisionCalls[0].installClaudeCli, false);
    assert.equal(provisionCalls[0].yes, true);
    // No Desktop write should have occurred.
    assert.equal(promptLib.record.tasks.length, 1);
  });

  test('installClaudeCli=true when user confirms in page 4', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [
        true,             // page 4 install cli? YES
        true,             // page 7 proceed? YES
      ],
      path: ['/home/test/.claude'],
    });
    const provisionCalls = [];
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async (opts) => { provisionCalls.push(opts); return { ok: true }; },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.installClaudeCli, true);
    assert.equal(provisionCalls[0].installClaudeCli, true);
    assert.equal(state.wizardStatus, STATES.DONE);
  });
});

// ─── runInstallWizard: multi-target, gateway preserved ────────────────────

describe('runInstallWizard(): multi-target with existing gateway', () => {
  test('preserves existing gateway; does not prompt for new URL/key', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/home/test/.config/claude-desktop',
        activeConfigPath: '/home/test/.config/claude-desktop/abc.json',
        activeConfigId: 'abc',
        gatewayConfigured: true,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-code', 'claude-desktop']],
      confirm: [
        false,            // page 4: install Claude Code CLI? NO
        true,             // page 5: use currently configured gateway? YES
        true,             // page 7: Proceed? YES
      ],
      path: ['/home/test/.claude'],
    });
    const provisionCalls = [];
    const writeCalls = [];
    let desktopReadCalled = 0;
    let mergeCalled = 0;

    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async (opts) => {
        provisionCalls.push(opts);
        return { ok: true };
      },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (args) => {
          mergeCalled++;
          // Preserve: caller passes undefined for baseUrl/apiKey when
          // gateway is already configured; merge layer reads existing.
          assert.equal(args.baseUrl, undefined);
          assert.equal(args.apiKey, undefined);
          return {
            ...args.existing,
            inferenceProvider: 'gateway',
            inferenceGatewayBaseUrl: 'https://existing/v1',
            inferenceGatewayApiKey: 'sk-existing',
            inferenceGatewayAuthScheme: 'bearer',
          };
        },
        writeDesktopConfigWithBackup: (args) => {
          writeCalls.push(args);
          return { ok: true, backupPath: '/tmp/bak-1' };
        },
        readActiveDesktopConfig: () => {
          desktopReadCalled++;
          return {
            exists: true,
            activePath: detected.desktop.activeConfigPath,
            config: {
              inferenceProvider: 'gateway',
              inferenceGatewayBaseUrl: 'https://existing/v1',
              inferenceGatewayApiKey: 'sk-existing',
              inferenceGatewayAuthScheme: 'bearer',
            },
          };
        },
      },
    });

    assert.equal(state.wizardStatus, STATES.DONE);
    assert.equal(state.gatewayValues, null);
    assert.equal(mergeCalled, 1);
    assert.equal(writeCalls.length, 1);
    // The merge result carried existing gateway keys forward.
    assert.equal(writeCalls[0].next.inferenceGatewayBaseUrl, 'https://existing/v1');
    assert.equal(writeCalls[0].next.inferenceGatewayApiKey, 'sk-existing');
    // No gateway URL/key prompt fires when existing gateway is preserved.
    assert.equal(promptLib.record.text.length, 0);
    assert.equal(promptLib.record.password.length, 0);
    assert.equal(provisionCalls.length, 1);
    assert.equal(provisionCalls[0].targets[0], 'claude-code');
  });
});

// ─── runInstallWizard: multi-target, new gateway ──────────────────────────

describe('runInstallWizard(): multi-target with new gateway', () => {
  test('prompts for URL + key when desktop gateway not configured', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/home/test/.config/claude-desktop',
        activeConfigPath: '/home/test/.config/claude-desktop/xyz.json',
        activeConfigId: 'xyz',
        gatewayConfigured: false,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-code', 'claude-desktop']],
      confirm: [
        false,   // page 4 install cli? NO
        true,    // page 5 configure gateway now? YES
        true,    // page 7 proceed? YES
      ],
      path: ['/home/test/.claude'],
      text: ['https://new-gateway.test/v1'],
      password: ['sk-new-12345'],
    });
    const provisionCalls = [];
    const writeCalls = [];

    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async (opts) => {
        provisionCalls.push(opts);
        return { ok: true };
      },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (args) => ({
          ...args.existing,
          inferenceProvider: 'gateway',
          inferenceGatewayBaseUrl: args.baseUrl,
          inferenceGatewayApiKey: args.apiKey,
          inferenceGatewayAuthScheme: args.authScheme,
        }),
        writeDesktopConfigWithBackup: (args) => {
          writeCalls.push(args);
          return { ok: true, backupPath: '/tmp/bak-2' };
        },
        readActiveDesktopConfig: () => ({
          exists: true,
          activePath: detected.desktop.activeConfigPath,
          config: { inferenceModels: [{ name: 'MiniMax-M3' }] },
        }),
      },
    });

    assert.equal(state.wizardStatus, STATES.DONE);
    assert.deepEqual(state.gatewayValues, {
      url: 'https://new-gateway.test/v1',
      key: 'sk-new-12345',
      authScheme: 'bearer',
    });
    assert.equal(provisionCalls.length, 1);
    assert.equal(writeCalls.length, 1);
    assert.equal(writeCalls[0].next.inferenceGatewayBaseUrl, 'https://new-gateway.test/v1');
    assert.equal(writeCalls[0].next.inferenceGatewayApiKey, 'sk-new-12345');
    // The merge preserved inferenceModels even though we replaced the gateway trio.
    assert.deepEqual(writeCalls[0].next.inferenceModels, [{ name: 'MiniMax-M3' }]);
  });
});

// ─── runInstallWizard: cancellation ───────────────────────────────────────

describe('runInstallWizard(): cancellation', () => {
  test('cancel mid-flow (Ctrl+C) → CANCELLED, exit 130', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [CANCEL_TOKEN],
    });
    const onCancelCalls = [];
    const state = await runInstallWizard({
      detected,
      promptLib,
      onCancel: (s) => onCancelCalls.push(s),
      provision: () => { throw new Error('should not be called'); },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.CANCELLED);
    assert.equal(getExitCode(state), 130);
    assert.equal(onCancelCalls.length, 1);
    assert.equal(promptLib.record.cancel.length, 1);
  });

  test('cancel at confirm page → CANCELLED, exit 130', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [
        false,         // install cli? NO
        CANCEL_TOKEN,  // cancel at confirm
      ],
      path: ['/home/test/.claude'],
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: () => { throw new Error('should not be called'); },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.CANCELLED);
    assert.equal(getExitCode(state), 130);
  });

  test('declined "configure gateway" → CANCELLED (decline-gateway-config)', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: false,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-desktop']],
      confirm: [false], // declined "configure now"
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: () => { throw new Error('should not be called'); },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: true, activePath: '/x/y.json', config: {} }),
      },
    });
    assert.equal(state.wizardStatus, STATES.CANCELLED);
    assert.equal(state.failureReason, 'declined-gateway-config');
  });

  test('onCancel callback throwing does not break cancellation', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [CANCEL_TOKEN],
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      onCancel: () => { throw new Error('callback boom'); },
      provision: () => { throw new Error('should not be called'); },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.CANCELLED);
  });
});

// ─── runInstallWizard: managed-source refusal ─────────────────────────────

describe('runInstallWizard(): managed-source', () => {
  test('surfaces note with --force-targets hint when managed', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: false,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-desktop']],
      confirm: [
        false, // "Override managed source?" → decline; wizard exits CANCELLED
      ],
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: () => { throw new Error('should not be called'); },
      desktop: {
        detectManagedOverride: () => true,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: true, activePath: '/x/y.json', config: {} }),
      },
    });
    assert.equal(state.wizardStatus, STATES.CANCELLED);
    assert.equal(state.managedDesktop, true);
    // Wizard should have shown the managed-source note (the first arg is the message).
    const noteMessages = promptLib.record.note.map((args) => args[0]).join(' | ');
    assert.match(noteMessages, /managed by your organization/i);
    assert.match(noteMessages, /--force-targets desktop/);
  });
});

// ─── runInstallWizard: installClaudeCli default ────────────────────────────

describe('runInstallWizard(): gateway overrides and validation', () => {
  test('user declines "use current gateway" → wizard prompts for new URL+key', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: true,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-desktop']],
      confirm: [
        false, // page 5 "use current gateway?" → NO → fall through to page 6
        true,  // page 7 proceed? YES
      ],
      text: ['https://override.test/v1'],
      password: ['sk-override-1234'],
    });
    let mergeArgs = null;
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (args) => {
          mergeArgs = args;
          return { ...args.existing, inferenceGatewayBaseUrl: args.baseUrl };
        },
        writeDesktopConfigWithBackup: () => ({ ok: true, backupPath: '/bak' }),
        readActiveDesktopConfig: () => ({
          exists: true,
          activePath: '/x/y.json',
          config: { inferenceGatewayBaseUrl: 'https://existing' },
        }),
      },
    });
    assert.equal(state.wizardStatus, STATES.DONE);
    assert.deepEqual(state.gatewayValues, {
      url: 'https://override.test/v1',
      key: 'sk-override-1234',
      authScheme: 'bearer',
    });
    assert.equal(mergeArgs.baseUrl, 'https://override.test/v1');
    assert.equal(mergeArgs.apiKey, 'sk-override-1234');
  });

  test('URL validation rejects empty string and invalid URLs', () => {
    // Capture the validator the wizard would pass to text().
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: false,
      },
    });
    let capturedValidate = null;
    const promptLib = makePromptLib({
      multiselect: [['claude-desktop']],
      confirm: [
        true, // configure now
        true, // proceed
      ],
      text: ['https://valid.test'],
      password: ['sk-1234'],
    });
    const originalText = promptLib.text;
    promptLib.text = async (opts) => {
      capturedValidate = opts.validate;
      return originalText(opts);
    };

    return runInstallWizard({
      detected,
      promptLib,
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (a) => a.existing,
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: true, activePath: '/x/y.json', config: {} }),
      },
    }).then(() => {
      assert.ok(capturedValidate);
      assert.match(capturedValidate(''), /URL is required/);
      assert.match(capturedValidate('   '), /URL is required/);
      assert.match(capturedValidate('not-a-url'), /http\(s\) URL/);
      assert.equal(capturedValidate('https://ok.test/v1'), undefined);
      assert.equal(capturedValidate('http://ok.test/v1'), undefined);
    });
  });

  test('password validation rejects empty string', () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: false,
      },
    });
    let capturedValidate = null;
    const promptLib = makePromptLib({
      multiselect: [['claude-desktop']],
      confirm: [true, true],
      text: ['https://valid.test'],
      password: ['sk-1234'],
    });
    const originalPassword = promptLib.password;
    promptLib.password = async (opts) => {
      capturedValidate = opts.validate;
      return originalPassword(opts);
    };

    return runInstallWizard({
      detected,
      promptLib,
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (a) => a.existing,
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: true, activePath: '/x/y.json', config: {} }),
      },
    }).then(() => {
      assert.ok(capturedValidate);
      assert.match(capturedValidate(''), /API key is required/);
      assert.match(capturedValidate('   '), /API key is required/);
      assert.equal(capturedValidate('sk-1234'), undefined);
    });
  });
});

// ─── runInstallWizard: desktop-config edge cases ──────────────────────────

describe('runInstallWizard(): desktop-config edge cases', () => {
  test('execute step throws when readActiveDesktopConfig returns not-exists', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: true,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-desktop']],
      confirm: [
        true, // use current gateway? YES
        true, // proceed
      ],
      tasks: [], // execute step runs; mock raises from the actual task fn
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (a) => a.existing,
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.FAILED);
    assert.equal(state.failureReason, 'desktop-partial-write-rollback');
    assert.equal(getExitCode(state), 4);
  });

  test('write-settings-failed when execute step throws a non-partial-write error', async () => {
    const detected = fakeDetected();
    const genericErr = new Error('disk full: cannot write settings.json');
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [false, true],
      path: ['/home/test/.claude'],
      tasks: [genericErr],
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async () => { throw genericErr; },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.FAILED);
    assert.equal(state.failureReason, 'write-settings-failed');
    assert.equal(getExitCode(state), 3);
  });
});

describe('runInstallWizard(): installClaudeCli default', () => {
  test('installClaudeCli defaults to false even when claude-code target selected', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [
        false,   // page 4 "Install Claude Code CLI?" → NO
        true,    // page 7 proceed? YES
      ],
      path: ['/home/test/.claude'],
    });
    const provisionCalls = [];
    await runInstallWizard({
      detected,
      promptLib,
      provision: async (opts) => { provisionCalls.push(opts); return { ok: true }; },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(provisionCalls[0].installClaudeCli, false);
  });
});

// ─── runInstallWizard: partial-write crash ────────────────────────────────

describe('runInstallWizard(): partial-write crash', () => {
  test('exit code 4 when writeDesktopConfigWithBackup throws partial-write', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: true,
      },
    });
    const partialWriteErr = new Error('writeDesktopConfigWithBackup: rolled back from /x/y.json.bak-0: partial-write detected');
    partialWriteErr.kind = 'desktop-partial-write-rollback';
    const promptLib = makePromptLib({
      multiselect: [['claude-code', 'claude-desktop']],
      confirm: [
        false, // install cli? NO
        true,  // use current gateway? YES
        true,  // proceed? YES
      ],
      path: ['/home/test/.claude'],
      tasks: [partialWriteErr], // signal tasks() to throw
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (args) => args.existing,
        writeDesktopConfigWithBackup: () => { throw partialWriteErr; },
        readActiveDesktopConfig: () => ({ exists: true, activePath: '/x/y.json', config: {} }),
      },
    });
    assert.equal(state.wizardStatus, STATES.FAILED);
    assert.equal(state.failureReason, 'desktop-partial-write-rollback');
    assert.equal(getExitCode(state), 4);
  });

  test('exit code 3 when provision throws', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [
        false, // install cli? NO
        true,  // page 7 proceed? YES
      ],
      path: ['/home/test/.claude'],
      tasks: [new Error('provisioner-throw: simulated failure')],
    });
    const state = await runInstallWizard({
      detected,
      promptLib,
      provision: async () => { throw new Error('provisioner-throw: simulated failure'); },
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(state.wizardStatus, STATES.FAILED);
    // Since the error message contains 'provisioner-throw' keyword,
    // the wizard maps to provisioner-throw → exit 3.
    assert.match(state.failureReason, /provisioner-throw|write-settings-failed/);
    assert.equal(getExitCode(state), 3);
  });
});

// ─── runInstallWizard: gateway preservation edge case ─────────────────────

describe('runInstallWizard(): gateway preservation', () => {
  test('preserve existing gateway: do NOT prompt for new URL/key', async () => {
    const detected = fakeDetected({
      desktop: {
        present: true,
        configLibraryPath: '/x',
        activeConfigPath: '/x/y.json',
        activeConfigId: 'y',
        gatewayConfigured: true,
      },
    });
    const promptLib = makePromptLib({
      multiselect: [['claude-code', 'claude-desktop']],
      confirm: [
        false, // install cli? NO
        true,  // use current gateway? YES
        true,  // proceed? YES
      ],
      path: ['/home/test/.claude'],
    });
    let textPromptCalls = 0;
    let passwordPromptCalls = 0;
    const originalText = promptLib.text;
    const originalPassword = promptLib.password;
    promptLib.text = async (...args) => {
      textPromptCalls++;
      return originalText(...args);
    };
    promptLib.password = async (...args) => {
      passwordPromptCalls++;
      return originalPassword(...args);
    };

    let mergeArgs = null;
    await runInstallWizard({
      detected,
      promptLib,
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: (args) => {
          mergeArgs = args;
          return {
            ...args.existing,
            inferenceProvider: 'gateway',
            inferenceGatewayBaseUrl: args.existing.inferenceGatewayBaseUrl,
            inferenceGatewayApiKey: args.existing.inferenceGatewayApiKey,
          };
        },
        writeDesktopConfigWithBackup: () => ({ ok: true, backupPath: '/tmp/bak' }),
        readActiveDesktopConfig: () => ({
          exists: true,
          activePath: '/x/y.json',
          config: {
            inferenceGatewayBaseUrl: 'https://existing',
            inferenceGatewayApiKey: 'sk-existing',
            inferenceModels: [{ name: 'MiniMax-M3' }],
          },
        }),
      },
    });

    assert.equal(textPromptCalls, 0);
    assert.equal(passwordPromptCalls, 0);
    assert.ok(mergeArgs);
    assert.equal(mergeArgs.baseUrl, undefined);
    assert.equal(mergeArgs.apiKey, undefined);
  });
});

// ─── runInstallWizard: intro override ─────────────────────────────────────

describe('runInstallWizard(): intro override', () => {
  test('uses the override function instead of default intro', async () => {
    const detected = fakeDetected();
    const promptLib = makePromptLib({
      multiselect: [['claude-code']],
      confirm: [
        false, // install cli? NO
        true,  // page 7 proceed? YES
      ],
      path: ['/home/test/.claude'],
    });
    const introCalls = [];
    await runInstallWizard({
      detected,
      promptLib,
      intro: ({ promptLib: pl, io, state }) => {
        introCalls.push({ pl, io, state });
      },
      provision: async () => ({ ok: true }),
      desktop: {
        detectManagedOverride: () => false,
        mergeGatewayIntoDesktopConfig: () => ({}),
        writeDesktopConfigWithBackup: () => ({ ok: true }),
        readActiveDesktopConfig: () => ({ exists: false }),
      },
    });
    assert.equal(introCalls.length, 1);
    assert.equal(introCalls[0].pl, promptLib);
    assert.ok(introCalls[0].state);
    // Default intro never fired because override short-circuited.
    // (The mock still records all calls, so check the override ran.)
  });
});

console.log('  wizard.test.mjs loaded');
