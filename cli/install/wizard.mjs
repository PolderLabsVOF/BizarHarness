/**
 * cli/install/wizard.mjs
 *
 * Clack-based interactive wizard for the Bizar installer. Implements
 * the 9-page state machine defined in
 * docs/specs/ralplan/installer-redesign-v2.md §5:
 *
 *   intro → detection → targetSelect → claudeCodeConfig →
 *   desktopConfig → gateway → confirm → execute → outro
 *
 * State machine:
 *
 *   idle → probing → [needs-provider | needs-desktop-config]? →
 *     needs-confirm → writing → done | cancelled | failed
 *
 * Each page is a function over injected state — I/O lives at the
 * edges (the `detected` prop, the `provision` callback, and the
 * `desktop.writeDesktopConfigWithBackup` helper). All clack prompts
 * receive `{ input, output, signal }` so the wizard is fully
 * testable against in-memory Readable / Writable pairs.
 *
 * Exit codes (F5 resolution from plan §5):
 *   - DONE                      → 0
 *   - CANCELLED                 → 130
 *   - FAILED detection-zero     → 2
 *   - FAILED write failure      → 3
 *   - FAILED partial rollback   → 4
 *
 * Detected shape (from `detectInstalledAgents()`):
 *   {
 *     claudeCode: { present, binPath, configDir, gatewayConfigured },
 *     desktop:    { present, configLibraryPath, activeConfigPath,
 *                   activeConfigId, gatewayConfigured },
 *     openkan:    { present, home },
 *   }
 */

import nodeFs from 'node:fs';

import * as defaultPrompts from '@clack/prompts';

import { runProvision } from '../provision.mjs';
import { runStatuslineInstall } from '../commands/statusline.mjs';
import * as defaultDesktop from './desktop-config.mjs';
import * as defaultProvider from './provider.mjs';

/**
 * Wizard state-machine labels. Exported so the orchestrator and tests
 * can branch on terminal state without stringly-typed comparisons.
 */
export const STATES = Object.freeze({
  IDLE: 'idle',
  PROBING: 'probing',
  NEEDS_PROVIDER: 'needs-provider',
  NEEDS_DESKTOP_CONFIG: 'needs-desktop-config',
  NEEDS_CONFIRM: 'needs-confirm',
  WRITING: 'writing',
  DONE: 'done',
  CANCELLED: 'cancelled',
  FAILED: 'failed',
});

/**
 * Build the multiselect options list from the detected-agent shape.
 * Skipped targets (not present) are omitted; cursor order matches
 * the order returned here.
 */
function buildTargetOptions(detected) {
  const options = [];
  if (detected.claudeCode && detected.claudeCode.present) {
    options.push({
      value: 'claude-code',
      label: 'Claude Code CLI',
      hint: detected.claudeCode.configDir || '~/.claude/',
    });
  }
  if (detected.desktop && detected.desktop.present) {
    options.push({
      value: 'claude-desktop',
      label: 'Claude Desktop',
      hint: detected.desktop.activeConfigId
        ? `${detected.desktop.activeConfigId}.json`
        : 'configLibrary',
    });
  }
  return options;
}

/**
 * Initial-value set for the multiselect: pre-check every detected
 * agent so the user only has to confirm or deselect.
 */
function buildInitialTargets(detected) {
  const initial = [];
  if (detected.claudeCode && detected.claudeCode.present) initial.push('claude-code');
  if (detected.desktop && detected.desktop.present) initial.push('claude-desktop');
  return initial;
}

/**
 * Single-line detection summary shown on the "Detected" note page.
 */
function formatDetectionSummary(detected) {
  const claudeMark = detected.claudeCode && detected.claudeCode.present ? '✓' : '✗';
  const desktopMark = detected.desktop && detected.desktop.present ? '✓' : '✗';
  const openkanMark = detected.openkan && detected.openkan.present ? '✓' : '✗';

  const claudeLine = `${claudeMark} Claude Code CLI`
    + (detected.claudeCode && detected.claudeCode.present
      ? ` (${detected.claudeCode.binPath || (detected.claudeCode.configDir ? detected.claudeCode.configDir : 'settings.json present')})`
      : '');
  const desktopLine = `${desktopMark} Claude Desktop`
    + (detected.desktop && detected.desktop.present
      ? ` (${detected.desktop.activeConfigId ? detected.desktop.activeConfigId + '.json' : detected.desktop.configLibraryPath})`
      : '');
  const openkanLine = `${openkanMark} OpenKan runtime`
    + (detected.openkan && detected.openkan.present && detected.openkan.home
      ? ` (${detected.openkan.home})`
      : '');

  return [claudeLine, desktopLine, openkanLine].join('\n');
}

