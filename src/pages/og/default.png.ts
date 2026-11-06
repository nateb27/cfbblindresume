/** /og/default.png: the site-wide share image (wordmark, tagline, this week's top 5s). */
import type { APIRoute } from 'astro';
import { latestWeek } from '../../components/site';
import { defaultOgSvg, renderPng } from '../../components/og';

export const GET: APIRoute = () => new Response(renderPng(defaultOgSvg(latestWeek())), { headers: { 'Content-Type': 'image/png' } });
