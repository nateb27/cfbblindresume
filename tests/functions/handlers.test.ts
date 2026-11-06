/**
 * The Functions' handlers end to end in Node: real migrations on SQLite (./d1.ts), real game data
 * behind a fake ASSETS binding. HTMLRewriter is workerd-only, so /r/{code} tag rewriting is covered
 * by scripts/fn-integration.mjs; here the shell fallback and the meta builder are checked.
 */
import { describe, expect, it } from 'vitest';
import { computeRunResults, gameTrioState } from '@lib/game-data';
import { encodeRun } from '@lib/sharecode';
import { nextTrio } from '@lib/trios';
import { rngForRound } from '@lib/rng';
import { EVENT_LIMIT, handleEvent, handleFans, handleFansTop25, handleSharedPage, handleShareImage, handleVote, VOTE_DROPPED_HEADER } from '../../functions/_lib/handlers';
import { PAGE_SECURITY_HEADERS } from '../../functions/_lib/http';
import { RATE_LIMIT } from '../../functions/_lib/ratelimit';
import { listNames, sharedMeta } from '../../functions/_lib/shared';
import { shareImageAlt, shareImageModel } from '../../functions/_lib/share-image';
import { SqliteD1 } from './d1';
import { clearWeekCache } from '../../functions/_lib/week';
import { decodePng, DEFAULT_PNG, fakeEnv, realGameData, SHELL_HTML, testAtlas } from './helpers';

const ORIGIN = 'https://cfbblindresume.test';
const gd = realGameData();
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const get = (path: string): Request => new Request(`${ORIGIN}${path}`);

function runRounds(n: number, seed = 77): string[][] {
  const rounds: string[][] = [];
  for (let r = 1; r <= n; r++) {
    const trio = nextTrio(gameTrioState(gd, rounds), rngForRound(seed, r))!;
    rounds.push([...trio].sort((a, b) => gd.teams[a]!.sor - gd.teams[b]!.sor));
  }
  return rounds;
}

