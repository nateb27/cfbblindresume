/**
 * /game-data/{season}-{week}.json: the game island's payload (src/lib/game-data.ts) for every week
 * file in /data, prerendered at build. The island fetches gameDataPath(season, week); the /r and OG
 * Functions read the same files through env.ASSETS.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { listSeasons, loadSeasonIndex, loadWeek } from '@lib/data-node';
import { buildGameData, gameDataPath } from '@lib/game-data';

interface Props {
  season: number;
  week: number;
}

/** `file` param for a week: gameDataPath without the directory and extension ("2026-9"). */
function fileParam(season: number, week: number): string {
  const m = /^\/game-data\/(.+)\.json$/.exec(gameDataPath(season, week));
  if (!m) throw new Error(`unexpected gameDataPath ${gameDataPath(season, week)}`);
  return m[1]!;
}

export const getStaticPaths = (() =>
  listSeasons().flatMap((season) =>
    loadSeasonIndex(season).weeks.map(({ week }) => ({
      params: { file: fileParam(season, week) },
      props: { season, week } satisfies Props,
    })),
  )) satisfies GetStaticPaths;

export const GET: APIRoute<Props> = ({ props }) =>
  new Response(JSON.stringify(buildGameData(loadWeek(props.season, props.week))), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
