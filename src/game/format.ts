/**
 * Small display helpers for the game island (pure, no DOM). Copy and number formatting only:
 * every rule (ranking, trios, playoff, tiers, share codes) comes from src/lib.
 */
import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';

/** 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd". */
export function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${n % 10 > 3 ? 'th' : suffix}`;
}

/** "W" + 16 -> "+16"; "L" + 3 -> "−3" (U+2212, the condensed face's minus). */
export function signedMargin(result: 'W' | 'L', margin: number): string {
  return `${result === 'W' ? '+' : '−'}${margin}`;
}

/** { w: 7, l: 1 } -> "7-1". */
export function recordText(r: { w: number; l: number }): string {
  return `${r.w}-${r.l}`;
}

/** { w: 7, l: 1 } -> "7 and 1" (screen readers say "7 and 1", not "7 minus 1"). */
export function recordSpoken(r: { w: number; l: number }): string {
  return `${r.w} and ${r.l}`;
}

/** "1 round" / "3 rounds". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Wrap every match of `re` (global) in an element, e.g. bold "4 of 6" inside the running line.
 * `wrap` receives the matched text and an index-stable key.
 */
export function emphasize(text: string, re: RegExp, wrap: (match: string, key: number) => ReactNode): ReactNode {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    out.push(wrap(m[0], i++));
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return createElement(Fragment, null, ...out);
}

/** Letters shown on the three blind cards, by display position. */
export const LETTERS = ['A', 'B', 'C'] as const;

/**
 * Short labels for bracket rounds on the phone round picker. Five rounds (24 teams) must fit a
 * 288px strip at 320px wide without scrolling: "Rd 1 · Rd 2 · QF · SF · Final".
 */
export function shortRoundLabel(label: string, roundCount: number): string {
  const compact = roundCount > 4;
  if (label === 'First round') return compact ? 'Rd 1' : 'First round';
  if (label === 'Second round') return 'Rd 2';
  if (label === 'Quarterfinal') return compact ? 'QF' : 'Quarters';
  if (label === 'Semifinal') return compact ? 'SF' : 'Semis';
  return label;
}


/** Column headers for the desktop bracket: "Quarterfinals", "Semifinals", "Final". */
export function columnRoundLabel(label: string): string {
  if (label === 'Quarterfinal' || label === 'Semifinal') return `${label}s`;
  return label;
}

/** Abbreviation used in "Winner QF 2" placeholders. */
export function roundAbbrev(label: string): string {
  if (label === 'First round') return 'R1';
  if (label === 'Second round') return 'R2';
  if (label === 'Quarterfinal') return 'QF';
  if (label === 'Semifinal') return 'SF';
  return label;
}

/** Whether the user prefers reduced motion (false during SSR). */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll behavior that respects prefers-reduced-motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth';
}

/**
 * Scroll so the top of a game screen sits at the top of the viewport when it is not already there:
 * when it starts above the viewport (scrolled past), or below the top and the screen would not fit
 * under it (a tall hero above the game on a laptop, the fixed rank footer on phones). Screens that
 * already fit where they are stay put, so a big monitor keeps the hero in view.
 */
export function bringIntoView(el: HTMLElement): void {
  const top = el.getBoundingClientRect().top;
  const footer = window.matchMedia('(min-width: 64rem)').matches ? 0 : 80;
  const fits = top + el.offsetHeight <= window.innerHeight - footer;
  if (top < -8 || (top > 16 && !fits)) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
}
