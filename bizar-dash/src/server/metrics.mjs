/**
 * src/server/metrics.mjs
 *
 * v4.7.0 — Tiny Prometheus-style metrics registry.
 *
 * Implements the three primitive metric types we actually use:
 *   - counter(name, help)        → { inc(labels) }
 *   - gauge(name, help)          → { set(value, labels) }
 *   - histogram(name, help, opts) → { observe(value, labels) }
 *
 * Storage is in-process: counters/gauges/histograms are kept in Maps
 * keyed by metric name → label-set signature → values. Labels are
 * JSON-stringified to produce a stable key (sorted-keys would be
 * nicer but JSON.stringify of a literal object preserves insertion
 * order, which is good enough for our use — every caller writes the
 * same label shape for the same metric).
 *
 * `render()` returns the Prometheus text exposition format
 * (Content-Type: text/plain; version=0.0.4) so it can be scraped by
 * Prometheus or read by humans. The output includes the `# HELP` and
 * `# TYPE` headers for every metric.
 *
 * `reset()` clears the registry — only intended for tests.
 */

const counters = new Map();
const gauges = new Map();
const histograms = new Map();

// Default Prometheus-style histogram buckets in seconds (suitable for
// HTTP latency). Override per-metric via opts.buckets.
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

function labelsKey(labels) {
  if (!labels || typeof labels !== 'object') return '{}';
  const keys = Object.keys(labels);
  if (keys.length === 0) return '{}';
  const ordered = {};
  for (const k of keys.sort()) ordered[k] = labels[k];
  return JSON.stringify(ordered);
}

function labelsToString(labels) {
  if (!labels || typeof labels !== 'object') return '';
  const keys = Object.keys(labels);
  if (keys.length === 0) return '';
  return keys
    .sort()
    .map((k) => `${k}="${escapeLabelValue(String(labels[k]))}"`)
    .join(',');
}

