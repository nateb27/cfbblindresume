/** /og/teams/{slug}.png: 1200x630 team share image for every FBS team in the latest week. */
import type { APIRoute, GetStaticPaths } from 'astro';
import { latestWeek } from '../../../components/site';
import { renderPng, teamOgSvg } from '../../../components/og';

export const getStaticPaths = (() => Object.keys(latestWeek().teams).map((slug) => ({ params: { slug } }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ params }) =>
  new Response(renderPng(teamOgSvg(latestWeek(), params.slug!)), { headers: { 'Content-Type': 'image/png' } });
