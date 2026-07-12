/*
 * tokens.ts — TypeScript mirror of the CSS variables in tokens.css.
 *
 * Each constant is a `var(--…)` reference so React code (chart configs,
 * inline style props, dynamic SVG fills, etc.) can stay typed end-to-end
 * without duplicating hex strings. Naming matches the CSS var name with
 * dashes replaced by camelCase (e.g. `--surface-0` → `surface0`).
 *
 * Synchronisation rule: when adding or renaming a token, update BOTH this
 * file and `tokens.css` in the same commit. The `as const` assertion
 * generates the union types below so consumers get autocompletion.
 */

export const colorTokens = {
  // surfaces
  surface0: 'var(--surface-0)',
  surface1: 'var(--surface-1)',
  surface2: 'var(--surface-2)',
  surface3: 'var(--surface-3)',
  surfaceOverlay: 'var(--surface-overlay)',
  // text
  textPrimary: 'var(--text-primary)',
  textSecondary: 'var(--text-secondary)',
  textTertiary: 'var(--text-tertiary)',
  textInverse: 'var(--text-inverse)',
  textDisabled: 'var(--text-disabled)',
  // borders
  borderSubtle: 'var(--border-subtle)',
  borderDefault: 'var(--border-default)',
  borderStrong: 'var(--border-strong)',
  borderFocus: 'var(--border-focus)',
  // accent
  accent: 'var(--accent)',
  accentHover: 'var(--accent-hover)',
  accentActive: 'var(--accent-active)',
  accentFg: 'var(--accent-fg)',
  accentSubtle: 'var(--accent-subtle)',
  // semantic
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)',
  successSubtle: 'var(--success-subtle)',
  warningSubtle: 'var(--warning-subtle)',
  dangerSubtle: 'var(--danger-subtle)',
  infoSubtle: 'var(--info-subtle)',
  // chart series
  chart1: 'var(--chart-1)',
  chart2: 'var(--chart-2)',
  chart3: 'var(--chart-3)',
  chart4: 'var(--chart-4)',
  chart5: 'var(--chart-5)',
  chart6: 'var(--chart-6)',
  chart7: 'var(--chart-7)',
  chart8: 'var(--chart-8)',
  chart9: 'var(--chart-9)',
  chart10: 'var(--chart-10)',
} as const;

export const spaceTokens = {
  space0: 'var(--space-0)',
  space1: 'var(--space-1)',
  space2: 'var(--space-2)',
  space3: 'var(--space-3)',
  space4: 'var(--space-4)',
  space5: 'var(--space-5)',
  space6: 'var(--space-6)',
  space7: 'var(--space-7)',
  space8: 'var(--space-8)',
  space9: 'var(--space-9)',
  space10: 'var(--space-10)',
  space11: 'var(--space-11)',
  space12: 'var(--space-12)',
} as const;

export const radiusTokens = {
  radiusNone: 'var(--radius-none)',
  radiusSm: 'var(--radius-sm)',
  radiusMd: 'var(--radius-md)',
  radiusLg: 'var(--radius-lg)',
  radiusFull: 'var(--radius-full)',
} as const;

export const fontSizeTokens = {
  textXs: 'var(--text-xs)',
  textSm: 'var(--text-sm)',
  textBase: 'var(--text-base)',
  textMd: 'var(--text-md)',
  textLg: 'var(--text-lg)',
  textXl: 'var(--text-xl)',
  text2xl: 'var(--text-2xl)',
  text3xl: 'var(--text-3xl)',
} as const;

export const fontFamilyTokens = {
  fontSans: 'var(--font-sans)',
  fontMono: 'var(--font-mono)',
} as const;

export const shadowTokens = {
  shadowNone: 'var(--shadow-none)',
  shadowHairline: 'var(--shadow-hairline)',
  shadowOverlay: 'var(--shadow-overlay)',
  shadowTooltip: 'var(--shadow-tooltip)',
} as const;

export const zIndexTokens = {
  zBase: 'var(--z-base)',
  zDropdown: 'var(--z-dropdown)',
  zSticky: 'var(--z-sticky)',
  zOverlay: 'var(--z-overlay)',
  zModal: 'var(--z-modal)',
  zPopover: 'var(--z-popover)',
  zTooltip: 'var(--z-tooltip)',
  zToast: 'var(--z-toast)',
} as const;

export const layoutTokens = {
  layoutSidebarWidth: 'var(--layout-sidebar-width)',
  layoutTopbarHeight: 'var(--layout-topbar-height)',
  layoutContentMax: 'var(--layout-content-max)',
} as const;

export type ColorToken = keyof typeof colorTokens;
export type SpaceToken = keyof typeof spaceTokens;
export type RadiusToken = keyof typeof radiusTokens;
export type FontSizeToken = keyof typeof fontSizeTokens;
export type FontFamilyToken = keyof typeof fontFamilyTokens;
export type ShadowToken = keyof typeof shadowTokens;
export type ZIndexToken = keyof typeof zIndexTokens;
export type LayoutToken = keyof typeof layoutTokens;
