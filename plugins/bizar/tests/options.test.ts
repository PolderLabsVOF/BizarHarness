import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_OPTIONS,
  expandHome,
  findOffendingPath,
  findSecretDirMatch,
  normalizeOptions,
  readEnvFlags,
  type NormalizedOptions,
} from "../src/options";

const D = DEFAULT_OPTIONS;

// ── expandHome ────────────────────────────────────────────────────────────────

test("expandHome converts ~ to homedir", () => {
  const home = process.env.HOME ?? "/home/test";
  expect(expandHome("~")).toBe(home);
});

test("expandHome converts ~-prefixed paths", () => {
  const home = process.env.HOME ?? "/home/test";
  expect(expandHome("~/foo/bar")).toBe(`${home}/foo/bar`);
});

test("expandHome leaves absolute paths alone", () => {
  expect(expandHome("/absolute/path")).toBe("/absolute/path");
});

// ── normalizeOptions ──────────────────────────────────────────────────────────

describe("normalizeOptions", () => {
  test("returns DEFAULT_OPTIONS when passed undefined", () => {
    const { options, notes } = normalizeOptions(undefined);
    expect(options.loopThresholdWarn).toBe(D.loopThresholdWarn);
    expect(options.loopThresholdEscalate).toBe(D.loopThresholdEscalate);
    expect(options.loopThresholdBlock).toBe(D.loopThresholdBlock);
    expect(options.loopWindowSize).toBe(D.loopWindowSize);
    expect(options.logDir).toBe(D.logDir);
    expect(options.stateDir).toBe(D.stateDir);
    expect(options.logRotationBytes).toBe(D.logRotationBytes);
    expect(notes).toContain(`loopThresholdWarn defaulted to ${D.loopThresholdWarn}`);
  });

  test("returns DEFAULT_OPTIONS when passed empty object", () => {
    const { options, notes } = normalizeOptions({});
    expect(options.loopThresholdWarn).toBe(D.loopThresholdWarn);
    expect(notes).toContain(`loopThresholdWarn defaulted to ${D.loopThresholdWarn}`);
  });

  test("negative loopThresholdWarn is clamped to 1", () => {
    const { options, notes } = normalizeOptions({ loopThresholdWarn: -5 });
    expect(options.loopThresholdWarn).toBe(1);
    expect(notes).toContain("loopThresholdWarn -5 clamped to 1");
  });

  test("zero loopThresholdWarn is clamped to 1", () => {
    const { options } = normalizeOptions({ loopThresholdWarn: 0 });
    expect(options.loopThresholdWarn).toBe(1);
  });

  test("loopThresholdWarn of 3 is preserved", () => {
    const { options } = normalizeOptions({ loopThresholdWarn: 3 });
    expect(options.loopThresholdWarn).toBe(3);
  });

  test("warn >= escalate → escalate bumped above warn", () => {
    // warn=5, escalate=5  → escalate becomes 6
    const { options, notes } = normalizeOptions({ loopThresholdWarn: 5, loopThresholdEscalate: 5 });
    expect(options.loopThresholdWarn).toBe(5);
    expect(options.loopThresholdEscalate).toBe(6);
    expect(notes.some((n) => n.includes("adjusted from 5 to 6"))).toBe(true);
  });

  test("escalate >= block → block bumped above escalate", () => {
    // escalate=8, block=8  → block becomes 9
    const { options, notes } = normalizeOptions({ loopThresholdEscalate: 8, loopThresholdBlock: 8 });
    expect(options.loopThresholdEscalate).toBe(8);
    expect(options.loopThresholdBlock).toBe(9);
    expect(notes.some((n) => n.includes("adjusted from 8 to 9"))).toBe(true);
  });

  test("loopWindowSize below 3 is clamped to 3", () => {
    const { options, notes } = normalizeOptions({ loopWindowSize: 1 });
    expect(options.loopWindowSize).toBe(3);
    expect(notes).toContain("loopWindowSize 1 clamped to 3 (minimum)");
  });

  test("loopWindowSize above 50 is clamped to 50", () => {
    const { options, notes } = normalizeOptions({ loopWindowSize: 200 });
    expect(options.loopWindowSize).toBe(50);
    expect(notes).toContain("loopWindowSize 200 clamped to 50 (maximum)");
  });

  test("loopWindowSize within [3,50] is preserved", () => {
    const { options } = normalizeOptions({ loopWindowSize: 25 });
    expect(options.loopWindowSize).toBe(25);
  });

  test("block > window + 2 → block clamped down", () => {
    // block=50, window=10 → block must be ≤ 12
    const { options, notes } = normalizeOptions({ loopThresholdBlock: 50, loopWindowSize: 10 });
    expect(options.loopThresholdBlock).toBe(12);
    expect(notes.some((n) => n.includes("adjusted to 12"))).toBe(true);
  });

  test("NaN threshold → uses default", () => {
    const { options } = normalizeOptions({ loopThresholdWarn: NaN });
    expect(options.loopThresholdWarn).toBe(D.loopThresholdWarn);
  });

  test("string threshold value is parsed", () => {
    const { options } = normalizeOptions({ loopThresholdWarn: "7" });
    expect(options.loopThresholdWarn).toBe(7);
  });

  test("non-numeric string threshold → uses default", () => {
    const { options } = normalizeOptions({ loopThresholdWarn: "not-a-number" });
    expect(options.loopThresholdWarn).toBe(D.loopThresholdWarn);
  });

  test("logRotationBytes below 1024 is clamped to 1024", () => {
    const { options, notes } = normalizeOptions({ logRotationBytes: 500 });
    expect(options.logRotationBytes).toBe(1024);
    expect(notes).toContain("logRotationBytes 500 clamped to 1024 (minimum)");
  });

  test("custom logDir and stateDir are preserved", () => {
    const { options } = normalizeOptions({ logDir: path.join(os.tmpdir(), "my-logs"), stateDir: path.join(os.tmpdir(), "my-state") });
    expect(options.logDir).toBe(path.join(os.tmpdir(), "my-logs"));
    expect(options.stateDir).toBe(path.join(os.tmpdir(), "my-state"));
  });
});

