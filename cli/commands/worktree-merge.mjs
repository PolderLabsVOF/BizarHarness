#!/usr/bin/env node
// `bizar worktree-merge <branch>`           — merge a single feature branch.
// `bizar worktree-merge --all`              — merge every wt/* branch in
//                                             deterministic dependency order.
// `bizar worktree-merge --all --order a,b`  — explicit override of the order.
// `bizar worktree-merge --all --dry-run`    — print the plan, do not execute.
// `bizar worktree-merge --all --keep-branch`— keep source branch after merge.
// `bizar worktree-merge --all --json`       — machine-readable plan/result.
//
// The single-branch path is the primitive that `bizar worktree-merge --all`
// calls once per branch. Both paths share the same archive-tag discipline:
// the source branch tip is tagged as `merge-archive/<branch>-<sha>` BEFORE
// the merge runs, so parallel pipeline work is never lost on conflict
// resolution. `git merge --no-ff` keeps the merge topology visible in
// `git log --graph`.

import { spawnSync } from "node:child_process";

const argv = process.argv.slice(2);

function parseArgs(args) {
  const flags = {
    all: false,
    order: null,
    dryRun: false,
    keepBranch: false,
    json: false,
    help: false,
    branch: null,
  };
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--all") flags.all = true;
    else if (arg === "--help" || arg === "-h") flags.help = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--keep-branch") flags.keepBranch = true;
    else if (arg === "--json") flags.json = true;
    else if (arg === "--order") {
      const next = args[i + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("flag --order requires a comma-separated branch list");
      }
      flags.order = next.split(",").map((s) => s.trim()).filter(Boolean);
      i += 1;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown flag: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) flags.branch = positional[0];
  return flags;
}

function usage() {
  const text = [
    "usage: bizar worktree-merge <branch>            merge a single branch (archive tag + --no-ff)",
    "   or: bizar worktree-merge --all                merge every wt/* branch in deterministic order",
    "      bizar worktree-merge --all --order a,b,c  explicit merge order (overrides default)",
    "      bizar worktree-merge --all --dry-run      print plan, do not mutate git",
    "      bizar worktree-merge --all --keep-branch  keep source branch after merge",
    "      bizar worktree-merge --all --json         emit a JSON plan + result envelope",
  ].join("\n");
  return text;
}

function emitJson(payload, status = 0) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(status);
}

function runGit(args, opts = {}) {
  const result = spawnSync("git", args, {
    encoding: "utf8",
    stdio: opts.stdio ?? "pipe",
    ...opts,
  });
  if (result.status !== 0 && !opts.allowFailure) {
    const stderr = result.stderr || result.stdout || `git ${args.join(" ")} failed`;
    throw new Error(stderr.trim());
  }
  return result;
}

