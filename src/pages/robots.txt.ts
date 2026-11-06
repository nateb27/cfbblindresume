/** /robots.txt: allow everything, point at the sitemap. */
import type { APIRoute } from 'astro';
import { absUrl } from '../components/site';

export const GET: APIRoute = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absUrl('/sitemap.xml')}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
