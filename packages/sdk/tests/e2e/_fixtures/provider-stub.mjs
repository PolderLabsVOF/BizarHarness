/**
 * packages/sdk/tests/e2e/_fixtures/provider-stub.mjs —
 * Deterministic provider stand-in (IMP-022 / F-192).
 *
 * Closes the IMP-022 acceptance gate from `IMPROVEMENTS.md` line 875 —
 * the matrix test must prove the recorded decision model agrees with
 * the actual provider-resolved model, so every captured Agent payload
 * is followed by a provider request to a fake gateway.
 *
 * Modes:
 *   - `'agree'` (default) — echoes the requested model so the recorded
 *     decision and the resolved provider model match 100% of the time.
 *   - `'substitute'` — silently swaps the requested model with a value
 *     from `substitutionMap` (defaults to a single known swap); records
 *     `substitution: true` on the request so matrix tests can detect
 *     the mismatch and the harness can emit a `provider-mismatch` audit
 *     row.
 *   - `'fail'` — throws a typed error matching the F-018 evidence
 *     taxonomy so the harness can call `attachOutcome({ status:
 *     'transport' })` automatically.
 *
 * IMPORTANT: this file is a TEST FIXTURE. Production code under
 * `packages/sdk/src/` MUST NOT import it. The drift guard in
 * `scripts/__tests__/autonomy-contract-e2e.test.mjs` enforces the
 * boundary.
 */

const VALID_MODES = new Set(['agree', 'substitute', 'fail', 'auth']);

/**
 * Typed error matching the F-018 evidence taxonomy. The harness converts
 * this into `attachOutcome({ status: 'transport' })` automatically.
 */
export class ProviderTransportError extends Error {
  constructor(message, { requestedModel, decisionId, cause } = {}) {
    super(message ?? 'provider transport failure');
    this.name = 'ProviderTransportError';
    this.code = 'transport';
    this.requestedModel = requestedModel;
    this.decisionId = decisionId;
    if (cause) this.cause = cause;
  }
}

/**
 * Typed error matching the F-018 evidence taxonomy. The harness
 * converts this into `attachOutcome({ status: 'auth' })` and triggers
 * the failover chain.
 */
export class ProviderAuthError extends Error {
  constructor(message, { requestedModel, decisionId, cause } = {}) {
    super(message ?? 'provider auth failure');
    this.name = 'ProviderAuthError';
    this.code = 'auth';
    this.requestedModel = requestedModel;
    this.decisionId = decisionId;
    if (cause) this.cause = cause;
  }
}

/**
 * Create a fresh provider stub.
 *
 * @param {object} [opts]
 * @param {'agree'|'substitute'|'fail'|'auth'} [opts.mode] - default `'agree'`.
 * @param {Record<string,string>} [opts.substitutionMap] - maps requested
 *   model ID to the substituted model ID in `'substitute'` mode.
 *   Defaults to `{ 'provider/cheap': 'provider/stronger' }`.
 * @returns {{
 *   mode: string,
 *   requests: Array<{ requestedModel: string, resolvedModel: string, decisionId: string, substitution: boolean }>,
 *   call: (request: { requestedModel: string, decisionId: string }) => Promise<object>,
 *   reset: () => void,
 * }}
 */
export function createProviderStub(opts = {}) {
  const mode = VALID_MODES.has(opts.mode) ? opts.mode : 'agree';
  const substitutionMap = opts.substitutionMap ?? { 'provider/cheap': 'provider/stronger' };
  const requests = [];

  function reset() {
    requests.length = 0;
  }

  async function call(request = {}) {
    const requestedModel = String(request.requestedModel ?? '');
    const decisionId = String(request.decisionId ?? '');
    let resolvedModel = requestedModel;
    let substitution = false;
    if (mode === 'substitute' && substitutionMap[requestedModel]) {
      resolvedModel = substitutionMap[requestedModel];
      substitution = true;
    }
    requests.push({ requestedModel, resolvedModel, decisionId, substitution });
    if (mode === 'fail') {
      throw new ProviderTransportError(`provider stub forced failure for ${requestedModel}`, {
        requestedModel,
        decisionId,
      });
    }
    if (mode === 'auth') {
      throw new ProviderAuthError(`provider stub auth failure for ${requestedModel}`, {
        requestedModel,
        decisionId,
      });
    }
    return {
      ok: true,
      requestedModel,
      resolvedModel,
      model: resolvedModel,
      decisionId,
      substitution,
    };
  }

  return { mode, requests, call, reset };
}