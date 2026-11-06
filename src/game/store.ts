/**
 * Game state (Zustand, one store per island instance so SSR of different pages never shares state).
 * Every rule comes from src/lib: nextTrio/rngForRound for trios, computeRunResults (in Results) for
 * the ranking and playoff, encodeRun/parseShareCode/resolveShareCode/gameRunViolations for links,
 * agreement/runningLine for the reveal.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { gameRunViolations, gameTrioState, type GameData } from '@lib/game-data';
import { rngForRound } from '@lib/rng';
import { encodeRun, parseShareCode, resolveShareCode, type ShareCodeError } from '@lib/sharecode';
import { nextTrio, TRIO_RULES, type Trio } from '@lib/trios';
import { fetchFansTrio, loadWeekData, postVote, track, trackRound, WeekNotFoundError } from './api';
import { readHistoryRun, readSavedRun, writeSavedRun, type SavedRun } from './saved';

export type Phase = 'loading' | 'round' | 'done' | 'results' | 'error';

export interface GameInit {
  mode: 'play' | 'shared';
  season: number;
  week: number;
  adsEnabled: boolean;
  /** Weeks that have game data (shared links to any other week are not fetched). */
  weeks?: { season: number; week: number }[];
}

/** The reveal shown after a round locks (the round is already in `rounds`). */
export interface RevealState {
  /** 1-based round number. */
  round: number;
  /** The user's order [1st, 2nd, 3rd]. */
  order: Trio;
  /** The trio in display order (letters A, B, C). */
  display: Trio;
  /** Fans' consensus order for this trio, once (and if) it arrives. */
  fans: string[] | null;
}

export interface GameError {
  title: string;
  message: string;
  /** A retry makes sense (network), as opposed to a bad link. */
  retry: boolean;
}

/** How the second pick was made: pointer picks auto-lock after a short undo window, keyboard picks wait for Enter. */
export type PickVia = 'pointer' | 'keyboard';

export interface GameState extends GameInit {
  phase: Phase;
  gd: GameData | null;
  error: GameError | null;
  seed: number;
  /** Locked rounds, each [1st, 2nd, 3rd]. */
  rounds: Trio[];
  /** Current trio in display order (A, B, C). */
  trio: Trio | null;
  /** Slugs picked this round, in order (0..2). */
  picks: string[];
  /**
   * Set after the second pick: the "lock in / undo" moment. `auto` = locks itself after a beat.
   * `locked` = the round is locked (its reveal is open): the bar keeps showing the locked order,
   * inert, until the next round replaces it.
   */
  confirm: { auto: boolean; locked: boolean } | null;
  reveal: RevealState | null;
  /** Show the reveal after each round (persisted in localStorage). */
  showReveals: boolean;
  /** Pointer picks lock in by themselves after a short undo window (persisted; off = always press Lock in). */
  autoLock: boolean;
  /** The run on screen was restored (reload, Back, header link) rather than started by a tap. */
  resumed: boolean;
  /** The user skipped to results before round 15. */
  skipped: boolean;
  /** Share code when viewing someone's link. */
  sharedCode: string | null;
}

export interface GameActions {
  start(): Promise<void>;
  openShared(): Promise<void>;
  pick(slug: string, via: PickVia): void;
  undo(): void;
  lock(): void;
  closeReveal(): void;
  doAnother(): void;
  finish(): void;
  skipToResults(): void;
  keepPlaying(): void;
  playAgain(): void;
  setShowReveals(on: boolean): void;
  setAutoLock(on: boolean): void;
  setConfirmManual(): void;
  /** Back/Forward between runs (Play again pushes a history entry): show the entry's run. */
  restoreFromHistory(): void;
}

export type GameStore = GameState & GameActions;

const REVEAL_KEY = 'cfbbr:reveal';
const AUTOLOCK_KEY = 'cfbbr:autolock';

/** A UI preference flag in localStorage (no personal data); `true` unless the user turned it off. */
function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, 'off');
  } catch {
    /* private mode etc. */
  }
}

function newSeed(): number {
  // The island may use Math.random for the run seed only (src/lib/README.md).
  return (Math.random() * 2 ** 32) >>> 0;
}

