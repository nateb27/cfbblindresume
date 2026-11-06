/**
 * Design tokens for code that cannot read CSS: build-time OG images (@resvg/resvg-js), the
 * share-image Function (glyph atlas), inline styles. Mirrors src/styles/tokens.css exactly
 * (tests/design-tokens.test.ts enforces it), plus the team-color helpers every surface uses.
 *
 * Pure TypeScript: no DOM, no Node APIs, safe in the browser, Node and Workers.
 */

export type ThemeName = 'dark' | 'light';

/** Semantic colors per theme. Keys match the CSS custom properties `--color-<key>`. */
export interface ThemeColors {
  page: string;
  surface: string;
  raised: string;
  'raised-2': string;
  line: string;
  'line-strong': string;
  control: string;
  track: string;
  fg: string;
  'fg-muted': string;
  'fg-faint': string;
  accent: string;
  'accent-fill': string;
  'on-accent': string;
  'accent-tint': string;
  'accent-edge': string;
  focus: string;
  win: string;
  loss: string;
  'win-tint': string;
  'loss-tint': string;
  'tier-50': string;
  'tier-45': string;
  'tier-40': string;
  'tier-30': string;
  'tier-20': string;
  'tier-15': string;
  'tier-10': string;
  'tier-05': string;
  selection: string;
  'on-selection': string;
}

export const colors: Readonly<Record<ThemeName, Readonly<ThemeColors>>> = Object.freeze({
  dark: Object.freeze({
    page: '#0e0f12',
    surface: '#16181d',
    raised: '#1e2128',
    'raised-2': '#272b33',
    line: '#2a2e36',
    'line-strong': '#3a3f49',
    control: '#7a808a',
    track: '#2b2f37',
    fg: '#ecedee',
    'fg-muted': '#9ba1ab',
    'fg-faint': '#878d97',
    accent: '#c8f135',
    'accent-fill': '#c8f135',
    'on-accent': '#0e0f12',
    'accent-tint': '#333f22',
    'accent-edge': '#c8f135',
    focus: '#c8f135',
    win: '#3dd68c',
    loss: '#ff6b6b',
    'win-tint': '#1b3a2f',
    'loss-tint': '#3e2329',
    'tier-50': '#ffcd34',
    'tier-45': '#f8b23d',
    'tier-40': '#d9a461',
    'tier-30': '#77abd7',
    'tier-20': '#7f96af',
    'tier-15': '#7c8999',
    'tier-10': '#777e87',
    'tier-05': '#717579',
    selection: '#c8f135',
    'on-selection': '#0e0f12',
  }),
  light: Object.freeze({
    page: '#ffffff',
    surface: '#f5f6f8',
    raised: '#ebedf0',
    'raised-2': '#e1e4e8',
    line: '#e1e4e8',
    'line-strong': '#c5cad1',
    control: '#6e7581',
    track: '#e1e4e8',
    fg: '#121317',
    'fg-muted': '#555b66',
    'fg-faint': '#5f6570',
    accent: '#4a6b00',
    'accent-fill': '#c8f135',
    'on-accent': '#0e0f12',
    'accent-tint': '#eef8d4',
    'accent-edge': '#5f8700',
    focus: '#4a6b00',
    win: '#087040',
    loss: '#b91e2a',
    'win-tint': '#e3f3e9',
    'loss-tint': '#fbe7e8',
    'tier-50': '#937900',
    'tier-45': '#b65a00',
    'tier-40': '#8c6b56',
    'tier-30': '#4479a9',
    'tier-20': '#698098',
    'tier-15': '#768392',
    'tier-10': '#7e858e',
    'tier-05': '#84888c',
    selection: '#d9f27a',
    'on-selection': '#0e0f12',
  }),
});

/** Constant inks (theme independent). */
export const INK = '#0e0f12';
export const PAPER = '#ffffff';

/* ------------------------------------------------------------------ opponent tiers */

/** Tier keys as used in `data-tier` and `--color-tier-*`: stars x 10, two digits. */
export type TierKey = '50' | '45' | '40' | '30' | '20' | '15' | '10' | '05';
export const TIER_KEYS: readonly TierKey[] = ['50', '45', '40', '30', '20', '15', '10', '05'];

/**
 * `data-tier` key for a star value from @lib/tiers (`tierFor(...).stars`): 4.5 -> "45", 0.5 -> "05".
 * For a metric bar, pass the stars of the rank band: `tierKey(tierFor({ fbs: true, feiRank: rank }).stars)`.
 */