describe('POST /api/vote', () => {
  const trio = gd.prior.slice(0, 3);

  it('stores a valid vote (no IP anywhere) and returns 204', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const res = await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: trio }), env, NOW);
    expect(res.status).toBe(204);
    expect(db.rows('SELECT season, week, a, b, c, created_day FROM votes')).toEqual([{ season: gd.season, week: gd.week, a: trio[0], b: trio[1], c: trio[2], created_day: '2026-11-06' }]);
    expect(db.rows('SELECT winner, loser, n FROM pair_counts ORDER BY winner, loser')).toHaveLength(3);
    const rl = db.rows<{ hash: string; count: number }>('SELECT hash, count FROM rate_limit');
    expect(rl).toHaveLength(1);
    expect(rl[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.rows('SELECT * FROM votes')) + JSON.stringify(rl)).not.toContain('203.0.113.9');
  });

  it('accepts only application/json (a cross-site JSON POST needs a preflight, which 405s)', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = JSON.stringify({ season: gd.season, week: gd.week, order: trio });
    expect((await handleVote(post('/api/vote', body, { 'Content-Type': 'text/plain;charset=UTF-8' }), env, NOW)).status).toBe(415);
    const untyped = new Request(`${ORIGIN}/api/vote`, { method: 'POST', body: new TextEncoder().encode(body) });
    expect((await handleVote(untyped, env, NOW)).status).toBe(415);
    expect((await handleVote(post('/api/vote', body, { 'Content-Type': 'application/json; charset=utf-8' }), env, NOW)).status).toBe(204);
    expect((await handleVote(new Request(`${ORIGIN}/api/vote`, { method: 'OPTIONS' }), env, NOW)).status).toBe(405);
    expect(db.rows('SELECT COUNT(*) AS n FROM votes')).toEqual([{ n: 1 }]);
  });

  it('refuses votes a browser sends from another site (403), allows same-origin and non-browser clients', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = { season: gd.season, week: gd.week, order: trio };
    const crossSite: Record<string, string>[] = [
      { Origin: 'https://evil.example' },
      { Origin: 'null' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site', Origin: 'https://www.cfbblindresume.test' },
      { 'Sec-Fetch-Site': 'same-origin', Origin: 'https://evil.example' },
    ];
    for (const h of crossSite) {
      const res = await handleVote(post('/api/vote', body, h), env, NOW);
      expect(res.status, JSON.stringify(h)).toBe(403);
    }
    expect(db.rows('SELECT COUNT(*) AS n FROM votes')).toEqual([{ n: 0 }]);
    expect((await handleVote(post('/api/vote', body, { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' }), env, NOW)).status).toBe(204);
    expect((await handleVote(post('/api/vote', body), env, NOW)).status).toBe(204); // curl-like: no browser headers
  });

  it('caps a chunked body while streaming (413 without reading it all)', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        pulled++;
        if (pulled > 1000) ctl.close();
        else ctl.enqueue(new Uint8Array(1024).fill(32));
      },
    });
    const req = new Request(`${ORIGIN}/api/vote`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    const res = await handleVote(req, fakeEnv({ db: new SqliteD1() }), NOW);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(10);
  });

  it.each([
    ['bad JSON', '{"season":', 400],
    ['an unknown week', { season: gd.season, week: 3, order: ['a', 'b', 'c'] }, 400],
    ['a non-pool team', { season: gd.season, week: gd.week, order: [trio[0], trio[1], gd.slugs.find((s) => !gd.prior.includes(s))] }, 400],
    ['duplicate teams', { season: gd.season, week: gd.week, order: [trio[0], trio[0], trio[1]] }, 400],
    ['a made-up slug', { season: gd.season, week: gd.week, order: ['miami', 'georgia', 'not-a-team'] }, 400],
    ['a huge body', JSON.stringify({ season: gd.season, week: gd.week, order: trio, pad: 'x'.repeat(5000) }), 413],
  ])('rejects %s', async (_l, body, status) => {
    const db = new SqliteD1();
    const res = await handleVote(post('/api/vote', body), fakeEnv({ db }), NOW);
    expect(res.status).toBe(status);
    expect(((await res.json()) as { error: string }).error).toBeTruthy();
    expect(db.rows('SELECT * FROM votes')).toHaveLength(0);
  });

  it('rejects other methods and content types', async () => {
    const env = fakeEnv({ db: new SqliteD1() });
    expect((await handleVote(get('/api/vote'), env)).status).toBe(405);
    expect((await handleVote(post('/api/vote', 'a=b', { 'Content-Type': 'application/x-www-form-urlencoded' }), env)).status).toBe(415);
  });

  it(`rate limits at ${RATE_LIMIT.limit} per hour per client; over the limit the vote is dropped with a 202 (no console error)`, async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = { season: gd.season, week: gd.week, order: trio };
    for (let i = 0; i < RATE_LIMIT.limit; i++) expect((await handleVote(post('/api/vote', body), env, NOW + i * 10)).status).toBe(204);
    const over = await handleVote(post('/api/vote', body), env, NOW + RATE_LIMIT.limit * 10 + 5);
    expect(over.status).toBe(202);
    expect(over.headers.get(VOTE_DROPPED_HEADER)).toBe('rate-limit');
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(over.headers.get('Cache-Control')).toBe('no-store');
    expect(await over.json()).toMatchObject({ dropped: 'rate-limit' });
    expect(db.rows('SELECT COUNT(*) AS n FROM votes')).toEqual([{ n: RATE_LIMIT.limit }]);
    expect(db.rows('SELECT SUM(n) AS n FROM pair_counts')).toEqual([{ n: 3 * RATE_LIMIT.limit }]);
    // Another client is unaffected.
    expect((await handleVote(post('/api/vote', body, { 'CF-Connecting-IP': '198.51.100.1' }), env, NOW + 2_000_000)).status).toBe(204);
  });

  it('holds under concurrency: parallel votes from one client get exactly the limit stored', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = { season: gd.season, week: gd.week, order: trio };
    const statuses = await Promise.all(Array.from({ length: RATE_LIMIT.limit + 40 }, () => handleVote(post('/api/vote', body, { 'CF-Connecting-IP': '198.51.100.77' }), env, NOW).then((r) => r.status)));
    expect(statuses.filter((x) => x === 204)).toHaveLength(RATE_LIMIT.limit);
    expect(statuses.filter((x) => x === 202)).toHaveLength(40);
    expect(db.rows('SELECT COUNT(*) AS n FROM votes')).toEqual([{ n: RATE_LIMIT.limit }]);
  });

  it('one IPv6 /64 is one client', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = { season: gd.season, week: gd.week, order: trio };
    const statuses: number[] = [];
    for (let i = 1; i <= RATE_LIMIT.limit + 10; i++) {
      statuses.push((await handleVote(post('/api/vote', body, { 'CF-Connecting-IP': `2001:db8:abcd:12::${i.toString(16)}` }), env, NOW)).status);
    }
    expect(statuses.filter((x) => x === 204)).toHaveLength(RATE_LIMIT.limit);
    expect((await handleVote(post('/api/vote', body, { 'CF-Connecting-IP': '2001:db8:abcd:13::1' }), env, NOW)).status).toBe(204);
  });

  it('deletes rate-limit rows older than 24 hours on write', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    db.db.prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?, ?, ?)').run('old', Math.floor(NOW / 1000) - 25 * 3600, 5);
    db.db.prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?, ?, ?)').run('recent', Math.floor(NOW / 1000) - 2 * 3600, 5);
    await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: trio }), env, NOW);
    const hashes = db.rows<{ hash: string }>('SELECT hash FROM rate_limit').map((r) => r.hash);
    expect(hashes).not.toContain('old');
    expect(hashes).toContain('recent');
  });

  it('503 without a database binding', async () => {
    const res = await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: trio }), fakeEnv(), NOW);
    expect(res.status).toBe(503);
  });
});

