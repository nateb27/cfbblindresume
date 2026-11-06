/**
 * /sitemap.xml: every indexable URL (not /r or the 404). lastmod = the week the page shows:
 * archive pages their own week's asOf, everything else the latest week's asOf.
 */
import type { APIRoute } from 'astro';
import { comparePairs } from '@lib/data';
import { absUrl, allWeekRefs, archiveHref, compareHref, compareHubHref, latestWeek, teamHref } from '../components/site';

export const GET: APIRoute = () => {
  const week = latestWeek();
  const latest = week.asOf;
  const urls: { path: string; lastmod: string; priority: string }[] = [
    { path: '/', lastmod: latest, priority: '1.0' },
    { path: '/rankings', lastmod: latest, priority: '0.9' },
    { path: '/bubble', lastmod: latest, priority: '0.9' },
    { path: '/teams', lastmod: latest, priority: '0.8' },
    ...Object.keys(week.teams)
      .sort()
      .map((slug) => ({ path: teamHref(slug), lastmod: latest, priority: '0.7' })),
    { path: compareHubHref, lastmod: latest, priority: '0.6' },
    ...comparePairs(week).map((p) => ({ path: compareHref(p.slug), lastmod: latest, priority: '0.5' })),
    ...allWeekRefs()
      .slice()
      .reverse()
      .map((r) => ({ path: archiveHref(r.season, r.week), lastmod: r.asOf, priority: '0.4' })),
    { path: '/how-it-works', lastmod: latest, priority: '0.5' },
    { path: '/about', lastmod: latest, priority: '0.3' },
    { path: '/privacy', lastmod: latest, priority: '0.2' },
  ];
  const body =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.map((u) => `  <url><loc>${absUrl(u.path)}</loc><lastmod>${u.lastmod}</lastmod><priority>${u.priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