/** Plain-language message for a share-code problem. */
export function shareErrorCopy(e: ShareCodeError): GameError {
  switch (e.kind) {
    case 'week-not-found':
      return {
        title: 'That week is not available',
        message: `This ranking was made with data from week ${e.week ?? '?'} of ${e.season ?? '?'}, which this site no longer has.`,
        retry: false,
      };
    case 'version':
      return {
        title: 'This link is from another version',
        message: 'The link was made by a different version of the game, so it cannot be opened here.',
        retry: false,
      };
    default:
      return {
        title: 'This link does not open a ranking',
        message: 'It looks incomplete or mistyped. Ask for the link again, or play your own run.',
        retry: false,
      };
  }
}

/** The share code from /r/{code} (tolerates a trailing slash or query). */
export function codeFromPath(pathname: string): string | null {
  const m = /\/r\/([^/?#]+)/.exec(pathname);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]!);
  } catch {
    return m[1]!;
  }
}

export function createGameStore(init: GameInit): StoreApi<GameStore> {
  return createStore<GameStore>()((set, get) => {
    /**
     * Next trio for the current rounds, or null after the last allowed round. Deterministic in
     * (rounds, seed), so the answer is memoized: lock() works it out while the reveal is on screen
     * and closing the reveal only has to render (adaptive selection is the expensive part).
     */
    let memo: { key: string; trio: Trio | null } | null = null;
    const trioKey = (rounds: Trio[], seed: number): string => `${seed}|${rounds.map((r) => r.join(',')).join(';')}`;
    const trioFor = (gd: GameData, rounds: Trio[], seed: number): Trio | null => {
      const key = trioKey(rounds, seed);
      if (memo?.key === key) return memo.trio;
      const trio = nextTrio(gameTrioState(gd, rounds), rngForRound(seed, rounds.length + 1));
      memo = { key, trio };
      return trio;
    };
    const precompute = (gd: GameData, rounds: Trio[], seed: number): void => {
      if (rounds.length >= TRIO_RULES.maxRounds) return;
      const run = () => {
        const s = get();
        if (s.gd === gd && s.seed === seed && s.rounds === rounds) trioFor(gd, rounds, seed);
      };
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout: 1500 });
      else setTimeout(run, 50);
    };

    const snapshot = (): SavedRun | null => {
      const s = get();
      if (s.mode !== 'play' || !s.gd) return null;
      const phase = s.phase === 'round' || s.phase === 'done' || s.phase === 'results' ? s.phase : null;
      if (!phase) return null;
      return {
        v: 1,
        season: s.gd.season,
        week: s.gd.week,
        seed: s.seed,
        code: s.rounds.length ? encodeRun({ season: s.gd.season, week: s.gd.week, rounds: s.rounds }, s.gd.slugs) : null,
        phase,
        skipped: s.skipped,
      };
    };
    const save = (push = false): void => {
      const run = snapshot();
      if (run) writeSavedRun(run, push);
    };

    /** After a round locks (and its reveal closes): next round, the "15 in" panel, or results. */
    const advance = (): void => {
      const { gd, rounds, seed } = get();
      if (!gd) return;
      const n = rounds.length;
      if (n >= TRIO_RULES.maxRounds) {
        get().finish();
        return;
      }
      if (n >= TRIO_RULES.baseRounds) {
        set({ phase: 'done', trio: null, picks: [], confirm: null, reveal: null });
        save();
        return;
      }
      const trio = trioFor(gd, rounds, seed);
      if (!trio) {
        get().finish();
        return;
      }
      set({ phase: 'round', trio, picks: [], confirm: null, reveal: null });
      save();
    };

    /** Restore a saved run (reload / Back / header link), if it decodes cleanly for this week. */
    const restore = (gd: GameData, saved: SavedRun | null = readSavedRun(gd.season, gd.week)): boolean => {
      if (!saved) return false;
      let rounds: Trio[] = [];
      if (saved.code) {
        const raw = parseShareCode(saved.code);
        if (!raw.ok) return false;
        const run = resolveShareCode(raw.value, gd.slugs);
        if (!run.ok || gameRunViolations(gd, run.value.rounds).length) return false;
        rounds = run.value.rounds;
      }
      const seed = saved.seed >>> 0;
      const base: Partial<GameState> = { gd, seed, rounds, picks: [], confirm: null, reveal: null, resumed: true };
      if (saved.phase === 'results' && rounds.length) {
        set({ ...base, phase: 'results', trio: null, skipped: saved.skipped });
        return true;
      }
      if (saved.phase === 'done' && rounds.length >= TRIO_RULES.baseRounds) {
        set({ ...base, phase: 'done', trio: null });
        return true;
      }
      const trio = trioFor(gd, rounds, seed);
      if (!trio) return false;
      set({ ...base, trio, phase: 'round', skipped: false });
      return true;
    };

    return {
      ...init,
      phase: 'loading',
      gd: null,
      error: null,
      seed: 0,
      rounds: [],
      trio: null,
      picks: [],
      confirm: null,
      reveal: null,
      showReveals: typeof window === 'undefined' ? true : readFlag(REVEAL_KEY),
      autoLock: typeof window === 'undefined' ? true : readFlag(AUTOLOCK_KEY),
      resumed: false,
      skipped: false,
      sharedCode: null,

      async start() {
        const { season, week } = get();
        set({ phase: 'loading', error: null });
        let gd: GameData;
        try {
          gd = await loadWeekData(season, week);
        } catch {
          set({
            phase: 'error',
            error: {
              title: 'Could not load this week’s resumes',
              message: 'Check your connection and try again.',
              retry: true,
            },
          });
          return;
        }
        if (restore(gd)) {
          save(); // re-sync the history entry and the session mirror with the run on screen
          return;
        }
        const seed = newSeed();
        const trio = trioFor(gd, [], seed);
        set({ gd, seed, rounds: [], trio, phase: 'round', picks: [], confirm: null, reveal: null, skipped: false, resumed: false });
        save();
      },

      async openShared() {
        set({ phase: 'loading', error: null });
        const code = codeFromPath(window.location.pathname);
        const bad = (error: GameError): void => set({ phase: 'error', error });
        if (!code) {
          bad({ title: 'No ranking in this link', message: 'Shared rankings live at a link like /r/AQ… . Play your own run instead.', retry: false });
          return;
        }
        const raw = parseShareCode(code);
        if (!raw.ok) {
          bad(shareErrorCopy(raw.error));
          return;
        }
        // Only fetch weeks the site has (a missing week would log a 404 for nothing).
        const { season, week, weeks } = get();
        const known = weeks?.length
          ? weeks.some((w) => w.season === raw.value.season && w.week === raw.value.week)
          : raw.value.season < season || (raw.value.season === season && raw.value.week <= week);
        if (!known) {
          bad(shareErrorCopy({ kind: 'week-not-found', message: '', season: raw.value.season, week: raw.value.week }));
          return;
        }
        let gd: GameData | null = null;
        try {
          gd = await loadWeekData(raw.value.season, raw.value.week);
        } catch (e) {
          if (!(e instanceof WeekNotFoundError)) {
            bad({ title: 'Could not load this ranking', message: 'Check your connection and try again.', retry: true });
            return;
          }
        }
        const run = resolveShareCode(raw.value, gd?.slugs);
        if (!run.ok || !gd) {
          bad(run.ok ? shareErrorCopy({ kind: 'week-not-found', message: '', season: raw.value.season, week: raw.value.week }) : shareErrorCopy(run.error));
          return;
        }
        if (gameRunViolations(gd, run.value.rounds).length) {
          bad({
            title: 'This ranking does not add up',
            message: 'The link decodes, but its rounds do not match that week’s game. It may have been edited by hand.',
            retry: false,
          });
          return;
        }
        set({ gd, rounds: run.value.rounds, phase: 'results', sharedCode: code, skipped: run.value.rounds.length < TRIO_RULES.baseRounds });
      },

      pick(slug, via) {
        const { trio, picks, confirm, reveal, phase, autoLock } = get();
        if (phase !== 'round' || !trio || confirm || reveal || !trio.includes(slug)) return;
        const at = picks.indexOf(slug);
        if (at >= 0) {
          // Picking the 1st-placed card again undoes it (desktop rank bar; double clicks are filtered in the UI).
          set({ picks: picks.slice(0, at) });
          return;
        }
        const next = [...picks, slug];
        set({ picks: next, confirm: next.length === 2 ? { auto: via === 'pointer' && autoLock, locked: false } : null });
      },

      undo() {
        const { picks, phase, reveal, confirm } = get();
        if (phase !== 'round' || reveal || confirm?.locked || !picks.length) return;
        set({ picks: picks.slice(0, -1), confirm: null });
      },

      setConfirmManual() {
        const c = get().confirm;
        if (c?.auto && !c.locked) set({ confirm: { auto: false, locked: false } });
      },

      lock() {
        const { trio, picks, confirm, gd, rounds, showReveals, seed } = get();
        if (!trio || !confirm || confirm.locked || picks.length !== 2 || !gd) return;
        const third = trio.find((s) => !picks.includes(s))!;
        const order: Trio = [picks[0]!, picks[1]!, third];
        const nextRounds = [...rounds, order];
        postVote(gd.season, gd.week, order);
        trackRound(nextRounds.length);
        if (!showReveals) {
          set({ rounds: nextRounds, confirm: null });
          advance();
          return;
        }
        const round = nextRounds.length;
        // The locked order stays on the (inert) bar behind the reveal until the next round. The tap
        // paints that first; the reveal (a modal: full style + layout pass) opens on the next frame,
        // which keeps the Lock in interaction itself fast on slow phones.
        set({ rounds: nextRounds, confirm: { auto: false, locked: true } });
        save();
        const open = () => {
          const s = get();
          if (s.rounds !== nextRounds || s.phase !== 'round' || !s.confirm?.locked || s.reveal) return;
          set({ reveal: { round, order, display: trio, fans: null } });
          precompute(gd, nextRounds, seed);
          void fetchFansTrio(gd.season, gd.week, [...order].sort()).then((fans) => {
            const r = get().reveal;
            if (fans && r && r.round === round) set({ reveal: { ...r, fans } });
          });
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(open, 0));
        else open();
      },

      closeReveal() {
        if (!get().reveal) return;
        advance();
      },

      doAnother() {
        const { gd, rounds, seed } = get();
        if (!gd || rounds.length >= TRIO_RULES.maxRounds) return;
        const trio = trioFor(gd, rounds, seed);
        if (!trio) {
          get().finish();
          return;
        }
        track({ name: 'do_another', round: rounds.length + 1 });
        set({ phase: 'round', trio, picks: [], confirm: null, reveal: null });
        save();
      },

      finish() {
        const { rounds } = get();
        if (!rounds.length) return;
        track({ name: 'run_completed', rounds: rounds.length });
        set({ phase: 'results', reveal: null, confirm: null, picks: [], skipped: rounds.length < TRIO_RULES.baseRounds });
        save();
      },

      skipToResults() {
        const { rounds } = get();
        if (!rounds.length) return;
        if (rounds.length < TRIO_RULES.baseRounds) {
          track({ name: 'skip_to_results', round: rounds.length });
          set({ phase: 'results', reveal: null, confirm: null, picks: [], skipped: true });
          save();
        } else {
          get().finish();
        }
      },

      keepPlaying() {
        const { gd, rounds, seed, mode } = get();
        if (!gd || mode !== 'play') return;
        if (rounds.length >= TRIO_RULES.baseRounds) {
          get().doAnother();
          return;
        }
        const trio = trioFor(gd, rounds, seed);
        if (!trio) return;
        set({ phase: 'round', trio, picks: [], confirm: null, reveal: null, skipped: false });
        save();
      },

      playAgain() {
        const { gd, rounds } = get();
        if (!gd) return;
        const seed = newSeed();
        const trio = trioFor(gd, [], seed);
        set({ seed, rounds: [], trio, phase: 'round', picks: [], confirm: null, reveal: null, skipped: false, resumed: false });
        // A new history entry: Back returns to the run just left (an accidental Play again is undoable).
        save(rounds.length > 0);
      },

      restoreFromHistory() {
        const { gd, mode } = get();
        if (!gd || mode !== 'play') return;
        const saved = readHistoryRun(gd.season, gd.week);
        if (!saved) return;
        const cur = snapshot();
        if (cur && cur.seed === saved.seed && cur.code === saved.code && cur.phase === saved.phase) return;
        if (restore(gd, saved)) save();
      },

      setShowReveals(on) {
        if (get().showReveals === on) return;
        writeFlag(REVEAL_KEY, on);
        if (!on) track({ name: 'reveal_disabled' });
        set({ showReveals: on });
      },

      setAutoLock(on) {
        if (get().autoLock === on) return;
        writeFlag(AUTOLOCK_KEY, on);
        const c = get().confirm;
        set({ autoLock: on, ...(c && !c.locked && !on ? { confirm: { auto: false, locked: false } } : {}) });
      },
    };
  });
}
