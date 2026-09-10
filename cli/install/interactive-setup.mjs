/**
 * cli/install/interactive-setup.mjs
 *
 * Back-compat re-export shim. The interactive-setup implementation
 * (readline-driven provider prompts) lives in `cli/install/provider.mjs`
 * after commit 3 of the installer redesign. This shim preserves every
 * prior import path so `cli/install/detect.mjs`,
 * `cli/install/index.mjs`, and `cli/install/interactive-setup.test.mjs`
 * (rewritten against the shim contract per plan §7 T2) continue to
 * resolve `runInteractiveSetup`, `providerSettingsPath`,
 * `readProviderSettings`, `detectProviderConfiguration`,
 * `detectAdvancedConfiguration`, `isValidProviderUrl`, `askLine`,
 * `askSecret`, and `isValidOpenKanHome` without code changes.
 *
 * Future wizard work (`cli/install/wizard.mjs`) will own the
 * clack-based interactive flow; once that lands, this shim should be
 * retired in favour of a wizard re-export that goes through the new
 * state machine.
 */

export {
  providerSettingsPath,
  readProviderSettings,
  detectProviderConfiguration,
  detectAdvancedConfiguration,
  isValidProviderUrl,
  isValidOpenKanHome,
  askLine,
  askSecret,
  runInteractiveSetup,
} from './provider.mjs';
