#!/usr/bin/env node
/**
 * CPU benchmark for the share-image Function (/og/r/{code}.png) in Node, which runs the same V8 as
 * workerd. It times exactly what one request does after the asset fetch: JSON.parse of the week's
 * game data, share-code decode + rule check + computeRunResults (src/lib), painting the 1200x630
 * palette canvas from the glyph atlas, and zlib deflate at the default level (what
 * CompressionStream('deflate') runs natively in workerd), plus PNG chunk CRCs.
 *
 *   node scripts/fn-bench-og.mjs [--runs 300] [--cold 7]
 *   (FN_SCRATCH: where the bundled worker and fn-bench-og.json go; default <tmpdir>/cfbblindresume-fn)
 *
 * Also times "1st request after warm-up": a fresh process that first runs warmShareRenderer() (what
 * the deployed route does at module scope, i.e. at isolate startup) and then serves one request.
 *
 * "cold" = the first request in a brand-new process (nothing JIT-compiled yet, like the first
 * share image in a fresh isolate); "warm" = steady state. Synchronous zlib is used for timing so
 * Node's thread-pool stream overhead (absent in workerd) does not distort the number.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRATCH = process.env.FN_SCRATCH ?? join(tmpdir(), 'cfbblindresume-fn');
const OUT = join(SCRATCH, 'backend');
mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const opt = (name, d) => {
  const i = argv.indexOf(name);
  return i >= 0 ? Number(argv[i + 1]) : d;
};

// The measured code, bundled from the repo sources (src/lib + functions/_lib).
const WORKER = `
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildGameData, computeRunResults, gameRunViolations, gameTrioState } from '@lib/game-data';
import { loadWeek } from '@lib/data-node';
import { nextTrio } from '@lib/trios';
import { rngForRound, mulberry32 } from '@lib/rng';
import { encodeRun, parseShareCode, resolveShareCode } from '@lib/sharecode';
import { loadAtlas } from './functions/_lib/atlas';
import { shareImageModel, paintShareImage, warmShareRenderer } from './functions/_lib/share-image';
import { crc32 } from './functions/_lib/png';

const mode = process.argv[2];
const runs = Number(process.argv[3] || 1);
const gdJson = JSON.stringify(buildGameData(loadWeek(2026, 9, { dataDir: ${JSON.stringify(join(root, 'data'))} })));
const gd0 = JSON.parse(gdJson);
function run(seed, n) {
  const r = mulberry32(seed ^ 0x9e3779b9);
  const rounds = [];
  while (rounds.length < n) {
    const trio = nextTrio(gameTrioState(gd0, rounds), rngForRound(seed, rounds.length + 1));
    if (!trio) break;
    rounds.push([...trio].sort((a, b) => gd0.teams[a].sor + r() * 25 - (gd0.teams[b].sor + r() * 25)));
  }
  return rounds;
}
const codes = Array.from({ length: 16 }, (_, i) => encodeRun({ season: gd0.season, week: gd0.week, rounds: run(500 + i, i % 4 === 3 ? 30 : 15) }, gd0.slugs));
const t = performance.now();
const atlas = loadAtlas(JSON.parse(readFileSync('functions/_lib/atlas.json', 'utf8')), readFileSync('functions/_lib/atlas.bin'));
const atlasMs = performance.now() - t;

function request(code) {
  const t0 = performance.now();
  const gd = JSON.parse(gdJson);
  const raw = parseShareCode(code);
  const sr = resolveShareCode(raw.value, gd.slugs);
  if (!sr.ok || gameRunViolations(gd, sr.value.rounds).length) throw new Error('bad run');
  const res = computeRunResults(gd, sr.value.rounds);
  const t1 = performance.now();
  const canvas = paintShareImage(shareImageModel(gd, res.ranking.order, res.playoff.byes.map((s) => s.slug), res.agreement), atlas);
  const rawRows = canvas.finishScanlines();
  const t2 = performance.now();
  const idat = deflateSync(rawRows);
  crc32(idat); crc32(canvas.paletteBytes());
  const t3 = performance.now();
  return { results: t1 - t0, paint: t2 - t1, encode: t3 - t2, total: t3 - t0, bytes: idat.length + canvas.palette.length * 3 + 57, palette: canvas.palette.length, levels: canvas.levels };
}

if (mode === 'cold') {
  console.log(JSON.stringify({ atlasMs, ...request(codes[0]) }));
} else if (mode === 'cold-warmed') {
  // What the deployed Function does: warmShareRenderer() runs at module scope (isolate startup),
  // then the first request arrives.
  const w0 = performance.now();
  warmShareRenderer(atlas);
  const warmupMs = performance.now() - w0;
  console.log(JSON.stringify({ atlasMs, warmupMs, ...request(codes[0]) }));
} else {
  for (let i = 0; i < 60; i++) request(codes[i % codes.length]);
  const out = [];
  for (let i = 0; i < runs; i++) out.push(request(codes[i % codes.length]));
  console.log(JSON.stringify(out));
}
`;

const esbuild = await import('esbuild');
const bundled = await esbuild.build({
  stdin: { contents: WORKER, resolveDir: root, loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  alias: { '@lib': join(root, 'src/lib') },
  logLevel: 'error',
});
const file = join(OUT, 'fn-bench-worker.mjs');
writeFileSync(file, bundled.outputFiles[0].text);

const node = (args) => {
  const r = spawnSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: +q(0.5).toFixed(2), p90: +q(0.9).toFixed(2), max: +s[s.length - 1].toFixed(2) };
};

const cold = Array.from({ length: opt('--cold', 7) }, () => node(['cold']));
const coldWarmed = Array.from({ length: opt('--cold', 7) }, () => node(['cold-warmed']));
const warm = node(['warm', String(opt('--runs', 300))]);
const report = {
  node: process.version,
  cold: Object.fromEntries(['results', 'paint', 'encode', 'total', 'atlasMs'].map((k) => [k, stats(cold.map((c) => c[k]))])),
  coldAfterStartupWarmup: Object.fromEntries(['results', 'paint', 'encode', 'total', 'warmupMs'].map((k) => [k, stats(coldWarmed.map((c) => c[k]))])),
  warm: Object.fromEntries(['results', 'paint', 'encode', 'total'].map((k) => [k, stats(warm.map((w) => w[k]))])),
  pngBytes: stats(warm.map((w) => w.bytes)).median,
  palette: warm[0].palette,
  levels: warm[0].levels,
};
writeFileSync(join(OUT, 'fn-bench-og.json'), JSON.stringify(report, null, 2));
const row = (label, s) => `${label.padEnd(26)} median ${String(s.median).padStart(6)} ms   p90 ${String(s.p90).padStart(6)} ms   max ${String(s.max).padStart(6)} ms`;
console.log(`share image CPU per request (Node ${process.version}), 12 teams, 1200x630:`);
console.log(row('warm  decode+results', report.warm.results));
console.log(row('warm  paint', report.warm.paint));
console.log(row('warm  deflate+crc', report.warm.encode));
console.log(row('warm  TOTAL', report.warm.total));
console.log(row('cold  TOTAL (1st request)', report.cold.total));
console.log(row('cold  atlas index (once)', report.cold.atlasMs));
console.log(row('startup warm-up (once)', report.coldAfterStartupWarmup.warmupMs));
console.log(row('1st request after warm-up', report.coldAfterStartupWarmup.total));
console.log(`PNG ~${(report.pngBytes / 1024).toFixed(1)} KiB, ${report.palette} palette entries, ${report.levels} coverage levels`);
