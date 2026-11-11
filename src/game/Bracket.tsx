/**
 * The playoff bracket for one PlayoffResult (DESIGN.md §13). Desktop: one column per round with
 * connectors, every game centered on its feeders. Phones: one round at a time behind a round picker,
 * each game saying who the winner plays next. Pairings come from playoff.ts (`games`, `next`).
 */
import { useMemo, useState } from 'react';
import type { GameData } from '@lib/game-data';
import type { BracketGame, BracketSide, PlayoffResult } from '@lib/playoff';
import { columnRoundLabel, roundAbbrev, shortRoundLabel } from './format';
import { useIsDesktop } from './hooks';
import { TeamBlock } from './ui';

const BOX = 'relative z-[1] flex w-full flex-col gap-0.5 rounded-chip border border-line-strong bg-surface p-1';

function useBracketModel(playoff: PlayoffResult) {
  return useMemo(() => {
    const byId = new Map<string, BracketGame>(playoff.games.map((g) => [g.id, g]));
    const rounds = [...new Set(playoff.games.map((g) => g.round))].sort((a, b) => a - b);
    const byRound = rounds.map((r) =>
      playoff.games.filter((g) => g.round === r).sort((a, b) => a.slot - b.slot),
    );
    const seedsUnder = (id: string): number[] => {
      const g = byId.get(id);
      if (!g) return [];
      return g.sides.flatMap((s) => (s.kind === 'team' ? [s.team.seed] : seedsUnder(s.gameId)));
    };
    /** "Winner 8 v 9", "Winner 1/8/9", or "Winner QF 2" when more than three seeds can come out. */
    const winnerOf = (id: string): string => {
      const g = byId.get(id)!;
      const seeds = seedsUnder(id).sort((a, b) => a - b);
      if (g.sides.every((s) => s.kind === 'team')) return `${seeds[0]} v ${seeds[1]}`;
      if (seeds.length <= 3) return seeds.join('/');
      return `${roundAbbrev(g.label)} ${g.slot + 1}`;
    };
    return { byId, rounds, byRound, winnerOf };
  }, [playoff]);
}

/** Lowercase round name as used in "in the quarterfinals". */
function inRound(label: string): string {
  if (label === 'Quarterfinal' || label === 'Semifinal') return `${label.toLowerCase()}s`;
  return label.toLowerCase();
}

function Slot({ side, gd, winnerOf }: { side: BracketSide; gd: GameData; winnerOf: (id: string) => string }) {
  if (side.kind === 'team') {
    const { slug, seed } = side.team;
    // Name = the visible "8 Ole Miss" (WCAG 2.5.3); the round lists give the seeding context.
    return <TeamBlock slug={slug} team={gd.teams[slug]!} seed={seed} size="slot" className="pr-2.5" />;
  }
  return (
    <div className="flex h-9 items-center rounded-slab bg-raised pr-2.5" data-slot="tbd">
      <span className="seed-plate min-w-8 bg-transparent text-[1rem] text-fg-faint" aria-hidden="true">
        –
      </span>
      <span className="cond truncate pl-2 text-[0.9375rem] font-semibold text-fg-muted">Winner {winnerOf(side.gameId)}</span>
    </div>
  );
}

