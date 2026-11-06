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

/** Short labels for bracket rounds on the phone round picker. */
export function shortRoundLabel(label: string, roundCount: number): string {
  if (label === 'First round') return roundCount > 4 ? 'Round 1' : 'First round';
  if (label === 'Second round') return 'Round 2';
  if (label === 'Quarterfinal') return 'Quarters';
  if (label === 'Semifinal') return 'Semis';
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
