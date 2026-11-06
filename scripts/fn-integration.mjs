#!/usr/bin/env node
/**
 * End-to-end check of the Pages Functions on the real local runtime (workerd via wrangler):
 *
 *   1. builds the site into a scratch dist (npx astro build --outDir ...; skip with --skip-build)
 *   2. applies migrations/ to a fresh local D1 (wrangler d1 migrations apply --local)
 *   3. runs `wrangler pages dev <dist> --port 8788` and exercises every endpoint:
 *      votes (204 / 400 / 405 / 429 on the 31st in an hour), fans (null under 20 votes per pair,
 *      then a consensus; 60s caching), fans top 25 (null under 200 votes, then 25 pool teams),
 *      events (allowlisted counters), /r/{code} tags (per-code title, og:image, canonical) and
 *      /r/garbage (generic tags), /og/r/{code}.png (1200x630 PNG; default image for garbage)
 *   4. checks D1 holds no IP address, saves a sample share image, prints a summary
 *
 * Usage: node scripts/fn-integration.mjs [--skip-build] [--keep] [--wait-cache]
 *   --keep        leave the dev server running at http://127.0.0.1:8788
 *   --wait-cache  also wait 61 s to see a cached fans answer refresh
 * Env: FN_SCRATCH (default: the session scratchpad), FN_PORT (8788).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, createWriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.FN_SCRATCH ?? '/tmp/claude-0/-home-user/38da28a1-5927-5734-b75e-1321c36c6410/scratchpad';
const DIST = join(SCRATCH, 'backend-dist');
const OUT = join(SCRATCH, 'backend');
const STATE = join(OUT, 'wrangler-state');
const PORT = Number(process.env.FN_PORT ?? 8788);
const BASE = `http://127.0.0.1:${PORT}`;
const args = new Set(process.argv.slice(2));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1' };

mkdirSync(OUT, { recursive: true });

const results = [];
let failed = 0;
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: root, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  if (r.status !== 0) {
    console.error(r.stdout, r.stderr);
    throw new Error(`${cmd} ${cmdArgs.join(' ')} exited ${r.status}`);
  }
  return r.stdout;
}

/** Run SQL against the local D1 and return rows. */
function sql(query) {
  const out = run('npx', ['wrangler', 'd1', 'execute', 'cfbblindresume', '--local', '--persist-to', STATE, '--json', '--command', query]);
  const json = JSON.parse(out.slice(out.indexOf('[')));
  return json[0]?.results ?? [];
}

/* ------------------------------------------------------------------ lib (bundled from src/lib) */

