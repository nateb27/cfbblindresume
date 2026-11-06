#!/usr/bin/env node
/**
 * End-to-end check of the blind-resume game island (Playwright, Chromium).
 *
 *   npx astro build --outDir /tmp/game-dist
 *   node scripts/e2e-game.mjs --dist /tmp/game-dist --out /tmp/game-shots
 *   node scripts/e2e-game.mjs --base http://localhost:8788      # against a running site instead
 *
 * With --dist it serves the build itself, the way Cloudflare Pages + the /r Function would:
 * extensionless pages map to {path}.html, /r/{code} serves the r.html shell, and /api/* plus
 * /og/r/*.png are mocked (votes and beacons are recorded; /api/fans answers so the Fans column and
 * tab are exercised; pass --no-fans to make every fans endpoint 404 instead).
 *
 * Flows:
 *  1. Phone 390x844 (touch): 15 rounds using only the sticky footer (card chips + rank button) and
 *     the reveal's button, always ranking in committee order; an undo; "Do another" once; final
 *     results must equal the committee top 25; switch to the 24-team format; copy the share link;
 *     open /r/{code} in a fresh context and get the same top 25.
 *  2. Laptop 1280x800, keyboard only (Tab / Enter / A-B-C / Escape): 15 rounds with a different
 *     order, results, format and tab switches, shared view matches.
 *  3. Skip to results after 5 rounds: partial results with Unseen teams.
 *  4. Corrupted and garbage share codes show the friendly error with a Play link.
 * --only phone,laptop,skip,bad runs a subset. Screenshots of every screen at both sizes go to --out. Exits non-zero on any failure, page
 * error or console error.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true]);
    return acc;
  }, []),
);
const OUT = resolve(String(args.out ?? 'e2e-game-shots'));
const PLAY = String(args.play ?? '/');
const SHELL = String(args.shell ?? 'r.html');
const FANS = !args['no-fans'];
mkdirSync(OUT, { recursive: true });

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
}

/* ------------------------------------------------------------------ static server + mocks */

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};
const received = { votes: [], events: [] };
let gameData = null; // the week's payload, captured from the page's own request

function readBody(req) {
  return new Promise((ok) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => ok(b));
  });
}

function startServer(dist) {
  const root = resolve(dist);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const path = decodeURIComponent(url.pathname);
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (path === '/api/vote' && req.method === 'POST') {
      received.votes.push(JSON.parse((await readBody(req)) || 'null'));
      return send(202, '{"ok":true}');
    }
    if (path === '/api/event' && req.method === 'POST') {
      received.events.push(JSON.parse((await readBody(req)) || 'null'));
      return send(204, '');
    }
    if (path === '/api/fans/top25') {
      if (!FANS || !gameData) return send(404, '{"error":"not found"}');
      // Fans: the committee order with two neighbours swapped, so the tab is distinguishable.
      const o = [...gameData.prior];
      [o[3], o[4]] = [o[4], o[3]];
      return send(200, JSON.stringify({ order: o.slice(0, 25), votes: 1234 }));
    }
    if (path === '/api/fans') {
      if (!FANS || !gameData) return send(404, '{"error":"not found"}');
      const trio = (url.searchParams.get('trio') ?? '').split(',');
      const order = trio.sort((a, b) => (gameData.teams[a]?.sor ?? 999) - (gameData.teams[b]?.sor ?? 999));
      return send(200, JSON.stringify({ order }));
    }
    if (path.startsWith('/og/r/')) {
      return createReadStream(join(root, 'apple-touch-icon.png')).pipe(res.writeHead(200, { 'Content-Type': 'image/png' }) && res);
    }
    let file = null;
    if (/^\/r\/[^/]+\/?$/.test(path)) file = join(root, SHELL);
    else {
      const p = normalize(path).replace(/^(\.\.[/\\])+/, '');
      for (const cand of [join(root, p), join(root, `${p}.html`), join(root, p, 'index.html')]) {
        if (existsSync(cand) && statSync(cand).isFile()) {
          file = cand;
          break;
        }
      }
    }
    if (!file) {
      const nf = join(root, '404.html');
      return existsSync(nf) ? createReadStream(nf).pipe(res.writeHead(404, { 'Content-Type': TYPES['.html'] }) && res) : send(404, 'not found', 'text/plain');
    }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(Number(args.port ?? 0), '127.0.0.1', () => ok(server)));
}