/**
 * Build a plan-of-record summary for the confirm page.
 */
function formatPlan(state) {
  const lines = [];
  for (const target of state.selectedTargets) {
    if (target === 'claude-code') {
      const dir = state.claudeCodeConfigDir
        || (state.detected.claudeCode && state.detected.claudeCode.configDir)
        || '~/.claude/';
      lines.push(`• Claude Code → ${dir}`);
      if (state.installClaudeCli) {
        lines.push('    ↳ install Claude Code CLI binary');
      }
    } else if (target === 'claude-desktop') {
      const desktop = state.detected.desktop || {};
      const id = desktop.activeConfigId || '(active)';
      lines.push(`• Claude Desktop → ${id}.json`);
      if (state.gatewayValues && state.gatewayValues.url) {
        lines.push(`    ↳ gateway URL: ${state.gatewayValues.url}`);
        lines.push('    ↳ gateway API key: set');
      } else if (desktop.gatewayConfigured) {
        lines.push('    ↳ gateway: preserve existing values');
      } else {
        lines.push('    ↳ gateway: (no values; skipped)');
      }
    }
  }
  return lines.join('\n');
}

/**
 * Drive the wizard. Returns the final state object so the orchestrator
 * can map it to an exit code via `getExitCode(state)`.
 *
 * @param {object} [opts]
 * @param {object} [opts.detected]                detected-agent shape from detectInstalledAgents()
 * @param {object} [opts.env]                    env to pass to desktop helpers (default process.env)
 * @param {object} [opts.fs]                     fs to pass to desktop helpers (default node:fs)
 * @param {object} [opts.provider]               provider module (default cli/install/provider.mjs)
 * @param {object} [opts.desktop]                desktop-config module (default cli/install/desktop-config.mjs)
 * @param {Function} [opts.provision]             provision callback (default runProvision)
 * @param {Function} [opts.statuslineInstall]     statusline-install callback (default runStatuslineInstall; NOT invoked here — orchestrator decides)
 * @param {Function} [opts.intro]                 override intro page (for tests / branding)
 * @param {Function} [opts.onCancel]              callback invoked when the user cancels at any page
 * @param {object} [opts.signal]                  AbortSignal forwarded to every clack prompt
 * @param {object} [opts.input]                   Readable forwarded to every clack prompt
 * @param {object} [opts.output]                  Writable forwarded to every clack prompt
 * @param {object} [opts.promptLib]              clack prompts module (for mocking in tests)
 * @returns {Promise<object>} final wizard state
 */
