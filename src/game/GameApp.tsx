/**
 * The blind-resume game island (SPEC "Game") — the only interactive island on the site.
 *
 * Contract (pages build against this):
 * - Mounted on `/` with `mode: 'play'` and on `/r/{code}` with `mode: 'shared'`, e.g.
 *   `<GameApp client:load mode="play" season={week.season} week={week.week} adsEnabled={ads} />`.
 *   Mount it full-bleed (not inside a padded container): the island applies `max-w-game` and the page
 *   gutters itself, and on phones it owns a fixed bottom bar while a round is on screen.
 * - `season` / `week`: the current week the page was built from. In 'play' mode the island fetches
 *   `gameDataPath(season, week)` (`/game-data/{season}-{week}.json`, emitted by
 *   src/pages/game-data/[file].json.ts). In 'shared' mode it reads the share code from
 *   `window.location.pathname` (`/r/{code}`), decodes it with `parseShareCode`, and fetches the
 *   CODE's week (which may differ from `season`/`week`); see src/lib/README.md "Typical game flow".
 * - `adsEnabled`: `PUBLIC_ADS === 'on'`. The island renders one reserved, labeled ad slot on the
 *   results screen (between the top 25 and the bracket/share module), never inside cards or modals.
 *   It does not load any ad script; the page's ad loader fills `.ad-slot .ad-box` elements.
 * - The server-rendered HTML is meaningful without the fetch (intro panel, or a loading state for a
 *   shared link), so LCP never waits on game data. No `window` access during render.
 * - The page should set `<html data-theme="dark">` (game pages are dark); the island also forces the
 *   dark tokens on its own subtree.
 *
 * Loading: this module (intro + shell) is the only JS that runs at hydration. Everything else (game
 * logic from src/lib, the round, reveal and results screens) is a lazy chunk fetched on the first
 * sign of intent (hover, focus or press on Play), together with the week's data.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Intro, SharedLoading } from './Intro';
import '../styles/game.css';

export interface GameAppProps {
  mode: 'play' | 'shared';
  season: number;
  week: number;
  adsEnabled: boolean;
}

type StageModule = typeof import('./Stage');
let stageModule: Promise<StageModule> | null = null;
const loadStage = (): Promise<StageModule> => (stageModule ??= import('./Stage'));
const Stage = lazy(loadStage);

/** True when history.state holds a run for this week (a reload or Back mid-run resumes it). */
function hasSavedRun(season: number, week: number): boolean {
  try {
    const s = (window.history.state as { cfbbr?: { season?: number; week?: number } } | null)?.cfbbr;
    return !!s && s.season === season && s.week === week;
  } catch {
    return false;
  }
}

export default function GameApp(props: GameAppProps) {
  const { mode, season, week } = props;
  const [started, setStarted] = useState(false);

  const intent = useCallback(() => {
    loadStage()
      .then((m) => m.prefetch(season, week))
      .catch(() => undefined);
  }, [season, week]);

  useEffect(() => {
    if (mode === 'shared' || hasSavedRun(season, week)) setStarted(true);
  }, [mode, season, week]);

  const play = useCallback(() => {
    intent();
    setStarted(true);
  }, [intent]);

  const placeholder = mode === 'shared' ? <SharedLoading /> : <Intro busy />;

  return (
    <section
      aria-label="Blind resume game"
      data-theme="dark"
      data-mode={mode}
      className="game-root relative w-full bg-page text-fg"
    >
      {started ? (
        <Suspense fallback={placeholder}>
          <Stage {...props} />
        </Suspense>
      ) : mode === 'play' ? (
        <Intro onPlay={play} onIntent={intent} />
      ) : (
        <SharedLoading />
      )}
    </section>
  );
}