describe('GET /api/fans and /api/fans/top25', () => {
  it('returns null under 20 votes per pair, then the consensus', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const [a, b, c] = gd.prior.slice(3, 6) as [string, string, string];
    const q = `/api/fans?season=${gd.season}&week=${gd.week}&trio=${c},${a},${b}`;
    for (let i = 0; i < 19; i++) await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: [b, a, c] }, { 'CF-Connecting-IP': `10.0.0.${i}` }), env, NOW);
    const under = await handleFans(get(q), env);
    expect(under.status).toBe(200);
    expect(under.headers.get('Cache-Control')).toBe('public, max-age=60');
    const u = (await under.json()) as { consensus: string[] | null; counts: Record<string, number>; minPairVotes: number; threshold: number };
    expect(u.consensus).toBeNull();
    expect(u.minPairVotes).toBe(19);
    expect(u.threshold).toBe(20);
    expect(u.counts[`${b}>${a}`]).toBe(19);
    await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: [b, a, c] }, { 'CF-Connecting-IP': '10.0.1.1' }), env, NOW);
    const at = (await (await handleFans(get(q), env)).json()) as { consensus: string[] | null };
    expect(at.consensus).toEqual([b, a, c]);
  });

  it('validates parameters', async () => {
    const env = fakeEnv({ db: new SqliteD1() });
    expect((await handleFans(get('/api/fans?season=2026&week=9'), env)).status).toBe(400);
    expect((await handleFans(get('/api/fans?season=x&week=9&trio=a,b,c'), env)).status).toBe(400);
    expect((await handleFans(get('/api/fans?season=2026&week=9&trio=a,a,b'), env)).status).toBe(400);
    expect((await handleFansTop25(get('/api/fans/top25?season=2026'), env)).status).toBe(400);
    expect((await handleFans(post('/api/fans', {}), env)).status).toBe(405);
  });

  it('top25 is null under 200 votes, then a Bradley-Terry ranking of pool teams', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const url = `/api/fans/top25?season=${gd.season}&week=${gd.week}`;
    const empty = await handleFansTop25(get(url), env);
    expect(empty.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(await empty.json()).toEqual({ season: gd.season, week: gd.week, votes: 0, threshold: 200, top25: null, order: null });
    // 200 votes from 7 clients over real trios, ordered by FEI.
    const rounds = [...runRounds(15, 1), ...runRounds(15, 2), ...runRounds(15, 3)];
    for (let i = 0; i < 200; i++) {
      const res = await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: rounds[i % rounds.length] }, { 'CF-Connecting-IP': `192.0.2.${Math.floor(i / 29)}` }), env, NOW);
      expect(res.status).toBe(204);
    }
    const res = await handleFansTop25(get(url), env);
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const body = (await res.json()) as { votes: number; top25: string[]; order: string[] };
    expect(body.votes).toBe(200);
    expect(body.top25).toHaveLength(25);
    expect(body.top25.every((s) => gd.prior.includes(s))).toBe(true);
    expect(new Set(body.top25).size).toBe(25);
    // The full voted order (every team that appeared in a vote) starts with the top 25, so the
    // results page can show the fans' next five.
    const voted = new Set(rounds.slice(0, 200).flat());
    expect(body.order.length).toBe(voted.size);
    expect(body.order.slice(0, 25)).toEqual(body.top25);
    expect(new Set(body.order)).toEqual(voted);
  });
});

