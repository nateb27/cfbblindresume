/**
 * "15 rankings in" (DESIGN.md §12): shown after round 15 and after every extra round, with
 * "Final results" and "Do another" (up to TRIO_RULES.maxRounds).
 */
import { useEffect, useMemo, useRef } from 'react';
import { agreement, runningLine } from '@lib/agreement';
import { gameAgreementRefs } from '@lib/game-data';
import { TRIO_RULES } from '@lib/trios';
import { useGame, useGameApi, useGameData } from './context';
import { emphasize } from './format';
import { FeiCredit } from './ui';

export function Done() {
  const api = useGameApi();
  const gd = useGameData();
  const rounds = useGame((s) => s.rounds);
  const heading = useRef<HTMLHeadingElement>(null);
  const line = useMemo(() => runningLine(agreement(rounds, gameAgreementRefs(gd))), [gd, rounds]);
  const n = rounds.length;
  const left = TRIO_RULES.maxRounds - n;

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [n]);

  return (
    <div className="mx-auto w-full max-w-game px-gutter py-6 lg:px-gutter-lg lg:py-10">
      <section className="mx-auto max-w-[34rem] animate-rise rounded-panel border border-line bg-surface px-6 py-8 text-center shadow-card sm:px-10" aria-labelledby="done-h" data-testid="done">
        <p className="cond text-hero text-accent" aria-hidden="true">
          {n}
        </p>
        <h2 id="done-h" ref={heading} tabIndex={-1} className="cond text-heading uppercase outline-none">
          <span className="sr-only">{n} </span>Rankings in
        </h2>
        <p className="mx-auto mt-3 max-w-[26rem] text-[0.9375rem] leading-6 text-fg-muted">
          {emphasize(line, /\d+ of \d+/g, (m, k) => (
            <b key={k} className="font-semibold text-fg">
              {m}
            </b>
          ))}
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <button type="button" className="btn btn-primary sm:min-w-48" onClick={() => api.getState().finish()} data-testid="final-results">
            Final results
          </button>
          {left > 0 && (
            <button type="button" className="btn btn-secondary sm:min-w-48" onClick={() => api.getState().doAnother()} data-testid="do-another">
              Do another
            </button>
          )}
        </div>
        <p className="mt-3 text-[0.8125rem] leading-5 text-fg-faint">
          {left > 0 ? `Up to ${TRIO_RULES.maxRounds} rounds (${left} more). More picks, sharper ranking.` : 'That is the most rounds a run can hold.'}
        </p>
      </section>
      <p className="mt-4 text-center text-[0.8125rem] text-fg-muted">
        <FeiCredit url={gd.ratingsUrl} />
      </p>
    </div>
  );
}
