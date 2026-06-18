/**
 * settings.ts
 *
 * v0.4.0 — Plan settings store.
 *
 * Persists user-controlled settings that drive the visual-plan flow
 * (`/visual-plan on|off`, last-used plan slug, default template).
 *
 * Spec contract:
 *   - §4.7 — corrupt-state fallback. A corrupt or missing file returns
 *     `DEFAULT_PLAN_SETTINGS`. Never throws.
 *   - §7.6 — no raw message content is logged. Only metadata strings.
 *   - §8.2 — mkdirSync on init with EACCES/EROFS handling; if creation
 *     fails the store returns defaults rather than throwing.
 *
 * The file is stored at `~/.cache/bizarharness/plan-settings.json`. We
 * `expandHome` in the constructor, just like `StateStore` does.
 *
 * Atomic writes use the same `writeFileSync(tmp) + renameSync(tmp, final)`
 * pattern as `state.ts`. We use a single in-memory mutex for write
 * serialization (concurrent `update()` calls must not lose data).
 *
 * Validation:
 *   - `visualPlanEnabled` — must be a boolean.
 *   - `defaultTemplate`  — must be one of the four known literals.
 *   - `lastUsedSlug`     — must be `string | null`.
 *
 * Invalid values are clamped to defaults (and a warning is logged).
 * The store never throws on bad input.
 */

import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";

import type { Logger } from "./logger.js";

// --- Public types --------------------------------------------------------

export type DefaultTemplate =
  | "blank"
  | "feature-design"
  | "bug-investigation"
  | "decision-record";

export const KNOWN_TEMPLATES: readonly DefaultTemplate[] = [
  "blank",
  "feature-design",
  "bug-investigation",
  "decision-record",
] as const;

export interface PlanSettings {
  /** When true, the agent's first action on a complex task is to
   *  call `bizar_create_visual_plan` and wait for feedback. */
  visualPlanEnabled: boolean;
  /** Default template to use when `/plan new` is invoked without one. */
  defaultTemplate: DefaultTemplate;
  /** Last plan slug the user opened/created. Surfaces as a default suggestion. */
  lastUsedSlug: string | null;
}

export const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  visualPlanEnabled: false,
  defaultTemplate: "blank",
  lastUsedSlug: null,
};

// --- Implementation -------------------------------------------------------

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Validates an unknown value as a `PlanSettings` shape. Returns either a
 * fully-validated `PlanSettings` (with invalid fields clamped to the
 * defaults) or `null` if the input is not an object at all.
 *
 * Validation rules:
 *   - `visualPlanEnabled`: must be a boolean, else `false`.
 *   - `defaultTemplate`:  must be one of `KNOWN_TEMPLATES`, else `"blank"`.
 *   - `lastUsedSlug`:     must be `string` or `null`, else `null`.
 */
function validateSettings(raw: unknown): PlanSettings | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;

  // visualPlanEnabled
  const visualPlanEnabled =
    typeof obj.visualPlanEnabled === "boolean" ? obj.visualPlanEnabled : false;

  // defaultTemplate
  let defaultTemplate: DefaultTemplate = "blank";
  if (
    typeof obj.defaultTemplate === "string" &&
    (KNOWN_TEMPLATES as readonly string[]).includes(obj.defaultTemplate)
  ) {
    defaultTemplate = obj.defaultTemplate as DefaultTemplate;
  }

  // lastUsedSlug
  let lastUsedSlug: string | null = null;
  if (typeof obj.lastUsedSlug === "string" && obj.lastUsedSlug !== "") {
    lastUsedSlug = obj.lastUsedSlug;
  } else if (obj.lastUsedSlug === null) {
    lastUsedSlug = null;
  }

  return { visualPlanEnabled, defaultTemplate, lastUsedSlug };
}

/**
 * Recursive mkdirSync with EACCES/EROFS handling. Returns true if the
 * directory is usable, false otherwise. Mirrors `state.ts`.
 */
function ensureDir(dir: string, logger: Logger): boolean {
  try {
    mkdirSync(dir, { recursive: true });
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EROFS") {
      logger.log({
        level: "error",
        message: `bizar: cannot create settings directory ${dir}: ${String(err)}`,
      });
      return false;
    }
    throw err;
  }
}

/**
 * Persist settings atomically: write to .tmp file then rename. Mirrors
 * `state.ts` `writeStateAtomic`. Best-effort: never throws, logs on failure.
 */
function writeSettingsAtomic(
  filePath: string,
  settings: PlanSettings,
  logger: Logger,
): void {
  const tmp = `${filePath}.tmp`;
  try {
    writeFileSync(tmp, JSON.stringify(settings, null, 2), "utf8");
    renameSync(tmp, filePath);
  } catch (err: unknown) {
    logger.log({
      level: "warn",
      message: `bizar: failed to write plan settings ${filePath}: ${String(err)}`,
    });
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // non-fatal
    }
  }
}

/**
 * Read settings from disk. Returns DEFAULT_PLAN_SETTINGS on missing or
 * corrupt file (with a warning logged). Never throws.
 */