describe('POST /api/event', () => {
  it('increments allowlisted (day, name, prop) counters', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const beacon = (b: unknown) => post('/api/event', JSON.stringify(b), { 'Content-Type': 'text/plain;charset=UTF-8' });
    expect((await handleEvent(beacon({ name: 'round_completed', prop: '3', props: { round: 3 } }), env, NOW)).status).toBe(204);
    expect((await handleEvent(beacon({ name: 'round_completed', prop: '3', props: { round: 3 } }), env, NOW)).status).toBe(204);
    expect((await handleEvent(beacon({ name: 'reveal_disabled', prop: null, props: {} }), env, NOW)).status).toBe(204);
    expect((await handleEvent(beacon({ name: 'page_view', prop: null }), env, NOW)).status).toBe(400);
    expect((await handleEvent(beacon({ name: 'results_shared', prop: 'https://evil.example' }), env, NOW)).status).toBe(400);
    expect(db.rows('SELECT day, name, prop, n FROM events ORDER BY name')).toEqual([
      { day: '2026-11-06', name: 'reveal_disabled', prop: '', n: 1 },
      { day: '2026-11-06', name: 'round_completed', prop: '3', n: 2 },
    ]);
  });

  it('refuses cross-site beacons, accepts same-origin ones', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = JSON.stringify({ name: 'run_completed', prop: '30' });
    const beacon = (h: Record<string, string>) => post('/api/event', body, { 'Content-Type': 'text/plain;charset=UTF-8', 'CF-Connecting-IP': '203.0.113.50', ...h });
    expect((await handleEvent(beacon({ Origin: 'http://localhost:8793', 'Sec-Fetch-Site': 'cross-site' }), env, NOW)).status).toBe(403);
    expect((await handleEvent(beacon({ Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' }), env, NOW)).status).toBe(204);
    expect(db.rows('SELECT n FROM events')).toEqual([{ n: 1 }]);
  });

  it(`drops (204) events past ${EVENT_LIMIT.limit} per client per ${EVENT_LIMIT.windowSec / 60} minutes`, async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = JSON.stringify({ name: 'round_completed', prop: '1' });
    const t = Date.UTC(2026, 10, 6, 15, 0, 0);
    for (let i = 0; i < EVENT_LIMIT.limit + 25; i++) {
      const res = await handleEvent(post('/api/event', body, { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '203.0.113.60' }), env, t);
      expect(res.status).toBe(204);
    }
    expect(db.rows('SELECT n FROM events')).toEqual([{ n: EVENT_LIMIT.limit }]);
    await handleEvent(post('/api/event', body, { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '203.0.113.61' }), env, t);
    expect(db.rows('SELECT n FROM events')).toEqual([{ n: EVENT_LIMIT.limit + 1 }]);
  });

  it('also purges expired rate-limit rows (privacy on days without votes)', async () => {
    const db = new SqliteD1();
    db.db.prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?, ?, ?)').run('old', Math.floor(NOW / 1000) - 25 * 3600, 5);
    await handleEvent(post('/api/event', JSON.stringify({ name: 'reveal_disabled' }), { 'Content-Type': 'text/plain' }), fakeEnv({ db }), NOW);
    expect(db.rows('SELECT hash FROM rate_limit')).toEqual([]);
  });
});

describe('GET /og/r/{code}.png', () => {
  const atlas = testAtlas;

  it('renders the run top 12 from the code alone (no database)', async () => {
    const env = fakeEnv();
    const code = encodeRun({ season: gd.season, week: gd.week, rounds: runRounds(15) }, gd.slugs);
    const res = await handleShareImage(get(`/og/r/${code}.png`), env, `${code}.png`, atlas);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Cache-Control')).toContain('max-age=604800');
    expect(res.headers.get('X-Share-Image')).toBe('ranking');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
    const img = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect([img.width, img.height]).toEqual([1200, 630]);
    expect(env.DB).toBeUndefined();
  });

  it('serves the default image for garbage, bad checksums and unknown weeks', async () => {
    const env = fakeEnv();
    const good = encodeRun({ season: gd.season, week: gd.week, rounds: runRounds(15) }, gd.slugs);
    const tampered = good.slice(0, 10) + (good[10] === 'A' ? 'B' : 'A') + good.slice(11);
    const otherWeek = encodeRun({ season: gd.season, week: 3, rounds: runRounds(15) }, gd.slugs);
    for (const code of ['garbage', '!!!', tampered, otherWeek, 'x'.repeat(500)]) {
      const res = await handleShareImage(get(`/og/r/${code}.png`), env, `${code}.png`, atlas);
      expect(res.status, code).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/png');
      expect(res.headers.get('X-Share-Image')).toBe('default');
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(DEFAULT_PNG);
    }
  });

  it('falls back to a rendered brand image when /og/default.png is missing', async () => {
    const res = await handleShareImage(get('/og/r/garbage.png'), fakeEnv({ defaultImage: false }), 'garbage.png', atlas);
    const img = decodePng(new Uint8Array(await res.arrayBuffer()));
    expect([img.width, img.height]).toEqual([1200, 630]);
  });

  it('answers HEAD without a body', async () => {
    const code = encodeRun({ season: gd.season, week: gd.week, rounds: runRounds(15) }, gd.slugs);
    const res = await handleShareImage(new Request(`${ORIGIN}/og/r/${code}.png`, { method: 'HEAD' }), fakeEnv(), `${code}.png`, atlas);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.body).toBeNull();
  });
});