// ── findSecretDirMatch ───────────────────────────────────────────────────────

describe("findSecretDirMatch", () => {
  const home = process.env.HOME ?? "/home/test";

  test("returns null for safe paths", () => {
    expect(findSecretDirMatch(path.join(os.tmpdir(), "foo"))).toBeNull();
    expect(findSecretDirMatch("/home/user/project")).toBeNull();
  });

  test("returns null for paths that are prefix siblings", () => {
    // ~/.ssh-foo is NOT ~/.ssh
    expect(findSecretDirMatch(`${home}/.ssh-foo`)).toBeNull();
    expect(findSecretDirMatch(`${home}/.ssh-foo/bar`)).toBeNull();
  });

  test("returns the secret kind for exact secret dir", () => {
    expect(findSecretDirMatch(`${home}/.ssh`)).toBe("~/.ssh");
    expect(findSecretDirMatch(`${home}/.gnupg`)).toBe("~/.gnupg");
    expect(findSecretDirMatch(`${home}/.aws`)).toBe("~/.aws");
    expect(findSecretDirMatch(`${home}/.kube`)).toBe("~/.kube");
  });

  test("returns the secret kind for descendant paths", () => {
    expect(findSecretDirMatch(`${home}/.ssh/keys`)).toBe("~/.ssh");
    expect(findSecretDirMatch(`${home}/.ssh/keys/id_rsa`)).toBe("~/.ssh");
    expect(findSecretDirMatch(`${home}/.gnupg/private`)).toBe("~/.gnupg");
    expect(findSecretDirMatch(`${home}/.aws/credentials`)).toBe("~/.aws");
    expect(findSecretDirMatch(`${home}/.kube/config`)).toBe("~/.kube");
  });

  test("tilde paths are expanded before comparison", () => {
    expect(findSecretDirMatch("~/.ssh")).toBe("~/.ssh");
    expect(findSecretDirMatch("~/.ssh/id_rsa")).toBe("~/.ssh");
    expect(findSecretDirMatch("~/some-other-dir")).toBeNull();
  });

  test("refuses paths inside secret dir", () => {
    expect(findSecretDirMatch(`${home}/.ssh/../ssh`)).toBeNull(); // resolves outside
    expect(findSecretDirMatch(`${home}/.ssh/../.ssh/legit`)).toBe("~/.ssh"); // resolves to ~/.ssh
  });
});

