/**
 * The interactive game (lazy chunk): owns the Zustand store and switches between the round, the
 * reveal, the "rankings in" panel and results. Loaded by GameApp on the first sign of intent.
 */
import { useEffect, useRef, useState } from 'react';
import type { GameAppProps } from './GameApp';
import { loadWeekData } from './api';
import { StoreContext, useGame, useGameApi } from './context';
import { createGameStore } from './store';
import { Intro, SharedError, SharedLoading } from './Intro';
import { Play } from './Play';
import { Reveal } from './Reveal';
import { Done } from './Done';
import { Results } from './Results';
import { scrollBehavior } from './format';

/** Warm the week's data while the user is still reading the intro. */
export function prefetch(season: number, week: number): void {
  loadWeekData(season, week).catch(() => undefined);
}

export default function Stage(props: GameAppProps) {
  const [store] = useState(() => createGameStore(props));
  useEffect(() => {
    const s = store.getState();
    if (s.phase !== 'loading' || s.gd) return;
    void (props.mode === 'shared' ? s.openShared() : s.start());
  }, [store, props.mode]);
  return (
    <StoreContext.Provider value={store}>
      <StageView />
    </StoreContext.Provider>
  );
}

function StageView() {
  const api = useGameApi();
  const phase = useGame((s) => s.phase);
  const mode = useGame((s) => s.mode);
  const error = useGame((s) => s.error);
  const reveal = useGame((s) => s.reveal);
  const anchor = useRef<HTMLDivElement>(null);

  // Keep the top of the game in view when the screen changes (new phase).
  useEffect(() => {
    if (phase === 'loading' || phase === 'error') return;
    const el = anchor.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.35) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
  }, [phase]);

  let body;
  if (phase === 'loading') body = mode === 'shared' ? <SharedLoading /> : <Intro busy />;
  else if (phase === 'error' && error) {
    body =
      mode === 'shared' ? (
        <SharedError title={error.title} message={error.message} onRetry={error.retry ? () => void api.getState().openShared() : undefined} />
      ) : (
        <Intro error={error} onRetry={() => void api.getState().start()} />
      );
  } else if (phase === 'round') body = <Play />;
  else if (phase === 'done') body = <Done />;
  else if (phase === 'results') body = <Results />;
  else body = null;

  return (
    <div ref={anchor} className="scroll-mt-2">
      {body}
      {reveal && <Reveal />}
    </div>
  );
}
