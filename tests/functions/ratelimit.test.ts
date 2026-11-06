import { describe, expect, it } from 'vitest';
import {
  allowed,
  clientIp,
  effectiveSalt,
  hashClient,
  ipv6Hextets,
  MemoryLimiter,
  previousWeight,
  RATE_LIMIT,
  rateKeyAddress,
  retryAfterSec,
  slidingCount,
  utcDay,
  voteBatch,
  windowKeys,
  windowStart,
} from '../../functions/_lib/ratelimit';
import { SqliteD1 } from './d1';

const H = RATE_LIMIT.windowSec;
const L = RATE_LIMIT.limit;
const T0 = 1_793_923_200; // a window boundary (multiple of 3600), 2026-11-06 00:00 UTC

describe('window math', () => {
  it('fixed windows', () => {
    expect(T0 % H).toBe(0);
    expect(windowStart(T0)).toBe(T0);
    expect(windowStart(T0 + H - 1)).toBe(T0);
    expect(windowStart(T0 + H)).toBe(T0 + H);
  });

  it('sliding count weights the previous window by its remaining overlap', () => {
    expect(slidingCount(10, 0, T0 + 100)).toBe(10);
    expect(slidingCount(0, 30, T0)).toBe(30);
    expect(slidingCount(0, 30, T0 + H / 2)).toBe(15);
    expect(slidingCount(5, 30, T0 + (3 * H) / 4)).toBeCloseTo(12.5, 9);
    expect(previousWeight(T0)).toBe(1);
    expect(previousWeight(T0 + H / 4)).toBe(0.75);
  });

  it(`allows ${L} per rolling hour and refuses the next`, () => {
    let current = 0;
    for (let i = 0; i < L; i++) {
      expect(allowed(current, 0, T0 + i)).toBe(true);
      current++;
    }
    expect(allowed(current, 0, T0 + L + 10)).toBe(false);
    // No boundary burst: a full window at the end of one hour still blocks early in the next.
    expect(allowed(0, L, T0 + H + 10)).toBe(false);
    // ... but capacity comes back as the old window slides out.
    expect(allowed(0, L, T0 + H + H / 2)).toBe(true);
  });

  it('fits four 30-round runs (or eight standard runs) an hour', () => {
    expect(L).toBeGreaterThanOrEqual(4 * 30);
  });

  it('retry-after points at the first second a request would pass', () => {
    const now = T0 + 600;
    expect(retryAfterSec(L, 0, now)).toBe(H - 600); // full window: wait for it to end
    const prev = L;
    const cur = Math.round(L * 0.4);
    const wait = retryAfterSec(cur, prev, now);
    expect(allowed(cur, prev, now + wait)).toBe(true);
    expect(allowed(cur, prev, now + wait - 2)).toBe(false);
    expect(retryAfterSec(0, 0, T0 + H - 1)).toBeGreaterThanOrEqual(1);
  });
});

describe('client hashing (privacy)', () => {
  it('is a salted SHA-256 that rotates with the UTC day', async () => {
    const a = await hashClient('203.0.113.7', 'salt-aaaaaaaa', '2026-11-06');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('203');
    expect(await hashClient('203.0.113.7', 'salt-aaaaaaaa', '2026-11-06')).toBe(a);
    expect(await hashClient('203.0.113.7', 'salt-aaaaaaaa', '2026-11-07')).not.toBe(a);
    expect(await hashClient('203.0.113.7', 'salt-bbbbbbbb', '2026-11-06')).not.toBe(a);
    expect(await hashClient('203.0.113.8', 'salt-aaaaaaaa', '2026-11-06')).not.toBe(a);
  });

  it('utcDay', () => {
    expect(utcDay(Date.UTC(2026, 10, 6, 23, 59, 59))).toBe('2026-11-06');
    expect(utcDay(Date.UTC(2026, 10, 7, 0, 0, 0))).toBe('2026-11-07');
  });

  it('never hashes without a secret salt: a missing IP_SALT gets a random per-isolate salt', () => {
    expect(effectiveSalt('configured-secret')).toBe('configured-secret');
    const s = effectiveSalt(undefined);
    expect(s).toMatch(/^[0-9a-f]{64}$/);
    expect(effectiveSalt('')).toBe(s);
    expect(effectiveSalt('short')).toBe(s);
  });

  it('reads the IP Cloudflare reports', () => {
    expect(clientIp(new Request('https://x/', { headers: { 'CF-Connecting-IP': '198.51.100.4' } }))).toBe('198.51.100.4');
    expect(clientIp(new Request('https://x/', { headers: { 'X-Forwarded-For': '198.51.100.5, 10.0.0.1' } }))).toBe('198.51.100.5');
    expect(clientIp(new Request('https://x/', { headers: { 'CF-Connecting-IP': '198.51.100.4', 'X-Forwarded-For': '1.2.3.4' } }))).toBe('198.51.100.4');
    expect(clientIp(new Request('https://x/'))).toBe('unknown');
  });
});