/* ------------------------------------------------------------------ helpers */

const failures = [];
const consoleProblems = [];
function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.error(`  FAIL ${msg}`);
  } else console.log(`  ok   ${msg}`);
}

function watch(page, label) {
  page.on('pageerror', (e) => consoleProblems.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // With --base against a dev server without Functions, the optional endpoints may 404.
    if (args.base && /Failed to load resource/.test(t)) return;
    consoleProblems.push(`${label} console.error: ${t}`);
  });
}

async function shot(page, name, opts = {}) {
  await page.waitForTimeout(opts.settle ?? 350);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: !!opts.full });
}

async function noHorizontalScroll(page, label) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(sw <= iw, `${label}: no horizontal page scroll (${sw} <= ${iw})`);
}

const cardKey = (c) => `${c.record.w}-${c.record.l}|${c.ranks.sor}|${c.ranks.off}|${c.ranks.def}|${c.ranks.sos}`;

/** Identify the three blind cards by their stats (black-box: the DOM never carries identities). */
async function readTrio(page) {
  const byKey = new Map(Object.entries(gameData.cards).map(([slug, c]) => [cardKey(c), slug]));
  const cards = await page.$$eval('[data-card]', (els) =>
    els.map((el) => {
      const num = (m) => Number((el.querySelector(`[data-metric="${m}"] [data-rank] [aria-hidden]`)?.textContent ?? '').replace('#', ''));
      const [w, l] = (el.querySelector('[data-record]')?.textContent ?? '').split('-').map(Number);
      return { letter: el.getAttribute('data-card'), record: { w, l }, ranks: { sor: num('sor'), off: num('off'), def: num('def'), sos: num('sos') } };
    }),
  );
  return cards.map((c) => ({ letter: c.letter, slug: byKey.get(cardKey(c)) }));
}

/** Committee-first order (prior index): picking this every round must reproduce the committee top 25. */
const byPrior = (trio) => [...trio].sort((a, b) => gameData.prior.indexOf(a.slug) - gameData.prior.indexOf(b.slug));

async function waitRound(page, n) {
  await page.waitForFunction((n) => document.querySelector('[data-testid=round-label]')?.textContent?.replace(/\s+/g, ' ').includes(`Round ${n} of`), n, { timeout: 15000 });
  await page.waitForSelector('[data-card=C]');
}

async function topNames(page, testid) {
  return page.$$eval(`[data-testid=${testid}] > li a.team-block`, (as) => as.map((a) => a.querySelector('span:nth-child(2)')?.textContent?.trim()));
}

/* ------------------------------------------------------------------ flow 1: phone, touch */

