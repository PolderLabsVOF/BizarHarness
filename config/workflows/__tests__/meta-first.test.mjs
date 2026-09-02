/**
 * config/workflows/__tests__/meta-first.test.mjs — F-198 regression fence.
 *
 * Pins the contract that every shipped workflow script under
 * config/workflows/ (excluding the lib/ subdirectory and the __tests__/
 * subdirectory) MUST begin with `export const meta = {...}` as the very
 * first top-level statement. ES module imports are hoisted regardless of
 * textual position, so the import statements may follow the meta block
 * with no semantic change. This is the grammar the Claude Code Workflow
 * tool requires for named and scriptPath invocation.
 *
 * If you add a new workflow script, this test will surface the requirement
 * automatically — every .js file directly under config/workflows/ (depth=1,
 * excluding lib and __tests__) is scanned.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const workflowsDir = resolve(here, '..')

const EXCLUDE = new Set(['lib', '__tests__'])

// Every direct child .js file in config/workflows/ is a workflow script and
// MUST begin with `export const meta` on line 1.
const scriptPaths = readdirSync(workflowsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
  .map((entry) => join(workflowsDir, entry.name))

test('every workflow script under config/workflows/ exports meta as its first statement', () => {
  assert.ok(scriptPaths.length >= 4, `expected at least 4 workflow scripts, found ${scriptPaths.length}: ${scriptPaths.join(', ')}`)

  for (const scriptPath of scriptPaths) {
    const rel = scriptPath.slice(workflowsDir.length + 1)
    const source = readFileSync(scriptPath, 'utf8')
    const firstLine = source.split('\n', 1)[0]
    assert.match(
      firstLine,
      /^export const meta\b/,
      `${rel}: first line must be \`export const meta = {...}\` (got: ${JSON.stringify(firstLine)})`
    )
  }
})

test('every workflow script keeps its imports somewhere in the body (hoisting check)', () => {
  for (const scriptPath of scriptPaths) {
    const rel = scriptPath.slice(workflowsDir.length + 1)
    const source = readFileSync(scriptPath, 'utf8')
    // Detect at least one `import` statement somewhere in the file.
    // Imports are hoisted regardless of textual position, but they must
    // still be present in the source for static analysis and human readers.
    assert.match(
      source,
      /^import\s+/m,
      `${rel}: no top-level import statement found — every workflow script must import its dependencies`
    )
  }
})

test('workflow discovery directory layout is intact', () => {
  // Both lib/ and __tests__/ must exist; if either is missing the workflow
  // toolchain is broken (lib holds dispatch helpers; __tests__ pins contracts).
  for (const required of EXCLUDE) {
    const path = join(workflowsDir, required)
    assert.ok(statSync(path).isDirectory(), `expected ${required}/ to exist at ${path}`)
  }
})

test('named workflow scripts match their meta.name field (no drift)', () => {
  for (const scriptPath of scriptPaths) {
    const rel = scriptPath.slice(workflowsDir.length + 1)
    const source = readFileSync(scriptPath, 'utf8')
    const nameMatch = source.match(/name:\s*['"]([^'"]+)['"]/)
    assert.ok(nameMatch, `${rel}: meta.name not found`)
    const declared = nameMatch[1]
    const fileBase = rel.replace(/\.js$/, '')
    assert.equal(
      declared,
      fileBase,
      `${rel}: meta.name "${declared}" does not match filename "${fileBase}"`
    )
  }
})
