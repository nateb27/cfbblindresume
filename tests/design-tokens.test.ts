/**
 * Design tokens (DOSSIER, DESIGN.md "Tokens" and "Measured contrast").
 * - src/styles/tokens.ts mirrors src/styles/tokens.css for all three sets: light-sheet (content
 *   pages), light-board (game pages) and dark (photostat). tokens.css declares world tokens in
 *   `@tokens <set>` ... `@end` blocks and maps the system tokens (`--color-*`) onto them in @theme
 *   (and again on [data-surface="board"]); the test resolves that mapping.
 * - Every documented token pair meets its WCAG minimum in every set: text 4.5:1; graphics,
 *   control boundaries and focus 3:1. There are no exceptions.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  colors,
  contrast,
  luminance,
  teamInk,
  teamRule,
  teamVars,
  tierColor,
  tierKey,
  TIER_KEYS,
  TIER_TICK_PX,
  type ThemeColors,
  type ThemeName,
} from '../src/styles/tokens';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const tokensCss = read('../src/styles/tokens.css');
const globalCss = read('../src/styles/global.css');

/** The text inside the `{ ... }` block that follows `marker` (first brace after it). */
function braceBlock(css: string, marker: string, from = 0): string {
  const start = css.indexOf(marker, from);
  expect(start, `marker ${marker}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unclosed block at ${marker}`);
}

/** `--name: value;` declarations in a chunk of CSS. */
function decls(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) out[m[1]!] = m[2]!.trim().toLowerCase();
  return out;
}

/** World tokens of one `@tokens <set>` ... `@end` block. */
function world(set: string): Record<string, string> {
  const start = tokensCss.indexOf(`@tokens ${set}`);
  expect(start, `@tokens ${set}`).toBeGreaterThanOrEqual(0);
  const end = tokensCss.indexOf('@end', start);
  return decls(tokensCss.slice(start, end));
}

/** System token -> world token, from `--color-x: var(--y);` in @theme. */
const themeBlock = braceBlock(tokensCss, '@theme static');
const mapping: Record<string, string> = {};
for (const [k, v] of Object.entries(decls(themeBlock))) {
  const m = /^color-(.+)$/.exec(k);
  const w = /^var\(--([a-z0-9-]+)\)$/.exec(v);
  if (m && w) mapping[m[1]!] = w[1]!;
}

const SETS: Record<ThemeName, string> = { light: 'light-sheet', board: 'light-board', dark: 'dark' };
const THEMES = Object.keys(SETS) as ThemeName[];

/** The resolved hex of every system colour token in one set. */
function resolved(theme: ThemeName): Record<string, string> {
  const w = world(SETS[theme]);
  return Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, w[v]!]));
}

type Pair = [keyof ThemeColors, keyof ThemeColors, number];
const on = (fg: keyof ThemeColors, bgs: (keyof ThemeColors)[], min: number): Pair[] => bgs.map((bg) => [fg, bg, min]);

/** DESIGN.md "Measured contrast": every pair at its minimum (81 per set). */
export const PAIRS: Pair[] = [
  // text >= 4.5
  ...on('fg', ['page', 'surface', 'raised', 'raised-2', 'accent-tint', 'win-tint', 'loss-tint'], 4.5),
  ...on('fg-muted', ['page', 'surface', 'raised', 'raised-2'], 4.5),
  ...on('fg-faint', ['page', 'surface', 'raised'], 4.5),
  ...on('accent', ['page', 'surface', 'raised', 'accent-tint'], 4.5),
  ['on-accent', 'accent-fill', 4.5],
  ...on('win', ['page', 'surface', 'raised', 'win-tint'], 4.5),
  ...on('loss', ['page', 'surface', 'raised', 'loss-tint'], 4.5),
  ['on-redaction', 'redaction', 4.5],
  ['surface', 'fg', 4.5],
  ['page', 'fg', 4.5],
  ['on-selection', 'selection', 4.5],
  // graphics, control boundaries, focus >= 3
  ...on('control', ['page', 'surface', 'raised'], 3),
  ...on('focus', ['page', 'surface', 'raised'], 3),
  ...on('fg', ['page', 'surface', 'raised'], 3),
  ...on('accent-edge', ['page', 'surface', 'raised'], 3),
  ...on('accent-fill', ['page', 'surface', 'raised'], 3),
  ...on('redaction', ['page', 'surface', 'raised'], 3),
  ...TIER_KEYS.flatMap((k) => on(`tier-${k}`, ['page', 'surface', 'raised', 'track'], 3)),
];

