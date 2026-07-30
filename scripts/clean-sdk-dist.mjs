#!/usr/bin/env node

import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

rmSync(resolve(import.meta.dirname, '..', 'packages', 'sdk', 'dist'), {
  recursive: true,
  force: true,
});
