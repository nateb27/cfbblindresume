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
import { handleEvent, handleFans, handleFansTop25, handleSharedPage, handleShareImage, handleVote } from '../../functions/_lib/handlers';
import { RATE_LIMIT } from '../../functions/_lib/ratelimit';
import { listNames, sharedMeta } from '../../functions/_lib/shared';
import { shareImageAlt, shareImageModel } from '../../functions/_lib/share-image';
import { SqliteD1 } from './d1';
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
    expect(db.rows('SELECT n FROM vote_totals')).toEqual([{ n: 1 }]);
    const rl = db.rows<{ hash: string; count: number }>('SELECT hash, count FROM rate_limit');
    expect(rl).toHaveLength(1);
    expect(rl[0]!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(db.rows('SELECT * FROM votes')) + JSON.stringify(rl)).not.toContain('203.0.113.9');
  });

  it('accepts a text/plain body (sendBeacon)', async () => {
    const env = fakeEnv({ db: new SqliteD1() });
    const res = await handleVote(post('/api/vote', JSON.stringify({ season: gd.season, week: gd.week, order: trio }), { 'Content-Type': 'text/plain;charset=UTF-8' }), env, NOW);
    expect(res.status).toBe(204);
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

  it('rate limits at 30 per hour per client, without counting refused votes', async () => {
    const db = new SqliteD1();
    const env = fakeEnv({ db });
    const body = { season: gd.season, week: gd.week, order: trio };
    for (let i = 0; i < RATE_LIMIT.limit; i++) expect((await handleVote(post('/api/vote', body), env, NOW + i * 1000)).status).toBe(204);
    const over = await handleVote(post('/api/vote', body), env, NOW + 40_000);
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(db.rows('SELECT n FROM vote_totals')).toEqual([{ n: RATE_LIMIT.limit }]);
    expect(db.rows('SELECT count FROM rate_limit')).toEqual([{ count: RATE_LIMIT.limit }]);
    // Another client is unaffected.
    expect((await handleVote(post('/api/vote', body, { 'CF-Connecting-IP': '198.51.100.1' }), env, NOW + 41_000)).status).toBe(204);
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
    expect(await empty.json()).toEqual({ season: gd.season, week: gd.week, votes: 0, threshold: 200, top25: null });
    // 200 votes from 7 clients over real trios, ordered by FEI.
    const rounds = [...runRounds(15, 1), ...runRounds(15, 2), ...runRounds(15, 3)];
    for (let i = 0; i < 200; i++) {
      const res = await handleVote(post('/api/vote', { season: gd.season, week: gd.week, order: rounds[i % rounds.length] }, { 'CF-Connecting-IP': `192.0.2.${Math.floor(i / 29)}` }), env, NOW);
      expect(res.status).toBe(204);
    }
    const body = (await (await handleFansTop25(get(url), env)).json()) as { votes: number; top25: string[] };
    expect(body.votes).toBe(200);
    expect(body.top25).toHaveLength(25);
    expect(body.top25.every((s) => gd.prior.includes(s))).toBe(true);
    expect(new Set(body.top25).size).toBe(25);
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
  it('serves the shell (generic tags) where HTMLRewriter is unavailable or the code is invalid', async () => {
    const res = await handleSharedPage(get('/r/garbage'), fakeEnv(), 'garbage');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=0, must-revalidate');
    expect(await res.text()).toBe(SHELL_HTML);
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
