/**
 * The server-rendered first view of the island: the intro panel (play mode) or the shared-ranking
 * placeholder (shared mode). No data, no window access, no src/lib imports (those live in the lazy
 * Stage chunk), so this HTML is the page's LCP-friendly content and hydrates with tiny JS.
 */
import type { ReactNode } from 'react';

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3.5">
      <span className="step-no" aria-hidden="true">
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="cond text-[1.125rem] leading-6 font-bold">{title}</h3>
        <p className="text-[0.9375rem] leading-[1.375rem] text-fg-muted">{children}</p>
      </div>
    </li>
  );
}

/** A redacted resume slab for the illustration: letter plate, "Team A", a bar, and a pick badge. */
function DemoSlab({ letter, place, width, tone }: { letter: string; place: string; width: string; tone: 1 | 2 | 3 }) {
  return (
    <div className="demo-slab" data-place={tone}>
      <span className="file-letter">{letter}</span>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1.5 px-3">
        <span className="label-caps">Team {letter}</span>
        <span data-redacted style={{ width }} />
      </div>
      <span className="flex items-center pr-3">
        <span className="pick-stamp" data-place={tone}>{place}</span>
      </span>
    </div>
  );
}

export function Intro(props: {
  onPlay?: () => void;
  onIntent?: () => void;
  busy?: boolean;
  error?: { title: string; message: string } | null;
  onRetry?: () => void;
  /** This week has a committee ranking (the copy says what the picks move from). Default true. */
  hasCommittee?: boolean;
}) {
  const { onPlay, onIntent, busy = false, error = null, onRetry, hasCommittee = true } = props;
  return (
    <div className="mx-auto w-full max-w-game px-gutter py-4 lg:px-gutter-lg lg:py-6">
      <div className="intro-panel grid overflow-hidden rounded-panel border border-line-strong bg-surface lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="flex flex-col px-5 pt-6 pb-6 sm:px-8 sm:pt-8">
          <p className="label-caps text-fg-muted">The blind resume game</p>
          <h2 className="cond mt-1 text-title sm:text-[2.5rem] sm:leading-[2.5rem]">Three resumes. Your call.</h2>
          <ol className="order-3 mt-6 flex flex-col gap-4 border-t border-line pt-5 sm:order-none sm:mt-5 sm:border-0 sm:pt-0">
            <Step n={1} title="Read three blind resumes">
              Record, FEI ratings, schedule strength and every result. Names and logos stay hidden.
            </Step>
            <Step n={2} title="Rank them 1-2-3">
              {hasCommittee
                ? 'Each pick moves teams up or down from where the committee has them.'
                : 'Each pick moves teams up or down from where FEI’s strength of record has them.'}
            </Step>
            <Step n={3} title="Get your top 25 and bracket">
              {hasCommittee
                ? 'Then see how you line up with the committee and FEI (and with other fans, once enough people have played).'
                : 'Then see how you line up with FEI (and with other fans, once enough people have played).'}
            </Step>
          </ol>
          <div className="order-2 mt-5 flex flex-col gap-2.5 sm:order-none sm:mt-7 sm:flex-row sm:items-center sm:gap-5">
            <button
              type="button"
              className="btn btn-primary h-13 w-full text-[1.1875rem] sm:w-auto sm:min-w-56"
              onClick={error && onRetry ? onRetry : onPlay}
              onPointerEnter={onIntent}
              onPointerDown={onIntent}
              onFocus={onIntent}
              disabled={busy || (!onPlay && !onRetry)}
              aria-busy={busy || undefined}
              data-testid="play"
            >
              {busy ? 'Loading resumes…' : error ? 'Try again' : 'Play'}
            </button>
            <p className="text-center text-[0.8125rem] leading-5 text-fg-faint sm:text-left">About three minutes · no sign-up</p>
          </div>
          {error && (
            <p role="alert" className="order-2 mt-4 rounded-chip border border-line-strong bg-raised px-3 py-2 text-[0.9375rem] leading-6 sm:order-none">
              <b className="font-semibold">{error.title}.</b> <span className="text-fg-muted">{error.message}</span>
            </p>
          )}
        </div>
        <div className="hidden border-l border-line bg-page/40 px-8 py-8 lg:flex lg:flex-col lg:justify-center" aria-hidden="true">
          <p className="label-caps text-fg-muted">Your call, round after round</p>
          <div className="mt-3 flex flex-col gap-3">
            <DemoSlab letter="B" place="1st" width="82%" tone={1} />
            <DemoSlab letter="C" place="2nd" width="64%" tone={2} />
            <DemoSlab letter="A" place="3rd" width="47%" tone={3} />
          </div>
          <p className="mt-4 text-[0.8125rem] leading-5 text-fg-faint">Names appear only after you lock in your order.</p>
        </div>
      </div>
    </div>
  );
}

/** Placeholder while a shared ranking loads (server-rendered for /r/{code}). */
export function SharedLoading() {
  return (
    <div className="mx-auto w-full max-w-game px-gutter py-6 lg:px-gutter-lg" aria-busy="true">
      <p className="label-caps text-fg-muted">Shared ranking</p>
      <h2 className="cond mt-1 text-title lg:text-display">Loading a top 25…</h2>
      <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-3" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-slab bg-raised sm:h-16" />
        ))}
      </div>
    </div>
  );
}

/** Friendly dead end for a bad or unloadable share link. Never a crash or a blank page. */
export function SharedError(props: { title: string; message: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto w-full max-w-game px-gutter py-8 lg:px-gutter-lg lg:py-12">
      <section className="mx-auto max-w-[34rem] animate-rise rounded-panel border border-line-strong bg-surface px-6 py-8 text-center sm:px-10" aria-labelledby="shared-error-h" role="alert">
        <p className="label-caps text-fg-muted">Shared ranking</p>
        <h2 id="shared-error-h" className="cond mt-1 text-heading">
          {props.title}
        </h2>
        <p className="mx-auto mt-3 max-w-[26rem] text-[0.9375rem] leading-6 text-fg-muted">{props.message}</p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
          <a className="btn btn-primary sm:min-w-48" href="/" data-testid="play-own">
            Play the game
          </a>
          {props.onRetry && (
            <button type="button" className="btn btn-secondary sm:min-w-40" onClick={props.onRetry}>
              Try again
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
