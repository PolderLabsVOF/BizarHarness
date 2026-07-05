/**
 * bizar-dash/tests/docker-build.test.mjs
 *
 * v4.9.0 — Validate Docker deployment configuration files.
 *
 * Checks:
 *   - Dockerfile exists and has valid syntax (FROM, CMD/ENTRYPOINT, EXPOSE, HEALTHCHECK)
 *   - docker-compose.yml exists with bizar-dash service and ports
 *   - .dockerignore exists
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

const DOCKERFILE = join(ROOT, 'Dockerfile');
const COMPOSE_FILE = join(ROOT, 'docker-compose.yml');
const DOCKERIGNORE = join(ROOT, '.dockerignore');

// ── Dockerfile ──────────────────────────────────────────────────────────────

test('Dockerfile exists at root', () => {
  assert.ok(existsSync(DOCKERFILE), 'Dockerfile should exist at project root');
});

test('Dockerfile has FROM instruction', () => {
  const content = readFileSync(DOCKERFILE, 'utf8');
  assert.match(content, /^FROM\s+\S+/m, 'Dockerfile must contain a FROM instruction');
});

test('Dockerfile has CMD or ENTRYPOINT', () => {
  const content = readFileSync(DOCKERFILE, 'utf8');
  assert.ok(
    /^(CMD|ENTRYPOINT)\s+/m.test(content),
    'Dockerfile must have a CMD or ENTRYPOINT instruction',
  );
});

test('Dockerfile exposes at least one port', () => {
  const content = readFileSync(DOCKERFILE, 'utf8');
  assert.match(content, /^EXPOSE\s+\d+/m, 'Dockerfile must expose at least one port');
});

test('Dockerfile has HEALTHCHECK', () => {
  const content = readFileSync(DOCKERFILE, 'utf8');
  assert.match(content, /^HEALTHCHECK\s+/m, 'Dockerfile must have a HEALTHCHECK instruction');
});

test('Dockerfile uses multi-stage build', () => {
  const content = readFileSync(DOCKERFILE, 'utf8');
  const fromCount = content.match(/^FROM\s+\S+/gm);
  assert.ok(fromCount && fromCount.length >= 2, 'Dockerfile must have at least 2 FROM instructions (multi-stage)');
});

// ── docker-compose.yml ──────────────────────────────────────────────────────

test('docker-compose.yml exists at root', () => {
  assert.ok(existsSync(COMPOSE_FILE), 'docker-compose.yml should exist at project root');
});

test('docker-compose.yml has bizar-dash service with build and ports', () => {
  const content = readFileSync(COMPOSE_FILE, 'utf8');
  assert.match(content, /bizar-dash:/, 'docker-compose must define a bizar-dash service');
  assert.match(content, /build:\s*\./, 'bizar-dash service must have build: .');
  assert.match(content, /ports:/, 'bizar-dash service must expose ports');
});

test('docker-compose.yml defines required volumes', () => {
  const content = readFileSync(COMPOSE_FILE, 'utf8');
  assert.match(content, /bizar-config:/, 'Must define bizar-config volume');
  assert.match(content, /bizar-memory:/, 'Must define bizar-memory volume');
  assert.match(content, /bizar-usage:/, 'Must define bizar-usage volume');
  assert.match(content, /bizar-backups:/, 'Must define bizar-backups volume');
});

test('docker-compose.yml has healthcheck', () => {
  const content = readFileSync(COMPOSE_FILE, 'utf8');
  assert.match(content, /healthcheck:/, 'bizar-dash service must have a healthcheck');
});

// ── .dockerignore ───────────────────────────────────────────────────────────

test('.dockerignore exists at root', () => {
  assert.ok(existsSync(DOCKERIGNORE), '.dockerignore should exist at project root');
});

test('.dockerignore excludes node_modules and .git', () => {
  const content = readFileSync(DOCKERIGNORE, 'utf8');
  assert.match(content, /node_modules/, '.dockerignore must exclude node_modules');
  assert.match(content, /\.git/, '.dockerignore must exclude .git');
});
