/**
 * Design tokens for code that cannot read CSS: build-time OG images (@resvg/resvg-js), the
 * share-image Function (glyph atlas), inline styles. Mirrors src/styles/tokens.css exactly
 * (tests/design-tokens.test.ts enforces it), plus the team-color helpers every surface uses.
 *
 * Pure TypeScript: no DOM, no Node APIs, safe in the browser, Node and Workers.
 */

/** light = content pages ("sheet"), board = game pages in light mode, dark = photostat (both). */
export type ThemeName = 'light' | 'board' | 'dark';

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
  /** The redaction bar (marker black on paper; paper-white on the photostat negative). */
  redaction: string;
  'on-redaction': string;
}

export const colors: Readonly<Record<ThemeName, Readonly<ThemeColors>>> = Object.freeze({
  light: Object.freeze({
    page: '#fdfdfa',
    surface: '#f4f4ef',
    raised: '#ecece6',
    'raised-2': '#e2e2db',
    line: '#d9d9d1',
    'line-strong': '#b2b3aa',
    control: '#74756d',
    track: '#e2e2db',
    fg: '#18191d',
    'fg-muted': '#50524b',
    'fg-faint': '#5f615a',
    accent: '#4b2c92',
    'accent-fill': '#4b2c92',
    'on-accent': '#fdfdfa',
    'accent-tint': '#e9e3f5',
    'accent-edge': '#5a3aa3',
    focus: '#4b2c92',
    win: '#17683a',
    loss: '#a3262b',
    'win-tint': '#e0eee3',
    'loss-tint': '#f6e0dd',
    selection: '#d9cdf3',
    'on-selection': '#18191d',
    redaction: '#121317',
    'on-redaction': '#fdfdfa',
    'tier-50': '#25262b',
    'tier-45': '#34363a',
    'tier-40': '#43454a',
    'tier-30': '#505257',
    'tier-20': '#5c5e63',
    'tier-15': '#66686c',
    'tier-10': '#6f7175',
    'tier-05': '#76787c',
  }),
  board: Object.freeze({
    page: '#e8e8e3',
    surface: '#fdfdfa',
    raised: '#f1f1ec',
    'raised-2': '#e6e6e0',
    line: '#dadad3',
    'line-strong': '#b4b5ad',
    control: '#74756d',
    track: '#e3e3dd',
    fg: '#18191d',
    'fg-muted': '#50524b',
    'fg-faint': '#5d5f58',
    accent: '#4b2c92',
    'accent-fill': '#4b2c92',
    'on-accent': '#fdfdfa',
    'accent-tint': '#ebe5f6',
    'accent-edge': '#5a3aa3',
    focus: '#4b2c92',
    win: '#17683a',
    loss: '#a3262b',
    'win-tint': '#e2efe5',
    'loss-tint': '#f7e2df',
    selection: '#d9cdf3',
    'on-selection': '#18191d',
    redaction: '#121317',
    'on-redaction': '#fdfdfa',
    'tier-50': '#25262b',
    'tier-45': '#34363a',
    'tier-40': '#43454a',
    'tier-30': '#505257',
    'tier-20': '#5f6166',
    'tier-15': '#686a6e',
    'tier-10': '#707276',
    'tier-05': '#77797d',
  }),
  dark: Object.freeze({
    page: '#161615',
    surface: '#1f1f1d',
    raised: '#282826',
    'raised-2': '#32322f',
    line: '#34342f',
    'line-strong': '#4c4c46',
    control: '#8a8a82',
    track: '#33332f',
    fg: '#ecebe4',
    'fg-muted': '#aeada4',
    'fg-faint': '#9d9c93',
    accent: '#b9a7f1',
    'accent-fill': '#b9a7f1',
    'on-accent': '#161615',
    'accent-tint': '#2d2742',
    'accent-edge': '#b9a7f1',
    focus: '#b9a7f1',
    win: '#78d39c',
    loss: '#f3968c',
    'win-tint': '#1d3326',
    'loss-tint': '#3f2523',
    selection: '#4a3d78',
    'on-selection': '#ecebe4',
    redaction: '#e6e3d8',
    'on-redaction': '#161615',
    'tier-50': '#f3f2ec',
    'tier-45': '#dad9d2',
    'tier-40': '#c3c2bb',
    'tier-30': '#acaba4',
    'tier-20': '#9a9991',
    'tier-15': '#8e8d86',
    'tier-10': '#8a8982',
    'tier-05': '#82817b',
  }),
});

/** Constant inks (theme independent). */
export const INK = '#0e0f12'; // team names on light primaries (teamInk); not the page ink
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

/** Toner ramp color for a star value, e.g. tierColor(4.5) -> "#34363a" (light paper, OG images). */
export function tierColor(stars: number, theme: ThemeName = 'light'): string {
  return colors[theme][`tier-${tierKey(stars)}`];
}

