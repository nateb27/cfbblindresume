import { describe, expect, it } from 'vitest';
import { mulberry32, shuffled, type Rng } from '../src/lib/rng';
import {
  base64urlDecode,
  base64urlEncode,
  crc16ccitt,
  decodeRun,
  encodeRun,
  parseShareCode,
  resolveShareCode,
  type SharedRun,
} from '../src/lib/sharecode';

const SLUGS = Array.from({ length: 138 }, (_, i) => `team-${String(i).padStart(3, '0')}`).sort();
const lookup = (season: number, week: number) => (season === 2026 && week === 9 ? SLUGS : null);
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function randomRun(rng: Rng, nRounds: number, season = 2026, week = 9): SharedRun {
  const rounds: [string, string, string][] = [];
  for (let r = 0; r < nRounds; r++) {
    const t = shuffled(SLUGS, rng).slice(0, 3);
    rounds.push([t[0]!, t[1]!, t[2]!]);
  }
  return { season, week, rounds };
}

/** Bytes for a hand-built payload with a correct CRC. */
function withCrc(body: number[]): string {
  const bytes = new Uint8Array(body.length + 2);
  bytes.set(body);
  const crc = crc16ccitt(bytes, body.length);
  bytes[body.length] = crc >> 8;
  bytes[body.length + 1] = crc & 255;
  return base64urlEncode(bytes);
}

