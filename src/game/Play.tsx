/**
 * One round (DESIGN.md §10): progress, head-to-head flags, three blind cards (snap carousel on
 * phones, three columns on desktop), and the ranking controls — a sticky bar aligned with the cards
 * on desktop, a fixed one-thumb footer on phones. After the second pick the third is implied and a
 * short lock-in moment offers Undo before the round locks.
 *
 * Input safety: every control that appears or changes under the pointer ignores pointer
 * activations for GUARD_MS (hooks.ts), so a double tap or double click never undoes, locks, or
 * picks in the next round by accident. Phones rank in two deliberate taps: "Rank B 1st" for the card
 * in view, then one of two "Rank X 2nd" buttons for the cards left, with Undo always on the left.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type RefObject } from 'react';
import { headToHeadFlags, type GameData } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { BlindCard, type Place } from './BlindCard';
import { useGame, useGameApi, useGameData } from './context';
import { bringIntoView, LETTERS, ordinal, recordText } from './format';
import { FeiCredit, Switch, UndoIcon } from './ui';
import { GUARD_MS, useFreshGuard, useIsDesktop } from './hooks';

/** How long a pointer pick waits before locking (the undo window). Off entirely via the "Lock in automatically" switch. */
const LOCK_MS = 1400;
/** Rounds before "Skip to results" unlocks (SPEC: after round 5). */
const SKIP_AFTER = 5;

type Guard = (e: { detail: number; timeStamp: number }) => boolean;

/** Focus without the browser's scroll jump, then reveal the element only if it is off screen. */
function focusInView(el: HTMLElement | null | undefined): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  const r = el.getBoundingClientRect();
  if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'nearest' });
}

