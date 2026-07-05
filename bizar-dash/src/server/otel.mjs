/**
 * src/server/otel.mjs
 *
 * v4.9.0 — OpenTelemetry distributed tracing for the Bizar dashboard.
 *
 * Initialises the NodeSDK with an OTLP HTTP trace exporter and exposes
 * a single `tracer` instance for ad-hoc spans (chat.send, opencode
 * session creation, etc). Auto-instrumentation is intentionally not
 * enabled — the dashboard already has structured logger + Prometheus
 * for the "what" metrics, so distributed tracing is only interesting
 * for the multi-step flows where request correlation matters
 * (chat SSE pump, opencode session creation).
 *
 * Off by default. Enable with one of:
 *   BIZAR_OTEL=1
 *   OTEL_ENABLED=1
 *   OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318/v1/traces   (also opts in)
 *
 * `shutdownOtel()` flushes any pending spans and tears down the SDK.
 * It is idempotent and safe to call multiple times — subsequent calls
 * are a no-op once the SDK has been shut down.
 *
 * The NodeSDK constructor is wrapped in try/catch so that a malformed
 * OTLP endpoint or missing optional binding (e.g. test runs that
 * import this module but never call `initOtel`) does not crash the
 * dashboard.
 */
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { trace } from '@opentelemetry/api';
import { info as logInfo, warn as logWarn } from './logger.mjs';

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
const SERVICE_NAME = 'bizar-dash';
const TRACER_NAME = 'bizar-dash';
const TRACER_VERSION = '0.1.0';

let sdk = null;
let shuttingDown = false;

/**
 * The shared tracer used by route handlers. Bound to the global
 * tracer provider — when OTEL is not enabled this resolves to a
 * no-op tracer (a `startActiveSpan` call still returns a valid span
 * object whose methods are all no-ops), so route handlers do not
 * need a feature flag of their own.
 */
export const tracer = trace.getTracer(TRACER_NAME, TRACER_VERSION);

/**
 * Initialise the NodeSDK with an OTLP HTTP trace exporter. Safe to
 * call multiple times — the second call returns the cached SDK.
 *
 * `npm_package_version` is set by `npm run` contexts; in any other
 * context we fall back to '0.0.0'. The version is informational
 * (the OTLP collector shows it in the resource panel), so failing to
 * read it is never a startup blocker.
 *
 * @param {object} [opts]
 * @param {string} [opts.serviceName]  Override SERVICE_NAME (default 'bizar-dash')
 * @param {string} [opts.endpoint]     OTLP HTTP traces endpoint
 * @returns {object|null}              The NodeSDK instance, or null on failure
 */
export function initOtel({
  serviceName = SERVICE_NAME,
  endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || DEFAULT_OTLP_ENDPOINT,
} = {}) {
  if (sdk) return sdk;
  if (shuttingDown) return null;
  try {
    sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]:
          process.env.npm_package_version || '0.0.0',
      }),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
    });
    sdk.start();
    logInfo('OpenTelemetry initialised', {
      module: 'otel',
      serviceName,
      endpoint,
    });
    return sdk;
  } catch (err) {
    logWarn('OpenTelemetry init failed; continuing without tracing', {
      module: 'otel',
      err: err?.message || String(err),
    });
    sdk = null;
    return null;
  }
}

/**
 * Flush pending spans and shut down the SDK. Idempotent.
 *
 * Designed to be wired into the dashboard's SIGTERM/SIGINT handler
 * so spans in flight at shutdown are not silently dropped. Tests
 * call this between scenarios to keep registry state clean.
 *
 * @returns {Promise<void>}
 */
export async function shutdownOtel() {
  if (!sdk) return;
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await sdk.shutdown();
  } catch (err) {
    logWarn('OpenTelemetry shutdown failed', {
      module: 'otel',
      err: err?.message || String(err),
    });
  } finally {
    sdk = null;
    shuttingDown = false;
  }
}

/**
 * Test-only: return whether the SDK is currently initialised. Lets
 * tests assert that initOtel really did instantiate the SDK without
 * having to introspect private state from outside.
 *
 * @returns {boolean}
 */
export function isOtelEnabled() {
  return sdk !== null;
}
