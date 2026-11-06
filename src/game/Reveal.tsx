/**
 * The reveal after each round (DESIGN.md §11): a native modal <dialog> (inert background, focus
 * inside, Esc handled), the three teams in the user's order with You / Committee / FEI (/ Fans),
 * match chips and the running line. Tap anywhere, Esc, Enter or a letter key continues; arrow,
 * Page, Home/End and Space keys scroll the panel instead (keyboard and zoomed-in users can read
 * all of it). It opens scrolled to the top with Next round and the FEI credit pinned to its
 * bottom edge, so short screens scroll the list, never the button. Taps in the first moments after
 * it opens are ignored (a double tap on the last pick must not dismiss it unseen).
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { agreement, runningLine } from '@lib/agreement';
import { gameAgreementRefs, type GameData } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { useGame, useGameApi, useGameData } from './context';
import { emphasize, LETTERS, ordinal, recordText } from './format';
import { ArrowIcon, CheckIcon, CrossIcon, FeiCredit, Switch, TeamBlock } from './ui';
import { GUARD_MS } from './hooks';

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

function Cell(props: { label: string; place: number | null; you: number; sub?: string; testid?: string }) {
  const { label, place, you, sub } = props;
  const same = place === you;
  return (
    <div className="min-w-0 rounded-slab bg-raised px-2 py-0.5 sm:py-1" data-testid={props.testid}>
      <dt className="label-caps whitespace-nowrap text-fg-muted max-[22rem]:tracking-[0.02em]">{label}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-1.5">
        <span className={`cond text-[1.25rem] leading-5 font-bold sm:leading-6 ${same ? 'text-accent' : 'text-fg'}`}>{place === null ? 'NR' : ordinal(place)}</span>
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
  const cols = ['', 'grid-cols-1', 'grid-cols-2', 'grid-cols-3', 'grid-cols-4'][cells];

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
    >
      <div className="animate-rise rounded-panel border border-line bg-surface shadow-panel">
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div>
            <p className="label-caps text-fg-muted">
              Round {round} of {total}
            </p>
            <h2 id="reveal-h" className="cond text-heading uppercase">
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
              <li key={slug} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="animate-wipe" style={{ animationDelay: `${i * 60}ms` }}>
                  <TeamBlock slug={slug} team={team} seed={letter} size="reveal" meta={recordText(team.record)} link={false} className="max-sm:h-12" label={`Team ${letter} was ${team.name}, ${recordText(team.record)}`} />
                </div>
                <dl className={`mt-1.5 grid gap-1 ${cols}`}>
                  <Cell label="You" place={you} you={you} />
                  {gd.hasCommittee && <Cell label="Committee" place={committee[slug] ?? null} you={you} sub={team.committee ? `#${team.committee}` : undefined} />}
                  <Cell label="FEI SoR" place={fei[slug] ?? null} you={you} sub={`#${team.sor}`} />
                  {fans && <Cell label="Fans" place={fans.indexOf(slug) + 1 || null} you={you} testid="fans-cell" />}
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
        <p className="px-5 pt-1 text-[0.8125rem] leading-5 text-fg-faint">
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