export function tierKey(stars: number): TierKey {
  const k = String(Math.round(stars * 10)).padStart(2, '0');
  if (!(TIER_KEYS as readonly string[]).includes(k)) throw new RangeError(`tierKey: no tier for ${stars} stars`);
  return k as TierKey;
}

/** Ramp color for a star value, e.g. tierColor(4.5) -> "#f8b23d" (dark). */
export function tierColor(stars: number, theme: ThemeName = 'dark'): string {
  return colors[theme][`tier-${tierKey(stars)}`];
}

/** Resume-strip dot diameter in CSS px for a star value (mirrors [data-tier] in global.css). */
export const TIER_DOT_PX: Readonly<Record<TierKey, number>> = Object.freeze({
  '50': 14, '45': 12, '40': 11, '30': 10, '20': 9, '15': 8, '10': 7, '05': 6,
});

/* ------------------------------------------------------------------ contrast */

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Parse #rgb / #rrggbb. Throws on anything else (data must be valid hex). */
export function parseHex(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new RangeError(`parseHex: not a hex color: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG 2.x relative luminance (0..1). */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ------------------------------------------------------------------ team identity */

export interface TeamColors {
  primary: string;
  secondary: string;
}

/**
 * Text color for a team's primary block: white or near-black ink, whichever contrasts more.
 * For mid-tone primaries where neither reaches 4.5:1 it uses white or pure black, whichever is
 * higher (one of the two is always >= 4.58:1), so the result is always AA for any text size.
 */
export function teamInk(primary: string): string {
  const onPaper = contrast(primary, PAPER);
  const onInk = contrast(primary, INK);
  if (onPaper >= onInk && onPaper >= 4.5) return PAPER;
  if (onInk >= 4.5) return INK;
  return onPaper >= contrast(primary, '#000000') ? PAPER : '#000000';
}

/**
 * The 4px rule color: the team's secondary, unless it is nearly the same as the primary
 * (contrast < 1.5), in which case the block's ink color is used so the rule stays visible.
 */
export function teamRule(c: TeamColors): string {
  return contrast(c.secondary, c.primary) < 1.5 ? teamInk(c.primary) : c.secondary;
}

/** Below this contrast against the page, a team block gets a 1px hairline edge. */
const EDGE_THRESHOLD = 1.5;

/**
 * CSS custom properties for `.team-block` / `.team-chip` (and anything else painted in team
 * colors). Works as a React `style` object and as an Astro `style={...}` object.
 *
 *   <a class="team-block" style={teamVars(team.colors)}>...</a>
 */
export function teamVars(c: TeamColors): Record<string, string> {
  const primary = c.primary.toLowerCase();
  const darkEdge = contrast(primary, colors.dark.surface) < EDGE_THRESHOLD;
  const lightEdge = contrast(primary, colors.light.page) < EDGE_THRESHOLD;
  return {
    '--team-bg': primary,
    '--team-ink': teamInk(primary),
    '--team-rule': teamRule(c).toLowerCase(),
    '--team-edge-dark': darkEdge ? 'rgb(255 255 255 / 0.18)' : 'transparent',
    '--team-edge-light': lightEdge ? 'rgb(18 19 23 / 0.18)' : 'transparent',
  };
}

/** Same values as plain hex for raster renderers (OG images). Edge is for the dark page. */
export function teamPaint(c: TeamColors): { bg: string; ink: string; rule: string; edge: string | null } {
  const primary = c.primary.toLowerCase();
  return {
    bg: primary,
    ink: teamInk(primary),
    rule: teamRule(c).toLowerCase(),
    edge: contrast(primary, colors.dark.page) < EDGE_THRESHOLD ? '#3a3f49' : null,
  };
}

/* ------------------------------------------------------------------ type, motion, OG */

export const fonts = Object.freeze({
  /** Family name to use in SVG/resvg (register both TTFs from src/assets/fonts/). */
  condensed: 'Barlow Condensed',
  /** Build-time TTFs (relative to the repo root) for @resvg/resvg-js and the glyph atlas. */
  ttf: Object.freeze({
    600: 'src/assets/fonts/BarlowCondensed-600.ttf',
    700: 'src/assets/fonts/BarlowCondensed-700.ttf',
  }),
});

/** Motion durations in ms (all < 300). Zero them when prefers-reduced-motion is set. */
export const motion = Object.freeze({ instant: 90, fast: 140, base: 200, slow: 280 });

/** OG image geometry (DESIGN.md "OG images"). */
export const og = Object.freeze({
  width: 1200,
  height: 630,
  pad: 56,
  rule: 12,
  footer: 72,
});