// ── findOffendingPath ────────────────────────────────────────────────────────

describe("findOffendingPath", () => {
  test("returns null when both paths are safe", () => {
    const opts: NormalizedOptions = {
      ...D,
      logDir: path.join(os.tmpdir(), "bizar-logs"),
      stateDir: path.join(os.tmpdir(), "bizar-state"),
    };
    expect(findOffendingPath(opts)).toBeNull();
  });

  test("returns offending logDir when it is inside a secret dir", () => {
    const home = process.env.HOME ?? "/home/test";
    const opts: NormalizedOptions = {
      ...D,
      logDir: `${home}/.ssh/evil`,
      stateDir: path.join(os.tmpdir(), "bizar-state"),
    };
    const result = findOffendingPath(opts);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("~/.ssh");
    expect(result!.path).toContain(".ssh");
  });

  test("returns offending stateDir when it is inside a secret dir", () => {
    const home = process.env.HOME ?? "/home/test";
    const opts: NormalizedOptions = {
      ...D,
      logDir: path.join(os.tmpdir(), "bizar-logs"),
      stateDir: `${home}/.aws/creds`,
    };
    const result = findOffendingPath(opts);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("~/.aws");
  });

  test("logDir takes priority over stateDir in error message", () => {
    const home = process.env.HOME ?? "/home/test";
    const opts: NormalizedOptions = {
      ...D,
      logDir: `${home}/.ssh/evil`,
      stateDir: `${home}/.gnupg/evil`,
    };
    const result = findOffendingPath(opts);
    // logDir is checked first
    expect(result!.kind).toBe("~/.ssh");
  });
});

// ── readEnvFlags ─────────────────────────────────────────────────────────────

describe("readEnvFlags", () => {
  test("returns all false when env vars are not set", () => {
    delete process.env.BIZAR_DISABLE;
    delete process.env.BIZAR_DISABLE_LOOP;
    delete process.env.BIZAR_DISABLE_LOG;
    const flags = readEnvFlags();
    expect(flags.disable).toBe(false);
    expect(flags.disableLoop).toBe(false);
    expect(flags.disableLog).toBe(false);
  });

  test("BIZAR_DISABLE=1 sets disable=true", () => {
    process.env.BIZAR_DISABLE = "1";
    const flags = readEnvFlags();
    expect(flags.disable).toBe(true);
    delete process.env.BIZAR_DISABLE;
  });

  test("BIZAR_DISABLE_LOOP=1 sets disableLoop=true", () => {
    process.env.BIZAR_DISABLE_LOOP = "1";
    const flags = readEnvFlags();
    expect(flags.disableLoop).toBe(true);
    delete process.env.BIZAR_DISABLE_LOOP;
  });

  test("BIZAR_DISABLE_LOG=1 sets disableLog=true", () => {
    process.env.BIZAR_DISABLE_LOG = "1";
    const flags = readEnvFlags();
    expect(flags.disableLog).toBe(true);
    delete process.env.BIZAR_DISABLE_LOG;
  });

  test("non-1 values are treated as false", () => {
    process.env.BIZAR_DISABLE = "true";
    process.env.BIZAR_DISABLE_LOOP = "yes";
    process.env.BIZAR_DISABLE_LOG = "0";
    const flags = readEnvFlags();
    expect(flags.disable).toBe(false);
    expect(flags.disableLoop).toBe(false);
    expect(flags.disableLog).toBe(false);
    delete process.env.BIZAR_DISABLE;
    delete process.env.BIZAR_DISABLE_LOOP;
    delete process.env.BIZAR_DISABLE_LOG;
  });
});
