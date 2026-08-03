#!/usr/bin/env node
// `bizar picker-proxy start` — spawn the 9router picker proxy in the foreground.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sub = process.argv[2];
if (sub === "start") {
  const here = dirname(fileURLToPath(import.meta.url));
  const child = spawn(process.execPath, [join(here, "9router-picker-proxy.mjs")], { stdio: "inherit" });
  child.on("exit", (code) => process.exit(code ?? 1));
  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));
} else {
  console.error("usage: bizar picker-proxy start");
  process.exit(2);
}
