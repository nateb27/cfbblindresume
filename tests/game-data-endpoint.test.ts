/**
 * src/pages/game-data/[file].json.ts emits /game-data/{season}-{week}.json for every week file,
 * byte-identical to buildGameData (the path the island fetches is gameDataPath).
 */
import type { APIContext } from 'astro';
import { describe, expect, it } from 'vitest';
import { listSeasons, loadSeasonIndex, loadWeek } from '../src/lib/data-node';
import { buildGameData, gameDataPath } from '../src/lib/game-data';
import { GET, getStaticPaths } from '../src/pages/game-data/[file].json';

const weeks = listSeasons().flatMap((season) => loadSeasonIndex(season).weeks.map((w) => ({ season, week: w.week })));

describe.skipIf(weeks.length === 0)('game-data endpoint', () => {
  const paths = getStaticPaths();

  it('one path per week file, named by gameDataPath', () => {
    expect(paths.map((p) => p.props)).toEqual(weeks);
    for (const p of paths) expect(`/game-data/${p.params.file}.json`).toBe(gameDataPath(p.props.season, p.props.week));
  });

  it('body equals buildGameData for the week, served as JSON', async () => {
    for (const p of paths) {
      const res = await GET({ props: p.props, params: p.params } as unknown as APIContext<typeof p.props>);
      expect(res.headers.get('Content-Type')).toMatch(/^application\/json/);
      expect(await res.text()).toBe(JSON.stringify(buildGameData(loadWeek(p.props.season, p.props.week))));
    }
  });
});