export async function runInstallWizard(opts = {}) {
  const {
    detected = {},
    env = process.env,
    fs = nodeFs,
    provider = defaultProvider,
    desktop = defaultDesktop,
    provision = runProvision,
    statuslineInstall: _statuslineInstall = runStatuslineInstall,
    intro: introOverride,
    onCancel = () => {},
    signal,
    input,
    output,
    promptLib = defaultPrompts,
  } = opts;

  const io = { input, output, signal };

  const state = {
    detected,
    selectedTargets: [],
    installClaudeCli: false,
    claudeCodeConfigDir: (detected.claudeCode && detected.claudeCode.configDir) || null,
    gatewayValues: null,
    wizardStatus: STATES.IDLE,
    failureReason: null,
    managedDesktop: false,
  };

  // Helper: route to the cancelled branch with the standard clack +
  // onCancel callback. Returns the state so callers can early-return.
  const cancelState = (reason = 'user-cancel') => {
    promptLib.cancel('Installation cancelled', io);
    state.wizardStatus = STATES.CANCELLED;
    state.failureReason = reason;
    try {
      onCancel(state);
    } catch {
      // Swallow callback errors so cancellation always wins.
    }
    return state;
  };

  // ─── Page 1: intro ─────────────────────────────────────────────────
  if (typeof introOverride === 'function') {
    introOverride({ promptLib, io, state });
  } else if (typeof promptLib.intro === 'function') {
    promptLib.intro('Bizar Installer', io);
    if (typeof promptLib.note === 'function') {
      promptLib.note(
        [
          'Bizar Harness installer',
          'Installs hooks, agents, skills, and commands into',
          'the detected surfaces.',
          '',
          'Use the arrow keys to navigate; press enter to confirm.',
        ].join('\n'),
        'Welcome',
        io,
      );
    }
  }
  state.wizardStatus = STATES.PROBING;

  // ─── Page 2: detection ────────────────────────────────────────────
  if (typeof promptLib.spinner === 'function') {
    const spin = promptLib.spinner({ output, signal });
    spin.start('Detecting installed agents…');
    spin.stop('Detection complete.');
  }
  if (typeof promptLib.note === 'function') {
    promptLib.note(formatDetectionSummary(detected), 'Detected', io);
  }

  const detectedCount =
    (detected.claudeCode && detected.claudeCode.present ? 1 : 0) +
    (detected.desktop && detected.desktop.present ? 1 : 0);

  if (detectedCount === 0) {
    if (typeof promptLib.outro === 'function') {
      promptLib.outro(
        'No supported agent surfaces detected (Claude Code CLI, Claude Desktop).\n' +
          'Run `bizar install` from a host with one of them installed.',
        io,
      );
    }
    state.wizardStatus = STATES.FAILED;
    state.failureReason = 'detection-zero';
    return state;
  }

  // ─── Page 3: targetSelect ─────────────────────────────────────────
  const targetOptions = buildTargetOptions(detected);
  const initialTargets = buildInitialTargets(detected);
  const selected = await promptLib.multiselect({
    message: 'Select install targets',
    options: targetOptions,
    required: true,
    initialValues: initialTargets,
    ...io,
  });
  if (promptLib.isCancel(selected)) return cancelState();
  state.selectedTargets = Array.isArray(selected) ? selected : [];

  // ─── Page 4: claudeCodeConfig ─────────────────────────────────────
  if (state.selectedTargets.includes('claude-code')) {
    const installCli = await promptLib.confirm({
      message: 'Install Claude Code CLI? (default NO)',
      initialValue: false,
      ...io,
    });
    if (promptLib.isCancel(installCli)) return cancelState();
    state.installClaudeCli = installCli === true;

    const dirInitial =
      state.claudeCodeConfigDir
      || (detected.claudeCode && detected.claudeCode.configDir)
      || '';
    const dir = await promptLib.path({
      message: 'Claude Code config dir?',
      initialValue: dirInitial,
      directory: true,
      ...io,
    });
    if (promptLib.isCancel(dir)) return cancelState();
    if (typeof dir === 'string' && dir.length > 0) {
      state.claudeCodeConfigDir = dir;
    }
  }

  // ─── Page 5: desktopConfig ────────────────────────────────────────
  let needsNewGateway = false;
  if (state.selectedTargets.includes('claude-desktop')) {
    state.managedDesktop = !!desktop.detectManagedOverride({ env, fs });

    const desktopLines = [];
    const desktopMeta = detected.desktop || {};
    desktopLines.push(`configLibrary: ${desktopMeta.configLibraryPath || '(unknown)'}`);
    if (desktopMeta.activeConfigId) {
      desktopLines.push(`Active config: ${desktopMeta.activeConfigId}.json`);
    }
    desktopLines.push(`Gateway: ${desktopMeta.gatewayConfigured ? 'configured' : 'not configured'}`);
    promptLib.note(desktopLines.join('\n'), 'Claude Desktop', io);

    if (state.managedDesktop) {
      promptLib.note(
        'Claude Desktop is managed by your organization. Re-run with `bizar install --force-targets desktop` to override.',
        'Managed source',
        io,
      );
      const force = await promptLib.confirm({
        message: 'Override managed source and continue?',
        initialValue: false,
        ...io,
      });
      if (promptLib.isCancel(force)) return cancelState();
      if (!force) return cancelState('declined-managed');
    }

    if (!desktopMeta.gatewayConfigured) {
      const configureNow = await promptLib.confirm({
        message: 'Configure a gateway for Claude Desktop?',
        initialValue: true,
        ...io,
      });
      if (promptLib.isCancel(configureNow)) return cancelState();
      if (!configureNow) {
        promptLib.note(
          'Re-run when ready to provide gateway credentials.',
          'Gateway',
          io,
        );
        return cancelState('declined-gateway-config');
      }
      needsNewGateway = true;
      state.wizardStatus = STATES.NEEDS_DESKTOP_CONFIG;
    } else {
      const useCurrent = await promptLib.confirm({
        message: 'Use currently configured gateway?',
        initialValue: true,
        ...io,
      });
      if (promptLib.isCancel(useCurrent)) return cancelState();
      if (useCurrent) {
        needsNewGateway = false;
      } else {
        needsNewGateway = true;
        state.wizardStatus = STATES.NEEDS_DESKTOP_CONFIG;
      }
    }
  }

  // ─── Page 6: gateway ──────────────────────────────────────────────
  if (needsNewGateway) {
    const url = await promptLib.text({
      message: 'Gateway URL',
      placeholder: 'https://gateway.example',
      ...io,
      validate: (value) => {
        if (typeof value !== 'string' || value.trim().length === 0) {
          return 'URL is required';
        }
        if (!provider.isValidProviderUrl(value)) {
          return 'Must be a valid http(s) URL';
        }
        return undefined;
      },
    });
    if (promptLib.isCancel(url)) return cancelState();

    const key = await promptLib.password({
      message: 'Gateway API key',
      ...io,
      validate: (value) => {
        if (typeof value !== 'string' || value.trim().length === 0) {
          return 'API key is required';
        }
        return undefined;
      },
    });
    if (promptLib.isCancel(key)) return cancelState();

    state.gatewayValues = { url: String(url), key: String(key), authScheme: 'bearer' };
  }

  state.wizardStatus = STATES.NEEDS_CONFIRM;

  // ─── Page 7: confirm ──────────────────────────────────────────────
  promptLib.note(formatPlan(state), 'Plan of record', io);
  const proceed = await promptLib.confirm({
    message: 'Proceed with installation?',
    initialValue: true,
    ...io,
  });
  if (promptLib.isCancel(proceed) || proceed !== true) return cancelState('declined-confirm');

  state.wizardStatus = STATES.WRITING;

  // ─── Page 8: execute ──────────────────────────────────────────────
  const tasks = [];
  if (state.selectedTargets.includes('claude-code')) {
    tasks.push({
      title: 'Install Bizar into Claude Code',
      enabled: true,
      task: async () => {
        await provision({
          mode: 'install',
          targets: ['claude-code'],
          force: false,
          dryRun: false,
          yes: true,
          installClaudeCli: state.installClaudeCli,
          openkanHome: detected.openkan && detected.openkan.home,
        });
        return 'Claude Code install complete.';
      },
    });
  }
  if (state.selectedTargets.includes('claude-desktop')) {
    tasks.push({
      title: 'Write Claude Desktop config',
      enabled: true,
      task: async () => {
        const active = desktop.readActiveDesktopConfig({ env, fs });
        if (!active || !active.exists) {
          const err = new Error('desktop-partial-write-rollback: no active desktop config available');
          err.kind = 'desktop-partial-write-rollback';
          throw err;
        }
        const next = desktop.mergeGatewayIntoDesktopConfig({
          existing: active.config,
          baseUrl: state.gatewayValues ? state.gatewayValues.url : undefined,
          apiKey: state.gatewayValues ? state.gatewayValues.key : undefined,
          authScheme: state.gatewayValues ? state.gatewayValues.authScheme : undefined,
        });
        const result = desktop.writeDesktopConfigWithBackup({
          path: active.activePath,
          next,
          env,
          fs,
        });
        return `Desktop config written (backup: ${result.backupPath})`;
      },
    });
  }

  let executeFailed = null;
  try {
    await promptLib.tasks(tasks, io);
  } catch (err) {
    executeFailed = err;
  }

  if (executeFailed) {
    const message = (executeFailed && executeFailed.message) || String(executeFailed);
    const kind = executeFailed && executeFailed.kind;
    if (kind === 'desktop-partial-write-rollback' || /partial-write/.test(message)) {
      state.failureReason = 'desktop-partial-write-rollback';
    } else if (/provisioner/i.test(message) || /runProvision/i.test(message)) {
      state.failureReason = 'provisioner-throw';
    } else {
      state.failureReason = 'write-settings-failed';
    }
    state.wizardStatus = STATES.FAILED;
    if (typeof promptLib.outro === 'function') {
      promptLib.outro(
        `Install failed: ${message}. Run \`bizar doctor\` for diagnostics.`,
        io,
      );
    }
    return state;
  }

  state.wizardStatus = STATES.DONE;

  // ─── Page 9: outro ────────────────────────────────────────────────
  const outroLines = ['Installation complete.'];
  if (state.selectedTargets.includes('claude-desktop')) {
    outroLines.push('Quit and reopen Claude Desktop for the new gateway to take effect.');
  }
  if (typeof promptLib.outro === 'function') {
    promptLib.outro(outroLines.join('\n'), io);
  }

  return state;
}

/**
 * Map a final wizard state to a process exit code.
 *
 * @param {object} state terminal state from `runInstallWizard()`
 * @returns {number} exit code per F5 resolution from plan §5
 */
export function getExitCode(state) {
  if (!state) return 0;
  if (state.wizardStatus === STATES.DONE) return 0;
  if (state.wizardStatus === STATES.CANCELLED) return 130;
  if (state.wizardStatus === STATES.FAILED) {
    switch (state.failureReason) {
      case 'detection-zero':
        return 2;
      case 'desktop-partial-write-rollback':
        return 4;
      case 'write-settings-failed':
      case 'provisioner-throw':
        return 3;
      default:
        return 1;
    }
  }
  return 0;
}

// Internal helpers exposed for test introspection only; not part of
// the wizard's public surface that the orchestrator consumes.
export const _internal = Object.freeze({
  buildTargetOptions,
  buildInitialTargets,
  formatDetectionSummary,
  formatPlan,
});