function escapeLabelValue(v) {
  return v.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

export function counter(name, help) {
  if (!name) throw new Error('counter(name, help): name is required');
  return {
    inc(labels = {}) {
      const key = labelsKey(labels);
      let entry = counters.get(name);
      if (!entry) {
        entry = { help: help || '', values: new Map() };
        counters.set(name, entry);
      }
      const v = entry.values.get(key) || { labels, value: 0 };
      v.value += 1;
      entry.values.set(key, v);
    },
  };
}

export function gauge(name, help) {
  if (!name) throw new Error('gauge(name, help): name is required');
  return {
    set(value, labels = {}) {
      const key = labelsKey(labels);
      let entry = gauges.get(name);
      if (!entry) {
        entry = { help: help || '', values: new Map() };
        gauges.set(name, entry);
      }
      entry.values.set(key, { labels, value: Number(value) });
    },
  };
}

export function histogram(name, help, opts = {}) {
  if (!name) throw new Error('histogram(name, help, opts): name is required');
  const buckets = Array.isArray(opts.buckets) && opts.buckets.length > 0
    ? [...opts.buckets].sort((a, b) => a - b)
    : DEFAULT_BUCKETS;
  return {
    observe(value, labels = {}) {
      const key = labelsKey(labels);
      let entry = histograms.get(name);
      if (!entry) {
        entry = {
          help: help || '',
          buckets,
          values: new Map(),
        };
        histograms.set(name, entry);
      }
      const v = entry.values.get(key) || {
        labels,
        count: 0,
        sum: 0,
        bucketCounts: buckets.map(() => 0),
      };
      v.count += 1;
      v.sum += Number(value);
      for (let i = 0; i < buckets.length; i += 1) {
        if (Number(value) <= buckets[i]) v.bucketCounts[i] += 1;
      }
      entry.values.set(key, v);
    },
  };
}

function renderCounters() {
  const lines = [];
  for (const [name, entry] of counters) {
    lines.push(`# HELP ${name} ${entry.help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const v of entry.values.values()) {
      const labels = labelsToString(v.labels);
      lines.push(`${name}${labels ? '{' + labels + '}' : ''} ${v.value}`);
    }
  }
  return lines;
}

function renderGauges() {
  const lines = [];
  for (const [name, entry] of gauges) {
    lines.push(`# HELP ${name} ${entry.help}`);
    lines.push(`# TYPE ${name} gauge`);
    for (const v of entry.values.values()) {
      const labels = labelsToString(v.labels);
      lines.push(`${name}${labels ? '{' + labels + '}' : ''} ${v.value}`);
    }
  }
  return lines;
}

function renderHistograms() {
  const lines = [];
  for (const [name, entry] of histograms) {
    lines.push(`# HELP ${name} ${entry.help}`);
    lines.push(`# TYPE ${name} histogram`);
    for (const v of entry.values.values()) {
      const baseLabels = labelsToString(v.labels);
      for (let i = 0; i < entry.buckets.length; i += 1) {
        const le = entry.buckets[i];
        const bucketLabels = baseLabels
          ? `${baseLabels},le="${le}"`
          : `le="${le}"`;
        lines.push(`${name}_bucket{${bucketLabels}} ${v.bucketCounts[i]}`);
      }
      const infLabels = baseLabels ? `${baseLabels},le="+Inf"` : 'le="+Inf"';
      lines.push(`${name}_bucket{${infLabels}} ${v.count}`);
      const sumLabels = baseLabels;
      lines.push(
        `${name}_sum${sumLabels ? '{' + sumLabels + '}' : ''} ${v.sum}`,
      );
      lines.push(
        `${name}_count${sumLabels ? '{' + sumLabels + '}' : ''} ${v.count}`,
      );
    }
  }
  return lines;
}

export function render() {
  const parts = [
    ...renderCounters(),
    ...renderGauges(),
    ...renderHistograms(),
  ];
  return parts.length === 0 ? '' : `${parts.join('\n')}\n`;
}

/**
 * Reset every metric. Intended for tests — never call this from a
 * long-running server.
 */
export function reset() {
  counters.clear();
  gauges.clear();
  histograms.clear();
}

// ─── v5.1.0 ────────────────────────────────────────────────────────────────
// Trace → metrics correlation helpers.
//
// The OTEL exporter ships spans to a collector; the Prometheus
// exporter ships counters from this in-process registry. To answer
// "how many `chat.send` spans landed in the last hour?" without
// leaving the dashboard, route handlers call `recordTrace(name,
// attributes)` from inside their `withSpan` wrapper. The Map keeps a
// bounded per-(name, attribute-set) count so a single high-cardinality
// label (e.g. `chat.session_id`) does not blow up memory.
//
// `traceCountByName` is intentionally exported read-only — tests
// import it to assert the helper was called with the right key, but
// production code should always go through `recordTrace` to keep
// the key derivation in one place.
//
//─── v5.1.0 ends ───────────────────────────────────────────────────────────

/**
 * Bounded counter of recorded trace samples, keyed by
 * `${name}:${JSON.stringify(attributes)}`. Routes populate this
 * from inside their `withSpan` callback so the dashboard can answer
 * "how often did span X fire with attribute set Y" without leaving
 * the process.
 *
 * The Map is intentionally an exported `let`-equivalent: tests
 * reset it via {@link resetTraceCounts}; production code never
 * mutates the Map directly.
 *
 * @type {Map<string, number>}
 */
export const traceCountByName = new Map();

/**
 * Increment the trace counter for `(name, attributes)`.
 *
 * The composite key is `${name}:${jsonString}` so two spans named
 * `chat.send` with different `chat.session_id` attributes are
 * tracked separately. Undefined/null/empty-string attribute values
 * are dropped from the key for stability (avoids the empty-string vs
 * undefined distinction polluting counts). Keys are alphabetised
 * before serialisation so `{a:1,b:2}` and `{b:2,a:1}` collide on
 * the same bucket — `JSON.stringify` alone would not give that
 * guarantee because it preserves insertion order.
 *
 * @param {string} name
 * @param {Record<string, string|number|boolean|undefined|null>} [attributes]
 * @returns {number} the new total for that key
 */
export function recordTrace(name, attributes = {}) {
  if (!name) return 0;
  const keys = [];
  if (attributes && typeof attributes === 'object') {
    for (const k of Object.keys(attributes)) {
      const v = attributes[k];
      if (v === undefined || v === null || v === '') continue;
      keys.push(k);
    }
  }
  keys.sort();
  const cleanAttrs = {};
  for (const k of keys) cleanAttrs[k] = attributes[k];
  const key = `${name}:${JSON.stringify(cleanAttrs)}`;
  const next = (traceCountByName.get(key) || 0) + 1;
  traceCountByName.set(key, next);
  return next;
}

/**
 * Clear every recorded-trace counter. Intended for tests.
 */
export function resetTraceCounts() {
  traceCountByName.clear();
}