describe('share code format', () => {
  it('CRC-16/CCITT-FALSE check value', () => {
    expect(crc16ccitt(new TextEncoder().encode('123456789'))).toBe(0x29b1);
  });

  it('15 rounds encode to 68 base64url characters with no padding', () => {
    const code = encodeRun(randomRun(mulberry32(1), 15), SLUGS);
    expect(code).toHaveLength(68);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('lays out bytes exactly as specified', () => {
    const run: SharedRun = { season: 2026, week: 9, rounds: [[SLUGS[5]!, SLUGS[0]!, SLUGS[137]!]] };
    const bytes = base64urlDecode(encodeRun(run, SLUGS))!;
    expect([...bytes.slice(0, 7)]).toEqual([1, 26, 9, 1, 5, 0, 137]);
    const crc = crc16ccitt(bytes, 7);
    expect([bytes[7], bytes[8]]).toEqual([crc >> 8, crc & 255]);
  });

  it('round-trips 1,000 random runs of 1..30 rounds', () => {
    const rng = mulberry32(2026);
    for (let i = 0; i < 1000; i++) {
      const run = randomRun(rng, 1 + (i % 30));
      const code = encodeRun(run, SLUGS);
      expect(code.length).toBe(((4 + 3 * run.rounds.length + 2) / 3) * 4);
      const back = decodeRun(code, lookup);
      expect(back).toEqual({ ok: true, value: run });
    }
  });

  it('round-trips other seasons and weeks through parse', () => {
    const run = randomRun(mulberry32(3), 4, 2031, 14);
    const parsed = parseShareCode(encodeRun(run, SLUGS));
    expect(parsed.ok && parsed.value.season === 2031 && parsed.value.week === 14).toBe(true);
    expect(decodeRun(encodeRun(run, SLUGS), lookup)).toMatchObject({ ok: false, error: { kind: 'week-not-found', season: 2031, week: 14 } });
  });
});

describe('share code corruption and errors', () => {
  it('detects every single-byte corruption', () => {
    const rng = mulberry32(77);
    for (const n of [1, 2, 15, 30]) {
      const code = encodeRun(randomRun(rng, n), SLUGS);
      const bytes = base64urlDecode(code)!;
      for (let pos = 0; pos < bytes.length; pos++) {
        for (let v = 0; v < 256; v++) {
          if (v === bytes[pos]) continue;
          const bad = bytes.slice();
          bad[pos] = v;
          const res = decodeRun(base64urlEncode(bad), lookup);
          expect(res.ok).toBe(false);
        }
      }
    }
  });

  it('detects every single-character substitution in the text', () => {
    const code = encodeRun(randomRun(mulberry32(5), 15), SLUGS);
    for (let i = 0; i < code.length; i++) {
      for (const ch of ALPHABET) {
        if (ch === code[i]) continue;
        const bad = code.slice(0, i) + ch + code.slice(i + 1);
        expect(decodeRun(bad, lookup).ok).toBe(false);
      }
    }
  });

  it('rejects every truncation', () => {
    const code = encodeRun(randomRun(mulberry32(6), 15), SLUGS);
    for (let len = 0; len < code.length; len++) {
      const res = decodeRun(code.slice(0, len), lookup);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(['bad-base64', 'length', 'checksum']).toContain(res.error.kind);
    }
    // Truncating whole bytes keeps valid base64 but breaks length/checksum.
    const bytes = base64urlDecode(code)!;
    for (let len = 1; len < bytes.length; len++) {
      const res = decodeRun(base64urlEncode(bytes.slice(0, len)), lookup);
      expect(res.ok).toBe(false);
    }
  });

  it('rejects garbage without throwing', () => {
    const rng = mulberry32(8);
    const samples = ['', ' ', '!!!!', 'abc', '====', 'AAAA', 'AQ', 'é漢字', 'AQ==', 'a'.repeat(5000), 'AQEB+/==', 'AQEB/AAA'];
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rng() * 80);
      let s = '';
      for (let k = 0; k < len; k++) s += String.fromCharCode(33 + Math.floor(rng() * 94));
      samples.push(s);
    }
    for (const s of samples) {
      const res = decodeRun(s, lookup);
      expect(res.ok).toBe(false);
    }
    expect(decodeRun('!!!!', lookup)).toMatchObject({ ok: false, error: { kind: 'bad-base64' } });
    expect(decodeRun('', lookup)).toMatchObject({ ok: false, error: { kind: 'bad-base64' } });
    // Non-string input from untyped callers
    expect(parseShareCode(undefined as unknown as string).ok).toBe(false);
  });

  it('a future version with an intact checksum reads as another version', () => {
    expect(decodeRun(withCrc([2, 26, 9, 1, 0, 1, 2]), lookup)).toMatchObject({ ok: false, error: { kind: 'version', version: 2 } });
    expect(decodeRun(withCrc([15, 26, 9]), lookup)).toMatchObject({ ok: false, error: { kind: 'version', version: 15 } });
    // Not a plausible version, or a damaged one: never "another version".
    expect(decodeRun(withCrc([0, 26, 9, 1, 0, 1, 2]), lookup)).toMatchObject({ ok: false, error: { kind: 'checksum' } });
    expect(decodeRun(withCrc([16, 26, 9, 1, 0, 1, 2]), lookup)).toMatchObject({ ok: false, error: { kind: 'checksum' } });
    const v2 = withCrc([2, 26, 9, 1, 0, 1, 2]);
    expect(decodeRun(v2.slice(0, -1) + (v2.endsWith('A') ? 'B' : 'A'), lookup)).toMatchObject({ ok: false, error: { kind: 'checksum' } });
  });

  it('garbled, truncated or lowercased links are damaged, not "another version"', () => {
    const code = encodeRun(randomRun(mulberry32(11), 15), SLUGS);
    const variants = [code.toLowerCase(), code.toUpperCase(), 'A'.repeat(400), 'results', code.slice(0, 20), code.slice(1), `x${code}`, `${code}xyz`];
    for (const v of variants) {
      const res = decodeRun(v, lookup);
      expect(res.ok, v.slice(0, 24)).toBe(false);
      if (!res.ok) expect(['bad-base64', 'length', 'checksum', 'round-count'], `${v.slice(0, 24)} -> ${res.error.kind}`).toContain(res.error.kind);
    }
    // Random garbage of every length never reports a version (CRC-16 false positives aside: 1 in 65,536).
    const rng = mulberry32(12);
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let versions = 0;
    for (let i = 0; i < 2000; i++) {
      let s = '';
      const len = 4 + Math.floor(rng() * 120);
      for (let k = 0; k < len; k++) s += alphabet[Math.floor(rng() * 64)];
      const res = parseShareCode(s);
      if (!res.ok && res.error.kind === 'version') versions++;
    }
    expect(versions).toBe(0);
  });

  it('index out of range', () => {
    const res = decodeRun(withCrc([1, 26, 9, 2, 0, 1, 2, 3, 200, 4]), lookup);
    expect(res).toMatchObject({ ok: false, error: { kind: 'index-out-of-range', round: 2, index: 200 } });
    expect(decodeRun(withCrc([1, 26, 9, 1, 0, 1, 138]), lookup)).toMatchObject({ ok: false, error: { kind: 'index-out-of-range' } });
    expect(decodeRun(withCrc([1, 26, 9, 1, 0, 1, 137]), lookup).ok).toBe(true);
  });

  it('duplicate team in a trio', () => {
    for (const t of [
      [5, 5, 6],
      [5, 6, 5],
      [6, 5, 5],
    ]) {
      expect(decodeRun(withCrc([1, 26, 9, 2, 0, 1, 2, ...t]), lookup)).toMatchObject({ ok: false, error: { kind: 'duplicate-team', round: 2 } });
    }
  });

  it('round count outside 1..30 and inconsistent length', () => {
    expect(decodeRun(withCrc([1, 26, 9, 0, 0, 1, 2]), lookup)).toMatchObject({ ok: false, error: { kind: 'round-count' } });
    const body31 = [1, 26, 9, 31];
    for (let r = 0; r < 31; r++) body31.push(r, r + 31, r + 62);
    expect(decodeRun(withCrc(body31), lookup)).toMatchObject({ ok: false, error: { kind: 'round-count' } });
    expect(decodeRun(withCrc([1, 26, 9, 2, 0, 1, 2]), lookup)).toMatchObject({ ok: false, error: { kind: 'length' } });
  });

  it('week not found, including a throwing lookup', () => {
    const code = encodeRun(randomRun(mulberry32(9), 3), SLUGS);
    expect(decodeRun(code, () => null)).toMatchObject({ ok: false, error: { kind: 'week-not-found' } });
    expect(
      decodeRun(code, () => {
        throw new Error('boom');
      }),
    ).toMatchObject({ ok: false, error: { kind: 'week-not-found' } });
    const parsed = parseShareCode(code);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(resolveShareCode(parsed.value, undefined).ok).toBe(false);
  });

  it('every error carries a human-readable message', () => {
    const res = decodeRun('!!', lookup);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.message.length).toBeGreaterThan(5);
  });

  it('encode rejects invalid runs', () => {
    const t: [string, string, string] = [SLUGS[0]!, SLUGS[1]!, SLUGS[2]!];
    expect(() => encodeRun({ season: 2026, week: 9, rounds: [] }, SLUGS)).toThrow(RangeError);
    expect(() => encodeRun({ season: 2026, week: 9, rounds: Array.from({ length: 31 }, () => t) }, SLUGS)).toThrow(RangeError);
    expect(() => encodeRun({ season: 2026, week: 9, rounds: [[SLUGS[0]!, SLUGS[0]!, SLUGS[1]!]] }, SLUGS)).toThrow(RangeError);
    expect(() => encodeRun({ season: 2026, week: 9, rounds: [['nope', SLUGS[0]!, SLUGS[1]!]] }, SLUGS)).toThrow(RangeError);
    expect(() => encodeRun({ season: 1999, week: 9, rounds: [t] }, SLUGS)).toThrow(RangeError);
    expect(() => encodeRun({ season: 2026, week: 256, rounds: [t] }, SLUGS)).toThrow(RangeError);
    // The input type takes plain string[][] (what the game holds), so round length is checked at runtime.
    expect(() => encodeRun({ season: 2026, week: 9, rounds: [[SLUGS[0]!, SLUGS[1]!]] }, SLUGS)).toThrow(RangeError);
    expect(() => encodeRun({ season: 2026, week: 9, rounds: [[...t, SLUGS[3]!]] }, SLUGS)).toThrow(RangeError);
  });

  it('encodes plain string[][] rounds the same as tuples', () => {
    const rounds: string[][] = [[SLUGS[5]!, SLUGS[0]!, SLUGS[137]!]];
    const code = encodeRun({ season: 2026, week: 9, rounds }, SLUGS);
    const dec = decodeRun(code, lookup);
    expect(dec.ok && dec.value.rounds).toEqual(rounds);
  });
});

describe('base64url helpers', () => {
  it('round-trip arbitrary lengths and reject non-canonical input', () => {
    const rng = mulberry32(10);
    for (let len = 0; len < 40; len++) {
      const b = new Uint8Array(len).map(() => Math.floor(rng() * 256));
      expect([...base64urlDecode(base64urlEncode(b))!]).toEqual([...b]);
    }
    expect(base64urlDecode('A')).toBeNull();
    expect(base64urlDecode('AB')).toBeNull(); // nonzero trailing bits
    expect(base64urlDecode('AA')).not.toBeNull();
    expect(base64urlDecode('A+')).toBeNull();
  });
});
