/**
 * Input validation for the API (pure; unit-tested in tests/functions/). Shapes only: whether a
 * season/week has data and whether slugs are in that week's pool is checked against the week's
 * game data by the endpoints.
 */

/** Seasons a share code can carry (season - 2000 fits a byte). */
export const SEASON_RANGE = Object.freeze({ min: 2000, max: 2255 });
/** Week numbers (0 = preseason; generous upper bound for postseason snapshots). */
export const WEEK_RANGE = Object.freeze({ min: 0, max: 30 });

/** Team slugs as the pipeline writes them: lowercase ASCII words joined by hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX = 64;

export type Check<T> = { ok: true; value: T } | { ok: false; error: string };

export function isSlug(v: unknown): v is string {
  return typeof v === 'string' && v.length <= SLUG_MAX && SLUG_RE.test(v);
}

export function validSeasonWeek(season: unknown, week: unknown): Check<{ season: number; week: number }> {
  if (typeof season !== 'number' || !Number.isInteger(season) || season < SEASON_RANGE.min || season > SEASON_RANGE.max) {
    return { ok: false, error: `season must be an integer from ${SEASON_RANGE.min} to ${SEASON_RANGE.max}.` };
  }
  if (typeof week !== 'number' || !Number.isInteger(week) || week < WEEK_RANGE.min || week > WEEK_RANGE.max) {
    return { ok: false, error: `week must be an integer from ${WEEK_RANGE.min} to ${WEEK_RANGE.max}.` };
  }
  return { ok: true, value: { season, week } };
}

/** Three distinct slugs. */
export function validTrio(order: unknown): Check<[string, string, string]> {
  if (!Array.isArray(order) || order.length !== 3) return { ok: false, error: 'order must list exactly three teams.' };
  if (!order.every(isSlug)) return { ok: false, error: 'order must contain team slugs.' };
  if (new Set(order).size !== 3) return { ok: false, error: 'order must name three different teams.' };
  return { ok: true, value: [order[0], order[1], order[2]] as [string, string, string] };
}

export interface VoteInput {
  season: number;
  week: number;
  /** [1st, 2nd, 3rd] as the user ranked them. */
  order: [string, string, string];
}

/** POST /api/vote body: `{ season, week, order: [1st, 2nd, 3rd] }`. Unknown keys are ignored. */
export function parseVote(body: unknown): Check<VoteInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  const sw = validSeasonWeek(b.season, b.week);
  if (!sw.ok) return sw;
  const trio = validTrio(b.order);
  if (!trio.ok) return trio;
  return { ok: true, value: { ...sw.value, order: trio.value } };
}

/** Every slug of the vote must be a pool team of that week (the teams the game can show). */
export function voteInPool(order: readonly string[], pool: ReadonlySet<string> | readonly string[]): Check<true> {
  const set = pool instanceof Set ? pool : new Set(pool as readonly string[]);
  const missing = order.filter((s) => !set.has(s));
  return missing.length ? { ok: false, error: `Not in this week's pool: ${missing.join(', ')}.` } : { ok: true, value: true };
}

/** `?trio=a,b,c` for GET /api/fans. */
export function parseTrioParam(v: string | null): Check<[string, string, string]> {
  if (!v) return { ok: false, error: 'trio=a,b,c is required.' };
  return validTrio(v.split(','));
}

/* ------------------------------------------------------------------ events */

const ROUND = (v: string): boolean => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 30;

/**
 * The only events (and property values) /api/event records, mirroring src/game/api.ts `GameEvent`.
 * `null` = the event takes no property.
 */
export const EVENT_RULES: Readonly<Record<string, ((prop: string) => boolean) | null>> = Object.freeze({
  round_completed: ROUND,
  run_completed: ROUND,
  results_shared: (v: string) => v === 'copy' || v === 'webshare' || v === 'image',
  skip_to_results: ROUND,
  reveal_disabled: null,
  do_another: ROUND,
});

export interface EventInput {
  name: string;
  /** '' when the event has no property. */
  prop: string;
}

/**
 * POST /api/event body: `{ name, prop }` (prop = the single property value as a string or number,
 * or null), as sent by the island; `{ name, props: { key: value } }` also works.
 */
export function parseEvent(body: unknown): Check<EventInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Body must be a JSON object.' };
  const b = body as Record<string, unknown>;
  const name = b.name;
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(EVENT_RULES, name)) return { ok: false, error: 'Unknown event.' };
  let raw: unknown = b.prop;
  if (raw === undefined && b.props && typeof b.props === 'object' && !Array.isArray(b.props)) {
    const values = Object.values(b.props as Record<string, unknown>);
    raw = values.length ? values[0] : null;
  }
  const rule = EVENT_RULES[name]!;
  if (rule === null) {
    return raw === undefined || raw === null || raw === '' ? { ok: true, value: { name, prop: '' } } : { ok: false, error: `${name} takes no property.` };
  }
  const prop = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : typeof raw === 'string' ? raw : null;
  if (prop === null || !rule(prop)) return { ok: false, error: `Invalid property for ${name}.` };
  return { ok: true, value: { name, prop: String(Number.isNaN(Number(prop)) ? prop : Number(prop)) } };
}
