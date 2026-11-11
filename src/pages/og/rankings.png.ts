/** /og/rankings.png: the share image of /rankings and /bubble (this week's committee and strength-of-record top 5s). */
import type { APIRoute } from 'astro';
import { latestWeek } from '../../components/site';
import { rankingsOgSvg, renderPng } from '../../components/og';

export const GET: APIRoute = () => new Response(renderPng(rankingsOgSvg(latestWeek())), { headers: { 'Content-Type': 'image/png' } });