async function phoneRun(browser, base) {
  console.log('\nPhone 390x844 (touch)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await ctx.newPage();
  watch(page, 'phone');
  await page.goto(base + PLAY, { waitUntil: 'networkidle' });
  await page.locator('[data-testid=play]').scrollIntoViewIfNeeded();
  await shot(page, 'm-01-intro');
  check(await page.locator('[data-testid=play]').isVisible(), 'intro is server-rendered with a Play button');

  const gdResp = page.waitForResponse((r) => /\/game-data\/.+\.json$/.test(r.url()));
  await page.locator('[data-testid=play]').tap();
  gameData = await (await gdResp).json();
  const committee = gameData.committee.map((s) => gameData.teams[s].name);

  for (let round = 1; round <= 16; round++) {
    await waitRound(page, round);
    if (round === 1) await shot(page, 'm-02-round');
    await noHorizontalScroll(page, `round ${round}`);
    const trio = await readTrio(page);
    check(trio.every((t) => t.slug), `round ${round}: all three cards identified`);
    const want = byPrior(trio);
    for (let k = 0; k < 2; k++) {
      const pickCard = async (t, place) => {
        await page.locator(`[data-testid=dot-${t.letter}]`).tap();
        const btn = page.locator('[data-testid=rank-current]');
        await page.waitForFunction(
          ([L, place]) => document.querySelector('[data-testid=rank-current]')?.textContent === `Rank ${L} ${place}`,
          [t.letter, place],
          { timeout: 5000 },
        );
        await btn.tap();
      };
      await pickCard(want[k], k === 0 ? '1st' : '2nd');
      if (round === 1 && k === 0) await shot(page, 'm-03-first-pick');
      if (round === 2 && k === 1) {
        // Undo inside the lock-in window, then pick again.
        await page.locator('[data-testid=undo]').tap();
        await page.waitForSelector('[data-testid=rank-current]');
        check((await page.locator('[data-testid=lock]').count()) === 0, 'undo returns to picking');
        await pickCard(want[1], '2nd');
      }
      if (round === 1 && k === 1) await shot(page, 'm-04-lock-in', { settle: 150 });
    }
    // Pointer picks lock themselves; the reveal follows (reveals are on).
    await page.waitForSelector('[data-testid=reveal][open]', { timeout: 5000 });
    const order = await page.$$eval('[data-testid=reveal] ol > li .team-block span:nth-child(2)', (els) => els.map((e) => e.textContent));
    check(JSON.stringify(order) === JSON.stringify(want.map((t) => gameData.teams[t.slug].name)), `round ${round}: reveal lists the picked order`);
    if (round === 1) {
      await page.waitForSelector('[data-testid=fans-cell]', { timeout: 5000 }).catch(() => null);
      if (FANS) check((await page.locator('[data-testid=fans-cell]').count()) === 3, 'reveal shows the Fans column when fan data exists');
      await shot(page, 'm-05-reveal');
    }
    await page.locator('[data-testid=reveal-next]').tap();
    await page.waitForSelector('[data-testid=reveal]', { state: 'detached' });
    if (round === 15) {
      await page.waitForSelector('[data-testid=done]');
      await shot(page, 'm-06-done');
      await page.locator('[data-testid=do-another]').tap();
    }
    if (round === 16) {
      await page.waitForSelector('[data-testid=done]');
      check((await page.locator('[data-testid=done]').textContent()).includes('16'), '"16 rankings in" after Do another');
      await page.locator('[data-testid=final-results]').tap();
    }
  }

  await page.waitForSelector('[data-testid=results]');
  await shot(page, 'm-07-results');
  await noHorizontalScroll(page, 'results');
  const mine = await topNames(page, 'top25-list');
  check(mine.length === 25, 'phone results list has 25 teams');
  check(JSON.stringify(mine) === JSON.stringify(committee), 'always ranking in committee order yields the committee top 25');

  await page.locator('[data-testid=format-24-team]').tap();
  await page.waitForFunction(() => document.querySelector('#bracket-h')?.textContent?.includes('24-team'));
  const note = await page.locator('[data-testid=format-note]').textContent();
  check(/Proposed for \d{4} — not final/.test(note) && note.includes('Source:'), '24-team view shows the proposed label and source');
  await page.locator('[data-testid=format-note]').scrollIntoViewIfNeeded();
  await shot(page, 'm-08-results-24');
  await page.locator('[data-testid=bracket]').scrollIntoViewIfNeeded();
  await shot(page, 'm-09-bracket-24');
  await page.locator('[data-testid=format-12-team]').tap();
  await page.locator('[data-testid=bracket]').scrollIntoViewIfNeeded();
  await shot(page, 'm-10-bracket-12');
  await noHorizontalScroll(page, 'bracket');
  await page.locator('[data-testid=bids]').scrollIntoViewIfNeeded();
  await shot(page, 'm-11-bids');

  await page.locator('[data-testid=copy-link]').scrollIntoViewIfNeeded();
  await page.locator('[data-testid=copy-link]').tap();
  await page.waitForFunction(() => document.querySelector('[data-testid=copy-link]')?.textContent?.includes('Copied'), null, { timeout: 3000 });
  let link = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
  if (!link) link = await page.locator('[data-testid=share-url]').inputValue();
  check(/\/r\/[A-Za-z0-9_-]+$/.test(link), `share link copied (${link.slice(0, 60)}…)`);
  await shot(page, 'm-12-share');
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p2 = await ctx2.newPage();
  watch(p2, 'phone-shared');
  await p2.goto(link, { waitUntil: 'networkidle' });
  await p2.waitForSelector('[data-testid=results]');
  const theirs = await topNames(p2, 'top25-list');
  check(JSON.stringify(theirs) === JSON.stringify(mine), 'fresh context: /r/{code} renders the same top 25');
  await shot(p2, 'm-13-shared');
  await ctx2.close();
  return link;
}

/* ------------------------------------------------------------------ flow 2: laptop, keyboard only */

/** Move focus with Tab (then Shift+Tab if it is behind us) until the element is focused. Never clicks. */
async function tabTo(page, testid, max = 80) {
  const focused = () => page.evaluate((id) => document.activeElement?.getAttribute('data-testid') === id, testid);
  for (let i = 0; i < max; i++) {
    if (await focused()) return true;
    await page.keyboard.press('Tab');
  }
  for (let i = 0; i < max * 2; i++) {
    if (await focused()) return true;
    await page.keyboard.press('Shift+Tab');
  }
  return false;
}

async function laptopRun(browser, base) {
  console.log('\nLaptop 1280x800 (keyboard only)');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const page = await ctx.newPage();
  watch(page, 'laptop');
  await page.goto(base + PLAY, { waitUntil: 'networkidle' });
  await shot(page, 'd-01-intro');
  check(await tabTo(page, 'play'), 'Tab reaches Play');
  const gdResp = page.waitForResponse((r) => /\/game-data\/.+\.json$/.test(r.url()));
  await page.keyboard.press('Enter');
  gameData ??= await (await gdResp).json();

  for (let round = 1; round <= 15; round++) {
    await waitRound(page, round);
    if (round === 1) await shot(page, 'd-02-round');
    const trio = await readTrio(page);
    // A different order than the committee's: reverse it on odd rounds.
    const want = round % 2 ? byPrior(trio).reverse() : byPrior(trio);
    if (round % 3 === 0) {
      // Tab to the rank buttons and press Enter.
      check(await tabTo(page, `rank-${want[0].letter}`, 40), `round ${round}: Tab reaches Rank ${want[0].letter}`);
      await page.keyboard.press('Enter');
      if (round === 3) await shot(page, 'd-03-first-pick');
      check(await tabTo(page, `rank-${want[1].letter}`, 10), `round ${round}: Tab reaches Rank ${want[1].letter} 2nd`);
      await page.keyboard.press('Enter');
    } else {
      await page.keyboard.press(want[0].letter.toLowerCase());
      await page.keyboard.press(want[1].letter.toLowerCase());
    }
    await page.waitForSelector('[data-testid=lock]');
    if (round === 1) await shot(page, 'd-04-lock-in');
    check(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'lock'), `round ${round}: focus moves to Lock in`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=reveal][open]');
    check(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') === 'reveal-next'), `round ${round}: reveal takes focus`);
    if (round === 1) await shot(page, 'd-05-reveal');
    await page.keyboard.press(round % 2 ? 'Escape' : 'Enter');
    await page.waitForSelector('[data-testid=reveal]', { state: 'detached' });
  }
  await page.waitForSelector('[data-testid=done]');
  await shot(page, 'd-06-done');
  check(await tabTo(page, 'final-results', 10), 'Tab reaches Final results');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=results]');
  await shot(page, 'd-07-results');
  const mine = await topNames(page, 'top25-grid');
  check(mine.length === 25, 'desktop results grid has 25 tiles');

  check(await tabTo(page, 'format-24-team'), 'Tab reaches the 24-team segment');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('#bracket-h')?.textContent?.includes('24-team'));
  await shot(page, 'd-08-results-24');
  await page.locator('[data-testid=bracket]').scrollIntoViewIfNeeded();
  await shot(page, 'd-09-bracket-24');
  await page.screenshot({ path: join(OUT, 'd-10-results-24-full.png'), fullPage: true });
  await page.locator('[data-testid=format-12-team]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-testid=bracket]').scrollIntoViewIfNeeded();
  await shot(page, 'd-11-bracket-12');
  await page.screenshot({ path: join(OUT, 'd-12-results-12-full.png'), fullPage: true });

  // Tabs with arrow keys: Your ranking -> Committee.
  await page.locator('[data-testid=tab-you]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => document.querySelector('[data-testid=results-title]')?.textContent?.includes('Committee'));
  const cmte = await topNames(page, 'top25-grid');
  check(JSON.stringify(cmte) === JSON.stringify(gameData.committee.map((s) => gameData.teams[s].name)), 'Committee tab shows the committee top 25');
  await page.locator('[data-testid=results-title]').scrollIntoViewIfNeeded();
  await shot(page, 'd-13-tab-committee');
  if (FANS) {
    check((await page.locator('[data-testid=tab-fans]').count()) === 1, 'Fans tab appears when fan data exists');
    await page.keyboard.press('End');
    await page.waitForFunction(() => document.querySelector('[data-testid=results-title]')?.textContent?.includes('Fans'));
    await shot(page, 'd-14-tab-fans');
  }
  await page.locator('[data-testid=tab-you]').focus();
  await page.keyboard.press('Enter');

  await page.locator('[data-testid=copy-link]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid=copy-link]')?.textContent?.includes('Copied'));
  const link = await page.locator('[data-testid=share-url]').inputValue();
  check(/\/r\/[A-Za-z0-9_-]+$/.test(link), 'desktop share link present');
  await page.locator('[data-testid=share]').scrollIntoViewIfNeeded();
  await shot(page, 'd-15-share');
  await ctx.close();

  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p2 = await ctx2.newPage();
  watch(p2, 'laptop-shared');
  await p2.goto(link, { waitUntil: 'networkidle' });
  await p2.waitForSelector('[data-testid=results]');
  check(JSON.stringify(await topNames(p2, 'top25-grid')) === JSON.stringify(mine), 'fresh context: shared view matches the desktop run');
  await shot(p2, 'd-16-shared');
  await ctx2.close();
}

