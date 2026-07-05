/**
 * src/server/eval.mjs
 *
 * v5.0.0 — Eval runner for evaluating AI agent outputs against golden fixtures.
 *
 * Supports:
 *   - contains/notContains substring checks
 *   - regex pattern matching
 *   - JSON schema validation
 *   - maxTokens bounds
 *   - maxLatencyMs bounds
 *   - Parallel fixture execution with configurable concurrency
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * @typedef {object} Fixture
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} agent
 * @property {string} prompt
 * @property {FixtureExpectations} expected
 * @property {string[]} [tags]
 */

/**
 * @typedef {object} FixtureExpectations
 * @property {string[]} [contains]
 * @property {string[]} [notContains]
 * @property {string[]} [regex]
 * @property {object} [jsonSchema]
 * @property {number} [maxTokens]
 * @property {number} [maxLatencyMs]
 * @property {number} [toolCallsMin]
 * @property {string[]} [toolSequence]
 */

/**
 * @typedef {object} CheckResult
 * @property {string} kind
 * @property {boolean} ok
 * @property {string} [message]
 */

/**
 * @typedef {object} EvalResult
 * @property {string} fixtureId
 * @property {boolean} ok
 * @property {CheckResult[]} checks
 * @property {number} latencyMs
 * @property {string} content
 * @property {{ inputTokens: number, outputTokens: number, totalTokens: number }} usage
 */

/**
 * @typedef {object} SuiteResult
 * @property {string} suitePath
 * @property {number} total
 * @property {number} passed
 * @property {number} failed
 * @property {EvalResult[]} results
 */

// ── Check implementations ──────────────────────────────────────────────────────

/**
 * @param {string} content
 * @param {string[]} needles
 * @returns {CheckResult[]}
 */
function checkContains(content, needles) {
  return needles.map((needle) => {
    const ok = content.includes(needle);
    return {
      kind: 'contains',
      ok,
      message: ok ? undefined : `expected to contain: "${needle}"`,
    };
  });
}

/**
 * @param {string} content
 * @param {string[]} needles
 * @returns {CheckResult[]}
 */
function checkNotContains(content, needles) {
  return needles.map((needle) => {
    const ok = !content.includes(needle);
    return {
      kind: 'notContains',
      ok,
      message: ok ? undefined : `expected NOT to contain: "${needle}"`,
    };
  });
}

/**
 * @param {string} content
 * @param {string[]} patterns
 * @returns {CheckResult[]}
 */
function checkRegex(content, patterns) {
  return patterns.map((pattern) => {
    let ok = false;
    let message;
    try {
      const re = new RegExp(pattern);
      ok = re.test(content);
      message = ok ? undefined : `regex did not match: ${pattern}`;
    } catch (err) {
      ok = false;
      message = `invalid regex: ${pattern} — ${err.message}`;
    }
    return { kind: 'regex', ok, message };
  });
}

/**
 * @param {string} content
 * @param {object} schema
 * @returns {CheckResult}
 */