async function loadLib() {
  const esbuild = await import('esbuild');
  const entry = `export { encodeRun } from '@lib/sharecode'; export { nextTrio } from '@lib/trios'; export { rngForRound } from '@lib/rng';
    export { gameTrioState, computeRunResults } from '@lib/game-data';`;
  const out = await esbuild.build({
    stdin: { contents: entry, resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    write: false,
    alias: { '@lib': join(root, 'src/lib') },
    logLevel: 'error',
  });
  const file = join(OUT, 'fn-integration-lib.mjs');
  writeFileSync(file, out.outputFiles[0].text);
  return import(file);
}

/* ------------------------------------------------------------------ server */

async function waitFor(url, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function startServer() {
  const log = createWriteStream(join(OUT, 'pages-dev.log'));
  const child = spawn(
    'npx',
    ['wrangler', 'pages', 'dev', DIST, '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', STATE, '--binding', 'IP_SALT=integration-salt-0123456789'],
    { cwd: root, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  return child;
}

function stopServer(child) {
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    /* already gone */
  }
}

/* ------------------------------------------------------------------ helpers */

const json = (r) => r.json();

function vote(order, ip, gd) {
  return fetch(`${BASE}/api/vote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ season: gd.season, week: gd.week, order }),
  });
}

function pngSize(buf) {
  const b = Buffer.from(buf);
  const sig = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return { sig, type: b.toString('ascii', 12, 16), width: b.readUInt32BE(16), height: b.readUInt32BE(20), colorType: b[25] };
}

/** Inflate every IDAT and confirm the scanline count (independent of the encoder). */
function pngInflates(buf) {
  const b = Buffer.from(buf);
  const { width, height, colorType } = pngSize(b);
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const idat = [];
  for (let o = 8; o < b.length; ) {
    const len = b.readUInt32BE(o);
    if (b.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  return inflateSync(Buffer.concat(idat)).length === (width * bpp + 1) * height;
}

const metaContent = (html, attr, key) => html.match(new RegExp(`<meta[^>]*${attr}="${key.replace(/[:]/g, '\\:')}"[^>]*content="([^"]*)"`))?.[1] ?? html.match(new RegExp(`<meta[^>]*content="([^"]*)"[^>]*${attr}="${key}"`))?.[1];
const titleOf = (html) => html.match(/<title>([^<]*)<\/title>/)?.[1];
const canonicalOf = (html) => html.match(/<link[^>]*rel="canonical"[^>]*href="([^"]*)"/)?.[1];
const decode = (s) => (s ?? '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"');

/* ------------------------------------------------------------------ main */

async function main() {
  if (!args.has('--skip-build') || !existsSync(join(DIST, 'r.html'))) {
    console.log(`building site into ${DIST} ...`);
    rmSync(DIST, { recursive: true, force: true });
    run('npx', ['astro', 'build', '--outDir', DIST]);
  }
  const gdFile = readdirSync(join(DIST, 'game-data')).filter((f) => /^\d{4}-\d+\.json$/.test(f)).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).pop();
  const gd = JSON.parse(readFileSync(join(DIST, 'game-data', gdFile), 'utf8'));
  const lib = await loadLib();

  rmSync(STATE, { recursive: true, force: true });
  run('npx', ['wrangler', 'd1', 'migrations', 'apply', 'cfbblindresume', '--local', '--persist-to', STATE]);
  const tables = sql("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name);
  check('migrations apply to a fresh local D1', ['votes', 'pair_counts', 'vote_totals', 'rate_limit', 'events'].every((t) => tables.includes(t)), tables.join(', '));

  const server = startServer();
  const cleanup = () => stopServer(server);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  try {
    check(`wrangler pages dev is up on :${PORT}`, await waitFor(`${BASE}/`, 60_000));

    // A real 15-round run from the island's own trio selector.
    const rounds = [];
    for (let r = 1; r <= 15; r++) {
      const trio = lib.nextTrio(lib.gameTrioState(gd, rounds), lib.rngForRound(4242, r));
      rounds.push([...trio].sort((a, b) => gd.teams[a].sor - gd.teams[b].sor));
    }
    const code = lib.encodeRun({ season: gd.season, week: gd.week, rounds }, gd.slugs);
    const expected = lib.computeRunResults(gd, rounds);

    /* ---------------- votes */
    const [p0, p1, p2, p3, p4, p5, p6, p7, p8] = gd.prior;
    let r = await vote([p0, p1, p2], '203.0.113.10', gd);
    check('POST /api/vote valid -> 204', r.status === 204, String(r.status));
    const nonPool = gd.slugs.find((s) => !gd.prior.includes(s));
    for (const [label, order] of [
      ['unknown slug', [p0, p1, 'not-a-team']],
      ['non-pool team', [p0, p1, nonPool]],
      ['duplicate team', [p0, p0, p1]],
      ['two teams', [p0, p1]],
    ]) {
      r = await vote(order, '203.0.113.10', gd);
      check(`POST /api/vote ${label} -> 400`, r.status === 400, `${r.status} ${JSON.stringify(await r.json())}`);
    }
    r = await fetch(`${BASE}/api/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ season: gd.season, week: 1, order: [p0, p1, p2] }) });
    check('POST /api/vote week without data -> 400', r.status === 400, String(r.status));
    r = await fetch(`${BASE}/api/vote`);
    check('GET /api/vote -> 405', r.status === 405 && r.headers.get('allow') === 'POST', String(r.status));

    /* ---------------- fans (trio T queried under the threshold; T2 never queried before) */
    const T = [p3, p4, p5];
    const T2 = [p6, p7, p8];
    const fansUrl = (t) => `${BASE}/api/fans?season=${gd.season}&week=${gd.week}&trio=${[...t].reverse().join(',')}`;
    for (let i = 0; i < 19; i++) await vote([T[1], T[0], T[2]], `198.51.100.${i + 1}`, gd);
    r = await fetch(fansUrl(T));
    let body = await json(r);
    check('GET /api/fans under 20 votes per pair -> consensus null', r.status === 200 && body.consensus === null && body.minPairVotes === 19, JSON.stringify(body));
    check('GET /api/fans Cache-Control 60s', r.headers.get('cache-control') === 'public, max-age=60');
    await vote([T[1], T[0], T[2]], '198.51.100.99', gd);
    body = await json(await fetch(fansUrl(T)));
    check('GET /api/fans is cached for 60s (still the earlier answer)', body.consensus === null, `minPairVotes ${body.minPairVotes}`);
    for (let i = 0; i < 21; i++) await vote([T2[2], T2[0], T2[1]], `198.51.100.${i + 1}`, gd);
    body = await json(await fetch(fansUrl(T2)));
    check('GET /api/fans with 20+ votes on every pair -> consensus', JSON.stringify(body.consensus) === JSON.stringify([T2[2], T2[0], T2[1]]), JSON.stringify(body.consensus));
    if (args.has('--wait-cache')) {
      await new Promise((res) => setTimeout(res, 61_000));
      body = await json(await fetch(fansUrl(T)));
      check('GET /api/fans after the cache expires -> consensus', JSON.stringify(body.consensus) === JSON.stringify([T[1], T[0], T[2]]), JSON.stringify(body.consensus));
    }

    /* ---------------- rate limit: 30 per hour per client */
    const ip = '192.0.2.200';
    let accepted = 0;
    let firstRefused = null;
    for (let i = 0; i < 32; i++) {
      r = await vote(rounds[i % rounds.length], ip, gd);
      if (r.status === 204) accepted++;
      else if (firstRefused === null) firstRefused = { at: i + 1, status: r.status, retry: r.headers.get('retry-after') };
    }
    check('rate limit: 30 votes accepted, the 31st -> 429 with Retry-After', accepted === 30 && firstRefused?.at === 31 && firstRefused.status === 429 && Number(firstRefused.retry) > 0, JSON.stringify({ accepted, firstRefused }));
    r = await vote([p0, p1, p2], '192.0.2.201', gd);
    check('rate limit is per client (another IP still 204)', r.status === 204, String(r.status));

    /* ---------------- fans top 25 */
    const topUrl = `${BASE}/api/fans/top25?season=${gd.season}&week=${gd.week}`;
    r = await fetch(topUrl);
    body = await json(r);
    check('GET /api/fans/top25 under 200 votes -> null', body.top25 === null && body.votes < 200 && body.threshold === 200, `votes ${body.votes}`);
    check('GET /api/fans/top25 Cache-Control 300s', r.headers.get('cache-control') === 'public, max-age=300');
    const before = body.votes;
    const need = 200 - before;
    const pool = [];
    for (let s = 1; s <= 3; s++) {
      const rs = [];
      for (let k = 1; k <= 15; k++) {
        const t = lib.nextTrio(lib.gameTrioState(gd, rs), lib.rngForRound(9000 + s, k));
        rs.push([...t].sort((a, b) => gd.teams[a].sor - gd.teams[b].sor));
      }
      pool.push(...rs);
    }
    let seeded = 0;
    for (let i = 0; i < need; i++) {
      const res = await vote(pool[i % pool.length], `10.20.${Math.floor(i / 25)}.${i % 25}`, gd);
      if (res.status === 204) seeded++;
    }
    check(`seeded ${need} more votes through the API from ${Math.ceil(need / 25)} clients`, seeded === need, `${seeded}/${need}`);
    // The 300s cache still holds the earlier answer; the totals row proves the threshold is met.
    const totals = sql(`SELECT n FROM vote_totals WHERE season = ${gd.season} AND week = ${gd.week}`)[0]?.n;
    check('vote_totals counts every accepted vote', totals === before + need, `${totals}`);
    // The answer above is cached for 300 s under a normalized key; the top 25 itself is checked on
    // a fresh server with an empty cache at the end.

    /* ---------------- events */
    for (const b of [
      { name: 'round_completed', prop: '1', props: { round: 1 } },
      { name: 'round_completed', prop: '1', props: { round: 1 } },
      { name: 'results_shared', prop: 'copy', props: { channel: 'copy' } },
      { name: 'reveal_disabled', prop: null, props: {} },
    ]) {
      r = await fetch(`${BASE}/api/event`, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(b) });
      if (r.status !== 204) check(`POST /api/event ${b.name}`, false, String(r.status));
    }
    r = await fetch(`${BASE}/api/event`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ name: 'page_view', prop: '/' }) });
    check('POST /api/event unknown name -> 400', r.status === 400, String(r.status));
    const ev = sql('SELECT name, prop, n FROM events ORDER BY name, prop');
    check('event counters (day, name, prop) incremented', JSON.stringify(ev) === JSON.stringify([
      { name: 'results_shared', prop: 'copy', n: 1 },
      { name: 'reveal_disabled', prop: '', n: 1 },
      { name: 'round_completed', prop: '1', n: 2 },
    ]), JSON.stringify(ev));

    /* ---------------- /r/{code} */
    r = await fetch(`${BASE}/r/${code}`);
    let html = await r.text();
    const names = expected.ranking.order.slice(0, 3).map((s) => gd.teams[s].name);
    const title = decode(titleOf(html));
    check('/r/{code} 200 text/html', r.status === 200 && (r.headers.get('content-type') ?? '').includes('text/html'), `${r.status}`);
    check('/r/{code} per-code <title> names the top three', title === `My blind-resume top 25: ${names.join(', ')} lead | CFB Blind Resume`, title);
    check('/r/{code} og:image = /og/r/{code}.png', metaContent(html, 'property', 'og:image') === `${BASE}/og/r/${code}.png`, metaContent(html, 'property', 'og:image'));
    check('/r/{code} twitter:image matches', metaContent(html, 'name', 'twitter:image') === `${BASE}/og/r/${code}.png`);
    check('/r/{code} canonical + og:url on the site origin', canonicalOf(html) === `https://cfbblindresume.com/r/${code}` && metaContent(html, 'property', 'og:url') === `https://cfbblindresume.com/r/${code}`, canonicalOf(html));
    const desc = decode(metaContent(html, 'name', 'description'));
    check('/r/{code} description (rounds, week, byes)', desc.startsWith(`Ranked from 15 rounds`) && desc.includes('First-round byes:'), desc);
    check('/r/{code} og:image:alt lists the top 12', decode(metaContent(html, 'property', 'og:image:alt')).includes(`12 ${gd.teams[expected.ranking.order[11]].name}`));
    check('/r/{code} keeps noindex', /<meta name="robots" content="noindex"/.test(html) && r.headers.get('x-robots-tag') === 'noindex');
    check('/r/{code} still mounts the island', html.includes('astro-island') || html.includes('Blind resume game'));
    writeFileSync(join(OUT, 'r-valid.html'), html);

    r = await fetch(`${BASE}/r/garbage`);
    html = await r.text();
    check('/r/garbage -> 200 shell with generic tags', r.status === 200 && decode(titleOf(html)) === 'A Shared Blind Resume Ranking | CFB Blind Resume' && /og\/default\.png/.test(metaContent(html, 'property', 'og:image') ?? ''), decode(titleOf(html)));

    /* ---------------- /og/r/{code}.png */
    const t0 = performance.now();
    r = await fetch(`${BASE}/og/r/${code}.png`);
    const png = new Uint8Array(await r.arrayBuffer());
    const firstMs = performance.now() - t0;
    const size = pngSize(png);
    check('/og/r/{code}.png -> image/png 1200x630', r.status === 200 && r.headers.get('content-type') === 'image/png' && size.sig && size.width === 1200 && size.height === 630, JSON.stringify(size));
    check('/og/r/{code}.png PNG inflates to 630 scanlines', pngInflates(png));
    check('/og/r/{code}.png long cache headers', (r.headers.get('cache-control') ?? '').includes('max-age=604800'), r.headers.get('cache-control'));
    writeFileSync(join(OUT, 'share-integration.png'), png);
    const t1 = performance.now();
    const again = new Uint8Array(await (await fetch(`${BASE}/og/r/${code}.png`)).arrayBuffer());
    check('/og/r/{code}.png second request identical (Cache API)', Buffer.from(again).equals(Buffer.from(png)), `first ${firstMs.toFixed(0)} ms, second ${(performance.now() - t1).toFixed(0)} ms wall`);
    r = await fetch(`${BASE}/og/r/${code}.png`, { method: 'HEAD' });
    check('HEAD /og/r/{code}.png', r.status === 200 && r.headers.get('content-type') === 'image/png');

    const def = new Uint8Array(await (await fetch(`${BASE}/og/default.png`)).arrayBuffer());
    for (const bad of ['garbage', code.slice(0, -2) + (code.endsWith('AA') ? 'BB' : 'AA')]) {
      r = await fetch(`${BASE}/og/r/${bad}.png`);
      const b = new Uint8Array(await r.arrayBuffer());
      check(`/og/r/${bad === 'garbage' ? 'garbage' : '{tampered}'}.png -> default image`, r.status === 200 && r.headers.get('content-type') === 'image/png' && Buffer.from(b).equals(Buffer.from(def)), `${b.length} bytes`);
    }

    /* ---------------- privacy */
    const rl = sql('SELECT hash, window_start, count FROM rate_limit');
    const dump = JSON.stringify(rl) + JSON.stringify(sql('SELECT * FROM votes LIMIT 50'));
    check('D1 stores no IP address (only 64-hex salted hashes)', rl.length > 0 && rl.every((x) => /^[0-9a-f]{64}$/.test(x.hash)) && !/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(dump), `${rl.length} rate-limit rows`);
    const cols = sql("SELECT name FROM pragma_table_info('votes')").map((x) => x.name);
    check('votes columns are season, week, a, b, c, created_day only', JSON.stringify(cols) === JSON.stringify(['id', 'season', 'week', 'a', 'b', 'c', 'created_day']), cols.join(','));
  } finally {
    if (!args.has('--keep')) cleanup();
  }

  /* ---------------- top 25 over the threshold, on a fresh server (empty zone cache) */
  if (!args.has('--keep')) {
    await new Promise((res) => setTimeout(res, 1500));
    rmSync(join(STATE, 'v3', 'cache'), { recursive: true, force: true });
    const server2 = startServer();
    try {
      await waitFor(`${BASE}/`, 60_000);
      const body = await json(await fetch(`${BASE}/api/fans/top25?season=${gd.season}&week=${gd.week}`));
      check('GET /api/fans/top25 at 200+ votes -> 25 pool teams (Bradley-Terry)', Array.isArray(body.top25) && body.top25.length === 25 && body.top25.every((s) => gd.prior.includes(s)) && body.votes >= 200, `votes ${body.votes}: ${(body.top25 ?? []).slice(0, 5).join(', ')} ...`);
    } finally {
      stopServer(server2);
    }
  }

  const summary = { passed: results.filter((x) => x.ok).length, failed, results };
  writeFileSync(join(OUT, 'fn-integration.json'), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.passed} passed, ${failed} failed. Sample share image: ${join(OUT, 'share-integration.png')}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
