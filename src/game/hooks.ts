/** Client-only hooks for the lazy game chunk (never rendered on the server). */
import { useEffect, useState } from 'react';

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
