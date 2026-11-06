#!/usr/bin/env node
/**
 * Content-site checks on a built output directory (default: dist):
 *   node scripts/content-verify.mjs [outDir]
 * - one /teams page per team in the latest week file, C(n,2) /compare pages for the committee top n
 * - "ESPN", "FPI", "SP+", "Game Control" only in about.html (house rule 1), in any built text file
 * - every HTML page: exactly one <title>, meta description, og:image (a versioned .png URL);
 *   indexable pages: canonical (absolute, no trailing slash) and titles/descriptions that are unique
 *   and fit search results (title <= 65 chars, description <= 160); noindex content pages carry no
 *   canonical
 * - the strength-of-record rank is never labeled bare "FEI N" (bare FEI = FEI overall)
 * - content pages (everything except / and /r) ship no <script> other than JSON-LD (and, in an
 *   ads-on build, the ad loader stub, which may appear only on pages with an ad slot)
 * - every compare page has an internal link from another page, and /_redirects maps each pair's
 *   reversed URL to it
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
const TITLE_MAX = 65;
const DESC_MAX = 160;
const titles = new Map();
const descs = new Map();
const indexable = [];
const inbound = new Map(); // url -> Set of linking urls
for (const f of html) {
  const t = readFileSync(f, 'utf8');
  const url = urlOf(f);
  const head = t.slice(0, t.indexOf('</head>'));
  const title = [...head.matchAll(/<title>([^<]*)<\/title>/g)];
  const desc = t.match(/<meta name="description" content="([^"]*)"/);
  const canon = t.match(/<link rel="canonical" href="([^"]*)"/);
  const noindex = /<meta name="robots" content="noindex"/.test(t);
  const game = url === '/' || url === '/r';
  if (title.length !== 1) fail(`${url}: ${title.length} <title>`);
  if (!desc) fail(`${url}: no meta description`);
  if (!noindex || game) {
    if (!canon) fail(`${url}: no canonical`);
    else if (!noindex && canon[1] !== ORIGIN + (url === '/' ? '' : url)) fail(`${url}: canonical ${canon[1]}`);
  } else if (canon) fail(`${url}: noindex content page carries a canonical`);
  if (canon && /\/$/.test(canon[1])) fail(`${url}: canonical has a trailing slash`);
  if (!/<meta property="og:image" content="https:\/\/[^"]+\.png\?v=\d{4}-\d+"/.test(t)) fail(`${url}: no versioned og:image`);
  const decode = (x) => x.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  if (!noindex) {
    const tt = decode(title[0]?.[1] ?? '');
    const dd = desc ? decode(desc[1]) : '';
    if (tt.length > TITLE_MAX) fail(`${url}: title ${tt.length} chars (max ${TITLE_MAX}): ${tt}`);
    if (dd.length > DESC_MAX) fail(`${url}: description ${dd.length} chars (max ${DESC_MAX}): ${dd}`);
    if (tt.length < 20 || dd.length < 70) fail(`${url}: title or description too short`);
  }
  // Visible text: "FEI 16" style labels must not stand for the strength-of-record rank.
  const body = t.slice(t.indexOf('<body')).replace(/<script\b[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const bare = body.match(/\bFEI (\d+)(?![\d+.-])/);
  if (bare) fail(`${url}: bare "FEI ${bare[1]}" label (strength of record is "SoR")`);
  for (const m of t.matchAll(/href="(\/[^"#?]*)/g)) {
    const to = m[1] === '/' ? '/' : m[1].replace(/\/$/, '');
    if (to === url) continue;
    if (!inbound.has(to)) inbound.set(to, new Set());
    inbound.get(to).add(url);
  }
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
  // The ad loader stub (PUBLIC_ADS=on builds) is the one allowed inline script, and only on pages
  // that render an ad slot.
  const adLoader = /cfb:ads-ready/.test(t);
  const hasSlot = /class="ad-slot[\s"]/.test(t) || (game && /adsEnabled&quot;:\[0,true\]/.test(t));
  if (adLoader && !hasSlot) fail(`${url}: ad loader on a page without an ad slot`);
  if (!game) {
    const scripts = [...t.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter((m) => !/application\/ld\+json/.test(m[1]) && !/cfb:ads-ready/.test(m[2]));
    if (scripts.length) fail(`${url}: ${scripts.length} non-JSON-LD <script> on a content page`);
  }
  if (!/Ratings: <a[^>]*href="https:\/\/bcftoys\.com\/\d{4}-fei"[^>]*>FEI by Brian Fremeau<\/a>/.test(t)) fail(`${url}: no FEI attribution link`);
}

// Every compare page is linked from somewhere, and its reversed URL redirects to it.
const redirectsFile = join(out, '_redirects');
const redirects = existsSync(redirectsFile) ? readFileSync(redirectsFile, 'utf8') : '';
if (!redirects) fail('missing _redirects');
const rules = new Map(
  redirects
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/))
    .map(([from, to, code]) => [from, `${to} ${code}`]),
);
let orphans = 0;
for (const f of comparePages) {
  const url = urlOf(f);
  if (!(inbound.get(url)?.size > 0)) orphans++;
  const [a, b] = url.replace('/compare/', '').split('-vs-');
  const pairsOk = comparePages.length > 0 && rules.get(`/compare/${b}-vs-${a}`) === `${url} 301`;
  if (!pairsOk && a && b && !url.includes('-vs-', url.indexOf('-vs-') + 4)) fail(`_redirects: no 301 from /compare/${b}-vs-${a} to ${url}`);
}
if (orphans) fail(`${orphans} compare pages have no internal link`);
if (rules.size > 2000) fail(`_redirects: ${rules.size} rules (Pages allows 2,000)`);

// Sitemap + robots.
const sm = readFileSync(join(out, 'sitemap.xml'), 'utf8');
const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(ORIGIN, '') || '/');
const smSet = new Set(locs);
for (const u of indexable) if (!smSet.has(u)) fail(`sitemap missing ${u}`);
for (const u of locs) if (!indexable.includes(u)) fail(`sitemap lists non-indexable or missing ${u}`);
if (!/Sitemap: https:\/\/cfbblindresume\.com\/sitemap\.xml/.test(readFileSync(join(out, 'robots.txt'), 'utf8'))) fail('robots.txt has no sitemap');

const lens = (m) => [...m.keys()].map((k) => k.length);
console.log(
  `html pages: ${html.length} (indexable ${indexable.length}) · teams ${teamPages.length}/${nTeams} · compares ${comparePages.length} (orphans ${orphans}) · sitemap ${locs.length} URLs · redirects ${rules.size}`,
);
console.log(`title length max ${Math.max(...lens(titles))} · description length max ${Math.max(...lens(descs))}`);
if (errors.length) {
  console.error(errors.slice(0, 60).join('\n'));
  console.error(`${errors.length} problem(s)`);
  process.exit(1);
}
console.log('content checks passed');
