/**
 * Design tokens: src/styles/tokens.ts must mirror src/styles/tokens.css (and the dark copy in
 * global.css), and every documented text/background pair must meet WCAG AA (DESIGN.md lists them).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { colors, contrast, teamInk, teamRule, teamVars, tierColor, tierKey, TIER_KEYS, type ThemeColors, type ThemeName } from '../src/styles/tokens';

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');
const tokensCss = read('../src/styles/tokens.css');
const globalCss = read('../src/styles/global.css');

/** `--color-x: #hex;` declarations inside the block that starts at `marker`. */
function block(css: string, marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  expect(start, `marker ${marker}`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  let end = start;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) { end = i; break; }
  }
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{3,6})\s*;/gi)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

const cssDark = block(tokensCss, '@theme static');
const cssLight = block(tokensCss, '@utility theme-light-values');
const cssDarkCopy = block(globalCss, '@utility theme-dark-values');

/** Text pairs need 4.5:1; graphics/control boundaries need 3:1. [fg, bg, min] by token key. */
export const PAIRS: [keyof ThemeColors, keyof ThemeColors, number][] = [
  ...(['page', 'surface', 'raised', 'raised-2'] as const).flatMap((bg) => [
    ['fg', bg, 4.5] as [keyof ThemeColors, keyof ThemeColors, number],
    ['fg-muted', bg, 4.5] as [keyof ThemeColors, keyof ThemeColors, number],
  ]),
  ...(['page', 'surface', 'raised'] as const).flatMap((bg) => [
    ['fg-faint', bg, 4.5] as [keyof ThemeColors, keyof ThemeColors, number],
    ['accent', bg, 4.5] as [keyof ThemeColors, keyof ThemeColors, number],
    ['win', bg, 4.5] as [keyof ThemeColors, keyof ThemeColors, number],
    ['loss', bg, 4.5] as [keyof ThemeColors, keyof ThemeColors, number],
    ['control', bg, 3] as [keyof ThemeColors, keyof ThemeColors, number],
    ['focus', bg, 3] as [keyof ThemeColors, keyof ThemeColors, number],
    ['accent-edge', bg, 3] as [keyof ThemeColors, keyof ThemeColors, number],
    ...TIER_KEYS.map((k) => [`tier-${k}`, bg, 3] as [keyof ThemeColors, keyof ThemeColors, number]),
  ]),
  ['on-accent', 'accent-fill', 4.5],
  ['accent', 'accent-tint', 4.5],
  ['win', 'win-tint', 4.5],
  ['loss', 'loss-tint', 4.5],
  ['on-selection', 'selection', 4.5],
];

describe('design tokens', () => {
  it('tokens.ts mirrors tokens.css (dark @theme and light block)', () => {
    for (const theme of ['dark', 'light'] as ThemeName[]) {
      const css = theme === 'dark' ? cssDark : cssLight;
      for (const [k, v] of Object.entries(colors[theme])) expect(css[k], `${theme} --color-${k}`).toBe(v);
    }
  });

  it('global.css dark copy equals the @theme values', () => {
    for (const [k, v] of Object.entries(cssDarkCopy)) expect(cssDark[k], `--color-${k}`).toBe(v);
    for (const k of Object.keys(cssLight)) expect(cssDarkCopy[k], `dark copy has --color-${k}`).toBeDefined();
  });

  it('every documented pair meets WCAG AA in both themes', () => {
    for (const theme of ['dark', 'light'] as ThemeName[]) {
      for (const [fg, bg, min] of PAIRS) {
        const r = contrast(colors[theme][fg], colors[theme][bg]);
        expect(r, `${theme}: ${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(min);
      }
    }
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

  it('tier keys map star values to ramp colors', () => {
    expect([5, 4.5, 4, 3, 2, 1.5, 1, 0.5].map(tierKey)).toEqual([...TIER_KEYS]);
    expect(tierColor(4.5)).toBe(colors.dark['tier-45']);
    expect(() => tierKey(2.5)).toThrow();
  });
});