describe('design tokens', () => {
  it('tokens.css maps every system colour onto a world token', () => {
    const keys = Object.keys(colors.light);
    for (const k of keys) expect(mapping[k], `--color-${k}`).toBeDefined();
  });

  it('the board surface re-declares the same mapping', () => {
    const board = decls(braceBlock(tokensCss, 'The system tokens again on the board surface'));
    for (const [k, w] of Object.entries(mapping)) expect(board[`color-${k}`], `--color-${k} on the board`).toBe(`var(--${w})`);
  });

  it('tokens.ts mirrors tokens.css in all three sets', () => {
    for (const theme of THEMES) {
      const css = resolved(theme);
      for (const [k, v] of Object.entries(colors[theme])) expect(css[k], `${theme} --color-${k}`).toBe(v);
    }
  });

  it('every documented pair meets its minimum in every set', () => {
    expect(PAIRS.length).toBe(81);
    for (const theme of THEMES) {
      for (const [fg, bg, min] of PAIRS) {
        const r = contrast(colors[theme][fg], colors[theme][bg]);
        expect(r, `${theme}: ${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      }
    }
  });

  it('the redaction bar is the blackest mark (lighter toner top step)', () => {
    for (const theme of ['light', 'board'] as const) expect(luminance(colors[theme]['tier-50'])).toBeGreaterThan(luminance(colors[theme].redaction));
    expect(luminance(colors.dark['tier-50'])).toBeGreaterThan(luminance(colors.dark.page));
  });

  it('no shadow tokens, no forced themes, no condensed face', () => {
    expect(tokensCss).not.toMatch(/--shadow-/);
    expect(tokensCss + globalCss).not.toMatch(/theme-(light|dark)-values|data-theme=|Barlow/);
  });

  it('teamInk is >= 4.5:1 on any primary color', () => {
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
      const hex = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
      expect(contrast(teamInk(hex), hex), hex).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('team rule falls back to ink when the secondary matches the primary', () => {
    expect(teamRule({ primary: '#003da5', secondary: '#002e5d' })).toBe('#ffffff');
    expect(teamRule({ primary: '#f47321', secondary: '#005030' })).toBe('#005030');
    const v = teamVars({ primary: '#000000', secondary: '#FFCD00' });
    expect(v['--team-ink']).toBe('#ffffff');
    expect(v['--team-edge-dark']).not.toBe('transparent');
    expect(v['--team-rule']).toBe('#ffcd00');
  });

  it('team redaction bar: the marker when it reads on the primary, else the team ink', () => {
    // Marker black on a light primary; paper-white marker would not read on it in dark mode.
    const gold = teamVars({ primary: '#ffcd00', secondary: '#000000' });
    expect(gold['--team-redact-light']).toBe('var(--redaction)');
    expect(gold['--team-redact-dark']).toBe(teamInk('#ffcd00'));
    // Navy: marker black does not read; the paper-white bar does in dark mode.
    const navy = teamVars({ primary: '#002244', secondary: '#ffffff' });
    expect(navy['--team-redact-light']).toBe('#ffffff');
    expect(navy['--team-redact-dark']).toBe('var(--redaction)');
  });

  it('tier keys map star values to the monochrome toner ramp (more ink = better opponent)', () => {
    expect([5, 4.5, 4, 3, 2, 1.5, 1, 0.5].map(tierKey)).toEqual([...TIER_KEYS]);
    expect(tierColor(4.5)).toBe(colors.light['tier-45']);
    expect(tierColor(4.5, 'dark')).toBe(colors.dark['tier-45']);
    expect(() => tierKey(2.5)).toThrow();
    for (const theme of THEMES) {
      const lum = TIER_KEYS.map((k) => luminance(colors[theme][`tier-${k}`]));
      // grey: no hue (warm photostat greys allowed a few units)
      for (const k of TIER_KEYS) {
        const hex = colors[theme][`tier-${k}`];
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
        expect(Math.max(r!, g!, b!) - Math.min(r!, g!, b!), `${theme} tier-${k} ${hex} is grey`).toBeLessThanOrEqual(10);
      }
      // monotonic: darker on paper, lighter on the photostat
      for (let i = 1; i < lum.length; i++) {
        if (theme === 'dark') expect(lum[i]!, `${theme} ramp step ${i}`).toBeLessThan(lum[i - 1]!);
        else expect(lum[i]!, `${theme} ramp step ${i}`).toBeGreaterThan(lum[i - 1]!);
      }
    }
    expect(TIER_KEYS.map((k) => TIER_TICK_PX[k])).toEqual([14, 12, 10, 8, 6, 5, 4, 3]);
  });

  it('tier ticks in global.css match TIER_TICK_PX', () => {
    for (const k of TIER_KEYS) {
      const m = new RegExp(`\\[data-tier="${k}"\\][^}]*--tier-tick:\\s*(\\d+)px`).exec(globalCss);
      expect(Number(m?.[1]), `tier ${k}`).toBe(TIER_TICK_PX[k]);
    }
  });
});
