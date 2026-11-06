import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { computeRunResults, gameTrioState } from '@lib/game-data';
import { nextTrio } from '@lib/trios';
import { rngForRound } from '@lib/rng';
import { colors, teamPaint } from '../../src/styles/tokens';
import { drawable, findStrike, fitStrike, layout, measure, strikeSizes, type AtlasJson } from '../../functions/_lib/atlas';
import { paintShareImage, renderBrandImage, renderShareImage, SHARE, shareImageAlt, shareImageModel } from '../../functions/_lib/share-image';
import { decodePng, pixelHex, realGameData, testAtlas } from './helpers';

const D = colors.dark;

describe('glyph atlas', () => {
  it('matches its manifest (bytes + sha256) and has every strike DESIGN.md §16 needs', () => {
    const json = JSON.parse(readFileSync('functions/_lib/atlas.json', 'utf8')) as AtlasJson & { sha256: string };
    const bin = readFileSync('functions/_lib/atlas.bin');
    expect(bin.length).toBe(json.bytes);
    expect(createHash('sha256').update(bin).digest('hex')).toBe(json.sha256);
    const atlas = testAtlas();
    expect(strikeSizes(atlas, 700)).toEqual([76, 40, 34, 32, 30, 28, 26]);
    expect(strikeSizes(atlas, 600)).toEqual([30, 28, 26]);
  });

  it('can draw every FBS school name in caps at every name size, without fallbacks', () => {
    const atlas = testAtlas();
    const names = new Set<string>();
    for (const season of readdirSync('data').filter((d) => /^\d{4}$/.test(d))) {
      for (const f of readdirSync(`data/${season}`).filter((x) => /^week-\d+\.json$/.test(x))) {
        const week = JSON.parse(readFileSync(`data/${season}/${f}`, 'utf8')) as { teams: Record<string, { name: string; short: string }> };
        for (const t of Object.values(week.teams)) names.add(t.name.toUpperCase()).add(t.short.toUpperCase());
      }
    }
    expect(names.size).toBeGreaterThan(100);
    for (const size of [34, 32, 30, 28, 26]) {
      const strike = findStrike(atlas, 700, size);
      for (const n of names) expect(drawable(strike, n).join(''), `${n} @${size}`).toBe(n);
    }
  });

  it('falls back gracefully for characters it does not have', () => {
    const strike = findStrike(testAtlas(), 700, 34);
    expect(drawable(strike, 'HAWAIʻI').join('')).toBe('HAWAIʻI');
    expect(drawable(strike, 'ŁÓDŹ').join('')).toBe(' ÓDZ');
  });

  it('measures with kerning and tracking, and snaps glyphs to sub-pixel phases', () => {
    const atlas = testAtlas();
    const s = findStrike(atlas, 700, 34);
    const av = measure(atlas, s, 'AV');
    expect(av).toBeLessThan(measure(atlas, s, 'A') + measure(atlas, s, 'V')); // GPOS kern
    expect(measure(atlas, s, 'ABC', 2) - measure(atlas, s, 'ABC')).toBeCloseTo(4, 6); // tracking between glyphs, not after
    const a = layout(atlas, s, 'I', 10);
    const b = layout(atlas, s, 'I', 10.5);
    expect(a[0]!.x).toBe(10);
    expect(b[0]!.x).toBe(10);
    expect(b[0]!.mask).not.toBe(a[0]!.mask); // a different phase
    expect(layout(atlas, s, 'I', 10.95)[0]!.x).toBe(11);
  });

  it('fitStrike shrinks in 2px steps', () => {
    const atlas = testAtlas();
    const wide = 'MIDDLE TENNESSEE STATE';
    const fit = fitStrike(atlas, 700, wide, measure(atlas, findStrike(atlas, 700, 30), wide, 0.5), 34, 26, 0.5);
    expect(fit.strike.size).toBe(30);
    expect(fit.fits).toBe(true);
    expect(fitStrike(atlas, 700, wide, 10, 34, 26).fits).toBe(false);
  });
});

function loadAllTeams(): Record<string, { name: string }> {
  return (JSON.parse(readFileSync('data/2026/week-9.json', 'utf8')) as { teams: Record<string, { name: string }> }).teams;
}

