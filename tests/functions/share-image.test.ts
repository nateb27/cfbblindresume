import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { computeRunResults, gameTrioState } from '@lib/game-data';
import { nextTrio } from '@lib/trios';
import { rngForRound } from '@lib/rng';
import { colors, teamPaint } from '../../src/styles/tokens';
import { drawable, findStrike, fitStrike, layout, measure, strikeSizes, type AtlasJson } from '../../functions/_lib/atlas';
import { paintShareImage, renderBrandImage, renderShareImage, SHARE, shareHook, shareImageAlt, shareImageModel } from '../../functions/_lib/share-image';
import { decodePng, pixelHex, realGameData, testAtlas } from './helpers';

const P = colors.light;

describe('glyph atlas', () => {
  it('matches its manifest (bytes + sha256), is Archivo 600/800, and has every strike DESIGN.md needs', () => {
    const json = JSON.parse(readFileSync('functions/_lib/atlas.json', 'utf8')) as AtlasJson & { sha256: string; font: string };
    const bin = readFileSync('functions/_lib/atlas.bin');
    expect(bin.length).toBe(json.bytes);
    expect(createHash('sha256').update(bin).digest('hex')).toBe(json.sha256);
    expect(json.font).toMatch(/^Archivo 600\/800/);
    expect(Object.keys(json.metrics).sort()).toEqual(['600', '800']);
    const atlas = testAtlas();
    expect(strikeSizes(atlas, 800)).toEqual([76, 36, 32, 30, 28, 26, 24]);
    expect(strikeSizes(atlas, 600)).toEqual([28, 26, 24]);
  });

  it('was built from the static TTFs filed under each weight (not a synthesized or swapped face)', () => {
    // usWeightClass (OS/2) of the files the atlas and the OG images read, and the advance of a
    // glyph that differs by weight: ExtraBold is wider than SemiBold.
    const weightClass = (file: string) => {
      const buf = readFileSync(file);
      for (let i = 0; i < buf.readUInt16BE(4); i++) {
        const o = 12 + 16 * i;
        if (buf.toString('ascii', o, o + 4) === 'OS/2') return buf.readUInt16BE(buf.readUInt32BE(o + 8) + 4);
      }
      return -1;
    };
    expect(weightClass('src/assets/fonts/Archivo-600.ttf')).toBe(600);
    expect(weightClass('src/assets/fonts/Archivo-800.ttf')).toBe(800);
    const atlas = testAtlas();
    expect(measure(atlas, findStrike(atlas, 800, 26), 'Committee')).toBeGreaterThan(measure(atlas, findStrike(atlas, 600, 26), 'Committee'));
  });

  it('can draw every FBS school name as printed (display case) at every name size, without fallbacks', () => {
    const atlas = testAtlas();
    const names = new Set<string>();
    for (const season of readdirSync('data').filter((d) => /^\d{4}$/.test(d))) {
      for (const f of readdirSync(`data/${season}`).filter((x) => /^week-\d+\.json$/.test(x))) {
        const week = JSON.parse(readFileSync(`data/${season}/${f}`, 'utf8')) as { teams: Record<string, { name: string; short: string }> };
        for (const t of Object.values(week.teams)) names.add(t.name).add(t.short);
      }
    }
    expect(names.size).toBeGreaterThan(100);
    for (const size of [32, 30, 28, 26, 24]) {
      const strike = findStrike(atlas, 800, size);
      for (const n of names) expect(drawable(strike, n).join(''), `${n} @${size}`).toBe(n);
    }
  });

  it('falls back gracefully for characters it does not have', () => {
    const strike = findStrike(testAtlas(), 800, 32);
    expect(drawable(strike, 'San José State').join('')).toBe('San José State');
    expect(drawable(strike, 'Hawaiʻi').join('')).toBe('Hawai‘i'); // Archivo has no okina
    expect(drawable(strike, 'Łódź').join('')).toBe(' ódz');
  });

  it('measures with kerning and tracking, and snaps glyphs to sub-pixel phases', () => {
    const atlas = testAtlas();
    const s = findStrike(atlas, 800, 32);
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
    const wide = 'Middle Tennessee State';
    const fit = fitStrike(atlas, 800, wide, measure(atlas, findStrike(atlas, 800, 28), wide, -0.3), 32, 24, -0.3);
    expect(fit.strike.size).toBe(28);
    expect(fit.fits).toBe(true);
    expect(fitStrike(atlas, 800, wide, 10, 32, 24).fits).toBe(false);
  });
});

