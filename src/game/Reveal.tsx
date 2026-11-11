/**
 * The reveal after each round (DESIGN.md §15): a native modal <dialog> (inert background, focus
 * inside, Esc handled), the three teams in the user's order with You / Committee / FEI (/ Fans),
 * match chips and the running line. Tap anywhere, Esc, Enter or a letter key continues; arrow,
 * Page, Home/End and Space keys scroll the panel instead (keyboard and zoomed-in users can read
 * all of it). It opens scrolled to the top with Next round and the FEI credit pinned to its
 * bottom edge, so short screens scroll the list, never the button. Taps in the first moments after
 * it opens are ignored (a double tap on the last pick must not dismiss it unseen).
 */

/* ─────────────────────────────────────────────────────────
 * ANIMATION STORYBOARD: the declassify
 *
 * Read top-to-bottom. Each value is ms after the round locks and the dialog opens.
 * CSS only (game.css "The declassify"): transform + opacity keyframes, no JS timers, no library.
 *
 *    0ms   the sheet lands: panel fades in, rises 8px → 0 (200ms)
 *   80ms   the bar over your 1st pick lifts, scaleX 1 → 0 toward the record (240ms)
 *  180ms   the bar over your 2nd pick lifts (stagger 100ms)
 *  280ms   the bar over your 3rd pick lifts
 *  520ms   all three names declassified; the panel is at rest
 *
 * Next round and Esc are live from 0ms: the bars are pointer-events: none pseudo-elements (taps
 * and Enter are only held for the GUARD_MS double-tap window). Screen readers get the names at
 * once. Reduced motion: no rise and no bars, the final frame at once. Forced colours: the bar is a
 * solid CanvasText block while it lifts.
 * ───────────────────────────────────────────────────────── */

import { useEffect, useMemo, useRef, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { agreement, runningLine } from '@lib/agreement';
import { gameAgreementRefs, type GameData } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { useGame, useGameApi, useGameData } from './context';
import { emphasize, LETTERS, ordinal, recordText } from './format';
import { ArrowIcon, CheckIcon, CrossIcon, FeiCredit, Switch, TeamBlock } from './ui';
import { GUARD_MS } from './hooks';

const TIMING = {
  panelIn:      0,    // the sheet lands on the desk
  firstLift:    80,   // the bar over your 1st pick starts to lift
  liftStagger:  100,  // each next bar, in your order (2nd at 180ms, 3rd at 280ms)
  declassified: 520,  // the last bar is gone: firstLift + 2 × liftStagger + BAR.duration
} as const;

/* The panel: one sheet laid on the desk. */
const PANEL = {
  duration: 200,               // ms: fade 0 → 1 while it rises
  rise:     8,                 // px it rises from
  ease:     'var(--ease-out)', // quick start, soft stop
} as const;

/* The redaction bar over each name (`.team-name::after`, the marker-swipe shape). */
const BAR = {
  duration: 240,                      // ms each bar takes to lift
  origin:   'right',                  // it peels off toward the record
  ease:     'var(--ease-declassify)', // cubic-bezier(0.77, 0, 0.175, 1): holds, lifts, lands soft
} as const;

/** The storyboard handed to game.css as custom properties: the numbers live only above. */
const MOTION = {
  '--reveal-in-duration': `${PANEL.duration}ms`,
  '--reveal-in-delay': `${TIMING.panelIn}ms`,
  '--reveal-in-rise': `${PANEL.rise}px`,
  '--reveal-in-ease': PANEL.ease,
  '--declassify-duration': `${BAR.duration}ms`,
  '--declassify-origin': BAR.origin,
  '--declassify-ease': BAR.ease,
} as CSSProperties;

/** When the bar over row `i`'s name (0 = your 1st pick) starts to lift. */
const liftAt = (i: number): CSSProperties => ({ '--lift-at': `${TIMING.firstLift + i * TIMING.liftStagger}ms` }) as CSSProperties;

/** Keys that move around or scroll inside the panel rather than continue. */
const NAV_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/** Place of each trio team by a rank lookup (1 = best); null when the team is unranked there. */
function placesBy(trio: readonly string[], rankOf: (s: string) => number | null): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const s of trio) {
    const r = rankOf(s);
    out[s] = r === null ? null : 1 + trio.filter((o) => o !== s && (rankOf(o) ?? Infinity) < r).length;
  }
  return out;
}