describe('GET /r/{code}', () => {
  it('serves the shell with 200 for a code that does not open (no console error; the island shows its error panel)', async () => {
    const good = encodeRun({ season: gd.season, week: gd.week, rounds: runRounds(15) }, gd.slugs);
    const otherWeek = encodeRun({ season: gd.season, week: 3, rounds: runRounds(15) }, gd.slugs);
    for (const code of ['garbage', good.toLowerCase(), good.slice(0, -3), otherWeek, 'x'.repeat(5000)]) {
      const res = await handleSharedPage(get(`/r/${code}`), fakeEnv(), code);
      expect(res.status, code.slice(0, 20)).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      expect(res.headers.get('X-Robots-Tag')).toBe('noindex');
      expect(await res.text()).toBe(SHELL_HTML);
    }
  });

  it('serves a valid code with 200 (the shell as-is where HTMLRewriter is unavailable)', async () => {
    const code = encodeRun({ season: gd.season, week: gd.week, rounds: runRounds(15) }, gd.slugs);
    const res = await handleSharedPage(get(`/r/${code}`), fakeEnv(), code);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    for (const [k, v] of Object.entries(PAGE_SECURITY_HEADERS)) expect(res.headers.get(k), k).toBe(v);
    expect(await res.text()).toBe(SHELL_HTML);
  });

  it('serves the generic shell (200) when the week data cannot be read at all', async () => {
    const env = fakeEnv();
    const assets = env.ASSETS;
    const code = encodeRun({ season: gd.season, week: gd.week, rounds: runRounds(15) }, gd.slugs);
    clearWeekCache();
    env.ASSETS = {
      fetch: (input: Request | URL | string) => (String(input instanceof Request ? input.url : input).includes('/game-data/') ? Promise.reject(new Error('asset fetch failed')) : assets.fetch(input)),
    };
    const res = await handleSharedPage(get(`/r/${code}`), env, code);
    expect(res.status).toBe(200);
    clearWeekCache();
  });

  it('builds per-code title, description, canonical and image tags', () => {
    const rounds = runRounds(15);
    const results = computeRunResults(gd, rounds);
    const model = shareImageModel(gd, results.ranking.order, results.playoff.byes.map((s) => s.slug));
    const code = encodeRun({ season: gd.season, week: gd.week, rounds }, gd.slugs);
    const m = sharedMeta(gd, rounds.length, results, code, 'https://cfbblindresume.com', ORIGIN, shareImageAlt(model));
    const top = results.ranking.order.slice(0, 3).map((s) => gd.teams[s]!.name);
    expect(m.socialTitle).toBe(`My blind-resume top 25: ${top.join(', ')} lead`);
    expect(m.title).toBe(`${m.socialTitle} | CFB Blind Resume`);
    expect(m.url).toBe(`https://cfbblindresume.com/r/${code}`);
    expect(m.image).toBe(`${ORIGIN}/og/r/${code}.png`);
    const byes = results.playoff.byes.map((s) => gd.teams[s.slug]!.name);
    expect(m.description).toContain(`First-round byes: ${listNames(byes)}.`);
    expect(m.description).toMatch(/^Ranked from 15 rounds of college football resumes with the names hidden, after Week 9, 2026\./);
    expect(m.description).toContain('12-team bracket');
    const partial = computeRunResults(gd, rounds.slice(0, 6));
    expect(sharedMeta(gd, 6, partial, code, 'https://cfbblindresume.com', ORIGIN, '').description).toContain('6 rounds (a partial run)');
  });

  it('listNames', () => {
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A and B');
    expect(listNames(['A', 'B', 'C', 'D'])).toBe('A, B, C and D');
  });
});
