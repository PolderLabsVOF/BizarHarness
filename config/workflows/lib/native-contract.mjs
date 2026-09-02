import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const META_PREFIX = 'export const meta =';

function firstStatement(source) {
  return String(source).replace(/^\uFEFF/, '').trimStart();
}

function workflowParts(source) {
  const normalized = firstStatement(source);
  if (!normalized.startsWith(META_PREFIX)) {
    throw new Error('`export const meta = { name, description, phases }` must be the FIRST statement in the script');
  }

  const open = normalized.indexOf('{', META_PREFIX.length);
  if (open < 0) throw new Error('meta must be a pure object literal');

  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let index = open; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quote) {
      if (character === '\\') escaped = true;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{') depth += 1;
    if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          block: normalized.slice(open, index + 1),
          body: normalized.slice(index + 1).replace(/^\s*;?/, ''),
        };
      }
    }
  }
  throw new Error('meta object literal is not balanced');
}

export function inspectNativeWorkflowSource(source, { expectedName } = {}) {
  const { block, body } = workflowParts(source);
  const name = block.match(/\bname\s*:\s*(['"])([^'"\r\n]+)\1/)?.[2];
  if (!name) throw new Error('meta.name must be a non-empty string literal');
  if (!/\bdescription\s*:\s*(['"])[^'"\r\n]+\1/.test(block)) {
    throw new Error('meta.description must be a non-empty string literal');
  }
  if (!/\bphases\s*:\s*\[/.test(block)) throw new Error('meta.phases must be an array literal');
  if (expectedName && name !== expectedName) {
    throw new Error(`meta.name ${JSON.stringify(name)} does not match filename ${JSON.stringify(expectedName)}`);
  }
  if (/^\s*import\s/m.test(body) || /\bimport\s*\(/.test(body)) {
    throw new Error('workflow body must be self-contained; imports are unavailable');
  }
  try {
    Function(`return (async () => { 'use strict';\n${body}\n});`);
  } catch (error) {
    throw new Error(`workflow body does not compile: ${error.message}`);
  }
  return { name };
}

export function validateNativeWorkflowFile(path) {
  const expectedName = basename(path, '.js');
  try {
    return inspectNativeWorkflowSource(readFileSync(path, 'utf8'), { expectedName });
  } catch (error) {
    throw new Error(`${path}: ${error.message}`);
  }
}

export function validateNativeWorkflowDirectory(directory) {
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(directory, entry.name))
    .sort();
  if (files.length === 0) throw new Error(`${directory}: no workflow scripts found`);

  const names = new Set();
  for (const file of files) {
    const { name } = validateNativeWorkflowFile(file);
    if (names.has(name)) throw new Error(`${file}: duplicate workflow name ${JSON.stringify(name)}`);
    names.add(name);
  }
  return { count: files.length, names: [...names] };
}