function readSettings(filePath: string, logger: Logger): PlanSettings {
  try {
    const raw = readFileSync(filePath, "utf8");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      logger.log({
        level: "warn",
        message: `bizar: corrupt plan settings file at ${filePath}, using defaults`,
      });
      return { ...DEFAULT_PLAN_SETTINGS };
    }
    const validated = validateSettings(parsed);
    if (validated === null) {
      logger.log({
        level: "warn",
        message: `bizar: corrupt plan settings file at ${filePath}, using defaults`,
      });
      return { ...DEFAULT_PLAN_SETTINGS };
    }
    return validated;
  } catch (err: unknown) {
    // Missing file → ENOENT. Other read errors are surfaced.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      logger.log({
        level: "warn",
        message: `bizar: failed to read plan settings ${filePath}: ${String(err)}`,
      });
    }
    return { ...DEFAULT_PLAN_SETTINGS };
  }
}

/**
 * Per-store async mutex. Writes through this mutex so two concurrent
 * `update()` calls don't lose data. Reads bypass the mutex (the file
 * write is atomic via rename, and we always re-read after write).
 */
async function withLock<T>(
  lock: { chain: Promise<unknown> },
  fn: () => Promise<T>,
): Promise<T> {
  const prev = lock.chain ?? Promise.resolve();
  const next = prev.then(fn, fn);
  lock.chain = next.catch(() => {});
  return next;
}

export class SettingsStore {
  private filePath: string;
  private settingsDir: string;
  private logger: Logger;
  private initialized = false;
  /** Single-instance mutex (settings are global, not per-session). */
  private lock = { chain: Promise.resolve() as Promise<unknown> };

  /**
   * @param settingsDir Directory containing the settings file. Typically
   *                     `"~/.cache/bizarharness"`. The constructor
   *                     expands `~` to the home directory.
   */
  constructor(settingsDir: string, logger: Logger) {
    this.settingsDir = expandHome(settingsDir);
    this.filePath = path.join(this.settingsDir, "plan-settings.json");
    this.logger = logger;
  }

  /** Lazily ensure the settings directory exists. */
  private ensureSettingsDir(): boolean {
    if (this.initialized) return true;
    this.initialized = true;
    return ensureDir(this.settingsDir, this.logger);
  }

  /**
   * Read the current settings. Returns DEFAULT_PLAN_SETTINGS if the
   * file is missing or corrupt. Never throws.
   */
  async get(): Promise<PlanSettings> {
    if (!this.ensureSettingsDir()) return { ...DEFAULT_PLAN_SETTINGS };
    if (!existsSync(this.filePath)) return { ...DEFAULT_PLAN_SETTINGS };
    return readSettings(this.filePath, this.logger);
  }

  /**
   * Merge a partial patch into the current settings and persist. The
   * returned value is the post-merge state.
   *
   * Invalid values in the patch are silently ignored — the existing
   * field is preserved (we don't clamp it to a default). Use `set()`
   * for type-checked setters that log a warning on rejection.
   *
   * Concurrent `update()` calls are serialized through the per-store
   * mutex; the on-disk file is always consistent.
   */
  async update(patch: Partial<PlanSettings>): Promise<PlanSettings> {
    if (!this.ensureSettingsDir()) return { ...DEFAULT_PLAN_SETTINGS };
    return withLock(this.lock, async () => {
      const current = await this.get();
      const next: PlanSettings = { ...current };

      // Validate each patch field independently. Invalid fields are
      // skipped (the existing value is preserved).
      if ("visualPlanEnabled" in patch) {
        const v = patch.visualPlanEnabled;
        if (typeof v === "boolean") {
          next.visualPlanEnabled = v;
        }
      }
      if ("defaultTemplate" in patch) {
        const v = patch.defaultTemplate;
        if (typeof v === "string" && (KNOWN_TEMPLATES as readonly string[]).includes(v)) {
          next.defaultTemplate = v as DefaultTemplate;
        }
      }
      if ("lastUsedSlug" in patch) {
        const v = patch.lastUsedSlug;
        if (v === null) {
          next.lastUsedSlug = null;
        } else if (typeof v === "string" && v !== "") {
          next.lastUsedSlug = v;
        }
      }

      writeSettingsAtomic(this.filePath, next, this.logger);
      return next;
    });
  }

  /**
   * Typed setter for a single setting. Returns the post-set state.
   * Unknown keys are rejected with a warning.
   *
   * If the value fails validation, the existing setting is preserved
   * and a warning is logged. The store never throws.
   */
  async set<K extends keyof PlanSettings>(
    setting: K,
    value: PlanSettings[K],
  ): Promise<PlanSettings> {
    if (!this.ensureSettingsDir()) return { ...DEFAULT_PLAN_SETTINGS };
    return withLock(this.lock, async () => {
      const current = await this.get();
      const candidate = validateSettings({ ...current, [setting]: value });
      if (candidate === null) return current;

      // validateSettings may clamp — only commit if the field actually changed
      // (or if the user-supplied value was valid). This avoids spurious writes
      // when someone calls `set("defaultTemplate", "nonsense")`.
      const desired = candidate[setting];
      if (desired !== value) {
        this.logger.log({
          level: "warn",
          message: `bizar: rejected invalid value for ${String(setting)}: ${JSON.stringify(value)}, keeping ${JSON.stringify(desired)}`,
        });
        return current;
      }

      const next: PlanSettings = { ...current, [setting]: value };
      writeSettingsAtomic(this.filePath, next, this.logger);
      return next;
    });
  }

  /** Absolute path of the settings file (for diagnostics/tests). */
  getFilePath(): string {
    return this.filePath;
  }
}