/* ------------------------------------------------------------------ flow 3: skip after round 5 */

async function skipRun(browser, base) {
  console.log('\nSkip to results after round 5 (phone)');
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  watch(page, 'skip');
  await page.addInitScript(() => localStorage.setItem('cfbbr:reveal', 'off'));
  await page.goto(base + PLAY, { waitUntil: 'networkidle' });
  await page.locator('[data-testid=play]').tap();
  for (let round = 1; round <= 5; round++) {
    await waitRound(page, round);
    check(await page.locator('[data-testid=skip]').isDisabled(), `round ${round}: skip disabled before round 5 is done`);
    for (const k of [0, 1]) {
      const t = (await readTrio(page))[k === 0 ? 2 : 0];
      await page.locator(`[data-testid=dot-${t.letter}]`).tap();
      await page.waitForFunction((L) => document.querySelector('[data-testid=rank-current]')?.textContent?.startsWith(`Rank ${L}`), t.letter);
      await page.locator('[data-testid=rank-current]').tap();
    }
    await page.locator('[data-testid=lock]').tap(); // tap Lock in right away (no reveal: it is off)
  }
  await waitRound(page, 6);
  await shot(page, 'm-14-round6-skip-enabled');
  await page.locator('[data-testid=skip]').tap();
  await page.waitForSelector('[data-testid=results]');
  const kicker = await page.locator('[data-testid=results] p.label-caps').first().textContent();
  check(kicker.includes('partial'), 'skipped run is marked partial');
  check((await page.locator('text=Unseen').count()) > 0, 'unseen teams are tagged');
  await shot(page, 'm-15-partial');
  await page.locator('[data-testid=keep-playing]').tap();
  await waitRound(page, 6);
  check(true, 'Keep ranking returns to round 6');
  await ctx.close();
}