/**
 * One place cell. `short` is the label shown when four cells share a 320px phone ("CFP" for
 * Committee, as on the results tiles); screen readers always hear the full label.
 */
function Cell(props: { label: string; short?: string; place: number | null; you: number; sub?: string; testid?: string; dense: boolean }) {
  const { label, short, place, you, sub, dense } = props;
  const same = place === you;
  return (
    <div className={`reveal-cell min-w-0 rounded-slab bg-raised px-2 py-0.5 sm:py-1 ${dense ? 'max-sm:px-1.5' : ''}`} data-testid={props.testid} data-match={same ? '' : undefined}>
      <dt className={`label-caps whitespace-nowrap text-fg-muted ${dense ? 'max-sm:text-[0.75rem]' : ''}`}>
        {short ? (
          <>
            <span className="max-[359px]:sr-only">{label}</span>
            <span className="hidden max-[359px]:inline" aria-hidden="true">
              {short}
            </span>
          </>
        ) : (
          label
        )}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5">
        <span className="reveal-value">{place === null ? 'NR' : ordinal(place)}</span>
        {same && label !== 'You' && <span className="sr-only">, same as your pick</span>}
        {sub && <span className="cond text-[0.875rem] leading-5 font-semibold text-fg-muted">{sub}</span>}
      </dd>
    </div>
  );
}

function MatchChip({ ok, who }: { ok: boolean; who: string }) {
  return ok ? (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-chip bg-accent-tint px-2 text-accent shadow-[inset_0_0_0_1px_var(--color-accent-edge)]">
      <CheckIcon />
      <span className="label-caps">Matches {who}</span>
    </span>
  ) : (
    <span className="inline-flex h-7 items-center gap-1.5 rounded-chip bg-raised px-2 text-fg-muted">
      <CrossIcon />
      <span className="label-caps">Differs from {who}</span>
    </span>
  );
}

function useRevealData(gd: GameData, rounds: readonly (readonly string[])[]) {
  return useMemo(() => {
    const summary = agreement(rounds, gameAgreementRefs(gd));
    return { summary, last: summary.rounds[summary.rounds.length - 1] ?? null, line: runningLine(summary) };
  }, [gd, rounds]);
}

