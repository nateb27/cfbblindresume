/**
 * Open a share code the way the island does (src/lib/README.md "/r/{code}"): two-stage decode,
 * the code's week fetched through ASSETS, hard-rule check, then computeRunResults. Used by the
 * /r/{code} page Function and the /og/r/{code}.png image Function; no database involved.
 */
import { computeRunResults, gameRunViolations, type GameData, type RunResults } from '@lib/game-data';
import { defaultFormat } from '@lib/playoff';
import { TOP_N } from '@lib/pool';
import { parseShareCode, resolveShareCode } from '@lib/sharecode';
import type { Env } from './cf';
import { loadGameWeek, type LoadedWeek } from './week';

/** Longest code accepted (30 rounds = 96 bytes = 128 chars). */
export const MAX_CODE_LENGTH = 160;
const CODE_RE = /^[A-Za-z0-9_-]+$/;

export type SharedOpen =
  | { ok: true; code: string; week: LoadedWeek; rounds: [string, string, string][]; results: RunResults }
  | { ok: false; code: string; reason: string };

/** Cheap syntactic check before any decoding. */
export function plausibleCode(code: string): boolean {
  return code.length > 0 && code.length <= MAX_CODE_LENGTH && CODE_RE.test(code);
}

export async function openSharedRun(env: Pick<Env, 'ASSETS'>, requestUrl: string, code: string): Promise<SharedOpen> {
  if (!plausibleCode(code)) return { ok: false, code, reason: 'not a share code' };
  const raw = parseShareCode(code);
  if (!raw.ok) return { ok: false, code, reason: raw.error.kind };
  const week = await loadGameWeek(env, requestUrl, raw.value.season, raw.value.week);
  const run = resolveShareCode(raw.value, week?.data.slugs);
  if (!run.ok || !week) return { ok: false, code, reason: run.ok ? 'week-not-found' : run.error.kind };
  if (gameRunViolations(week.data, run.value.rounds).length) return { ok: false, code, reason: 'rule-violation' };
  try {
    return { ok: true, code, week, rounds: run.value.rounds, results: computeRunResults(week.data, run.value.rounds) };
  } catch {
    return { ok: false, code, reason: 'compute-failed' };
  }
}

/* ------------------------------------------------------------------ /r/{code} meta */

export const SITE_NAME = 'CFB Blind Resume';

export interface SharedMeta {
  /** <title> (with the site name). */
  title: string;
  /** og:title / twitter:title (without the site name). */
  socialTitle: string;
  description: string;
  /** Canonical + og:url. */
  url: string;
  image: string;
  imageAlt: string;
}

/** "A, B and C" */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const lowerFirst = (s: string): string => (s ? s[0]!.toLowerCase() + s.slice(1) : s);

/**
 * Per-code tags for the shared results page. `siteOrigin` is the canonical origin (from the shell's
 * canonical link); `assetOrigin` serves the image (the request's origin, so previews work).
 */
export function sharedMeta(gd: GameData, rounds: number, results: RunResults, code: string, siteOrigin: string, assetOrigin: string, imageAlt: string): SharedMeta {
  const name = (s: string): string => gd.teams[s]?.name ?? s;
  const top3 = results.ranking.order.slice(0, 3).map(name);
  const fmt = defaultFormat(gd.playoffFormats);
  const byes = results.playoff.byes.map((s) => name(s.slug));
  const socialTitle = `My blind-resume top ${TOP_N}: ${top3.join(', ')} lead`;
  const runText = results.partial ? `${rounds} ${rounds === 1 ? 'round' : 'rounds'} (a partial run)` : `${rounds} rounds`;
  const description =
    `Ranked from ${runText} of college football resumes with the names hidden, ${lowerFirst(gd.label)}, ${gd.season}. ` +
    `First-round byes: ${listNames(byes)}. See the full top ${TOP_N} and ${fmt.size}-team bracket next to the committee and FEI, then rank your own.`;
  return {
    title: `${socialTitle} | ${SITE_NAME}`,
    socialTitle,
    description,
    url: `${siteOrigin}/r/${code}`,
    image: `${assetOrigin}/og/r/${code}.png`,
    imageAlt,
  };
}