export function Play() {
  const api = useGameApi();
  const gd = useGameData();
  const trio = useGame((s) => s.trio)!;
  const picks = useGame((s) => s.picks);
  const confirm = useGame((s) => s.confirm);
  const roundsDone = useGame((s) => s.rounds.length);
  const revealOpen = useGame((s) => s.reveal !== null);
  const showReveals = useGame((s) => s.showReveals);
  const autoLock = useGame((s) => s.autoLock);
  const desktop = useIsDesktop();

  // Once locked (reveal opening or open) the round just played is still on screen (it is already in `rounds`).
  const lockedIn = revealOpen || !!confirm?.locked;
  const round = lockedIn ? roundsDone : roundsDone + 1;
  const total = round > TRIO_RULES.baseRounds ? TRIO_RULES.maxRounds : TRIO_RULES.baseRounds;
  const flags = useMemo(() => headToHeadFlags(gd, trio), [gd, trio]);
  const letterOf = useCallback((slug: string) => LETTERS[trio.indexOf(slug)] ?? '?', [trio]);

  const placeOf = (slug: string): Place => {
    const i = picks.indexOf(slug);
    if (i >= 0) return (i + 1) as 1 | 2;
    if (picks.length === 2) return 3;
    return undefined;
  };

  const heading = useRef<HTMLHeadingElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const scrollLeft = useRef(0);
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(true);
  const [announce, setAnnounce] = useState('');

  // Controls change on a new trio, a pick, an undo and the lock: the guard restarts each time.
  const trioKey = trio.join('|');
  const controlsKey = `${trioKey}|${picks.join(',')}|${confirm ? (confirm.locked ? 'locked' : 'confirm') : ''}`;
  const isStale = useFreshGuard(controlsKey);

  // New round: reset the carousel (only if it was scrolled: a scrollTo forces a full layout),
  // bring the game top into view, focus the round heading.
  useLayoutEffect(() => {
    if (scrollLeft.current !== 0) scroller.current?.scrollTo({ left: 0 });
    scrollLeft.current = 0;
    setActive(0);
  }, [trioKey]);
  useEffect(() => {
    const root = area.current?.closest('.game-root') as HTMLElement | null;
    if (root) bringIntoView(root);
    heading.current?.focus({ preventScroll: true });
    setAnnounce(`Round ${roundsDone + 1} of ${total}. Three new resumes.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trioKey]);

  // The phone footer only shows while the cards are on screen.
  useEffect(() => {
    const el = area.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setInView(!!e?.isIntersecting), { rootMargin: '0px 0px -80px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Which card is centered in the phone carousel. While a chip tap scrolls programmatically, the
  // target stays active so the rank button never flickers to the card being passed.
  const target = useRef<{ index: number; until: number } | null>(null);
  const onScroll = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
    scrollLeft.current = sc.scrollLeft;
    const center = sc.scrollLeft + sc.clientWidth / 2;
    let best = 0;
    let bestD = Infinity;
    Array.from(sc.children).forEach((child, i) => {
      const c = child as HTMLElement;
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const t = target.current;
    if (t) {
      if (best !== t.index && Date.now() < t.until) return;
      target.current = null;
    }
    setActive(best);
  }, []);
  const raf = useRef(0);
  const onScrollThrottled = useCallback(() => {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(onScroll);
  }, [onScroll]);

  const showCard = useCallback((i: number) => {
    const sc = scroller.current;
    const c = sc?.children[i] as HTMLElement | undefined;
    if (!sc || !c) return;
    target.current = { index: i, until: Date.now() + 900 };
    sc.scrollTo({ left: c.offsetLeft - (sc.clientWidth - c.offsetWidth) / 2, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    setActive(i);
  }, []);

  // Picks, announced politely for screen readers.
  const doPick = useCallback(
    (slug: string, via: 'pointer' | 'keyboard') => {
      const before = api.getState().picks;
      api.getState().pick(slug, via);
      const after = api.getState().picks;
      const L = letterOf(slug);
      if (after.length > before.length) {
        if (after.length === 2) {
          const third = trio.find((s) => !after.includes(s))!;
          const auto = api.getState().confirm?.auto;
          setAnnounce(`Team ${L} ranked 2nd, so Team ${letterOf(third)} is 3rd. ${auto ? 'Locking in. Undo to change it.' : 'Lock in, or undo.'}`);
        } else setAnnounce(`Team ${L} ranked 1st.`);
      } else if (after.length < before.length) setAnnounce(`Undid Team ${L}.`);
    },
    [api, letterOf, trio],
  );
  const doUndo = useCallback(() => {
    const p = api.getState().picks;
    if (!p.length || api.getState().confirm?.locked) return;
    api.getState().undo();
    setAnnounce(`Undid Team ${letterOf(p[p.length - 1]!)}.`);
  }, [api, letterOf]);

  // Pointer picks lock themselves after a short undo window (unless turned off); keyboard picks wait for Enter.
  useEffect(() => {
    if (!confirm?.auto || confirm.locked) return;
    const t = window.setTimeout(() => api.getState().lock(), LOCK_MS);
    return () => window.clearTimeout(t);
  }, [confirm, api]);

  // Focus follows the controls: Lock in when it appears, back to a rank button after Undo.
  const lockBtn = useRef<HTMLButtonElement>(null);
  const rankBtns = useRef<Record<string, HTMLButtonElement | null>>({});
  const prevPicks = useRef(picks.length);
  useEffect(() => {
    if (confirm?.locked) return;
    const activeEl = document.activeElement as HTMLElement | null;
    const inControls = !activeEl || activeEl === document.body || !!activeEl.closest('[data-rank-controls]');
    // Keyboard picks (no auto-lock) always land on Lock in, so Enter confirms; pointer picks only
    // move focus when it was on the controls that just changed.
    if (confirm && (!confirm.auto || inControls)) focusInView(lockBtn.current);
    else if (!confirm && prevPicks.current > picks.length && inControls) {
      const firstOpen = trio.find((s) => !picks.includes(s) && rankBtns.current[s]);
      focusInView(desktop ? (firstOpen ? rankBtns.current[firstOpen] : null) : (rankBtns.current.mobile ?? (firstOpen ? rankBtns.current[firstOpen] : null)));
    }
    prevPicks.current = picks.length;
  }, [confirm, picks, trio, desktop]);

  // Keyboard: A/B/C rank that card next, Backspace undoes, Enter locks in. Only while focus is in
  // the game (or nowhere): elsewhere on the page the letters are just letters (WCAG 2.1.4).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && t !== document.documentElement && !t.closest('.game-root')) return;
      if (t?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      const s = api.getState();
      if (s.reveal || s.confirm?.locked) return;
      const k = e.key.toLowerCase();
      const i = (LETTERS as readonly string[]).indexOf(k.toUpperCase());
      if (i >= 0 && k.length === 1) {
        e.preventDefault();
        if (!s.confirm) doPick(trio[i]!, 'keyboard');
      } else if (k === 'backspace') {
        e.preventDefault();
        doUndo();
      } else if (k === 'enter' && s.confirm && !t?.closest('button, a')) {
        e.preventDefault();
        s.lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, trio, doPick, doUndo]);

  const skipEnabled = roundsDone >= SKIP_AFTER;
  const extra = roundsDone >= TRIO_RULES.baseRounds;
  const nextOrdinal = ordinal(Math.min(picks.length + 1, 2));
  const confirmOrder = confirm ? [picks[0]!, picks[1]!, trio.find((s) => !picks.includes(s))!] : null;

  const onRank = (slug: string) => (e: { detail: number; timeStamp: number }) => {
    if (isStale(e)) return;
    doPick(slug, e.detail === 0 ? 'keyboard' : 'pointer');
  };
  const onUndo = (e: { detail: number; timeStamp: number }) => {
    if (isStale(e)) return;
    doUndo();
  };

  return (
    <div className="mx-auto w-full max-w-game px-gutter pb-28 lg:px-gutter-lg lg:pb-8">
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announce}
      </p>

      {/* Progress */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 pt-2 pb-3 lg:grid-cols-[auto_1fr_auto] lg:py-3">
        <h2 ref={heading} tabIndex={-1} className="label-caps whitespace-nowrap text-fg outline-none" data-testid="round-label">
          <span className="text-fg-muted">Round</span> {round} <span className="text-fg-muted">of {total}</span>
        </h2>
        <ol className="col-span-2 row-start-2 flex gap-1 lg:col-span-1 lg:col-start-2 lg:row-start-1" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <li
              key={i}
              className={`h-1.5 flex-1 rounded-slab transition-colors duration-(--duration-base) ${
                i < roundsDone ? 'bg-accent-fill' : i === roundsDone && !lockedIn ? 'bg-fg' : 'bg-track'
              }`}
            />
          ))}
        </ol>
        <button
          type="button"
          className={`btn -mr-3 text-label-lg ${extra ? 'btn-secondary mr-0 min-h-10 px-4' : 'btn-ghost'}`}
          disabled={!skipEnabled}
          onClick={() => api.getState().skipToResults()}
          data-testid="skip"
        >
          {extra ? 'Final results' : skipEnabled ? 'Skip to results' : `Skip after round ${SKIP_AFTER}`}
        </button>
      </div>

      {/* Head-to-head flags */}
      {flags.length > 0 && (
        <ul className="mb-3 flex flex-col items-center gap-1.5" aria-label="Head-to-head">
          {flags.map((f) => (
            <li key={`${f.winner}-${f.loser}-${f.week}`} className="inline-flex max-w-full items-center gap-2.5 rounded-chip border border-line bg-surface py-1.5 pr-3 pl-2">
              <span className="label-caps flex-none rounded-slab bg-raised-2 px-1.5 py-0.5 text-fg">H2H</span>
              <span className="cond text-[1.0625rem] leading-5 font-semibold">
                {letterOf(f.winner)} beat {letterOf(f.loser)} head-to-head · +{f.margin}
                <span className="sr-only"> points, week {f.week}</span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Phones: the three resumes side by side in one glance */}
      {!desktop && <Glance gd={gd} trio={trio} placeOf={placeOf} onShow={showCard} />}

      {/* Cards + desktop rank bar */}
      <div ref={area} className="relative">
        <div
          ref={scroller}
          onScroll={onScrollThrottled}
          className="game-carousel -mx-gutter flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-gutter px-gutter pb-2 lg:mx-0 lg:grid lg:grid-cols-3 lg:gap-x-5 lg:overflow-visible lg:px-0 lg:pb-0"
          data-testid="cards"
        >
          {trio.map((slug, i) => (
            <div key={`${trioKey}-${slug}`} className="w-[88%] max-w-[26rem] flex-none snap-center animate-rise lg:w-auto lg:max-w-none" style={{ animationDelay: `${i * 50}ms` }}>
              <BlindCard letter={LETTERS[i]!} card={gd.cards[slug]!} tiers={gd.tiers} fbsCount={gd.fbsCount} place={placeOf(slug)} ratingsUrl={gd.ratingsUrl} />
            </div>
          ))}
        </div>

        {desktop && (
          <div
            className="sticky bottom-0 z-10 mt-0 bg-page pt-3 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-page before:to-transparent"
            data-rank-controls
          >
            {confirmOrder ? (
              <ConfirmBar order={confirmOrder} letterOf={letterOf} auto={!!confirm?.auto} locked={!!confirm?.locked} lockRef={lockBtn} layout="desktop" isStale={isStale} onUndo={onUndo} />
            ) : (
              <div className="grid grid-cols-3 gap-x-5">
                {trio.map((slug, i) => {
                  const placed = picks.indexOf(slug) === 0;
                  return (
                    <button
                      key={slug}
                      ref={(el) => {
                        rankBtns.current[slug] = el;
                      }}
                      type="button"
                      className="btn btn-rank"
                      data-place={placed ? 1 : undefined}
                      aria-pressed={placed}
                      onClick={onRank(slug)}
                      data-testid={`rank-${LETTERS[i]}`}
                    >
                      {placed ? (
                        <>
                          1st · undo<span className="sr-only">, Team {LETTERS[i]}</span>
                        </>
                      ) : (
                        `Rank ${LETTERS[i]} ${nextOrdinal}`
                      )}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="mt-2 text-center text-[0.8125rem] leading-5 text-fg-faint">
              Keys: <kbd className="cond font-semibold text-fg-muted">A</kbd> <kbd className="cond font-semibold text-fg-muted">B</kbd>{' '}
              <kbd className="cond font-semibold text-fg-muted">C</kbd> rank a card · <kbd className="cond font-semibold text-fg-muted">Backspace</kbd> undo ·{' '}
              <kbd className="cond font-semibold text-fg-muted">Enter</kbd> lock in
            </p>
          </div>
        )}
      </div>

      <div className="mt-3 flex flex-col items-center gap-1 text-center lg:mt-2">
        <p className="flex flex-col items-center text-[0.8125rem] leading-5 text-fg-muted lg:flex-row lg:flex-wrap lg:justify-center" data-testid="card-note">
          <span>#1 = best of {gd.fbsCount} FBS teams</span>
          <span className="lg:before:px-1.5 lg:before:content-['·']">Tap or click a stat name to see what it measures</span>
          <span className="lg:before:px-1.5 lg:before:content-['·']">
            <FeiCredit url={gd.ratingsUrl} />
          </span>
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6">
          <Switch checked={showReveals} onChange={(v) => api.getState().setShowReveals(v)} className="text-[0.875rem] text-fg-muted">
            Show the answers after each round
          </Switch>
          <Switch checked={autoLock} onChange={(v) => api.getState().setAutoLock(v)} className="text-[0.875rem] text-fg-muted" testid="autolock">
            Lock in automatically
          </Switch>
        </div>
      </div>

      {/* Phone footer: one fixed height for every state, so swapping its contents never moves it. */}
      {!desktop && (
        <div
          className={`fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-footer transition-transform duration-(--duration-base) ${
            inView || confirm ? 'translate-y-0' : 'translate-y-full'
          }`}
          data-rank-controls
          data-testid="footer"
        >
          <div className="mx-auto flex h-17 max-w-[30rem] items-center gap-2.5 px-gutter">
            {confirmOrder ? (
              <ConfirmBar order={confirmOrder} letterOf={letterOf} auto={!!confirm?.auto} locked={!!confirm?.locked} lockRef={lockBtn} layout="phone" isStale={isStale} onUndo={onUndo} />
            ) : picks.length === 1 ? (
              <div className="flex w-full items-center gap-2.5 animate-fade">
                <UndoButton onClick={onUndo} label={`Team ${letterOf(picks[0]!)}, 1st`} compact />
                {trio
                  .filter((s) => !picks.includes(s))
                  .map((slug) => (
                    <button
                      key={slug}
                      ref={(el) => {
                        rankBtns.current[slug] = el;
                      }}
                      type="button"
                      className="btn btn-rank min-w-0 flex-1 px-2"
                      onClick={onRank(slug)}
                      data-testid={`rank-${letterOf(slug)}`}
                    >
                      Rank {letterOf(slug)} 2nd
                    </button>
                  ))}
              </div>
            ) : (
              <>
                <div className="flex flex-none items-center gap-1" role="group" aria-label="Show card">
                  {trio.map((slug, i) => {
                    const current = i === active;
                    const rec = recordText(gd.cards[slug]!.record);
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => showCard(i)}
                        aria-current={current ? 'true' : undefined}
                        className="relative grid h-12 w-11 place-items-center"
                        data-testid={`dot-${LETTERS[i]}`}
                      >
                        <span
                          className={`cond flex h-10 w-10 flex-col items-center justify-center rounded-chip leading-none font-bold transition-colors duration-(--duration-fast) ${
                            current ? 'bg-fg text-page' : 'bg-raised-2 text-fg-muted'
                          }`}
                        >
                          <span className="sr-only">Show Team </span>
                          <span className="text-[1.0625rem]">{LETTERS[i]}</span>
                          <span className="sr-only">, </span>
                          <span className="mt-0.5 text-[0.75rem] font-semibold">{rec}</span>
                        </span>
                        <span
                          className={`absolute bottom-0 h-0.5 w-5 rounded-full transition-opacity duration-(--duration-fast) ${current ? 'bg-fg opacity-100' : 'opacity-0'}`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
                <button
                  ref={(el) => {
                    rankBtns.current.mobile = el;
                  }}
                  type="button"
                  className="btn btn-rank min-w-0 flex-1"
                  onClick={onRank(trio[active]!)}
                  data-testid="rank-current"
                >
                  Rank {LETTERS[active]} 1st
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function UndoButton({ onClick, label, compact, disabled }: { onClick: (e: { detail: number; timeStamp: number }) => void; label?: string; compact?: boolean; disabled?: boolean }) {
  return (
    <button type="button" className={`btn btn-secondary flex-none ${compact ? 'px-3.5 max-[22.5rem]:px-3' : 'px-4'}`} onClick={onClick} disabled={disabled} data-testid="undo">
      <UndoIcon />
      {/* Icon only on the narrowest phones (the word stays for screen readers), so both rank buttons fit. */}
      <span className={compact ? 'max-[22.5rem]:sr-only' : undefined}>Undo</span>
      {label && <span className="sr-only"> {label}</span>}
    </button>
  );
}

/**
 * Phones: one row per card with the numbers a fan compares first (record, the four FEI ranks, record
 * against the top 25), so A vs B vs C does not need memorizing while swiping. Tapping a row shows
 * that card. The best value in each column is in full white; picks show as the card letter plates.
 */
function Glance({ gd, trio, placeOf, onShow }: { gd: GameData; trio: readonly string[]; placeOf: (slug: string) => Place; onShow: (i: number) => void }) {
  const rows = trio.map((slug) => {
    const c = gd.cards[slug]!;
    const t25 = [c.quality.top10[0] + c.quality.r11to25[0], c.quality.top10[1] + c.quality.r11to25[1]] as const;
    return { slug, c, t25, pct: c.record.w / Math.max(1, c.record.w + c.record.l) };
  });
  const best = {
    rec: Math.max(...rows.map((r) => r.pct)),
    sor: Math.min(...rows.map((r) => r.c.ranks.sor)),
    off: Math.min(...rows.map((r) => r.c.ranks.off)),
    def: Math.min(...rows.map((r) => r.c.ranks.def)),
    sos: Math.min(...rows.map((r) => r.c.ranks.sos)),
    t25: Math.max(...rows.map((r) => r.t25[0])),
  };
  const cell = (isBest: boolean) => `py-1 text-right ${isBest ? 'text-fg' : 'text-fg-muted'}`;
  const th = 'label-caps py-1 text-right font-semibold text-fg-muted';
  return (
    <div className="mb-3 rounded-card border border-line bg-surface px-2.5 py-1.5" data-testid="glance">
      <table className="cond w-full border-collapse text-[0.9375rem] leading-5 font-bold">
        <caption className="sr-only">The three resumes at a glance (ranks among {gd.fbsCount} FBS teams)</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className="label-caps w-9 py-1 text-left font-semibold text-fg-muted">
              <span className="sr-only">Team</span>
            </th>
            <th scope="col" className={`${th} text-left`}>
              Rec
            </th>
            <th scope="col" className={th}>
              <abbr title="FEI strength of record" className="no-underline">
                SoR
              </abbr>
            </th>
            <th scope="col" className={th}>
              Off
            </th>
            <th scope="col" className={th}>
              Def
            </th>
            <th scope="col" className={th}>
              Sched
            </th>
            <th scope="col" className={th}>
              <abbr title="Record against FEI top 25 teams" className="no-underline">
                v Top 25
              </abbr>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ slug, c, t25, pct }, i) => {
            const place = placeOf(slug);
            const plate =
              place === 1
                ? 'bg-accent-fill text-on-accent'
                : place === 2
                  ? 'bg-accent-tint text-accent shadow-[inset_0_0_0_1px_var(--color-accent-edge)]'
                  : place === 3
                    ? 'bg-raised-2 text-fg-muted'
                    : 'bg-fg text-page';
            return (
              <tr key={slug} className="cursor-pointer border-t border-line first:border-t-0" onClick={() => onShow(i)}>
                <th scope="row" className="py-1 text-left">
                  <button type="button" className={`grid h-6 w-7 place-items-center rounded-slab text-[0.9375rem] ${plate}`} onClick={(e) => (e.stopPropagation(), onShow(i))} aria-label={`Team ${LETTERS[i]}${place ? `, ranked ${ordinal(place)}` : ''}: show card`}>
                    {LETTERS[i]}
                  </button>
                </th>
                <td className={`${cell(pct === best.rec)} text-left`}>{recordText(c.record)}</td>
                <td className={cell(c.ranks.sor === best.sor)}>{c.ranks.sor}</td>
                <td className={cell(c.ranks.off === best.off)}>{c.ranks.off}</td>
                <td className={cell(c.ranks.def === best.def)}>{c.ranks.def}</td>
                <td className={cell(c.ranks.sos === best.sos)}>{c.ranks.sos}</td>
                <td className={cell(t25[0] === best.t25 && t25[0] > 0)}>
                  {t25[0]}-{t25[1]}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The lock-in moment: the implied order, Undo, and Lock in (which fills while it counts down).
 * Locked: the same bar, inert, while the reveal is open. Hovering Undo with a real mouse movement
 * stops the countdown; the hover a stationary cursor gets when the bar appears under it does not.
 */
function ConfirmBar(props: {
  order: string[];
  letterOf: (slug: string) => string;
  auto: boolean;
  locked: boolean;
  lockRef: RefObject<HTMLButtonElement | null>;
  layout: 'desktop' | 'phone';
  isStale: Guard;
  onUndo: (e: { detail: number; timeStamp: number }) => void;
}) {
  const api = useGameApi();
  const { order, letterOf, auto, locked, lockRef, layout, isStale, onUndo } = props;
  const mounted = useRef(0);
  useLayoutEffect(() => {
    mounted.current = performance.now();
  }, []);
  const toManual = () => api.getState().setConfirmManual();
  const onUndoMove = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && (e.movementX || e.movementY) && e.timeStamp - mounted.current > GUARD_MS) toManual();
  };
  const undo = (
    <span
      className="flex-none"
      onPointerMove={auto ? onUndoMove : undefined}
      // Keyboard focus on Undo stops the countdown; the focus a mouse press gives it does not.
      onFocus={(e) => {
        if ((e.target as HTMLElement).matches(':focus-visible')) toManual();
      }}
    >
      <UndoButton onClick={onUndo} compact={layout === 'phone'} disabled={locked} />
    </span>
  );
  const lock = (
    <button
      ref={lockRef}
      type="button"
      className={`btn btn-primary relative overflow-hidden ${layout === 'phone' ? 'min-w-0 flex-1' : 'min-w-56'}`}
      onClick={(e) => {
        if (!isStale(e)) api.getState().lock();
      }}
      disabled={locked}
      data-testid="lock"
    >
      {auto && !locked && (
        <span
          className="game-countdown pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-on-accent/15"
          style={{ animationDuration: `${LOCK_MS}ms` } as CSSProperties}
          aria-hidden="true"
        />
      )}
      <span className="relative">
        {locked ? 'Locked in' : auto ? 'Locking in' : 'Lock in'}
        {layout === 'phone' && <span className="ml-2 tracking-[0.12em]">{order.map(letterOf).join(' · ')}</span>}
        {auto && !locked && layout !== 'phone' && '…'}
      </span>
    </button>
  );
  if (layout === 'phone') {
    return (
      <div className="flex w-full items-center gap-2.5 animate-fade">
        {undo}
        {lock}
      </div>
    );
  }
  return (
    <div className="flex animate-fade flex-wrap items-center justify-center gap-x-6 gap-y-3 rounded-card border border-line bg-surface px-4 py-2.5">
      <p className="flex items-center gap-2" aria-label={`Your order: ${order.map((s, i) => `Team ${letterOf(s)} ${ordinal(i + 1)}`).join(', ')}`}>
        <span className="label-caps mr-1 text-fg-muted">Your order</span>
        {order.map((s, i) => (
          <span key={s} className="flex items-center gap-1.5" aria-hidden="true">
            <span
              className={`cond grid size-8 place-items-center rounded-chip text-[1.125rem] leading-none font-bold ${
                i === 0 ? 'bg-accent-fill text-on-accent' : i === 1 ? 'bg-accent-tint text-accent shadow-[inset_0_0_0_1px_var(--color-accent-edge)]' : 'bg-raised-2 text-fg-muted'
              }`}
            >
              {letterOf(s)}
            </span>
            {i < 2 && <span className="text-fg-faint">›</span>}
          </span>
        ))}
      </p>
      <div className="flex items-center gap-3">
        {undo}
        {lock}
      </div>
    </div>
  );
}