function checkJsonSchema(content, schema) {
  if (!schema) return { kind: 'jsonSchema', ok: true };
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { kind: 'jsonSchema', ok: false, message: 'response is not valid JSON' };
  }
  // Basic schema validation — check required fields exist
  const errors = [];
  if (schema.type === 'object' && typeof parsed !== 'object' || Array.isArray(parsed)) {
    if (schema.type !== 'array') {
      errors.push(`expected ${schema.type}, got ${typeof parsed}`);
    }
  }
  if (schema.type === 'array') {
    if (!Array.isArray(parsed)) {
      errors.push(`expected array, got ${typeof parsed}`);
    } else {
      if (schema.minItems != null && parsed.length < schema.minItems) {
        errors.push(`array length ${parsed.length} is less than minItems ${schema.minItems}`);
      }
      if (schema.items?.type) {
        for (let i = 0; i < parsed.length; i++) {
          if (typeof parsed[i] !== schema.items.type) {
            errors.push(`item at index ${i} expected type ${schema.items.type}, got ${typeof parsed[i]}`);
          }
        }
      }
    }
  }
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (parsed[key] === undefined) {
        if (!schema.required?.includes(key)) continue;
        errors.push(`missing required property: ${key}`);
      } else if (prop.type && typeof parsed[key] !== prop.type) {
        errors.push(`property "${key}" expected type ${prop.type}, got ${typeof parsed[key]}`);
      }
    }
  }
  return {
    kind: 'jsonSchema',
    ok: errors.length === 0,
    message: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

/**
 * @param {{ inputTokens: number, outputTokens: number, totalTokens: number }} usage
 * @param {number} maxTokens
 * @returns {CheckResult}
 */
function checkMaxTokens(usage, maxTokens) {
  if (maxTokens == null) return { kind: 'maxTokens', ok: true };
  const ok = usage.totalTokens <= maxTokens;
  return {
    kind: 'maxTokens',
    ok,
    message: ok ? undefined : `token count ${usage.totalTokens} exceeds max ${maxTokens}`,
  };
}

/**
 * @param {number} latencyMs
 * @param {number} maxLatencyMs
 * @returns {CheckResult}
 */
function checkMaxLatency(latencyMs, maxLatencyMs) {
  if (maxLatencyMs == null) return { kind: 'maxLatencyMs', ok: true };
  const ok = latencyMs <= maxLatencyMs;
  return {
    kind: 'maxLatencyMs',
    ok,
    message: ok ? undefined : `latency ${latencyMs}ms exceeds max ${maxLatencyMs}ms`,
  };
}

/**
 * @param {string[]} toolCalls
 * @param {number} minCalls
 * @returns {CheckResult}
 */
function checkToolCallsMin(toolCalls, minCalls) {
  if (minCalls == null) return { kind: 'toolCallsMin', ok: true };
  const ok = toolCalls.length >= minCalls;
  return {
    kind: 'toolCallsMin',
    ok,
    message: ok ? undefined : `tool calls ${toolCalls.length} is less than min ${minCalls}`,
  };
}

/**
 * @param {string[]} toolCalls
 * @param {string[]} sequence
 * @returns {CheckResult}
 */
function checkToolSequence(toolCalls, sequence) {
  if (!sequence || !sequence.length) return { kind: 'toolSequence', ok: true };
  const seqStr = sequence.join(',');
  const callStr = toolCalls.join(',');
  // Find the sequence as a subsequence
  let seqIdx = 0;
  for (const call of toolCalls) {
    if (call === sequence[seqIdx]) {
      seqIdx++;
      if (seqIdx === sequence.length) break;
    }
  }
  const ok = seqIdx === sequence.length;
  return {
    kind: 'toolSequence',
    ok,
    message: ok ? undefined : `tool sequence [${seqStr}] not found in [${callStr}]`,
  };
}

// ── Core runner ───────────────────────────────────────────────────────────────

/**
 * Run a single fixture against an LLM.
 *
 * @param {Fixture} fixture
 * @param {{ llmCall: (prompt: string, opts: {agent: string}) => Promise<{content: string, usage: object}>, timeoutMs?: number, toolCalls?: string[] }} opts
 * @returns {Promise<EvalResult>}
 */
export async function runFixture(
  fixture,
  { llmCall, timeoutMs = 60000, toolCalls = [] } = {},
) {
  if (!llmCall) throw new Error('llmCall is required');
  const start = Date.now();
  let content = '';
  let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let timeoutHit = false;
  let callError = null;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const result = await Promise.race([
      llmCall(fixture.prompt, { agent: fixture.agent }),
      new Promise((_, reject) => ctrl.signal.addEventListener('abort', () => reject(new Error('timeout')))),
    ]);
    clearTimeout(timer);
    content = result.content || '';
    usage = result.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    // Support tool calls returned from llmCall
    if (result.toolCalls?.length) {
      toolCalls = result.toolCalls;
    }
  } catch (err) {
    if (err.message === 'timeout') {
      timeoutHit = true;
    } else {
      callError = err;
    }
    content = '';
    usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  const latencyMs = Date.now() - start;
  const checks = [];
  const expected = fixture.expected || {};

  // Timeout check
  if (timeoutHit) {
    checks.push({ kind: 'timeout', ok: false, message: `call exceeded ${timeoutMs}ms` });
  }

  // Error check (non-timeout error)
  if (callError) {
    checks.push({ kind: 'error', ok: false, message: callError.message });
  }

  // Content checks
  if (expected.contains?.length) {
    checks.push(...checkContains(content, expected.contains));
  }
  if (expected.notContains?.length) {
    checks.push(...checkNotContains(content, expected.notContains));
  }
  if (expected.regex?.length) {
    checks.push(...checkRegex(content, expected.regex));
  }
  if (expected.jsonSchema) {
    checks.push(checkJsonSchema(content, expected.jsonSchema));
  }
  if (expected.maxTokens != null) {
    checks.push(checkMaxTokens(usage, expected.maxTokens));
  }
  if (expected.maxLatencyMs != null) {
    checks.push(checkMaxLatency(latencyMs, expected.maxLatencyMs));
  }
  if (expected.toolCallsMin != null) {
    checks.push(checkToolCallsMin(toolCalls, expected.toolCallsMin));
  }
  if (expected.toolSequence?.length) {
    checks.push(checkToolSequence(toolCalls, expected.toolSequence));
  }

  const ok = checks.every((c) => c.ok);

  return {
    fixtureId: fixture.id,
    ok,
    checks,
    latencyMs,
    content,
    usage,
  };
}

/**
 * Run a single fixture by ID from a known fixture map (useful for testing).
 *
 * @param {string} fixtureId
 * @param {Fixture[]} fixtures
 * @param {{ llmCall: Function, timeoutMs?: number, toolCalls?: string[] }} opts
 * @returns {Promise<EvalResult>}
 */
export async function runFixtureById(
  fixtureId,
  fixtures,
  { llmCall, timeoutMs = 60000, toolCalls = [] } = {},
) {
  const fixture = fixtures.find((f) => f.id === fixtureId);
  if (!fixture) {
    throw new Error(`Fixture not found: ${fixtureId}`);
  }
  return runFixture(fixture, { llmCall, timeoutMs, toolCalls });
}

/**
 * Load all JSON fixtures from a directory.
 *
 * @param {string} suitePath
 * @returns {Fixture[]}
 */
export function loadFixtures(suitePath) {
  /** @type {Fixture[]} */
  const fixtures = [];
  try {
    const entries = readdirSync(suitePath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && extname(entry.name) === '.json') {
        const full = join(suitePath, entry.name);
        try {
          const raw = readFileSync(full, 'utf8');
          const parsed = JSON.parse(raw);
          // Support both single fixture and suite of fixtures
          if (parsed.id && parsed.prompt) {
            fixtures.push(parsed);
          } else if (Array.isArray(parsed.fixtures)) {
            fixtures.push(...parsed.fixtures);
          }
        } catch { /* skip invalid JSON */ }
      }
    }
  } catch { /* dir not found */ }
  return fixtures;
}

/**
 * Run a suite of fixtures.
 *
 * @param {string} suitePath
 * @param {{ llmCall: Function, concurrency?: number, timeoutMs?: number }} opts
 * @returns {Promise<SuiteResult>}
 */
export async function runSuite(
  suitePath,
  { llmCall, concurrency = 5, timeoutMs = 60000 } = {},
) {
  const fixtures = loadFixtures(suitePath);
  /** @type {EvalResult[]} */
  const results = [];
  let passed = 0;
  let failed = 0;

  // Run in batches of `concurrency`
  for (let i = 0; i < fixtures.length; i += concurrency) {
    const batch = fixtures.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((fixture) =>
        runFixture(fixture, { llmCall, timeoutMs }).catch((err) => ({
          fixtureId: fixture.id,
          ok: false,
          checks: [{ kind: 'error', ok: false, message: err.message }],
          latencyMs: 0,
          content: '',
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        }))
      )
    );
    for (const r of batchResults) {
      results.push(r);
      if (r.ok) passed++;
      else failed++;
    }
  }

  return {
    suitePath,
    total: fixtures.length,
    passed,
    failed,
    results,
  };
}
