/**
 * packages/sdk/tests/e2e/_fixtures/agent-tool-stub.mjs —
 * Deterministic stand-in for the Claude Code Agent tool (IMP-022 / F-192).
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875
 * ("Model-selection E2E matrix | Direct, workflow, and team selection
 * cases pass"): the captured Agent payload must prove that the resolved
 * model ID + `routingDecisionId` actually rides on every dispatch.
 *
 * The stub records every invocation into `captured` so tests can assert
 * on the augmented payload after the orchestrator has called
 * `dispatchAgent`. The deterministic stub result honors the payload's
 * generated-definition context — downstream provider stubs echo the same value, so the
 * matrix test can prove `decision === resolvedModel` 100% of the time.
 *
 * IMPORTANT: this file is a TEST FIXTURE. Production code under
 * `packages/sdk/src/` MUST NOT import it. The drift guard in
 * `scripts/__tests__/autonomy-contract-e2e.test.mjs` enforces the
 * boundary.
 */

/**
 * Create a fresh agent-tool stub. By default the stub is not installed
 * anywhere — call `install(globalName)` to monkey-patch
 * `globalThis[globalName]` (defaults to `"Agent"`). `restore()` undoes
 * the patch.
 *
 * @param {object} [opts]
 * @param {number} [opts.captureLimit] - when set, recording stops after
 *   this many captures (throws if exceeded).
 * @returns {{
 *   captured: Array<{ args: { prompt: string, payload: object }, result: object }>,
 *   reset: () => void,
 *   invoke: (args: { prompt: string, payload: object }) => Promise<object>,
 *   install: (globalName?: string) => void,
 *   restore: () => void,
 *   uninstalledResultFor: (args: object) => object,
 * }}
 */
export function createAgentToolStub(opts = {}) {
  const captureLimit = Number.isFinite(opts.captureLimit) ? opts.captureLimit : null;
  let globalName = null;
  let previousDescriptor = null;
  const captured = [];

  function record(args, payload, result) {
    if (captureLimit !== null && captured.length >= captureLimit) {
      throw new Error(
        `agent-tool-stub: captureLimit=${captureLimit} exceeded; reset the stub or raise the limit`,
      );
    }
    captured.push({ args, payload, result });
  }

  /**
   * Deterministic stub result. Honors Bizar's generated-definition context so
   * downstream provider stubs can echo the selected full ID.
   */
  function stubResultFor(payload) {
    return {
      ok: true,
      model: payload?.additionalContext?.bizarConfiguredModel,
      decisionId: payload?.routingDecisionId,
      tier: payload?.tier,
      selectorReason: payload?.selectorReason,
    };
  }

  async function invoke(args = {}) {
    const prompt = String(args.prompt ?? '');
    const payload = args.payload ?? {};
    const result = stubResultFor(payload);
    record({ prompt }, payload, result);
    return result;
  }

  function reset() {
    captured.length = 0;
  }

  function install(name = 'Agent') {
    if (globalName !== null) {
      throw new Error(`agent-tool-stub: already installed as globalThis.${globalName}`);
    }
    globalName = name;
    const target = globalThis[name];
    if (typeof target === 'function') {
      previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, name) ?? null;
    }
    Object.defineProperty(globalThis, name, {
      value: (prompt, payload) => invoke({ prompt, payload }),
      writable: true,
      configurable: true,
    });
  }

  function restore() {
    if (globalName === null) return;
    if (previousDescriptor) {
      Object.defineProperty(globalThis, globalName, previousDescriptor);
    } else {
      delete globalThis[globalName];
    }
    globalName = null;
    previousDescriptor = null;
  }

  return {
    captured,
    reset,
    invoke,
    install,
    restore,
    uninstalledResultFor: stubResultFor,
  };
}
