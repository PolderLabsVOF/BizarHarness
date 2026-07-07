/**
 * Logger — thin wrapper over `client.app.log`.
 *
 * Spec requirements satisfied here:
 *   - §6.5 — honors `BIZAR_LOG_LEVEL` env var (`debug` | `info` | `warn` | `error`,
 *     default `info`, invalid values fall back to `info` with a warning).
 *   - §7.6 — never accepts or emits raw tool args / session content. Every call
 *     to `client.app.log` is `{ level, message }` (or the SDK's wrapped
 *     `{ body: { service, level, message } }` shape) where `message` is a
 *     static string the caller constructed. There is no second argument,
 *     no metadata object, no structured logging payload.
 *
 * The logger swallows all errors from the underlying `client.app.log` call.
 * A failed log MUST NOT crash the plugin or block the tool hook.
 *
 * The interface is intentionally compatible with the `Logger` shape that
 * Thor's `StateStore` and `LogWriter` accept: a single `log(opts)` method
 * returning `void` (synchronous). We also expose level-specific convenience
 * methods (`debug` / `info` / `warn` / `error`) that all delegate to `log`.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Minimal client surface the logger depends on. The real cline client's
 * `app.log` is a generated SDK method with a complex Options<T> type; we
 * accept any object with a compatible `app.log` method and treat the body
 * as an opaque `unknown` at the boundary. The logger internally shapes the
 * call to the SDK's expected `{ body: { service, level, message } }` form.
 */
export interface LoggerClient {
  app: {
    log: (input: unknown) => unknown;
  };
}

/**
 * The Logger interface matches the one defined in `state.ts` and `report.ts`
 * (Thor's modules). A single `log(opts)` method, synchronous, returns `void`.
 * The convenience methods are additive.
 */
export interface Logger {
  log(opts: { level: LogLevel; message: string }): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

interface ParsedLogLevel {
  level: LogLevel;
  wasInvalid: boolean;
  original: string | undefined;
}

function parseLogLevel(raw: string | undefined): ParsedLogLevel {
  if (raw === undefined || raw === "") {
    return { level: "info", wasInvalid: false, original: raw };
  }
  const lower = raw.toLowerCase();
  if (lower === "debug" || lower === "info" || lower === "warn" || lower === "error") {
    return { level: lower, wasInvalid: false, original: raw };
  }
  return { level: "info", wasInvalid: true, original: raw };
}

function readEnvLevel(): string | undefined {
  try {
    return typeof process !== "undefined" && process.env
      ? process.env.BIZAR_LOG_LEVEL
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Service name stamped onto every log entry. Lets users filter app logs
 * by service (e.g. `bizar`) in their diagnostic tooling.
 */
const SERVICE_NAME = "bizar";

/**
 * Construct a Logger bound to the cline client.
 *
 * @param client    The cline client (we use only `client.app.log`).
 * @param envLevel  Optional override for `BIZAR_LOG_LEVEL`. If omitted, the
 *                  env var is read once. Env vars are read at plugin init;
 *                  mid-session changes are ignored (spec §6.5).
 */
export function createLogger(client: LoggerClient, envLevel?: string): Logger {
  const raw = envLevel ?? readEnvLevel();
  const parsed = parseLogLevel(raw);
  const threshold = parsed.level;

  if (parsed.wasInvalid) {
    // Best-effort: warn about the invalid value, then proceed with "info".
    // We call `client.app.log` directly because the logger is not yet wired
    // to the threshold.
    try {
      client.app.log({
        body: { service: SERVICE_NAME, level: "warn", message: `bizar: invalid BIZAR_LOG_LEVEL "${parsed.original ?? ""}", falling back to "info"` },
      });
    } catch {
      // ignore — never let a warning crash init
    }
  }

  function emit(msgLevel: LogLevel, message: string): void {
    if (LEVEL_ORDER[msgLevel] < LEVEL_ORDER[threshold]) return;
    try {
      client.app.log({
        body: { service: SERVICE_NAME, level: msgLevel, message },
      });
    } catch {
      // Swallow — a failed log MUST NOT crash the plugin.
    }
  }

  return {
    log(opts) {
      emit(opts.level, opts.message);
    },
    debug(message) {
      emit("debug", message);
    },
    info(message) {
      emit("info", message);
    },
    warn(message) {
      emit("warn", message);
    },
    error(message) {
      emit("error", message);
    },
  };
}
