#!/usr/bin/env node

import { runInstaller, runPostInstall } from './install.mjs';

const args = process.argv.slice(2);

if (args.includes('--postinstall')) {
  await runPostInstall();
} else if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  BizarHarness — Norse Pantheon Agent System for opencode

  Usage:
    bizarharness           Run interactive installer
    bizarharness --help    Show this help
    npm install -g bizarharness   Install globally, then run 'bizarharness'
    npx bizarharness       Run without installing
  `);
} else {
  await runInstaller();
}