describe('rate-limit key: IPv4 address or IPv6 /64', () => {
  it('expands IPv6 addresses', () => {
    expect(ipv6Hextets('2001:db8::1')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Hextets('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipv6Hextets('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Hextets('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Hextets('[2001:DB8:0:0:1:2:3:4]')).toEqual([0x2001, 0xdb8, 0, 0, 1, 2, 3, 4]);
    expect(ipv6Hextets('::ffff:192.0.2.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0xc000, 0x0201]);
    for (const bad of ['198.51.100.4', 'unknown', '1::2::3', '2001:db8:1:2:3:4:5:6:7', '12345::1', 'g::1', '::ffff:1.2.3.300', '1:2:3:4:5:6:7']) {
      expect(ipv6Hextets(bad), bad).toBeNull();
    }
  });

  it('keeps full IPv4 addresses and cuts IPv6 to the /64', () => {
    expect(rateKeyAddress('198.51.100.4')).toBe('198.51.100.4');
    expect(rateKeyAddress('2001:db8:abcd:12::1')).toBe('2001:db8:abcd:12::/64');
    expect(rateKeyAddress('2001:0db8:abcd:0012:ffff:1:2:3')).toBe('2001:db8:abcd:12::/64');
    expect(rateKeyAddress('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(rateKeyAddress('unknown')).toBe('unknown');
  });

  it('every address of one /64 shares a key; neighbouring /64s do not', () => {
    const keys = new Set(Array.from({ length: 40 }, (_, i) => rateKeyAddress(`2001:db8:abcd:12::${(i + 1).toString(16)}`)));
    expect(keys.size).toBe(1);
    expect(rateKeyAddress('2001:db8:abcd:13::1')).not.toBe(rateKeyAddress('2001:db8:abcd:12::1'));
  });
});

describe('window keys across midnight UTC', () => {
  it('uses each window’s own day, so the previous window is found after midnight', async () => {
    const salt = 'salt-0123456789';
    const before = await windowKeys('203.0.113.7', salt, T0 - 60); // 23:59 on Nov 5
    const after = await windowKeys('203.0.113.7', salt, T0 + 60); // 00:01 on Nov 6
    expect(after.previous).toBe(before.current);
    expect(after.current).not.toBe(before.current);
    expect(after.current).toBe(await hashClient('203.0.113.7', salt, '2026-11-06'));
    const midday = await windowKeys('203.0.113.7', salt, T0 + 12 * H + 5);
    expect(midday.previous).toBe(midday.current);
  });
});

describe('voteBatch (atomic count + guarded writes)', () => {
  const insert = { insertSelect: 'INSERT INTO votes (season, week, a, b, c, created_day) SELECT ?1, ?2, ?3, ?4, ?5, ?6', params: [2026, 9, 'a', 'b', 'c', '2026-11-06'] };

  it(`accepts exactly ${L} of ${L + 30} concurrent attempts and counts every attempt`, async () => {
    const db = new SqliteD1();
    const keys = await windowKeys('198.51.100.77', 'salt-0123456789', T0 + 100);
    const decisions = await Promise.all(Array.from({ length: L + 30 }, () => voteBatch(db, keys, T0 + 100, [insert])));
    expect(decisions.filter((d) => d.allowed)).toHaveLength(L);
    expect(db.rows('SELECT COUNT(*) AS n FROM votes')).toEqual([{ n: L }]);
    expect(db.rows('SELECT count FROM rate_limit')).toEqual([{ count: L + 30 }]);
    const refused = decisions.find((d) => !d.allowed)!;
    expect(refused.retryAfter).toBeGreaterThan(0);
  });

  it('carries the limit over midnight UTC', async () => {
    const db = new SqliteD1();
    const salt = 'salt-0123456789';
    const late = T0 - 5; // 23:59:55
    const lateKeys = await windowKeys('203.0.113.9', salt, late);
    for (let i = 0; i < L; i++) expect((await voteBatch(db, lateKeys, late, [insert])).allowed).toBe(true);
    const early = T0 + 5; // 00:00:05, the next UTC day
    const earlyKeys = await windowKeys('203.0.113.9', salt, early);
    expect((await voteBatch(db, earlyKeys, early, [insert])).allowed).toBe(false);
  });

  it('purges rows whose window started more than 24 hours ago', async () => {
    const db = new SqliteD1();
    db.db.prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?, ?, ?)').run('old', T0 - 25 * H, 5);
    db.db.prepare('INSERT INTO rate_limit (hash, window_start, count) VALUES (?, ?, ?)').run('recent', T0 - 2 * H, 5);
    await voteBatch(db, await windowKeys('203.0.113.9', 'salt-0123456789', T0), T0, [insert]);
    const hashes = db.rows<{ hash: string }>('SELECT hash FROM rate_limit').map((r) => r.hash);
    expect(hashes).not.toContain('old');
    expect(hashes).toContain('recent');
  });
});

describe('MemoryLimiter', () => {
  it('caps a key per fixed window and resets with the next window', () => {
    const m = new MemoryLimiter(3, 600);
    expect([1, 2, 3, 4].map(() => m.hit('k', 1000))).toEqual([true, true, true, false]);
    expect(m.hit('other', 1000)).toBe(true);
    expect(m.hit('k', 1200)).toBe(true); // next 600 s window
  });

  it('forgets everything rather than grow past maxKeys', () => {
    const m = new MemoryLimiter(1, 600, 2);
    expect(m.hit('a', 0)).toBe(true);
    expect(m.hit('a', 0)).toBe(false);
    m.hit('b', 0);
    m.hit('c', 0); // third key: cleared first
    expect(m.hit('a', 0)).toBe(true);
  });
});
