#!/usr/bin/env node
/**
 * Content-site checks on a built output directory (default: dist):
 *   node scripts/content-verify.mjs [outDir]
 * - one /teams page per team in the latest week file, C(n,2) /compare pages for the committee top n
 * - "ESPN", "FPI", "SP+", "Game Control" only in about.html (house rule 1), in any built text file
 * - every HTML page: exactly one <title>, meta description, canonical (absolute, no trailing slash),
 *   og:image; titles and descriptions unique across indexable pages
 * - content pages (everything except / and /r) ship no <script> other than JSON-LD
 * - sitemap.xml lists every indexable page and nothing else; robots.txt points to it
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const out = process.argv[2] ?? 'dist';
const ORIGIN = 'https://cfbblindresume.com';
const errors = [];
const fail = (m) => errors.push(m);

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(out);
const html = files.filter((f) => f.endsWith('.html'));
const urlOf = (f) => {
  const r = '/' + relative(out, f).replace(/\\/g, '/').replace(/\.html$/, '');
  return r === '/index' ? '/' : r.replace(/\/index$/, '');
};

// Latest week (data dir next to the repo root).
const seasons = readdirSync('data').filter((d) => /^\d{4}$/.test(d)).sort();
const season = seasons[seasons.length - 1];
const idx = JSON.parse(readFileSync(join('data', season, 'index.json'), 'utf8'));
const last = idx.weeks[idx.weeks.length - 1];
const week = JSON.parse(readFileSync(join('data', season, `week-${last.week}.json`), 'utf8'));
const nTeams = Object.keys(week.teams).length;
const nCmte = week.committee?.length ?? 0;

const teamPages = html.filter((f) => /\/teams\/[^/]+\.html$/.test(f));
const comparePages = html.filter((f) => /\/compare\/[^/]+\.html$/.test(f));
if (teamPages.length !== nTeams) fail(`team pages: ${teamPages.length}, expected ${nTeams}`);
if (comparePages.length !== (nCmte * (nCmte - 1)) / 2) fail(`compare pages: ${comparePages.length}, expected ${(nCmte * (nCmte - 1)) / 2}`);
const ogTeams = files.filter((f) => /\/og\/teams\/[^/]+\.png$/.test(f));
if (ogTeams.length !== nTeams) fail(`team OG images: ${ogTeams.length}, expected ${nTeams}`);
if (!existsSync(join(out, 'og', 'default.png'))) fail('missing og/default.png');
const ogCompare = files.filter((f) => /\/og\/compare\/[^/]+\.png$/.test(f));
if (ogCompare.length !== comparePages.length) fail(`compare OG images: ${ogCompare.length}, expected ${comparePages.length}`);

// Forbidden strings.
const forbidden = /ESPN|FPI|SP\+|Game Control/;
for (const f of files.filter((x) => /\.(html|js|css|json|xml|txt|svg|webmanifest)$/.test(x))) {
  const text = readFileSync(f, 'utf8');
  if (forbidden.test(text) && relative(out, f) !== 'about.html') fail(`forbidden string in ${relative(out, f)}: ${text.match(forbidden)[0]}`);
}

// Head tags.
const titles = new Map();
const descs = new Map();
const indexable = [];
for (const f of html) {
  const t = readFileSync(f, 'utf8');
  const url = urlOf(f);
  const head = t.slice(0, t.indexOf('</head>'));
  const title = [...head.matchAll(/<title>([^<]*)<\/title>/g)];
  const desc = t.match(/<meta name="description" content="([^"]*)"/);
  const canon = t.match(/<link rel="canonical" href="([^"]*)"/);
  const noindex = /<meta name="robots" content="noindex"/.test(t);
  if (title.length !== 1) fail(`${url}: ${title.length} <title>`);
  if (!desc) fail(`${url}: no meta description`);
  if (!canon) fail(`${url}: no canonical`);
  else if (!noindex && canon[1] !== ORIGIN + (url === '/' ? '' : url)) fail(`${url}: canonical ${canon[1]}`);
  if (canon && /\/$/.test(canon[1])) fail(`${url}: canonical has a trailing slash`);
  if (!/<meta property="og:image" content="https:\/\/[^"]+\.png"/.test(t)) fail(`${url}: no og:image`);
  if (!/application\/ld\+json/.test(t) && !noindex) fail(`${url}: no JSON-LD`);
  if (!noindex) {
    indexable.push(url);
    const tt = title[0]?.[1];
    if (titles.has(tt)) fail(`duplicate title: ${url} and ${titles.get(tt)}`);
    titles.set(tt, url);
    if (desc) {
      if (descs.has(desc[1])) fail(`duplicate description: ${url} and ${descs.get(desc[1])}`);
      descs.set(desc[1], url);
    }
  }
  const game = url === '/' || url === '/r';
  if (!game) {
    const scripts = [...t.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/application\/ld\+json/.test(m[1]));
    if (scripts.length) fail(`${url}: ${scripts.length} non-JSON-LD <script> on a content page`);
  }
  if (!/Ratings: <a[^>]*href="https:\/\/bcftoys\.com\/\d{4}-fei"[^>]*>FEI by Brian Fremeau<\/a>/.test(t)) fail(`${url}: no FEI attribution link`);
}

// Sitemap + robots.
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(ORIGIN, '') || '/');
const smSet = new Set(locs);
for (const u of indexable) if (!smSet.has(u)) fail(`sitemap missing ${u}`);
for (const u of locs) if (!indexable.includes(u)) fail(`sitemap lists non-indexable or missing ${u}`);
if (!/Sitemap: https:\/\/cfbblindresume\.com\/sitemap\.xml/.test(readFileSync(join(out, 'robots.txt'), 'utf8'))) fail('robots.txt has no sitemap');

console.log(`html pages: ${html.length} (indexable ${indexable.length}) · teams ${teamPages.length}/${nTeams} · compares ${comparePages.length} · sitemap ${locs.length} URLs`);
if (errors.length) {
  console.error(errors.slice(0, 60).join('\n'));
  console.error(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log('content checks passed');
