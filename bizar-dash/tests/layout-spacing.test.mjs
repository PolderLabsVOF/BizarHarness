/**
 * tests/layout-spacing.test.mjs
 *
 * v4.x.x — Smoke test for page-level CSS spacing.
 * Parses main.css and verifies the .view class has sufficient top padding
 * so content isn't squished against the topbar.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(
  resolve(import.meta.dirname, '../src/web/styles/main.css'),
  'utf8',
);

// Extract the .view rule's padding value.
// Handles both `padding: 24px` (shorthand) and `padding: var(--space-6)` (CSS variable).
// We extract the first token (top padding) and resolve CSS var to its px value.
const viewPaddingMatch = css.match(/\.view\s*\{[^}]*padding:\s*([^;]+)(?:\s|;)/);
if (!viewPaddingMatch) throw new Error('Could not find .view { padding: ... } in main.css');

// The padding shorthand may be "var(--space-6) var(--space-6) 0" (top right bottom).
// We split by whitespace and resolve the first token.
const paddingTokens = viewPaddingMatch[1].trim().split(/\s+/);
const paddingValue = paddingTokens[0];
// CSS var: var(--space-6) = 24px, var(--space-4) = 16px, var(--space-3) = 12px
const CSS_VAR_MAP = {
  'var(--space-1)': 4,
  'var(--space-2)': 8,
  'var(--space-3)': 12,
  'var(--space-4)': 16,
  'var(--space-5)': 20,
  'var(--space-6)': 24,
  'var(--space-8)': 32,
};

let paddingNum;
if (paddingValue.startsWith('var(')) {
  paddingNum = CSS_VAR_MAP[paddingValue] ?? NaN;
} else {
  paddingNum = parseInt(paddingValue, 10);
}
if (isNaN(paddingNum)) throw new Error(`Unexpected padding value: "${paddingValue}"`);

const MIN_PADDING = 16;
if (paddingNum < MIN_PADDING) {
  throw new Error(
    `.view padding-top too small: ${paddingNum}px (expected >= ${MIN_PADDING}px). ` +
    `Content will be squished against the topbar.`,
  );
}

console.log(`✓ .view padding-top: ${paddingNum}px (minimum: ${MIN_PADDING}px)`);

// Also verify .bg-active-view has adequate top padding
const bgMatch = css.match(/\.bg-active-view\s*\{[^}]*padding:\s*([^;]+)(?:\s|;)/);
if (bgMatch) {
  const bgTokens = bgMatch[1].trim().split(/\s+/);
  const bgVal = bgTokens[0];
  let bgPadding;
  if (bgVal.startsWith('var(')) {
    bgPadding = CSS_VAR_MAP[bgVal] ?? NaN;
  } else {
    bgPadding = parseInt(bgVal, 10);
  }
  if (!isNaN(bgPadding) && bgPadding < MIN_PADDING) {
    throw new Error(
      `.bg-active-view padding-top too small: ${bgPadding}px (expected >= ${MIN_PADDING}px)`,
    );
  }
  if (!isNaN(bgPadding)) console.log(`✓ .bg-active-view padding-top: ${bgPadding}px`);
}

// Verify .view gap is at least 16px
const gapMatch = css.match(/\.view\s*\{[^}]*gap:\s*([^;]+)(?:\s|;)/);
if (gapMatch) {
  const gapVal = gapMatch[1].trim();
  let gapNum;
  if (gapVal.startsWith('var(')) {
    gapNum = CSS_VAR_MAP[gapVal] ?? NaN;
  } else {
    gapNum = parseInt(gapVal, 10);
  }
  const MIN_GAP = 16;
  if (!isNaN(gapNum) && gapNum < MIN_GAP) {
    throw new Error(`.view gap too small: ${gapNum}px (expected >= ${MIN_GAP}px)`);
  }
  if (!isNaN(gapNum)) console.log(`✓ .view gap: ${gapNum}px`);
}

// Verify .page-header exists (margin-bottom for spacing below page headers)
if (!css.includes('.page-header')) {
  throw new Error('.page-header not found in main.css — page header spacing missing');
}
console.log('✓ .page-header rule present');

// Verify .card + .card rule for sibling card spacing
if (!css.includes('.card + .card')) {
  throw new Error('.card + .card sibling rule not found — card spacing may be cramped');
}
console.log('✓ .card + .card sibling rule present');