export function Bracket({ playoff, gd, source }: { playoff: PlayoffResult; gd: GameData; source: string }) {
  const desktop = useIsDesktop();
  const model = useBracketModel(playoff);
  const { byId, rounds, byRound, winnerOf } = model;
  const [roundIdx, setRoundIdx] = useState(0);
  const f = playoff.format;
  const idx = Math.min(roundIdx, rounds.length - 1);

  /** "Winner plays Miami (1) in the quarterfinals". */
  const caption = (g: BracketGame) => {
    if (!g.next) return <>For the national title</>;
    const ng = byId.get(g.next)!;
    const other = ng.sides.find((s) => !(s.kind === 'winner' && s.gameId === g.id))!;
    if (ng.label === 'Final') return <>Winner goes to the final</>;
    if (other.kind === 'team') {
      return (
        <>
          Winner plays <span className="text-fg">{gd.teams[other.team.slug]!.name}</span> ({other.team.seed}) in the {inRound(ng.label)}
        </>
      );
    }
    return (
      <>
        Winner meets the {winnerOf(other.gameId)} winner in the {inRound(ng.label)}
      </>
    );
  };

  return (
    <section className="mt-10" aria-labelledby="bracket-h" data-testid="bracket">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line pb-2">
        <h3 id="bracket-h" tabIndex={-1} className="cond text-heading outline-none">
          {f.size}-team bracket
        </h3>
        <p className="text-sm text-fg-muted">
          Seeds from {source} · seeds 1-{f.byes} have first-round byes
        </p>
      </div>

      {desktop ? (
        <div className={`mt-4 ${rounds.length > 4 ? 'overflow-x-auto' : ''}`}>
          <div className={rounds.length > 4 ? 'min-w-[68rem]' : ''}>
            <div className="grid gap-x-8" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(0, 1fr))` }}>
              {byRound.map((games) => (
                <h4 key={games[0]!.id} className="label-caps pb-1 text-fg-muted">
                  {columnRoundLabel(games[0]!.label)}
                </h4>
              ))}
            </div>
            <div className="grid gap-x-8" style={{ gridTemplateColumns: `repeat(${rounds.length}, minmax(0, 1fr))` }}>
              {byRound.map((games, ri) => {
                const next = byRound[ri + 1];
                const prev = byRound[ri - 1];
                const out = !next ? '' : next.length === games.length ? 'after:w-8' : 'after:w-4';
                const inBracket = prev && prev.length === games.length * 2;
                return (
                  <ol key={games[0]!.id} className="grid" style={{ gridTemplateRows: `repeat(${games.length}, minmax(0, 1fr))` }} aria-label={columnRoundLabel(games[0]!.label)}>
                    {games.map((g) => (
                      <li
                        key={g.id}
                        className={`relative flex items-center py-2 ${
                          out ? `after:absolute after:top-1/2 after:left-full after:h-px after:bg-line-strong ${out}` : ''
                        } ${
                          inBracket
                            ? 'before:absolute before:top-1/4 before:right-full before:bottom-1/4 before:w-4 before:border-y before:border-r before:border-line-strong'
                            : ''
                        }`}
                      >
                        <div className={BOX}>
                          <Slot side={g.sides[0]} gd={gd} winnerOf={winnerOf} />
                          <Slot side={g.sides[1]} gd={gd} winnerOf={winnerOf} />
                        </div>
                      </li>
                    ))}
                  </ol>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="segmented mt-3 flex w-full overflow-x-auto [&>*]:flex-1" role="tablist" aria-label="Bracket round" style={{ scrollbarWidth: 'none' }}>
            {byRound.map((games, i) => (
              <button
                key={games[0]!.id}
                type="button"
                role="tab"
                aria-selected={i === idx}
                onClick={() => setRoundIdx(i)}
                className="min-w-max max-[23rem]:px-2"
              >
                {shortRoundLabel(games[0]!.label, rounds.length)}
                {shortRoundLabel(games[0]!.label, rounds.length) !== columnRoundLabel(games[0]!.label) && <span className="sr-only">, {columnRoundLabel(games[0]!.label)}</span>}
              </button>
            ))}
          </div>
          <ol className="mt-3 flex flex-col gap-2.5" aria-label={columnRoundLabel(byRound[idx]![0]!.label)}>
            {byRound[idx]!.map((g) => (
              <li key={g.id} className={`${BOX} animate-fade`}>
                <Slot side={g.sides[0]} gd={gd} winnerOf={winnerOf} />
                <Slot side={g.sides[1]} gd={gd} winnerOf={winnerOf} />
                <p className="px-1 pt-1 pb-0.5 text-[0.8125rem] leading-4 text-fg-muted">{caption(g)}</p>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