/** Season-strip tick height in CSS px for a tier (mirrors --tier-tick on [data-tier] in global.css). */
export const TIER_TICK_PX: Readonly<Record<TierKey, number>> = Object.freeze({
  '50': 14, '45': 12, '40': 10, '30': 8, '20': 6, '15': 5, '10': 4, '05': 3,
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

/**
 * Below this contrast against a page/sheet it sits on, a team plate gets a 1px edge (the primary
 * vanishes into the paper or the photostat), and a rule is redrawn (see ruleOn).
 */
const EDGE_THRESHOLD = 1.5;

/** `from` mixed toward `to` by share t (0..1), as #rrggbb. */
function mixHex(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  return '#' + a.map((c, i) => Math.round(c + (b[i]! - c) * t).toString(16).padStart(2, '0')).join('');
}

/** sRGB chroma (max - min channel, 0..1): 0 for greys, white and black. */
function chroma(hex: string): number {
  const c = parseHex(hex);
  return (Math.max(...c) - Math.min(...c)) / 255;
}

/**
 * A rule blends into a surface when it is within 1.5:1 of it and carries no hue to tell it apart
 * (white on paper, black or navy on the photostat); a saturated colour (Iowa's gold on paper) still
 * reads as a rule down to 1.15:1.
 */
export function ruleBlends(rule: string, surface: string): boolean {
  const k = contrast(rule, surface);
  return k < EDGE_THRESHOLD && (chroma(rule) < 0.3 || k < 1.15);
}

/** Surfaces a team plate or chip can sit on, per scheme (pages, sheets, form fields). */
const RULE_SURFACES = {
  light: [colors.light.page, colors.light.surface, colors.light.raised, colors.board.page, colors.board.surface, colors.board.raised],
  dark: [colors.dark.page, colors.dark.surface, colors.dark.raised],
} as const;

/**
 * The 4px rule as printed in one scheme: teamRule, unless it blends into a surface the plate sits
 * on (ruleBlends: a white secondary on paper, a black one on the photostat), which would make the plate
 * look 4px short. Then a shade of the primary (darker on paper, lighter on the photostat) that
 * reads against both the primary and those surfaces; failing every shade, the primary itself (the
 * plate runs in its colour to its bottom edge, no rule).
 */
export function ruleOn(c: TeamColors, surfaces: readonly string[], prefer: 'darker' | 'lighter' = 'darker'): string {
  const primary = c.primary.toLowerCase();
  const rule = teamRule(c).toLowerCase();
  if (surfaces.every((bg) => !ruleBlends(rule, bg))) return rule;
  const darker = [mixHex(primary, '#000000', 0.4), mixHex(primary, '#000000', 0.6)];
  const lighter = [mixHex(primary, '#ffffff', 0.45), mixHex(primary, '#ffffff', 0.65)];
  // A shade is our own pick, so it must clear 1.5:1 outright, against the plate and every surface.
  for (const shade of prefer === 'darker' ? [...darker, ...lighter] : [...lighter, ...darker]) {
    if (contrast(shade, primary) >= EDGE_THRESHOLD && surfaces.every((bg) => contrast(shade, bg) >= EDGE_THRESHOLD)) return shade;
  }
  return primary;
}
/** The redaction bar must read on the team colour (graphics contrast) or it falls back to the ink. */
const REDACT_THRESHOLD = 3;

/**
 * CSS custom properties for `.team-block` / `.team-chip` (and anything else painted in team
 * colors). Works as a React `style` object and as an Astro `style={...}` object.
 *
 *   <a class="team-block" style={teamVars(team.colors)}>...</a>
 */
export function teamVars(c: TeamColors): Record<string, string> {
  const primary = c.primary.toLowerCase();
  const ink = teamInk(primary);
  const vanishes = (fg: string, ...bgs: string[]) => bgs.some((bg) => contrast(fg, bg) < EDGE_THRESHOLD);
  // The edge is for a primary that vanishes; a vanishing rule is redrawn per scheme instead (ruleOn),
  // so no plate gets a stray frame or looks shorter than its row.
  const darkEdge = vanishes(primary, colors.dark.page, colors.dark.surface);
  const lightEdge = vanishes(primary, colors.light.page, colors.board.page, colors.board.surface);
  // The reveal's redaction bar sits on the team colour: marker black (paper-white in dark) when it
  // reads at >= 3:1 on the primary, else the team's own ink (always >= 4.5:1 on it).
  const redact = (bar: string) => (contrast(bar, primary) >= REDACT_THRESHOLD ? 'var(--redaction)' : ink);
  // CSS resolves --team-rule (like --team-edge and --team-redact) from the scheme's value.
  return {
    '--team-bg': primary,
    '--team-ink': ink,
    '--team-rule-light': ruleOn(c, RULE_SURFACES.light),
    '--team-rule-dark': ruleOn(c, RULE_SURFACES.dark, 'lighter'),
    '--team-edge-dark': darkEdge ? 'rgb(236 235 228 / 0.42)' : 'transparent',
    '--team-edge-light': lightEdge ? 'rgb(24 25 29 / 0.34)' : 'transparent',
    '--team-redact-light': redact(colors.light.redaction),
    '--team-redact-dark': redact(colors.dark.redaction),
  };
}

/**
 * Same values as plain hex for raster renderers (OG images, paper page): the light rule (ruleOn
 * against the paper and the sheet), and an edge only when the primary vanishes into them;
 * renderers frame the plate with the rule inside it.
 */
export function teamPaint(c: TeamColors): { bg: string; ink: string; rule: string; edge: string | null; redact: string } {
  const primary = c.primary.toLowerCase();
  const ink = teamInk(primary);
  const paper = [colors.light.page, colors.light.surface];
  const vanishes = (fg: string) => paper.some((bg) => contrast(fg, bg) < EDGE_THRESHOLD);
  return {
    bg: primary,
    ink,
    rule: ruleOn(c, paper),
    edge: vanishes(primary) ? colors.light['line-strong'] : null,
    redact: contrast(colors.light.redaction, primary) >= REDACT_THRESHOLD ? colors.light.redaction : ink,
  };
}

/* ------------------------------------------------------------------ type, motion, OG */

export const fonts = Object.freeze({
  /** Family name to use in SVG/resvg (register the three TTFs from src/assets/fonts/). */
  family: 'Archivo',
  /** Build-time static TTFs (relative to the repo root) for @resvg/resvg-js and the glyph atlas. */
  ttf: Object.freeze({
    400: 'src/assets/fonts/Archivo-400.ttf',
    600: 'src/assets/fonts/Archivo-600.ttf',
    800: 'src/assets/fonts/Archivo-800.ttf',
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