/* ------------------------------------------------------------------ flow 4: bad codes */

async function badCodes(browser, base, goodLink) {
  console.log('\nCorrupted share codes');
  const code = goodLink.split('/r/')[1];
  const flipped = code.slice(0, 10) + (code[10] === 'A' ? 'B' : 'A') + code.slice(11);
  for (const [w, h, tag] of [[390, 844, 'm'], [1280, 800, 'd']]) {
    for (const [bad, label] of [[flipped, 'one character changed'], ['not-a-real-code', 'garbage'], [code.slice(0, 20), 'truncated']]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
      const page = await ctx.newPage();
      watch(page, `bad-${tag}`);
      await page.goto(`${base}/r/${bad}`, { waitUntil: 'networkidle' });
      await page.waitForSelector('[role=alert]', { timeout: 10000 });
      const play = page.locator('[data-testid=play-own]');
      check((await play.count()) === 1 && (await play.getAttribute('href')) === '/', `${tag}: ${label} code shows a friendly error with Play`);
      if (label === 'one character changed') await shot(page, `${tag}-17-bad-code`);
      await ctx.close();
    }
  }
}

/* ------------------------------------------------------------------ main */

let server = null;
let base = args.base ? String(args.base).replace(/\/$/, '') : null;
if (!base) {
  if (!args.dist) {
    console.error('Pass --dist <astro build dir> or --base <url>.');
    process.exit(2);
  }
  server = await startServer(String(args.dist));
  base = `http://127.0.0.1:${server.address().port}`;
}
console.log(`Base ${base} · screenshots in ${OUT}`);
const browser = await chromium.launch();
try {
  const only = args.only ? new Set(String(args.only).split(',')) : null;
  const run = (name) => !only || only.has(name);
  let link = null;
  if (run('phone')) link = await phoneRun(browser, base);
  if (run('laptop')) await laptopRun(browser, base);
  if (run('skip')) await skipRun(browser, base);
  if (run('bad')) await badCodes(browser, base, link ?? `${base}/r/ARoJECp6ZAyIQnYQVms3b4InQzwpAiJ7MmxBcd`);
  if (server && !only) {
    check(received.votes.length >= 15 + 16 + 5, `votes posted after every round (${received.votes.length})`);
    check(received.votes.every((v) => Array.isArray(v?.order) && v.order.length === 3 && v.season && v.week), 'vote bodies are {season, week, order:[a,b,c]}');
    const names = new Set(received.events.map((e) => e?.name));
    for (const n of ['round_completed', 'run_completed', 'results_shared', 'skip_to_results', 'do_another']) check(names.has(n), `beacon ${n} sent`);
  }
} catch (e) {
  failures.push(`crashed: ${e.stack ?? e}`);
  console.error(e);
} finally {
  await browser.close();
  server?.close();
}
for (const p of consoleProblems) console.error(`  CONSOLE ${p}`);
const bad = failures.length + consoleProblems.length;
console.log(bad ? `\n${failures.length} failure(s), ${consoleProblems.length} console problem(s)` : '\nAll game e2e checks passed.');
process.exit(bad ? 1 : 0);
