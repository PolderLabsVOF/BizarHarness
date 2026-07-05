/**
 * bundle-analysis.test.mjs
 *
 * Regression test to track dashboard bundle sizes and enforce that the
 * mobile entry chunk stays under control.
 *
 * The mobile entry point (mobile.html → assets/mobile-*.js) is a
 * separate Vite chunk from the desktop entry (index.html → assets/main-*.js).
 * The desktop entry statically imports both App and MobileApp; the mobile
 * entry imports only MobileApp — so the two chunks have different
 * chunking characteristics.
 *
 * We track the primary mobile chunk (largest mobile-*.js, > 10 KB) and
 * ensure neither bundle exceeds its documented cap.  The QR-code library
 * (qrcode.react) lives in a separate lazy chunk (index-*.js) and is NOT
 * counted against the mobile bundle cap.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const dist = join(__dirname, '..', 'dist', 'assets');

function findLargestAsset(prefix) {
  const files = readdirSync(dist)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.js'))
    .map((f) => ({ file: f, path: join(dist, f), size: readFileSync(join(dist, f)).length }))
    .filter((f) => f.size > 10 * 1024); // exclude tiny entry wrappers
  if (files.length === 0) throw new Error(`No asset found starting with "${prefix}" in dist/assets`);
  return files.sort((a, b) => b.size - a.size)[0];
}

function kbytes(path) {
  return readFileSync(path).length / 1024;
}

// v5.0 targets:
// - mobile.js < desktop.js (must be smaller — mobile has no App.tsx deduplication)
// - mobile.js < 120 KB (was 141 KB in v5.0.2; mobile-specific lazy views + fine vendor chunks)
// - desktop.js < 400 KB (was 404 KB in v5.0.2; fine vendor chunks shifted some bytes to desktop
//   but overall vendor bytes are better distributed — 380 KB is the stretch goal)
const DESKTOP_MAX_KB = 400;
const MOBILE_MAX_KB  = 120;

const desktop = findLargestAsset('main-');
const mobile  = findLargestAsset('mobile-');

const dk = kbytes(desktop.path);
const mk = kbytes(mobile.path);

console.log(`desktop bundle : ${dk.toFixed(1)} KB  (${desktop.file})`);
console.log(`mobile bundle  : ${mk.toFixed(1)} KB  (${mobile.file})`);

// Check caps
if (dk > DESKTOP_MAX_KB) {
  console.error(`FAIL: desktop bundle (${dk.toFixed(1)} KB) exceeds cap ${DESKTOP_MAX_KB} KB`);
  process.exit(1);
}
if (mk > MOBILE_MAX_KB) {
  console.error(`FAIL: mobile bundle (${mk.toFixed(1)} KB) exceeds cap ${MOBILE_MAX_KB} KB`);
  process.exit(1);
}

// Dominance rule: mobile users should not pay more per initial load than desktop.
// The desktop entry (index.html) includes both App and MobileApp in its main chunk;
// the mobile entry (mobile.html) loads only MobileApp.  If mobile ≥ desktop here
// it means the chunking ratio has inverted and warrants investigation.
if (mk >= dk) {
  console.error(`FAIL: mobile (${mk.toFixed(1)} KB) is not smaller than desktop (${dk.toFixed(1)} KB)`);
  process.exit(1);
}

console.log(`PASS: mobile (${mk.toFixed(1)} KB) < desktop (${dk.toFixed(1)} KB)`);
