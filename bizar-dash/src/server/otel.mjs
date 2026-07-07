/**
 * src/server/otel.mjs
 *
 * v5.1.0 — Expanded OpenTelemetry tracing surface for the Bizar dashboard.
 *
 * Initialises the NodeSDK with an OTLP HTTP trace exporter and exposes:
 *   - `tracer`                        — the shared tracer instance
 *   - `initOtel()` / `shutdownOtel()` — SDK lifecycle (off by default)
 *   - `withSpan(name, fn, attrs)`     — ergonomic wrapper that records
 *                                       OK on success, ERROR+exception
 *                                       on throw, and ends the span in
 *                                       every code path
 *   - `setCommonAttributes(span, …)`  — fast-path for the recurring
 *                                       user/workspace/ip/ua attributes
 *                                       that 95% of route spans set
 *
 * Auto-instrumentation is intentionally NOT enabled. The dashboard
 * already has structured logger + Prometheus for the "what" metrics, so
 * distributed tracing is only interesting for the multi-step flows
 * where request correlation matters (chat SSE pump, cline session
 * creation, plugin install, workspace invites, etc).
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
import { SpanStatusCode, trace } from '@opentelemetry/api';
import os from 'node:os';
import { info as logInfo, warn as logWarn } from './logger.mjs';

const DEFAULT_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces';
const SERVICE_NAME = 'bizar-dash';
const SERVICE_NAMESPACE = 'bizar';
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
 * Build the OTel resource attributes for this dashboard process.
 *
 * Used both at SDK init time (so a collector sees deployment
 * context) and exposed via `getResourceAttributes()` for any
 * consumer that needs the same metadata on a per-span basis.
 *
 * @returns {Record<string, string|number>}
 */
export function getResourceAttributes() {
  return {
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
    [SemanticResourceAttributes.SERVICE_VERSION]:
      process.env.npm_package_version || '0.0.0',
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: SERVICE_NAMESPACE,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]:
      process.env.NODE_ENV || 'development',
    [SemanticResourceAttributes.PROCESS_PID]: process.pid,
    [SemanticResourceAttributes.HOST_NAME]: os.hostname(),
    [SemanticResourceAttributes.OS_VERSION]: `${os.platform()} ${os.release()}`,
  };
}

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
    const attrs = getResourceAttributes();
    if (serviceName !== SERVICE_NAME) attrs[SemanticResourceAttributes.SERVICE_NAME] = serviceName;
    sdk = new NodeSDK({
      resource: new Resource(attrs),
      traceExporter: new OTLPTraceExporter({ url: endpoint }),
    });
    sdk.start();
    logInfo('OpenTelemetry initialised', {
      module: 'otel',
      serviceName,
      endpoint,
      namespace: SERVICE_NAMESPACE,
      deployment: process.env.NODE_ENV || 'development',
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

/**
 * Run `fn` inside an active span on the shared tracer.
 *
 * The helper:
 *   - opens a span with the given name and pre-bound attributes;
 *   - awaits the user callback (which receives the span as its
 *     last argument, after `(req, res)` in route handlers, or as
 *     the only argument in free-standing helpers);
 *   - sets the span status to OK on success;
 *   - on throw: records the exception and sets ERROR status before
 *     rethrowing so the original error propagates to `wrap()` /
 *     `next(err)` exactly as if the helper were not used;
 *   - ends the span in a finally block so a thrown error from the
 *     callback cannot leak the span.
 *
 * `withSpan` works under both the live SDK and the no-op tracer
 * shipped when OTEL is disabled — every span method is a no-op then
 * and the callback's return value is what callers see.
 *
 * @template T
 * @param {string} name
 * @param {(span: import('@opentelemetry/api').Span, ...args: any[]) => Promise<T>|T} fn
 * @param {Record<string, string|number|boolean>} [attributes]
 * @returns {(...args: any[]) => Promise<T>}
 */
export function withSpan(name, fn, attributes = {}) {
  return (...args) => tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span, ...args);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      try {
        span.recordException(err);
      } catch {
        /* no-op tracer swallows everything */
      }
      try {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err?.message || String(err),
        });
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      try {
        span.end();
      } catch {
        /* never re-throw inside OTel helpers */
      }
    }
  });
}

/**
 * Apply the common request-scoped attributes most route spans want:
 * user/workspace identity, plus the OTel HTTP semantic conventions
 * for the client IP and user-agent string.
 *
 * Each attribute is set independently and only if a value was
 * provided; passing `undefined`/`null`/empty string skips the
 * attribute so spans for public endpoints don't get an empty
 * `bizar.user.id = ""` cluttering the trace UI.
 *
 * Attribute naming rationale:
 *   - `bizar.user.id`       — namespaced custom key (avoids colliding
 *                             with any future OTel `enduser.id`)
 *   - `bizar.workspace.id`  — namespaced custom key
 *   - `http.client_ip`      — OTel HTTP semantic convention
 *   - `http.user_agent`     — OTel HTTP semantic convention (the
 *                             spec later renamed this to
 *                             `user_agent.original`; the dashboard
 *                             keeps `http.user_agent` because the
 *                             v4.x dashboards in production still
 *                             search by that key)
 *
 * @param {import('@opentelemetry/api').Span} span
 * @param {object} opts
 * @param {string} [opts.userId]
 * @param {string} [opts.workspaceId]
 * @param {string} [opts.ip]
 * @param {string} [opts.userAgent]
 */
export function setCommonAttributes(span, { userId, workspaceId, ip, userAgent } = {}) {
  if (!span) return;
  if (userId) span.setAttribute('bizar.user.id', userId);
  if (workspaceId) span.setAttribute('bizar.workspace.id', workspaceId);
  if (ip) span.setAttribute('http.client_ip', ip);
  if (userAgent) span.setAttribute('http.user_agent', userAgent);
}
