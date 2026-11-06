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
import { fetchFansTrio, loadWeekData, postVote, track, WeekNotFoundError } from './api';

export type Phase = 'loading' | 'round' | 'done' | 'results' | 'error';

export interface GameInit {
  mode: 'play' | 'shared';
  season: number;
  week: number;
  adsEnabled: boolean;
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
  /** Set after the second pick: the "lock in / undo" moment. `auto` = locks itself after a beat. */
  confirm: { auto: boolean } | null;
  reveal: RevealState | null;
  /** Show the reveal after each round (persisted in localStorage). */
  showReveals: boolean;
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
  setConfirmManual(): void;
}

export type GameStore = GameState & GameActions;

const REVEAL_KEY = 'cfbbr:reveal';
const HISTORY_KEY = 'cfbbr';

function readShowReveals(): boolean {
  try {
    return window.localStorage.getItem(REVEAL_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeShowReveals(on: boolean): void {
  try {
    if (on) window.localStorage.removeItem(REVEAL_KEY);
    else window.localStorage.setItem(REVEAL_KEY, 'off');
  } catch {
    /* private mode etc. */
  }
}

/** Run snapshot kept in history.state so a reload or Back from a team page resumes the run. */
interface SavedRun {
  v: 1;
  season: number;
  week: number;
  seed: number;
  code: string | null;
  phase: 'round' | 'done' | 'results';
  skipped: boolean;
}

export function readSavedRun(season: number, week: number): SavedRun | null {
  try {
    const s = (window.history.state as Record<string, unknown> | null)?.[HISTORY_KEY] as SavedRun | undefined;
    if (!s || s.v !== 1 || s.season !== season || s.week !== week) return null;
    return s;
  } catch {
    return null;
  }
}

function writeSavedRun(run: SavedRun | null): void {
  try {
    const prev = (window.history.state as Record<string, unknown> | null) ?? {};
    const next = { ...prev };
    if (run) next[HISTORY_KEY] = run;
    else delete next[HISTORY_KEY];
    window.history.replaceState(next, '');
  } catch {
    /* history unavailable: the run just won't survive a reload */
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
    /** Next trio for the current rounds, or null after the last allowed round. */
    const trioFor = (gd: GameData, rounds: Trio[], seed: number): Trio | null =>
      nextTrio(gameTrioState(gd, rounds), rngForRound(seed, rounds.length + 1));

    const save = (): void => {
      const s = get();
      if (s.mode !== 'play' || !s.gd) return;
      const phase = s.phase === 'round' || s.phase === 'done' || s.phase === 'results' ? s.phase : null;
      if (!phase) return;
      writeSavedRun({
        v: 1,
        season: s.gd.season,
        week: s.gd.week,
        seed: s.seed,
        code: s.rounds.length ? encodeRun({ season: s.gd.season, week: s.gd.week, rounds: s.rounds }, s.gd.slugs) : null,
        phase,
        skipped: s.skipped,
      });
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

    /** Restore a run saved in history.state (reload / Back), if it decodes cleanly for this week. */
    const restore = (gd: GameData): boolean => {
      const saved = readSavedRun(gd.season, gd.week);
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
      if (saved.phase === 'results' && rounds.length) {
        set({ gd, seed, rounds, phase: 'results', trio: null, skipped: saved.skipped, picks: [], confirm: null });
        return true;
      }
      if (saved.phase === 'done' && rounds.length >= TRIO_RULES.baseRounds) {
        set({ gd, seed, rounds, phase: 'done', trio: null, picks: [], confirm: null });
        return true;
      }
      const trio = trioFor(gd, rounds, seed);
      if (!trio) return false;
      set({ gd, seed, rounds, trio, phase: 'round', picks: [], confirm: null, skipped: false });
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
      showReveals: typeof window === 'undefined' ? true : readShowReveals(),
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
        if (restore(gd)) return;
        const seed = newSeed();
        const trio = trioFor(gd, [], seed);
        set({ gd, seed, rounds: [], trio, phase: 'round', picks: [], confirm: null, reveal: null, skipped: false });
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
        const { trio, picks, confirm, reveal, phase } = get();
        if (phase !== 'round' || !trio || confirm || reveal || !trio.includes(slug)) return;
        const at = picks.indexOf(slug);
        if (at >= 0) {
          // Tapping a picked card undoes that pick (and anything after it).
          set({ picks: picks.slice(0, at) });
          return;
        }
        const next = [...picks, slug];
        set({ picks: next, confirm: next.length === 2 ? { auto: via === 'pointer' } : null });
      },

      undo() {
        const { picks, phase, reveal } = get();
        if (phase !== 'round' || reveal || !picks.length) return;
        set({ picks: picks.slice(0, -1), confirm: null });
      },

      setConfirmManual() {
        if (get().confirm?.auto) set({ confirm: { auto: false } });
      },

      lock() {
        const { trio, picks, confirm, gd, rounds, showReveals } = get();
        if (!trio || !confirm || picks.length !== 2 || !gd) return;
        const third = trio.find((s) => !picks.includes(s))!;
        const order: Trio = [picks[0]!, picks[1]!, third];
        const nextRounds = [...rounds, order];
        set({ rounds: nextRounds, confirm: null });
        postVote(gd.season, gd.week, order);
        track({ name: 'round_completed', round: nextRounds.length });
        if (!showReveals) {
          advance();
          return;
        }
        const round = nextRounds.length;
        set({ reveal: { round, order, display: trio, fans: null } });
        save();
        void fetchFansTrio(gd.season, gd.week, [...order].sort()).then((fans) => {
          const r = get().reveal;
          if (fans && r && r.round === round) set({ reveal: { ...r, fans } });
        });
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
        const { gd } = get();
        if (!gd) return;
        const seed = newSeed();
        const trio = trioFor(gd, [], seed);
        set({ seed, rounds: [], trio, phase: 'round', picks: [], confirm: null, reveal: null, skipped: false });
        save();
      },

      setShowReveals(on) {
        if (get().showReveals === on) return;
        writeShowReveals(on);
        if (!on) track({ name: 'reveal_disabled' });
        set({ showReveals: on });
      },
    };
  });
}