function loadAllTeams(): Record<string, { name: string; record: { w: number; l: number } }> {
  return (JSON.parse(readFileSync('data/2026/week-9.json', 'utf8')) as { teams: Record<string, { name: string; record: { w: number; l: number } }> }).teams;
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

  it('renders a 1200x630 palette PNG with the DESIGN.md layout (paper, index tabs, footer)', async () => {
    const order = gd.committee!;
    const m = shareImageModel(gd, order);
    const bytes = await renderShareImage(m, testAtlas());
    const img = decodePng(bytes);
    expect([img.width, img.height, img.colorType]).toEqual([1200, 630, 3]);
    expect(img.palette!.length / 3).toBeLessThanOrEqual(256);
    expect(img.chunks.every((c) => c.crcOk)).toBe(true);
    expect(bytes.length).toBeLessThan(60_000);

    const S = SHARE;
    expect(pixelHex(img, 600, 3)).toBe(P.page); // paper page, no accent bar
    expect(pixelHex(img, 10, 300)).toBe(P.page);
    for (let i = 0; i < 12; i++) {
      const x = S.pad + Math.floor(i / 6) * (S.colW + S.colGap);
      const y = S.top + (i % 6) * S.pitch;
      const p = teamPaint(gd.teams[order[i]!]!.colors);
      expect(pixelHex(img, x + 3, y + 3), `plate ${i + 1}`).toBe(p.bg); // byes are words, not a colour
      expect(pixelHex(img, x + 3, y + S.rowH - 2), `rule ${i + 1}`).toBe(p.rule);
      expect(pixelHex(img, x, y + 20), `plate edge ${i + 1}`).toBe(p.edge ?? p.bg);
      expect(pixelHex(img, x + S.colW - 6, y + 20), `sheet ${i + 1}`).toBe(P.surface);
      expect(pixelHex(img, x + S.colW - 1, y + 20), `frame ${i + 1}`).toBe(P['line-strong']);
      expect(pixelHex(img, x + 200, y + S.rowH + 5), `gap ${i + 1}`).toBe(P.page);
    }
    // The name is typed in ink on the sheet: some pixels in the first name's area have exactly that color.
    let inked = 0;
    for (let x = S.pad + S.plate + 18; x < S.pad + S.plate + 140; x++) for (let y = S.top + 16; y < S.top + 44; y++) if (pixelHex(img, x, y) === P.fg) inked++;
    expect(inked).toBeGreaterThan(100);
    // Footer band: 2px ink rule, sheet, and the wordmark's redaction bar behind "Blind".
    expect(pixelHex(img, 600, S.footerTop)).toBe(P.fg);
    expect(pixelHex(img, 600, S.footerTop + 1)).toBe(P.fg);
    expect(pixelHex(img, 600, S.footerTop + 3)).toBe(P.surface);
    let bar = 0;
    for (let x = 120; x < 230; x++) for (let y = 580; y < 612; y++) if (pixelHex(img, x, y) === P.redaction) bar++;
    expect(bar).toBeGreaterThan(400);
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

  it('fits every school name on its tab (32px, shrinking to 24px) clear of "Bye · record"', () => {
    const atlas = testAtlas();
    const S = SHARE;
    for (const t of Object.values(loadAllTeams())) {
      // Same space as the renderer: name from plate + 18 to 24px before the right-aligned meta.
      const meta = measure(atlas, findStrike(atlas, 600, 26), `Bye · ${t.record.w}-${t.record.l}`);
      const maxW = S.colW - 18 - meta - 24 - (S.plate + 18);
      const fit = fitStrike(atlas, 800, t.name, maxW, 32, 24, -0.01 * 24);
      expect(fit.fits, t.name).toBe(true);
    }
  });

  it('adds a hook line: agreement with the committee and the biggest call in the top 12', async () => {
    const results = computeRunResults(gd, sampleRun());
    const order = results.ranking.order;
    const m = shareImageModel(gd, order, results.playoff.byes.map((s) => s.slug), results.agreement);
    const share = results.agreement.pairwise.committee.share!;
    expect(m.hook!.ref).toBe('committee');
    expect(m.hook!.pct).toBe(`${Math.round(share * 100)}%`);
    // The call is the top-12 team furthest from its committee rank (unranked counts as 26 - position).
    const dist = order.slice(0, 12).map((s, i) => {
      const c = gd.teams[s]!.committee;
      return c === null ? gd.committee!.length + 1 - (i + 1) : Math.abs(c - (i + 1));
    });
    const best = Math.max(...dist);
    const at = dist.indexOf(best);
    expect(m.hook!.call).toEqual({ name: gd.teams[order[at]!]!.name, rank: at + 1, delta: gd.teams[order[at]!]!.committee === null ? null : gd.teams[order[at]!]!.committee! - (at + 1) });
    expect(shareImageAlt(m)).toContain(` Matched the committee on ${m.hook!.pct}; biggest call: ${m.hook!.call!.name}`);
    // Drawn: the kicker moves up and the hook (the fan's percentage in violet) sits on the title
    // baseline, right side.
    const img = decodePng(await renderShareImage(m, testAtlas()));
    let accent = 0;
    for (let x = 600; x < 1144; x++) for (let y = 80; y < 108; y++) if (pixelHex(img, x, y) === P.accent) accent++;
    expect(accent).toBeGreaterThan(20);
  });

  it('hook: shortens its wording for long names, never collides with the title, keeps the full name', async () => {
    const atlas = testAtlas();
    const committee = gd.committee!;
    const agreement = { ...computeRunResults(gd, []).agreement, hasCommittee: true, pairwise: { calls: 3, committee: { matched: 1, comparable: 3, share: 1 / 3 }, fei: { matched: 2, comparable: 3, share: 2 / 3 } } };
    const byLength = (xs: string[]) => [...xs].sort((a, b) => gd.teams[b]!.name.length - gd.teams[a]!.name.length);
    const unranked = byLength(Object.keys(gd.teams).filter((s) => gd.teams[s]!.committee === null))[0]!;
    const ranked = byLength(committee)[0]!;
    const titleRight = SHARE.pad + measure(atlas, findStrike(atlas, 800, 76), 'My top 12', -0.03 * 76);
    for (const order of [[committee[0]!, unranked, ...committee.slice(1)], [ranked, ...committee.filter((s) => s !== ranked)]]) {
      const m = shareImageModel(gd, order, undefined, agreement);
      expect(m.hook!.call!.name).toBe(gd.teams[order[order[0] === ranked ? 0 : 1]!]!.name);
      const img = decodePng(await renderShareImage(m, atlas));
      let accent = 0;
      for (let x = 400; x < 1144; x++) for (let y = 80; y < 108; y++) if (pixelHex(img, x, y) === P.accent) accent++;
      expect(accent, 'percentage drawn').toBeGreaterThan(20);
      // At least 24px of clear paper between the title and the hook.
      for (let x = Math.ceil(titleRight) + 4; x < titleRight + 28; x++) for (let y = 70; y < 110; y++) expect(pixelHex(img, x, y), `gap at ${x},${y}`).toBe(P.page);
    }
  });

  it('hook: the committee order has no call; an unranked team in the top 12 is the call; no committee means FEI', () => {
    const committee = gd.committee!;
    const agreeAll = computeRunResults(gd, []).agreement;
    const withShare = { ...agreeAll, hasCommittee: true, pairwise: { calls: 3, committee: { matched: 3, comparable: 3, share: 1 }, fei: { matched: 2, comparable: 3, share: 2 / 3 } } };
    expect(shareHook(gd, committee, withShare, 12)).toEqual({ ref: 'committee', pct: '100%', call: null });
    const outsider = gd.prior.find((s) => gd.teams[s]!.committee === null)!;
    const order = [committee[0]!, outsider, ...committee.slice(1)];
    expect(shareHook(gd, order, withShare, 12)!.call).toEqual({ name: gd.teams[outsider]!.name, rank: 2, delta: null });
    const noCommittee = { ...gd, committee: null };
    expect(shareHook(noCommittee, gd.prior, { ...withShare, hasCommittee: false }, 12)).toEqual({ ref: 'FEI', pct: '67%', call: null });
    expect(shareHook(gd, committee, { ...withShare, pairwise: { calls: 0, committee: { matched: 0, comparable: 0, share: null }, fei: { matched: 0, comparable: 0, share: null } } }, 12)).toBeNull();
  });

  it('renders the generic brand image (paper, the wordmark with its redaction bar, footer credit)', async () => {
    const img = decodePng(await renderBrandImage(testAtlas()));
    expect([img.width, img.height]).toEqual([1200, 630]);
    expect(pixelHex(img, 10, 2)).toBe(P.page);
    expect(pixelHex(img, 600, SHARE.footerTop)).toBe(P.fg);
    let bar = 0;
    for (let x = 200; x < 460; x++) for (let y = 236; y < 316; y++) if (pixelHex(img, x, y) === P.redaction) bar++;
    expect(bar).toBeGreaterThan(5000);
  });
});
