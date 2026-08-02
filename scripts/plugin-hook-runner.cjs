#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const eventName = process.argv[2];
if (!eventName || !/^[a-z][a-z0-9-]*$/.test(eventName)) {
  process.stderr.write('Usage: plugin-hook-runner.cjs <event>\n');
  process.exitCode = 64;
} else {
  const pluginRoot = resolve(process.env.CLAUDE_PLUGIN_ROOT || __dirname, process.env.CLAUDE_PLUGIN_ROOT ? '.' : '..');
  const cli = resolve(pluginRoot, 'cli', 'bin.mjs');
  const result = spawnSync(process.execPath, [cli, 'hook', eventName], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) {
    process.stderr.write(`${result.error.message}\n`);
    process.exitCode = 1;
  } else if (result.signal) {
    process.kill(process.pid, result.signal);
  } else {
    process.exitCode = Number.isInteger(result.status) ? result.status : 1;
  }
}
