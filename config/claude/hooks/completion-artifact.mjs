#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveGlobalArtifactsDir } from '../../../cli/config-paths.mjs';
import { readArtifactSetting } from '../../../cli/commands/artifact.mjs';

export const COMPLETE_MARKER = '<!-- bizar:complete -->';
const MAX_MESSAGE = 24_000;

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function defaultOpen(path) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', path] : [path];
  const child = spawn(command, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export function createCompletionArtifact(input, options = {}) {
  const env = options.env || process.env;
  const cwd = String(input?.cwd || process.cwd());
  const message = String(input?.last_assistant_message || '');
  if (!message.includes(COMPLETE_MARKER)) return { created: false, reason: 'not-complete' };
  if (!readArtifactSetting({ env, cwd }).enabled) return { created: false, reason: 'disabled' };
  const clean = message.replaceAll(COMPLETE_MARKER, '').trim().slice(0, MAX_MESSAGE);
  const dir = resolveGlobalArtifactsDir({ env, cwd });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = (options.now || new Date()).toISOString().replace(/[:.]/g, '-');
  const session = String(input?.session_id || 'session').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'session';
  const path = join(dir, `${stamp}-${session}.html`);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Bizar completion</title><style>body{font:16px/1.55 system-ui;max-width:920px;margin:40px auto;padding:0 24px;color:#171717}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:20px;border-radius:12px}small{color:#666}</style></head><body><h1>Work completed</h1><small>${escapeHtml(cwd)}</small><pre>${escapeHtml(clean)}</pre></body></html>`;
  writeFileSync(path, html, { mode: 0o600 });
  (options.open || defaultOpen)(path);
  return { created: true, path };
}

export function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => { raw += chunk; });
  process.stdin.on('end', () => {
    let input = {};
    try { input = JSON.parse(raw || '{}'); } catch { input = {}; }
    try { createCompletionArtifact(input); } catch (error) { process.stderr.write(`completion-artifact: ${error.message}\n`); }
    process.stdout.write('{}\n');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
