/**
 * One round (DESIGN.md §10): progress, head-to-head flags, three blind cards (snap carousel on
 * phones, three columns on desktop), and the ranking controls — a sticky bar aligned with the cards
 * on desktop, a fixed one-thumb footer on phones. After the second pick the third is implied and a
 * short lock-in moment offers Undo before the round locks.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { headToHeadFlags } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { BlindCard, type Place } from './BlindCard';
import { useGame, useGameApi, useGameData } from './context';
import { LETTERS, ordinal, scrollBehavior } from './format';
import { FeiCredit, Switch, UndoIcon } from './ui';
import { useIsDesktop } from './hooks';

/** How long a pointer pick waits before locking (the undo window). */
const LOCK_MS = 1400;
/** Rounds before "Skip to results" unlocks (SPEC: after round 5). */
const SKIP_AFTER = 5;

export function Play() {
  const api = useGameApi();
  const gd = useGameData();
  const trio = useGame((s) => s.trio)!;
  const picks = useGame((s) => s.picks);
  const confirm = useGame((s) => s.confirm);
  const roundsDone = useGame((s) => s.rounds.length);
  const revealOpen = useGame((s) => s.reveal !== null);
  const showReveals = useGame((s) => s.showReveals);
  const desktop = useIsDesktop();

  // While the reveal is open the round just played is still on screen (it is already in `rounds`).
  const round = revealOpen ? roundsDone : roundsDone + 1;
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
  const [active, setActive] = useState(0);
  const [inView, setInView] = useState(true);
  const [announce, setAnnounce] = useState('');

  // New round: reset the carousel, bring the game top into view, focus the round heading.
  const trioKey = trio.join('|');
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ left: 0 });
    setActive(0);
  }, [trioKey]);
  useEffect(() => {
    const root = area.current?.closest('.game-root') as HTMLElement | null;
    if (root && root.getBoundingClientRect().top < -8) root.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
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

  // Which card is centered in the phone carousel. While a dot tap scrolls programmatically, the
  // target stays active so the rank button never flickers to the card being passed.
  const target = useRef<{ index: number; until: number } | null>(null);
  const onScroll = useCallback(() => {
    const sc = scroller.current;
    if (!sc) return;
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
    sc.scrollTo({ left: c.offsetLeft - (sc.clientWidth - c.offsetWidth) / 2, behavior: scrollBehavior() });
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
          setAnnounce(`Team ${L} ranked 2nd, so Team ${letterOf(third)} is 3rd. Lock in, or undo.`);
        } else setAnnounce(`Team ${L} ranked 1st.`);
      } else if (after.length < before.length) setAnnounce(`Undid Team ${L}.`);
    },
    [api, letterOf, trio],
  );
  const doUndo = useCallback(() => {
    const p = api.getState().picks;
    if (!p.length) return;
    api.getState().undo();
    setAnnounce(`Undid Team ${letterOf(p[p.length - 1]!)}.`);
  }, [api, letterOf]);

  // Pointer picks lock themselves after a short undo window; keyboard picks wait for Enter.
  useEffect(() => {
    if (!confirm?.auto) return;
    const t = window.setTimeout(() => api.getState().lock(), LOCK_MS);
    return () => window.clearTimeout(t);
  }, [confirm, api]);

  // Focus follows the controls: Lock in when it appears, back to a rank button after Undo.
  const lockBtn = useRef<HTMLButtonElement>(null);
  const rankBtns = useRef<Record<string, HTMLButtonElement | null>>({});
  const prevPicks = useRef(picks.length);
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const inControls = !active || active === document.body || !!active.closest('[data-rank-controls]');
    // Keyboard picks (no auto-lock) always land on Lock in, so Enter confirms; pointer picks only
    // move focus when it was on the controls that just changed.
    if (confirm && (!confirm.auto || inControls)) lockBtn.current?.focus({ preventScroll: true });
    else if (!confirm && prevPicks.current === 2 && picks.length === 1 && inControls) {
      const undone = trio.find((s) => !picks.includes(s) && rankBtns.current[s]);
      (desktop && undone ? rankBtns.current[undone] : rankBtns.current.mobile)?.focus({ preventScroll: true });
    }
    prevPicks.current = picks.length;
  }, [confirm, picks, trio, desktop]);

  // Keyboard: A/B/C rank that card next, Backspace undoes, Enter locks in.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"], dialog')) return;
      if (api.getState().reveal) return;
      const k = e.key.toLowerCase();
      const i = (LETTERS as readonly string[]).indexOf(k.toUpperCase());
      if (i >= 0 && k.length === 1) {
        e.preventDefault();
        if (!api.getState().confirm) doPick(trio[i]!, 'keyboard');
      } else if (k === 'backspace') {
        e.preventDefault();
        doUndo();
      } else if (k === 'enter' && api.getState().confirm && !t?.closest('button, a')) {
        e.preventDefault();
        api.getState().lock();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, trio, doPick, doUndo]);

  const skipEnabled = roundsDone >= SKIP_AFTER;
  const extra = roundsDone >= TRIO_RULES.baseRounds;
  const nextOrdinal = ordinal(Math.min(picks.length + 1, 2));

  const confirmOrder = confirm ? [picks[0]!, picks[1]!, trio.find((s) => !picks.includes(s))!] : null;

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
                i < roundsDone ? 'bg-accent-fill' : i === roundsDone && !revealOpen ? 'bg-fg' : 'bg-track'
              }`}
            />
          ))}
        </ol>
        <button
          type="button"
          className={`btn -mr-3 text-label-lg disabled:opacity-50 ${extra ? 'btn-secondary mr-0 min-h-10 px-4' : 'btn-ghost'}`}
          disabled={!skipEnabled}
          aria-describedby={skipEnabled ? undefined : 'skip-hint'}
          title={skipEnabled ? undefined : `Available after round ${SKIP_AFTER}`}
          onClick={() => api.getState().skipToResults()}
          data-testid="skip"
        >
          {extra ? 'Final results' : 'Skip to results'}
        </button>
        <span id="skip-hint" className="sr-only">
          Available after round {SKIP_AFTER}
        </span>
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
              <BlindCard letter={LETTERS[i]!} card={gd.cards[slug]!} tiers={gd.tiers} fbsCount={gd.fbsCount} place={placeOf(slug)} />
            </div>
          ))}
        </div>

        {desktop && (
          <div
            className="sticky bottom-0 z-10 mt-0 bg-page pt-3 pb-4 before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-page before:to-transparent"
            data-rank-controls
          >
            {confirmOrder ? (
              <ConfirmBar order={confirmOrder} letterOf={letterOf} auto={!!confirm?.auto} lockRef={lockBtn} layout="desktop" />
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
                      aria-label={placed ? `Team ${LETTERS[i]} is 1st. Press to undo.` : undefined}
                      onClick={(e) => doPick(slug, e.detail === 0 ? 'keyboard' : 'pointer')}
                      data-testid={`rank-${LETTERS[i]}`}
                    >
                      {placed ? '1st · tap to undo' : `Rank ${LETTERS[i]} ${nextOrdinal}`}
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
        <p className="text-[0.8125rem] leading-5 text-fg-muted">
          #N = rank among all {gd.fbsCount} FBS teams · <FeiCredit url={gd.ratingsUrl} />
        </p>
        <Switch checked={showReveals} onChange={(v) => api.getState().setShowReveals(v)} className="text-[0.875rem] text-fg-muted">
          Show the answers after each round
        </Switch>
      </div>

      {/* Phone footer: card-in-view chips + one big thumb button */}
      {!desktop && (
        <div
          className={`fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-footer transition-transform duration-(--duration-base) ${
            inView || confirm ? 'translate-y-0' : 'translate-y-full'
          }`}
          data-rank-controls
          data-testid="footer"
        >
          <div className="mx-auto flex max-w-[30rem] items-center gap-3 px-gutter py-2.5">
            {confirmOrder ? (
              <ConfirmBar order={confirmOrder} letterOf={letterOf} auto={!!confirm?.auto} lockRef={lockBtn} layout="phone" />
            ) : (
              <>
                <div className="flex flex-none items-center gap-1" role="group" aria-label="Show card">
                  {trio.map((slug, i) => {
                    const place = placeOf(slug);
                    const current = i === active;
                    return (
                      <button
                        key={slug}
                        type="button"
                        onClick={() => showCard(i)}
                        aria-current={current ? 'true' : undefined}
                        aria-label={`Show Team ${LETTERS[i]}${place ? `, ranked ${ordinal(place)}` : ''}`}
                        className="relative grid h-11 w-9 place-items-center"
                        data-testid={`dot-${LETTERS[i]}`}
                      >
                        <span
                          className={`cond grid size-8 place-items-center rounded-chip text-[1.0625rem] leading-none font-bold transition-colors duration-(--duration-fast) ${
                            place === 1
                              ? 'bg-accent-fill text-on-accent'
                              : current
                                ? 'bg-fg text-page'
                                : 'bg-raised-2 text-fg-muted'
                          }`}
                        >
                          {LETTERS[i]}
                        </span>
                        <span
                          className={`absolute bottom-0 h-0.5 w-5 rounded-full transition-opacity duration-(--duration-fast) ${current ? 'bg-fg opacity-100' : 'opacity-0'}`}
                          aria-hidden="true"
                        />
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const slug = trio[active]!;
                  const placed = picks.indexOf(slug) === 0;
                  return (
                    <button
                      ref={(el) => {
                        rankBtns.current.mobile = el;
                      }}
                      type="button"
                      className="btn btn-rank min-w-0 flex-1"
                      data-place={placed ? 1 : undefined}
                      aria-pressed={placed}
                      aria-label={placed ? `Team ${LETTERS[active]} is 1st. Tap to undo.` : undefined}
                      onClick={(e) => doPick(slug, e.detail === 0 ? 'keyboard' : 'pointer')}
                      data-testid="rank-current"
                    >
                      {placed ? '1st · tap to undo' : `Rank ${LETTERS[active]} ${nextOrdinal}`}
                    </button>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The lock-in moment: the implied order, Undo, and Lock in (which fills while it counts down). */
function ConfirmBar(props: {
  order: string[];
  letterOf: (slug: string) => string;
  auto: boolean;
  lockRef: RefObject<HTMLButtonElement | null>;
  layout: 'desktop' | 'phone';
}) {
  const api = useGameApi();
  const { order, letterOf, auto, lockRef, layout } = props;
  const toManual = () => api.getState().setConfirmManual();
  const undo = (
    <button
      type="button"
      className={`btn btn-secondary ${layout === 'phone' ? 'flex-none px-4' : 'min-w-36'}`}
      onClick={() => api.getState().undo()}
      onPointerEnter={toManual}
      onFocus={toManual}
      data-testid="undo"
    >
      <UndoIcon />
      Undo
    </button>
  );
  const lock = (
    <button
      ref={lockRef}
      type="button"
      className={`btn btn-primary relative overflow-hidden ${layout === 'phone' ? 'min-w-0 flex-1' : 'min-w-56'}`}
      onClick={() => api.getState().lock()}
      data-testid="lock"
    >
      {auto && (
        <span
          className="game-countdown pointer-events-none absolute inset-y-0 left-0 w-full origin-left bg-on-accent/15"
          style={{ animationDuration: `${LOCK_MS}ms` }}
          aria-hidden="true"
        />
      )}
      <span className="relative">
        {auto ? 'Locking in' : 'Lock in'}
        {layout === 'phone' && <span className="ml-2 tracking-[0.12em]">{order.map(letterOf).join(' · ')}</span>}
        {auto && layout !== 'phone' && '…'}
      </span>
    </button>
  );
  if (layout === 'phone') {
    return (
      <div className="flex w-full items-center gap-3 animate-fade">
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
