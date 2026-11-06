/** Client-only hooks for the lazy game chunk (never rendered on the server). */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Live result of a media query. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}

/** The desktop layout breakpoint (DESIGN.md: >= 1024px = 64rem, Tailwind `lg`). */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 64rem)');
}

/**
 * How long after a control appears (or changes) under the pointer its pointer activations are
 * ignored. A double tap / double click is two activations ~100-300 ms apart; nobody reads a new
 * control and decides to press it that fast, so this only ever drops the accidental second hit.
 */
export const GUARD_MS = 400;

/**
 * Returns `isStale(event)`: true for a pointer activation (mouse, touch, pen: `detail > 0`) that
 * lands within {@link GUARD_MS} of the last change of `key` — the second half of a double tap that
 * would otherwise hit whatever just replaced the control under the finger (Undo, Lock in, Play
 * again, a results tile). Keyboard and assistive-technology activations (`detail === 0`) always pass.
 */
export function useFreshGuard(key: unknown, ms = GUARD_MS): (e: { detail: number; timeStamp: number }) => boolean {
  const at = useRef(0);
  useLayoutEffect(() => {
    at.current = performance.now();
  }, [key]);
  return useCallback((e) => e.detail !== 0 && e.timeStamp - at.current < ms, [ms]);
}
