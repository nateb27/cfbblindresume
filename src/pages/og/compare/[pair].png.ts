/** /og/compare/{a}-vs-{b}.png: 1200x630 share image for every compare page. */
import type { APIRoute, GetStaticPaths } from 'astro';
import { comparePairs } from '@lib/data';
import { latestWeek } from '../../../components/site';
import { compareOgSvg, renderPng } from '../../../components/og';

export const getStaticPaths = (() =>
  comparePairs(latestWeek()).map((p) => ({ params: { pair: p.slug }, props: { a: p.a, b: p.b } }))) satisfies GetStaticPaths;

export const GET: APIRoute<{ a: string; b: string }> = ({ props }) =>
  new Response(renderPng(compareOgSvg(latestWeek(), props.a, props.b)), { headers: { 'Content-Type': 'image/png' } });
