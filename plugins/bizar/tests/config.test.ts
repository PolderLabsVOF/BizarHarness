/**
 * config.test.ts — Config drift detection tests (R4 audit).
 *
 * Verifies:
 *   1. Every `bizar_*` tool registered in `plugins/bizar/index.ts`
 *      is also present in `config/opencode.json` `tools: { ... }`.
 *   2. No `bizarre_*` (double-r) typos remain in `plugins/bizar/src/`.
 *   3. `plugins/bizar/package.json` version is `0.5.0`.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const BIZAR_PLUGIN_ROOT = join(__dirname, "..");
const PLUGIN_INDEX = join(BIZAR_PLUGIN_ROOT, "index.ts");
const CONFIG_OPENCODE = join(__dirname, "..", "..", "..", "config", "opencode.json");
const PKG_JSON = join(BIZAR_PLUGIN_ROOT, "package.json");
const SRC_DIR = join(BIZAR_PLUGIN_ROOT, "src");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract `bizar_*` tool registration keys from index.ts.
 * Matches: `bizar_spawn_background: createBgSpawnTool(...)` etc.
 */
function extractPluginToolKeys(indexContent: string): string[] {
  const keys: string[] = [];
  // Matches `bizar_xxx: createXxxTool(` or `bizar_xxx: createBgXxxTool(`
  const toolKeyRegex = /\bbizar_([a-z_]+)\s*:\s*(?:create(?:Bg)?[A-Z]\w*Tool|createWaitForFeedbackTool)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = toolKeyRegex.exec(indexContent)) !== null) {
    keys.push(`bizar_${m[1]}`);
  }
  return [...new Set(keys)].sort();
}

/**
 * Extract `tools: { ... }` keys from config/opencode.json.
 */
function extractConfigToolKeys(configContent: string): string[] {
  const parsed = JSON.parse(configContent) as { tools?: Record<string, unknown> };
  if (!parsed.tools) return [];
  return Object.keys(parsed.tools).sort();
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("config drift detection", () => {
  test("plugin_tool_keys ⊆ config_tools_keys (R4 audit)", () => {
    const indexContent = readFileSync(PLUGIN_INDEX, "utf-8");
    const configContent = readFileSync(CONFIG_OPENCODE, "utf-8");

    const pluginKeys = extractPluginToolKeys(indexContent);
    const configKeys = extractConfigToolKeys(configContent);

    const missingInConfig = pluginKeys.filter((k) => !configKeys.includes(k));
    expect(missingInConfig, `Plugin tools missing in config: ${JSON.stringify(missingInConfig)}`).toEqual([]);
  });

  test("no 'bizarre_*' (double-r) typos remain in plugins/bizar/src/", () => {
    // Walk src/ directory recursively and grep for 'bizarre_'
    const allSrcFiles = getAllTsFiles(SRC_DIR);
    const violations: Array<{ file: string; match: string }> = [];

    const doubleRRegex = /\bbizarre_[a-z_]+\b/g;

    for (const file of allSrcFiles) {
      const content = readFileSync(file, "utf-8");
      let m: RegExpExecArray | null;
      while ((m = doubleRRegex.exec(content)) !== null) {
        violations.push({ file: relativeToSrc(file), match: m[0] });
      }
    }

    expect(
      violations,
      `Found 'bizarre_*' typos: ${JSON.stringify(violations)}`,
    ).toEqual([]);
  });

  test("plugins/bizar/package.json version is 0.8.0", () => {
    const pkg = JSON.parse(readFileSync(PKG_JSON, "utf-8")) as { version?: string };
    expect(pkg.version).toBe("0.8.0");
  });
});

// ---------------------------------------------------------------------------
// Helper: recursively collect all .ts files under a directory
// ---------------------------------------------------------------------------

function getAllTsFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const name of entries) {
    const full = join(dir, name);
    try {
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...getAllTsFiles(full));
      } else if (name.endsWith(".ts") || name.endsWith(".tsx")) {
        results.push(full);
      }
    } catch {
      // skip inaccessible entries
    }
  }
  return results;
}

function relativeToSrc(file: string): string {
  return file.replace(SRC_DIR + "/", "");
}
