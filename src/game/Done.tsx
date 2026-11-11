/**
 * The done panel (DESIGN.md §12): shown after round 15 and after every extra round, with
 * "Final results" and "One more round" (up to TRIO_RULES.maxRounds). The hero is the player's own
 * verdict (rounds where their order matched the committee, or FEI before the first committee
 * release), in violet, like the FEI count beside it (both are the player's numbers); the kicker
 * says which round this is.
 */
import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import { agreement } from '@lib/agreement';
import { gameAgreementRefs } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { useGame, useGameApi, useGameData } from './context';
import { FeiCredit } from './ui';
import { useFreshGuard } from './hooks';

export function Done() {
  const api = useGameApi();
  const gd = useGameData();
  const rounds = useGame((s) => s.rounds);
  const heading = useRef<HTMLHeadingElement>(null);
  const summary = useMemo(() => agreement(rounds, gameAgreementRefs(gd)), [gd, rounds]);
  const n = rounds.length;
  const { committee, fei } = summary.roundsMatched;
  // The verdict: the committee when it has released a ranking, else FEI.
  const main = summary.hasCommittee ? { who: 'the committee', m: committee } : { who: 'FEI', m: fei };
  const left = TRIO_RULES.maxRounds - n;
  const total = n > TRIO_RULES.baseRounds ? TRIO_RULES.maxRounds : TRIO_RULES.baseRounds;
  // It appears where the reveal's Continue was tapped: ignore the second half of a double tap.
  const isStale = useFreshGuard(n);
  const onClickCapture = (e: MouseEvent) => {
    if (isStale(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [n]);

  return (
    <div className="mx-auto w-full max-w-game px-gutter py-6 lg:px-gutter-lg lg:py-10" onClickCapture={onClickCapture}>
      <section className="mx-auto max-w-[34rem] animate-rise rounded-panel border border-line-strong bg-surface px-6 py-8 text-center sm:px-10" aria-labelledby="done-h" data-testid="done">
        <p className="label-caps text-fg-muted" aria-hidden="true">
          Round {n} of {total}
        </p>
        <p className="mt-1 flex items-baseline justify-center gap-2" aria-hidden="true">
          <span className="cond text-hero text-accent">{main.m.matched}</span>
          <span className="cond text-title text-fg-muted">of {main.m.comparable}</span>
        </p>
        <h2 id="done-h" ref={heading} tabIndex={-1} className="cond mt-1 text-heading outline-none">
          <span className="sr-only">Round {n} of {total} done. </span>Matched {main.who}
          <span className="sr-only">
            {' '}
            in {main.m.matched} of {main.m.comparable} rounds
          </span>
        </h2>
        <p className="mx-auto mt-2 max-w-[26rem] text-[0.9375rem] leading-6 text-fg-muted">
          Rounds where your order matched {main.who}&rsquo;s.
          {summary.hasCommittee && (
            <>
              {' '}
              FEI:{' '}
              <b className="font-extrabold whitespace-nowrap text-accent">
                {fei.matched} of {fei.comparable}
              </b>
              .
            </>
          )}
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button type="button" className="btn btn-primary sm:min-w-48" onClick={() => api.getState().finish()} data-testid="final-results">
            Final results
          </button>
          {left > 0 && (
            <button type="button" className="btn btn-secondary sm:min-w-48" onClick={() => api.getState().doAnother()} data-testid="do-another">
              One more round
            </button>
          )}
        </div>
        {left === 0 && <p className="mt-3 text-[0.8125rem] leading-5 text-fg-faint">That is the most rounds a run can hold.</p>}
      </section>
      <p className="mt-4 text-center text-[0.8125rem] text-fg-muted">
        <FeiCredit url={gd.ratingsUrl} />
      </p>
    </div>
  );
}
