/**
 * The in-progress run snapshot (seed + share code + screen), kept so a reload, Back from a team page,
 * or the header "Play" link resumes the run instead of starting over. It lives in history.state (per
 * history entry, so Back/Forward land on the right run) and is mirrored in sessionStorage (tab-scoped,
 * cleared when the tab closes) for navigations that create a fresh entry. No personal data: the
 * same rounds a share link carries.
 *
 * Tiny on purpose: GameApp (eager shell) reads it to decide whether to skip the intro, and the
 * inline boot script in GameApp mirrors the same check before hydration.
 */

export const SAVED_KEY = 'cfbbr';

export interface SavedRun {
  v: 1;
  season: number;
  week: number;
  seed: number;
  code: string | null;
  phase: 'round' | 'done' | 'results';
  skipped: boolean;
}

function valid(s: unknown, season: number, week: number): s is SavedRun {
  const r = s as SavedRun | null | undefined;
  return !!r && r.v === 1 && r.season === season && r.week === week && typeof r.seed === 'number';
}

/** The saved run for this week: the current history entry first, then the tab's sessionStorage copy. */
export function readSavedRun(season: number, week: number): SavedRun | null {
  try {
    const fromHistory = (window.history.state as Record<string, unknown> | null)?.[SAVED_KEY];
    if (valid(fromHistory, season, week)) return fromHistory;
  } catch {
    /* history unavailable */
  }
  try {
    const raw = window.sessionStorage.getItem(SAVED_KEY);
    const fromSession: unknown = raw ? JSON.parse(raw) : null;
    if (valid(fromSession, season, week)) return fromSession;
  } catch {
    /* storage blocked or bad JSON */
  }
  return null;
}

/** Only the history entry (used on popstate, where sessionStorage may hold a different run). */
export function readHistoryRun(season: number, week: number): SavedRun | null {
  try {
    const s = (window.history.state as Record<string, unknown> | null)?.[SAVED_KEY];
    return valid(s, season, week) ? s : null;
  } catch {
    return null;
  }
}

/**
 * Save (or clear) the run in the current history entry and the session mirror. `push` adds a new
 * history entry instead of replacing (Play again: Back returns to the previous results).
 */
export function writeSavedRun(run: SavedRun | null, push = false): void {
  try {
    const prev = (window.history.state as Record<string, unknown> | null) ?? {};
    const next: Record<string, unknown> = push ? {} : { ...prev };
    if (run) next[SAVED_KEY] = run;
    else delete next[SAVED_KEY];
    if (push) window.history.pushState(next, '');
    else window.history.replaceState(next, '');
  } catch {
    /* history unavailable: the run just won't survive a reload */
  }
  try {
    if (run) window.sessionStorage.setItem(SAVED_KEY, JSON.stringify(run));
    else window.sessionStorage.removeItem(SAVED_KEY);
  } catch {
    /* storage blocked */
  }
}

/**
 * Inline boot script (runs while the HTML parses, before React hydrates). Two jobs:
 * 1. If a run will be resumed, mark <html> so the game root reserves the viewport (game.css) and the
 *    swap from the intro to the round/results moves nothing on screen (zero layout shift).
 * 2. Catch taps on the server-rendered Play button before hydration: show "Loading resumes…"
 *    instantly (CSS) and remember the tap so GameApp starts the run as soon as it hydrates.
 * Kept as a string so it ships inline; it touches only <html> classes and a window flag, never the
 * React-managed DOM (no hydration mismatch).
 */
export function bootScript(season: number, week: number): string {
  return `(function(){try{var d=document.documentElement,K=${JSON.stringify(SAVED_KEY)},S=${season | 0},W=${week | 0};function ok(r){return r&&r.v===1&&r.season===S&&r.week===W}var r=null;try{r=history.state&&history.state[K]}catch(e){}if(!ok(r)){try{r=JSON.parse(sessionStorage.getItem(K)||'null')}catch(e){r=null}}if(ok(r))d.classList.add('cfbbr-resume');document.addEventListener('click',function(e){if(window.__cfbbrHydrated)return;var b=e.target&&e.target.closest&&e.target.closest('[data-testid=play]');if(!b)return;window.__cfbbrPlay=true;d.classList.add('cfbbr-play-pending')},true)}catch(e){}})();`;
}
