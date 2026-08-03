#!/usr/bin/env node
// `bizar worktree-merge <branch>` — merge a feature branch into the current
// branch with guaranteed artifact preservation. Tags the source branch tip
// as `merge-archive/<branch>-<sha>` before merge, so parallel pipeline work
// is never lost on conflict resolution. `git merge --no-ff` keeps the merge
// topology visible in `git log --graph`.

import { spawnSync } from "node:child_process";

const branch = process.argv[2];
if (!branch) {
  console.error("usage: bizar worktree-merge <branch>");
  process.exit(2);
}

const tip = spawnSync("git", ["rev-parse", branch], { encoding: "utf8" });
if (tip.status !== 0) {
  console.error(tip.stderr || tip.stdout);
  process.exit(1);
}
const sha = tip.stdout.trim();
const safe = branch.replace(/[^a-zA-Z0-9._-]/g, "-");
const tag = `merge-archive/${safe}-${sha.slice(0, 7)}`;
const tagged = spawnSync("git", ["tag", tag, sha], { encoding: "utf8", stdio: "inherit" });
if (tagged.status !== 0) process.exit(tagged.status ?? 1);

const m = spawnSync(
  "git",
  ["merge", "--no-ff", branch, "-m", `merge: ${branch} into current branch`],
  { encoding: "utf8", stdio: "inherit" },
);
process.exit(m.status ?? 1);
