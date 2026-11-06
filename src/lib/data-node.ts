/**
 * Node-only loaders for the Astro build and tests (SPEC "data-node.ts"). The ONLY module in
 * src/lib that touches the filesystem. Never import it from the game island or Functions.
 *
 * Data directory: `opts.dataDir`, else env CFB_DATA_DIR, else `<process.cwd()>/data`
 * (Astro and vitest run from the repo root).
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SCHEMA_VERSION, type SeasonIndex, type WeekFile } from './types';

/** Optional override of where /data lives. */
export interface LoadOptions {
  dataDir?: string;
}

/** Absolute path of the data directory. */
export function dataDir(opts: LoadOptions = {}): string {
  return resolve(opts.dataDir ?? process.env.CFB_DATA_DIR ?? join(process.cwd(), 'data'));
}

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Path of data/{season}/week-{week}.json. */
export function weekPath(season: number, week: number, opts: LoadOptions = {}): string {
  return join(dataDir(opts), String(season), `week-${week}.json`);
}

/**
 * data/{season}/index.json. If index.json is missing, the index is rebuilt from the week files
 * that exist (sorted by week). @throws Error if the season directory does not exist.
 */
export function loadSeasonIndex(season: number, opts: LoadOptions = {}): SeasonIndex {
  const dir = join(dataDir(opts), String(season));
  const idx = join(dir, 'index.json');
  if (existsSync(idx)) {
    const parsed = readJson<SeasonIndex>(idx);
    return { season: parsed.season, weeks: [...parsed.weeks].sort((a, b) => a.week - b.week) };
  }
  if (!existsSync(dir)) throw new Error(`no data for season ${season} (${dir})`);
  const weeks = readdirSync(dir)
    .map((f) => /^week-(\d+)\.json$/.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
    .map((w) => {
      const wf = loadWeek(season, w, opts);
      return { week: w, asOf: wf.asOf, label: wf.label, hasCommittee: wf.committee !== null };
    });
  return { season, weeks };
}

/** data/{season}/week-{week}.json. @throws Error if missing or the schema version differs. */
export function loadWeek(season: number, week: number, opts: LoadOptions = {}): WeekFile {
  const file = weekPath(season, week, opts);
  if (!existsSync(file)) throw new Error(`week file not found: ${file}`);
  const wf = readJson<WeekFile>(file);
  if (wf.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`${file}: schemaVersion ${String(wf.schemaVersion)} (expected ${SCHEMA_VERSION})`);
  }
  return wf;
}

/** Seasons with a data directory, ascending. */
export function listSeasons(opts: LoadOptions = {}): number[] {
  const dir = dataDir(opts);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}$/.test(f))
    .map(Number)
    .sort((a, b) => a - b);
}

/** Every week of a season in week order. */
export function loadAllWeeks(season: number, opts: LoadOptions = {}): WeekFile[] {
  return loadSeasonIndex(season, opts).weeks.map((w) => loadWeek(season, w.week, opts));
}

/** The newest week of the newest season that has at least one week. @throws Error if none. */
export function loadLatest(opts: LoadOptions = {}): WeekFile {
  const seasons = listSeasons(opts).reverse();
  for (const s of seasons) {
    let idx: SeasonIndex;
    try {
      idx = loadSeasonIndex(s, opts);
    } catch {
      continue;
    }
    const last = idx.weeks[idx.weeks.length - 1];
    if (last) return loadWeek(s, last.week, opts);
  }
  throw new Error(`no week files under ${dataDir(opts)}`);
}