function listWorktreeBranches() {
  const result = runGit([
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
  ]);
  return result.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter((name) => /^wt\//.test(name));
}

function defaultOrder(branches) {
  // Deterministic dependency order: lexicographic ascending by branch name.
  // The lowest-suffix branch merges first so conflicts surface before
  // dependent work piles up. An orchestrator can override with --order.
  return [...branches].sort();
}

function resolveOrder(flags, branches) {
  if (!flags.order) return defaultOrder(branches);
  const known = new Set(branches);
  const missing = flags.order.filter((b) => !known.has(b));
  if (missing.length > 0) {
    throw new Error(
      `--order referenced unknown branches: ${missing.join(", ")}; available: ${branches.join(", ")}`,
    );
  }
  return [...flags.order];
}

function archiveTag(branch) {
  const tip = runGit(["rev-parse", branch]);
  const sha = tip.stdout.trim();
  const safe = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  const tag = `merge-archive/${safe}-${sha.slice(0, 7)}`;
  runGit(["tag", tag, sha], { stdio: "inherit" });
  return { sha, tag };
}

function mergeSingleBranch(branch, { keepBranch }) {
  const { sha, tag } = archiveTag(branch);
  const merge = spawnSync(
    "git",
    ["merge", "--no-ff", branch, "-m", `merge: ${branch} into current branch`],
    { encoding: "utf8", stdio: "inherit" },
  );
  if (merge.status !== 0) {
    return {
      branch,
      sha,
      tag,
      merged: false,
      conflictReport: (merge.stderr || merge.stdout || "").trim(),
      exitStatus: merge.status ?? 1,
    };
  }
  const cleanup = cleanupWorktree(branch);
  if (!keepBranch) {
    runGit(["branch", "-D", branch], { stdio: "inherit" });
  }
  return {
    branch,
    sha,
    tag,
    merged: true,
    cleanup,
    branchDeleted: !keepBranch,
  };
}

function cleanupWorktree(branch) {
  // Find the worktree path that points at this branch.
  const list = runGit(["worktree", "list", "--porcelain"]);
  const blocks = list.stdout.split(/\n(?=worktree )/);
  let removed = false;
  for (const block of blocks) {
    const pathMatch = /^worktree (.+)$/m.exec(block);
    const branchMatch = /^branch refs\/heads\/(.+)$/m.exec(block);
    if (!pathMatch || !branchMatch) continue;
    if (branchMatch[1] !== branch) continue;
    const wtPath = pathMatch[1].trim();
    const remove = spawnSync("git", ["worktree", "remove", wtPath, "--force"], {
      encoding: "utf8",
      stdio: "pipe",
    });
    if (remove.status === 0) {
      removed = true;
    } else {
      // Fall back to prune; the directory may have been cleaned up
      // manually. This is advisory and never fatal for the merge.
      spawnSync("git", ["worktree", "prune"], {
        encoding: "utf8",
        stdio: "pipe",
      });
    }
  }
  if (!removed) {
    spawnSync("git", ["worktree", "prune"], {
      encoding: "utf8",
      stdio: "pipe",
    });
  }
  return { removed };
}

function planMerge(order, flags) {
  return order.map((branch) => {
    const tip = runGit(["rev-parse", branch]);
    const sha = tip.stdout.trim();
    const safe = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
    const tag = `merge-archive/${safe}-${sha.slice(0, 7)}`;
    return { branch, sha, tag, keepBranch: flags.keepBranch };
  });
}

async function main() {
  let flags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    console.error(usage());
    process.exit(2);
  }

  if (flags.help) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  if (!flags.all && !flags.branch) {
    // Either the user asked for --all alone (handled below) or for a
    // single branch (handled last). When neither is given, error out
    // with usage.
    if (flags.dryRun || flags.order || flags.keepBranch || flags.json) {
      console.error("flag is only valid with --all");
      console.error(usage());
      process.exit(2);
    }
    console.error(usage());
    process.exit(2);
  }

  if (flags.all) {
    const branches = listWorktreeBranches();
    if (branches.length === 0) {
      const msg = "no wt/* branches to merge";
      if (flags.json) emitJson({ status: "noop", branches: [], results: [] });
      console.log(msg);
      process.exit(0);
    }
    const order = resolveOrder(flags, branches);
    const plan = planMerge(order, flags);

    if (flags.dryRun) {
      if (flags.json) {
        emitJson({ status: "plan", plan, branchCount: plan.length });
      }
      console.log(`Plan: merge ${plan.length} branch(es) in this order`);
      for (const step of plan) {
        console.log(`  ${step.branch} -> tag ${step.tag} (sha ${step.sha.slice(0, 7)})`);
      }
      process.exit(0);
    }

    if (flags.json) {
      // Emit plan first so callers see the order even on partial failure.
      process.stdout.write(`${JSON.stringify({ status: "executing", plan })}\n`);
    } else {
      console.log(`Merging ${plan.length} branch(es) in order:`);
      for (const step of plan) console.log(`  - ${step.branch}`);
    }

    const results = [];
    let firstFailure = null;
    for (const branch of order) {
      const result = mergeSingleBranch(branch, flags);
      results.push(result);
      if (!result.merged) {
        firstFailure = result;
        break;
      }
    }

    if (firstFailure) {
      const report = {
        status: "conflict",
        stoppedAt: firstFailure.branch,
        results,
        conflictReport: firstFailure.conflictReport,
      };
      if (flags.json) emitJson(report, 1);
      console.error(`\nMerge conflict in ${firstFailure.branch}; aborting sequencer.`);
      console.error(firstFailure.conflictReport);
      console.error(
        `\nResolve the conflict, then re-run \`bizar worktree-merge ${firstFailure.branch}\` and \`bizar worktree-merge --all\` to continue.`,
      );
      process.exit(1);
    }

    const summary = {
      status: "merged",
      plan,
      results,
    };
    if (flags.json) emitJson(summary, 0);
    console.log(`\nMerged ${results.length} branch(es).`);
    process.exit(0);
  }

  // Single-branch path.
  const branch = flags.branch;
  const tip = runGit(["rev-parse", branch]);
  const sha = tip.stdout.trim();
  const safe = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
  const tag = `merge-archive/${safe}-${sha.slice(0, 7)}`;
  runGit(["tag", tag, sha], { stdio: "inherit" });
  const m = spawnSync(
    "git",
    ["merge", "--no-ff", branch, "-m", `merge: ${branch} into current branch`],
    { encoding: "utf8", stdio: "inherit" },
  );
  process.exit(m.status ?? 1);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
