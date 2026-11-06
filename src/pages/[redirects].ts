/**
 * /_redirects (Cloudflare Pages redirect rules), generated from the week files so compare URLs
 * never 404:
 * - the reversed order of every current pair -> the canonical pair (better committee rank first);
 * - every pair from an earlier week of this season that is no longer a current pair (a team left
 *   the committee top 25) -> the page of the team that is still ranked (else the first team).
 *   Both orders, since either may have been indexed or shared.
 * Stays under the 2,000 static-redirect limit: current-week rules first, then stale pairs from the
 * newest earlier week back, cut off at the limit. A file named
 * `_redirects` cannot be a route file (Astro skips files that start with "_"), hence the param.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { comparePairs } from '@lib/data';
import { compareHref, latestWeek, seasonWeeks, teamHref } from '../components/site';

export const getStaticPaths = (() => [{ params: { redirects: '_redirects' } }]) satisfies GetStaticPaths;

const LIMIT = 2000;

export const GET: APIRoute = () => {
  const week = latestWeek();
  const current = comparePairs(week);
  const live = new Set(current.map((p) => p.slug));
  const lines: string[] = ['# Generated at build from the week files (src/pages/[redirects].ts).', '# Reversed compare URLs -> canonical order.'];
  for (const p of current) lines.push(`${compareHref(`${p.b}-vs-${p.a}`)} ${compareHref(p.slug)} 301`);

  const ranked = new Set(week.committee ?? []);
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const w of seasonWeeks(week.season).slice().reverse()) {
    if (w.week === week.week) continue;
    for (const p of comparePairs(w)) {
      for (const [x, y] of [
        [p.a, p.b],
        [p.b, p.a],
      ] as const) {
        const slug = `${x}-vs-${y}`;
        if (live.has(slug) || live.has(`${y}-vs-${x}`) || seen.has(slug)) continue;
        seen.add(slug);
        const target = ranked.has(p.b) && !ranked.has(p.a) ? p.b : p.a;
        if (week.teams[target]) stale.push(`${compareHref(slug)} ${teamHref(target)} 301`);
      }
    }
  }
  const room = Math.max(0, LIMIT - current.length);
  if (stale.length) lines.push('# Pairs from earlier weeks that are no longer both in the committee top 25 -> the team still ranked.', ...stale.slice(0, room));
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
