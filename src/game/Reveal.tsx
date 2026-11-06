/**
 * The reveal after each round (DESIGN.md §11): a native modal <dialog> (inert background, focus
 * inside, Esc handled), the three teams in the user's order with You / Committee / FEI (/ Fans),
 * match chips and the running line. Tap anywhere, Enter, Space or Esc continues.
 */
import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react';
import { agreement, runningLine } from '@lib/agreement';
import { gameAgreementRefs, type GameData } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { useGame, useGameApi, useGameData } from './context';
import { emphasize, LETTERS, ordinal, recordText } from './format';
import { ArrowIcon, CheckIcon, CrossIcon, FeiCredit, Switch, TeamBlock } from './ui';

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
    <div className="min-w-0 rounded-slab bg-raised px-2 py-1" data-testid={props.testid}>
      <dt className="label-caps truncate text-fg-muted">{label}</dt>
      <dd className="flex items-baseline gap-1.5">
        <span className={`cond text-[1.25rem] leading-6 font-bold ${same ? 'text-accent' : 'text-fg'}`}>{place === null ? 'NR' : ordinal(place)}</span>
        {sub && <span className="cond truncate text-[0.875rem] font-semibold text-fg-muted">{sub}</span>}
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
  const { last, line } = useRevealData(gd, rounds);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  const close = () => api.getState().closeReveal();
  const { order, display, fans, round } = reveal;
  const total = round > TRIO_RULES.baseRounds ? TRIO_RULES.maxRounds : TRIO_RULES.baseRounds;
  const committee = placesBy(order, (s) => gd.teams[s]?.committee ?? null);
  const fei = placesBy(order, (s) => gd.teams[s]?.sor ?? null);
  const isLast = round >= TRIO_RULES.baseRounds;

  const onClick = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, [role="switch"]')) return;
    close();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key) || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement;
    if ((e.key === 'Enter' || e.key === ' ') && t.closest('a, [role="switch"]')) return;
    e.preventDefault();
    close();
  };

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
        <ol className="flex flex-col gap-3.5 px-5">
          {order.map((slug, i) => {
            const team = gd.teams[slug]!;
            const you = i + 1;
            const letter = LETTERS[display.indexOf(slug)]!;
            return (
              <li key={slug} className="animate-rise" style={{ animationDelay: `${i * 60}ms` }}>
                <div className="animate-wipe" style={{ animationDelay: `${i * 60}ms` }}>
                  <TeamBlock slug={slug} team={team} seed={letter} size="reveal" meta={recordText(team.record)} link={false} label={`Team ${letter} was ${team.name}, ${recordText(team.record)}`} />
                </div>
                <dl className={`mt-1.5 grid gap-1 ${fans ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  <Cell label="You" place={you} you={you} />
                  {gd.hasCommittee && <Cell label="Committee" place={committee[slug] ?? null} you={you} sub={team.committee ? `#${team.committee}` : undefined} />}
                  <Cell label="FEI" place={fei[slug] ?? null} you={you} sub={`#${team.sor}`} />
                  {fans && <Cell label="Fans" place={fans.indexOf(slug) + 1 || null} you={you} testid="fans-cell" />}
                </dl>
              </li>
            );
          })}
        </ol>
        {last && (
          <div className="mt-4 flex flex-wrap gap-2 px-5">
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
        <p className="px-5 pt-1 text-[0.8125rem] leading-5 text-fg-faint">1st to 3rd: order among these three. #: rank in the full ranking.</p>
        <div className="px-5 pt-4">
          <button type="button" className="btn btn-primary w-full" autoFocus data-testid="reveal-next">
            {isLast ? 'Continue' : 'Next round'}
            <ArrowIcon />
          </button>
        </div>
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-5 py-2.5 text-[0.75rem] leading-4 text-fg-faint">
          <Switch checked={showReveals} onChange={(v) => api.getState().setShowReveals(v)} className="min-h-10 text-[0.8125rem] text-fg-muted">
            Show after every round
          </Switch>
          <span>
            <FeiCredit url={gd.ratingsUrl} />
          </span>
        </footer>
      </div>
    </dialog>
  );
}