/** A plausible 15-round run: trios from the real selector, ordered by FEI GWD rank with a twist. */
function sampleRun(): string[][] {
  const gd = realGameData();
  const rounds: string[][] = [];
  for (let r = 1; r <= 15; r++) {
    const trio = nextTrio(gameTrioState(gd, rounds), rngForRound(1234, r))!;
    const sorted = [...trio].sort((a, b) => gd.teams[a]!.sor - gd.teams[b]!.sor);
    if (r % 4 === 0) sorted.reverse();
    rounds.push(sorted);
  }
  return rounds;
}

describe('share image', () => {
  const gd = realGameData();

  it('models the top 12 of the ranking with byes from the playoff result', () => {
    const results = computeRunResults(gd, sampleRun());
    const m = shareImageModel(gd, results.ranking.order, results.playoff.byes.map((s) => s.slug));
    expect(m.title).toBe('My top 12');
    expect(m.kicker).toBe(`${gd.label} · ${gd.season}`);
    expect(m.rows).toHaveLength(12);
    expect(m.rows.map((r) => r.name)).toEqual(results.ranking.order.slice(0, 12).map((s) => gd.teams[s]!.name));
    expect(m.rows.filter((r) => r.bye).map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    expect(shareImageAlt(m)).toMatch(/^My top 12 of a blind-resume college football ranking, After Week 9 · 2026: 1 .+, 12 .+\. Ratings: FEI by Brian Fremeau\.$/);
  });

  it('renders a 1200x630 palette PNG with the DESIGN.md layout', async () => {
    const order = gd.committee!;
    const m = shareImageModel(gd, order);
    const bytes = await renderShareImage(m, testAtlas());
    const img = decodePng(bytes);
    expect([img.width, img.height, img.colorType]).toEqual([1200, 630, 3]);
    expect(img.palette!.length / 3).toBeLessThanOrEqual(256);
    expect(img.chunks.every((c) => c.crcOk)).toBe(true);
    expect(bytes.length).toBeLessThan(60_000);

    expect(pixelHex(img, 600, 3)).toBe(D['accent-fill']); // accent bar
    expect(pixelHex(img, 600, 20)).toBe(D.page);
    const S = SHARE;
    const colW = (S.width - 2 * S.pad - S.colGap) / 2;
    for (let i = 0; i < 12; i++) {
      const x = S.pad + Math.floor(i / 6) * (colW + S.colGap);
      const y = S.top + (i % 6) * (S.rowH + S.rowGap);
      const p = teamPaint(gd.teams[order[i]!]!.colors);
      expect(pixelHex(img, x + 3, y + 3), `plate ${i + 1}`).toBe(i < 4 ? D['accent-fill'] : D['raised-2']);
      expect(pixelHex(img, x + colW - 6, y + 20), `block ${i + 1}`).toBe(p.bg);
      expect(pixelHex(img, x + colW - 6, y + S.rowH - 2), `rule ${i + 1}`).toBe(p.rule);
      if (p.edge) expect(pixelHex(img, x + S.plate, y + 20), `edge ${i + 1}`).toBe(p.edge);
    }
    // The name is drawn in the block's ink: some pixel in the name area has exactly that color.
    const p0 = teamPaint(gd.teams[order[0]!]!.colors);
    let inked = 0;
    for (let x = S.pad + S.plate + 20; x < S.pad + S.plate + 140; x++) for (let y = S.top + 16; y < S.top + 44; y++) if (pixelHex(img, x, y) === p0.ink) inked++;
    expect(inked).toBeGreaterThan(100);
  });

  it('is deterministic and fast once warm', async () => {
    const atlas = testAtlas();
    const m = shareImageModel(gd, gd.prior);
    const a = await renderShareImage(m, atlas);
    const b = await renderShareImage(m, atlas);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    for (let i = 0; i < 5; i++) paintShareImage(m, atlas);
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) paintShareImage(m, atlas);
    expect((performance.now() - t0) / 10).toBeLessThan(25); // generous bound; real numbers in functions/README.md
  });

  it('fits every school name in its block (34px, shrinking to 26px) clear of the record', () => {
    const atlas = testAtlas();
    const S = SHARE;
    const maxW = (S.width - 2 * S.pad - S.colGap) / 2 - S.plate - 110;
    for (const t of Object.values(loadAllTeams())) {
      const fit = fitStrike(atlas, 700, t.name.toUpperCase(), maxW, 34, 26, 0.5);
      expect(fit.fits, t.name).toBe(true);
    }
  });

  it('renders the generic brand image', async () => {
    const img = decodePng(await renderBrandImage(testAtlas()));
    expect([img.width, img.height]).toEqual([1200, 630]);
    expect(pixelHex(img, 10, 2)).toBe(D['accent-fill']);
  });
});
