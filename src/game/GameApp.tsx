/**
 * The blind-resume game island (SPEC "Game") — the only interactive island on the site.
 *
 * Contract (pages build against this):
 * - Mounted on `/` with `mode: 'play'` and on `/r/{code}` with `mode: 'shared'`, e.g.
 *   `<GameApp client:load mode="play" season={week.season} week={week.week} adsEnabled={ads} hasCommittee={!!week.committee} />`
 *   and `<GameApp client:load mode="shared" … weeks={[{ season, week }, …]} />` (weeks with game data).
 *   Mount it full-bleed (not inside a padded container): the island applies `max-w-game` and the page
 *   gutters itself, and on phones it owns a fixed bottom bar while a round is on screen.
 * - `season` / `week`: the current week the page was built from. In 'play' mode the island fetches
 *   `gameDataPath(season, week)` (`/game-data/{season}-{week}.json`, emitted by
 *   src/pages/game-data/[file].json.ts). In 'shared' mode it reads the share code from
 *   `window.location.pathname` (`/r/{code}`), decodes it with `parseShareCode`, and fetches the
 *   CODE's week (which may differ from `season`/`week`); see src/lib/README.md "Typical game flow".
 * - `adsEnabled`: `PUBLIC_ADS === 'on'`. The island renders one reserved, labeled ad slot on the
 *   results screen (after the bracket, bids and agreement line, just above the share module), never
 *   inside cards or modals.
 *   It does not load any ad script; the page's ad loader fills `.ad-slot .ad-box` elements.
 * - The server-rendered HTML is meaningful without the fetch (intro panel, or a loading state for a
 *   shared link), so LCP never waits on game data. No `window` access during render.
 * - The page sets `<html data-surface="board">`; the island repeats it on its own subtree, so the
 *   board tokens (white sheets on a grey board) apply in light mode. Dark mode = photostat, by OS.
 * - Play mode emits a tiny inline boot script (saved.ts `bootScript`): it reserves the viewport when a
 *   saved run will resume (no layout shift when the intro is swapped out) and catches Play taps made
 *   before hydration so they are not lost. Shared mode reserves the viewport in CSS (game.css).
 *
 * Loading: this module (intro + shell) is the only JS that runs at hydration. Everything else (game
 * logic from src/lib, the round, reveal and results screens) is a lazy chunk fetched on the first
 * sign of intent (hover, focus or press on Play), together with the week's data.
 */
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Intro, SharedLoading } from './Intro';
import { bootScript, readSavedRun } from './saved';
import '../styles/game.css';

export interface GameAppProps {
  mode: 'play' | 'shared';
  season: number;
  week: number;
  adsEnabled: boolean;
  /**
   * Whether this week has a committee ranking (default true). Only used for the intro copy, which is
   * server-rendered before any data loads: pass `hasCommittee={!!week.committee}`.
   */
  hasCommittee?: boolean;
  /**
   * Weeks that have game data (`/game-data/{season}-{week}.json`). Shared mode checks a link's week
   * against it before fetching, so a link to a week the site does not have shows the friendly panel
   * without a failing request. Optional: without it, only weeks after `season`/`week` are known-missing.
   */
  weeks?: { season: number; week: number }[];
}

type StageModule = typeof import('./Stage');
let stageModule: Promise<StageModule> | null = null;
const loadStage = (): Promise<StageModule> => (stageModule ??= import('./Stage'));
const Stage = lazy(loadStage);

type BootWindow = Window & { __cfbbrPlay?: boolean; __cfbbrHydrated?: boolean };

export default function GameApp(props: GameAppProps) {
  const { mode, season, week, hasCommittee = true } = props;
  const [started, setStarted] = useState(false);

  const intent = useCallback(() => {
    loadStage()
      .then((m) => m.prefetch(season, week))
      .catch(() => undefined);
  }, [season, week]);

  const play = useCallback(() => {
    intent();
    setStarted(true);
  }, [intent]);

  useEffect(() => {
    const w = window as BootWindow;
    w.__cfbbrHydrated = true;
    if (mode === 'shared') {
      setStarted(true);
      return;
    }
    if (readSavedRun(season, week)) {
      setStarted(true);
      // The viewport reservation (game.css) has done its job once the user interacts: dropping it
      // right after an input never counts as a layout shift.
      const unlisten = () => {
        window.removeEventListener('pointerdown', release, true);
        window.removeEventListener('keydown', release, true);
      };
      const release = () => {
        document.documentElement.classList.remove('cfbbr-resume');
        unlisten();
      };
      window.addEventListener('pointerdown', release, true);
      window.addEventListener('keydown', release, true);
      return unlisten;
    }
    document.documentElement.classList.remove('cfbbr-resume');
    // A tap on Play before hydration (caught by the boot script): start now, no second tap needed.
    if (w.__cfbbrPlay) {
      w.__cfbbrPlay = false;
      play();
      return;
    }
    // Otherwise warm the round chunk and the week's data once the page is idle, so Play is instant.
    const idle = (cb: () => void): (() => void) => {
      if (typeof window.requestIdleCallback === 'function') {
        const id = window.requestIdleCallback(cb, { timeout: 4000 });
        return () => window.cancelIdleCallback(id);
      }
      const id = window.setTimeout(cb, 2000);
      return () => window.clearTimeout(id);
    };
    return idle(intent);
  }, [mode, season, week, play, intent]);

  // Once the round (or its loading state) has taken over, the pre-hydration "loading" look goes.
  useEffect(() => {
    if (started) document.documentElement.classList.remove('cfbbr-play-pending');
  }, [started]);

  const placeholder = mode === 'shared' ? <SharedLoading /> : <Intro busy hasCommittee={hasCommittee} />;

  return (
    <section
      aria-label="Blind resume game"
      data-surface="board"
      data-mode={mode}
      className="game-root relative w-full bg-page text-fg"
    >
      {mode === 'play' && <script dangerouslySetInnerHTML={{ __html: bootScript(season, week) }} />}
      {started ? (
        <Suspense fallback={placeholder}>
          <Stage {...props} />
        </Suspense>
      ) : mode === 'play' ? (
        <Intro onPlay={play} onIntent={intent} hasCommittee={hasCommittee} />
      ) : (
        <SharedLoading />
      )}
    </section>
  );
}
