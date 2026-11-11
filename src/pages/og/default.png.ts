/** /og/default.png: the site-wide share image (the redacted file: "Rank the resumes. Names hidden." over three blind card headers). */
import type { APIRoute } from 'astro';
import { latestWeek } from '../../components/site';
import { defaultOgSvg, renderPng } from '../../components/og';

export const GET: APIRoute = () => new Response(renderPng(defaultOgSvg(latestWeek())), { headers: { 'Content-Type': 'image/png' } });
