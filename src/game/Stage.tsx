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
import { bringIntoView } from './format';

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
      <StageView hasCommittee={props.hasCommittee ?? true} />
    </StoreContext.Provider>
  );
}

function StageView({ hasCommittee }: { hasCommittee: boolean }) {
  const api = useGameApi();
  const phase = useGame((s) => s.phase);
  const mode = useGame((s) => s.mode);
  const error = useGame((s) => s.error);
  const reveal = useGame((s) => s.reveal);
  const anchor = useRef<HTMLDivElement>(null);
  const shown = useRef(false);

  // Bring the new screen into view when the phase changes because of a tap (Play, Final results…).
  // The first screen of a shared link or a restored run is left where the browser put it.
  useEffect(() => {
    if (phase === 'loading' || phase === 'error') return;
    const first = !shown.current;
    shown.current = true;
    if (first && (mode === 'shared' || api.getState().resumed)) return;
    if (anchor.current) bringIntoView(anchor.current);
  }, [phase, mode, api]);

  // Back/Forward between runs (Play again pushes a history entry).
  useEffect(() => {
    if (mode !== 'play') return;
    const onPop = () => api.getState().restoreFromHistory();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [mode, api]);

  let body;
  if (phase === 'loading') body = mode === 'shared' ? <SharedLoading /> : <Intro busy hasCommittee={hasCommittee} />;
  else if (phase === 'error' && error) {
    body =
      mode === 'shared' ? (
        <SharedError title={error.title} message={error.message} onRetry={error.retry ? () => void api.getState().openShared() : undefined} />
      ) : (
        <Intro error={error} onRetry={() => void api.getState().start()} hasCommittee={hasCommittee} />
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