export function Reveal() {
  const api = useGameApi();
  const gd = useGameData();
  const reveal = useGame((s) => s.reveal)!;
  const rounds = useGame((s) => s.rounds);
  const showReveals = useGame((s) => s.showReveals);
  const ref = useRef<HTMLDialogElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(Infinity);
  const { last, line } = useRevealData(gd, rounds);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) {
      d.showModal();
      // showModal focuses (and scrolls to) the first control; start at the top with Next round
      // focused instead (it is pinned to the bottom edge, so it is in view).
      next.current?.focus({ preventScroll: true });
      d.scrollTop = 0;
    }
    openedAt.current = performance.now();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  const close = () => api.getState().closeReveal();
  const tooSoon = (timeStamp: number) => timeStamp - openedAt.current < GUARD_MS;
  const { order, display, fans, round } = reveal;
  const total = round > TRIO_RULES.baseRounds ? TRIO_RULES.maxRounds : TRIO_RULES.baseRounds;
  const committee = placesBy(order, (s) => gd.teams[s]?.committee ?? null);
  const fei = placesBy(order, (s) => gd.teams[s]?.sor ?? null);
  const isLast = round >= TRIO_RULES.baseRounds;

  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, [role="switch"]')) return;
    if (e.detail !== 0 && tooSoon(e.timeStamp)) return;
    close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (NAV_KEYS.has(e.key) || e.key === 'Escape' || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    const onControl = !!t.closest('a, button, [role="switch"]');
    // Space scrolls unless it presses a control; Enter/Space on a link or the switch do their own thing.
    if (e.key === ' ' && !onControl) return;
    if ((e.key === 'Enter' || e.key === ' ') && t.closest('a, [role="switch"]')) return;
    e.preventDefault();
    if (e.repeat || tooSoon(e.timeStamp)) return;
    close();
  };
  const cells = 1 + (gd.hasCommittee ? 1 : 0) + 1 + (fans ? 1 : 0);
  // Four cells on a phone: the columns are weighted by their labels (You is short, Committee long)
  // and the cells get 12px labels, so "Committee" fits from 360px; below that it reads "CFP".
  const dense = cells === 4;
  const cols = dense
    ? 'grid-cols-4 max-sm:grid-cols-[minmax(0,0.85fr)_minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,0.9fr)]'
    : ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3'][cells];

  return (
    <dialog
      ref={ref}
      className="game-dialog m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[34rem] overflow-y-auto border-0 bg-transparent p-0 text-fg"
      aria-labelledby="reveal-h"
      aria-describedby="reveal-line"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      data-testid="reveal"
      style={MOTION}
    >
      <div className="reveal-panel rounded-panel border border-line-strong bg-surface">
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            <p className="label-caps text-fg-muted">
              Round {round} of {total}
            </p>
            <h2 id="reveal-h" className="cond text-heading">
              Your order, revealed
            </h2>
          </div>
        </header>
        <ol className="flex flex-col gap-3 px-5 sm:gap-3.5">
          {order.map((slug, i) => {
            const team = gd.teams[slug]!;
            const you = i + 1;
            const letter = LETTERS[display.indexOf(slug)]!;
            return (
              <li key={slug} style={liftAt(i)}>
                <TeamBlock slug={slug} team={team} seed={letter} size="reveal" meta={recordText(team.record)} link={false} className="max-sm:h-12" label={`Team ${letter} was ${team.name}, ${recordText(team.record)}`} />
                <dl className={`mt-1.5 grid gap-1 ${cols}`}>
                  <Cell label="You" place={you} you={you} dense={dense} />
                  {gd.hasCommittee && <Cell label="Committee" short={dense ? 'CFP' : undefined} place={committee[slug] ?? null} you={you} sub={team.committee ? `#${team.committee}` : undefined} dense={dense} />}
                  <Cell label="FEI SoR" place={fei[slug] ?? null} you={you} sub={`#${team.sor}`} dense={dense} />
                  {fans && <Cell label="Fans" place={fans.indexOf(slug) + 1 || null} you={you} testid="fans-cell" dense={dense} />}
                </dl>
              </li>
            );
          })}
        </ol>
        {last && (
          <div className="mt-3 flex flex-wrap gap-2 px-5 sm:mt-4">
            {last.committee !== null && <MatchChip ok={last.committee} who="committee" />}
            {last.fei !== null && <MatchChip ok={last.fei} who="FEI" />}
          </div>
        )}
        <p id="reveal-line" className="px-5 pt-3 text-[0.9375rem] leading-6 text-fg-muted" aria-live="polite">
          {emphasize(line, /\d+ of \d+/g, (m, k) => (
            <b key={k} className="font-semibold text-fg">
              {m}
            </b>
          ))}
        </p>
        <p className="px-5 pt-1 text-[0.8125rem] leading-5 text-balance text-fg-faint">
          1st–3rd: order among these three · #: rank in the full ranking · FEI SoR: FEI strength of record
        </p>
        <div className="px-5 pt-1">
          <Switch checked={showReveals} onChange={(v) => api.getState().setShowReveals(v)} className="min-h-10 text-[0.8125rem] text-fg-muted">
            Show after every round
          </Switch>
        </div>
        <footer className="sticky bottom-0 rounded-b-panel border-t border-line bg-surface px-5 pt-3 pb-2.5">
          <button ref={next} type="button" className="btn btn-primary w-full" data-testid="reveal-next">
            {isLast ? 'Continue' : 'Next round'}
            <ArrowIcon />
          </button>
          <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-[0.75rem] leading-4 text-fg-faint">
            <span className="max-sm:hidden">Tap anywhere or press Enter to continue</span>
            <span data-testid="reveal-credit">
              <FeiCredit url={gd.ratingsUrl} />
            </span>
          </p>
        </footer>
      </div>
    </dialog>
  );
}
