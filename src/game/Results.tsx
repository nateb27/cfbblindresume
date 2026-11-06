/**
 * Results (DESIGN.md §13): tabs (your ranking / committee / FEI / fans), the top 25 as a 5x5 grid
 * (a list on phones) plus the next five, "Compare with committee" and "Highlight playoff field",
 * the playoff-format control driving the bracket, bids, highlight and first five out, the agreement
 * sentence, sharing and play again. Every computation is src/lib (computeRunResults, gamePlayoffs).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { agreementSentence } from '@lib/agreement';
import { computeRunResults, gamePlayoffs, type GameData, type GameTeam } from '@lib/game-data';
import type { PlayoffResult, PlayoffResults, Seed } from '@lib/playoff';
import type { PlayoffFormat } from '@lib/types';
import { encodeRun } from '@lib/sharecode';
import { TRIO_RULES } from '@lib/trios';
import { fetchFansTop25 } from './api';
import { Bracket } from './Bracket';
import { useGame, useGameApi, useGameData } from './context';
import { emphasize, plural, recordText } from './format';
import { Share } from './Share';
import { FeiCredit, Switch, TeamBlock, TeamChip } from './ui';

type TabId = 'you' | 'committee' | 'fei' | 'fans';
const GRID = 25;
const NEXT = 5;

interface TabView {
  id: TabId;
  label: string;
  title: string;
  /** Who the seeds come from, for the bracket subtitle. */
  source: string;
  /** Ordered teams, at least the top 25 (+ next five when the source ranks them). */
  order: string[];
  /** Whether positions 26-30 belong to this source (the committee ranks only 25). */
  hasNext: boolean;
  playoffs: PlayoffResults;
}

/** "5 highest-ranked champions", "4 Power 4 champions + 1 other champion". */
function rulesText(f: PlayoffFormat): string {
  return f.autoBids.rules
    .map((r) => {
      const s = r.count === 1 ? '' : 's';
      if (r.from === 'all') return `${r.count} highest-ranked champion${s}`;
      if (r.from === 'power') return `${r.count} Power ${f.powerConferences.length} champion${s}`;
      return `${r.count} best other champion${s}`;
    })
    .join(' + ');
}

function formatLabel(f: PlayoffFormat, season: number): string {
  return `${f.label} · ${f.status === 'current' ? `${season} format` : 'proposed'}`;
}

/** Extend an order to `n` teams with the payload's GWD order (display only; the playoff extends itself). */
function extendTo(order: readonly string[], gd: GameData, n: number): string[] {
  const out = [...new Set(order)].filter((s) => gd.teams[s]);
  for (const s of gd.gwdOrder) {
    if (out.length >= n) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function Delta({ value }: { value: number }) {
  if (!value) return null;
  const up = value > 0;
  return (
    <span className="delta" data-dir={up ? 'up' : 'down'}>
      {Math.abs(value)}
      <span className="sr-only">
        {' '}
        {up ? 'above' : 'below'} the committee
      </span>
    </span>
  );
}

function UnseenTag() {
  return (
    <span className="label-caps rounded-slab bg-raised-2 px-1 text-fg" title="This team never came up in your rounds">
      Unseen
    </span>
  );
}

export function Results() {
  const api = useGameApi();
  const gd = useGameData();
  const rounds = useGame((s) => s.rounds);
  const mode = useGame((s) => s.mode);
  const sharedCode = useGame((s) => s.sharedCode);
  const adsEnabled = useGame((s) => s.adsEnabled);
  const shared = mode === 'shared';

  const results = useMemo(() => computeRunResults(gd, rounds), [gd, rounds]);
  const code = useMemo(() => sharedCode ?? encodeRun({ season: gd.season, week: gd.week, rounds }, gd.slugs), [sharedCode, gd, rounds]);
  const formats = gd.playoffFormats;

  const [tab, setTab] = useState<TabId>('you');
  const [compare, setCompare] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [formatId, setFormatId] = useState(formats[0]!.id);
  const [fans, setFans] = useState<string[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    let live = true;
    void fetchFansTop25(gd.season, gd.week).then((order) => {
      const known = order?.filter((s) => gd.teams[s]) ?? [];
      if (live && known.length >= GRID) setFans(known);
    });
    return () => {
      live = false;
    };
  }, [gd]);

  const tabs = useMemo(() => {
    const yours = shared ? 'Shared ranking' : 'Your ranking';
    const list: { id: TabId; label: string; make: () => Omit<TabView, 'id' | 'label'> }[] = [
      {
        id: 'you',
        label: yours,
        make: () => ({
          title: shared ? 'Shared top 25' : 'Your top 25',
          source: shared ? 'this ranking' : 'your ranking',
          order: extendTo(results.ranking.order, gd, GRID + NEXT),
          hasNext: true,
          playoffs: results.playoffs,
        }),
      },
    ];
    if (gd.committee) {
      const committee = gd.committee;
      list.push({
        id: 'committee',
        label: 'Committee',
        make: () => ({ title: 'Committee top 25', source: 'the committee', order: committee.slice(), hasNext: false, playoffs: gamePlayoffs(gd, committee) }),
      });
    }
    list.push({
      id: 'fei',
      label: 'FEI',
      make: () => ({ title: 'FEI top 25', source: 'FEI strength of record', order: extendTo(gd.feiOrder, gd, GRID + NEXT), hasNext: true, playoffs: gamePlayoffs(gd, gd.feiOrder) }),
    });
    if (fans) {
      list.push({
        id: 'fans',
        label: 'Fans',
        make: () => ({ title: 'Fans’ top 25', source: 'the fans', order: extendTo(fans, gd, GRID + NEXT), hasNext: true, playoffs: gamePlayoffs(gd, fans) }),
      });
    }
    return list;
  }, [gd, results, fans, shared]);

  const cache = useRef(new Map<string, TabView>());
  const view: TabView = useMemo(() => {
    const t = tabs.find((x) => x.id === tab) ?? tabs[0]!;
    const key = `${t.id}:${t.id === 'fans' ? fans?.join() : ''}:${t.id === 'you' ? rounds.length : ''}`;
    let v = cache.current.get(key);
    if (!v) {
      v = { id: t.id, label: t.label, ...t.make() };
      cache.current.set(key, v);
    }
    return v;
  }, [tabs, tab, fans, rounds.length]);

  const playoff: PlayoffResult = view.playoffs[formatId] ?? Object.values(view.playoffs)[0]!;
  const format = playoff.format;
  const field = useMemo(() => new Set(playoff.field.map((s) => s.slug)), [playoff]);
  const top = view.order.slice(0, GRID);
  const next = view.hasNext ? view.order.slice(GRID, GRID + NEXT) : [];
  const showCompare = compare && gd.hasCommittee && view.id !== 'committee';
  const unseen = view.id === 'you' ? results.ranking.unseen : new Set<string>();
  const partial = results.partial;
  const sentence = agreementSentence(results.agreement);

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === view.id);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[j]!.id);
    (e.currentTarget.querySelectorAll('[role="tab"]')[j] as HTMLElement | undefined)?.focus();
  };

  const cfpLabel = (t: GameTeam) => `CFP ${t.committee ?? 'NR'}`;

  return (
    <div className="mx-auto w-full max-w-game px-gutter pb-16 lg:px-gutter-lg" data-testid="results">
      {/* Header */}
      <div className={`flex justify-between gap-x-4 gap-y-3 pt-6 pb-4 ${shared ? 'flex-col sm:flex-row sm:items-end' : 'items-end'}`}>
        <div className="min-w-0">
          <p className="label-caps text-accent">
            {shared ? 'Shared ranking · ' : ''}
            {gd.label} · {plural(rounds.length, 'round')}
            {partial ? ' · partial' : ''}
          </p>
          <h2 ref={heading} tabIndex={-1} className="cond text-title uppercase outline-none lg:text-display" data-testid="results-title">
            {view.title}
          </h2>
        </div>
        {shared ? (
          <a className="btn btn-primary flex-none max-sm:w-full" href="/" data-testid="play-own">
            Play it yourself
          </a>
        ) : (
          <button type="button" className="btn btn-secondary flex-none" onClick={() => api.getState().playAgain()} data-testid="play-again-top">
            Play again
          </button>
        )}
      </div>

      {partial && (
        <div className="callout mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="text-[0.9375rem] leading-6">
            {shared ? 'This run stopped' : 'You stopped'} after {rounds.length} of {TRIO_RULES.baseRounds} rounds.{' '}
            <span className="text-fg-muted">
              {plural(results.ranking.unseen.size, 'team')} never came up, so {results.ranking.unseen.size === 1 ? 'it stays' : 'they stay'} where{' '}
              {gd.hasCommittee ? 'the committee has' : 'FEI has'} {results.ranking.unseen.size === 1 ? 'it' : 'them'} (marked Unseen).
            </span>
          </p>
          {!shared && (
            <button type="button" className="btn btn-secondary flex-none" onClick={() => api.getState().keepPlaying()} data-testid="keep-playing">
              Keep ranking
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs" role="tablist" aria-label="Whose top 25" onKeyDown={onTabKey}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={t.id === view.id}
            aria-controls="results-panel"
            tabIndex={t.id === view.id ? 0 : -1}
            className="tab"
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div id="results-panel" role="tabpanel" aria-labelledby={`tab-${view.id}`}>
        {/* Controls */}
        <div className="grid grid-cols-2 items-center gap-x-3 py-2 sm:flex sm:flex-wrap sm:gap-x-6 [&_.switch]:max-sm:text-[0.875rem] [&_.switch]:max-sm:leading-[1.125rem]">
          {gd.hasCommittee && view.id !== 'committee' && (
            <Switch checked={compare} onChange={setCompare}>
              Compare with committee
            </Switch>
          )}
          <Switch checked={highlight} onChange={setHighlight}>
            Highlight playoff field
          </Switch>
          {formats.length > 1 && (
            <div className="segmented col-span-2 my-1 ml-auto max-sm:ml-0 max-sm:w-full max-sm:[&>*]:flex-1 max-sm:[&>*]:px-2" role="group" aria-label="Playoff format">
              {formats.map((f) => (
                <button key={f.id} type="button" aria-pressed={f.id === format.id} onClick={() => setFormatId(f.id)} data-testid={`format-${f.id}`}>
                  {formatLabel(f, gd.season)}
                </button>
              ))}
            </div>
          )}
        </div>
        <FormatNote format={format} season={gd.season} />

        {/* Top 25: grid (>= 640px) */}
        <div className="mt-3 hidden gap-6 sm:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,1fr)]">
          <ol className="grid grid-cols-5 gap-x-3 gap-y-3.5" aria-label={view.title} data-testid="top25-grid">
            {top.map((slug, i) => {
              const t = gd.teams[slug]!;
              const d = t.committee === null ? 0 : t.committee - (i + 1);
              return (
                <li key={slug} className="min-w-0">
                  <TeamBlock slug={slug} team={t} seed={i + 1} size="tile" inField={highlight && field.has(slug)} />
                  <div className="mt-1.5 flex h-4 items-center justify-between gap-1 px-0.5">
                    <span className="label-caps text-fg-muted">{showCompare ? cfpLabel(t) : ''}</span>
                    {unseen.has(slug) ? <UnseenTag /> : showCompare ? <Delta value={d} /> : null}
                  </div>
                </li>
              );
            })}
          </ol>
          <section className="lg:border-l lg:border-line lg:pl-6" aria-labelledby="next-h">
            <h3 id="next-h" className="label-caps mb-2 text-fg-muted lg:mb-1.5">
              Next five
            </h3>
            {next.length ? (
              <ol className="grid grid-cols-5 gap-x-3 gap-y-3.5 lg:grid-cols-1">
                {next.map((slug, i) => {
                  const t = gd.teams[slug]!;
                  return (
                    <li key={slug} className="min-w-0">
                      <TeamBlock slug={slug} team={t} seed={GRID + 1 + i} size="tile" inField={highlight && field.has(slug)} />
                      <div className="mt-1.5 flex h-4 items-center justify-between px-0.5">
                        <span className="label-caps text-fg-muted">{showCompare ? cfpLabel(t) : ''}</span>
                        {unseen.has(slug) && <UnseenTag />}
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="text-[0.875rem] leading-5 text-fg-muted">The committee ranks only 25 teams.</p>
            )}
          </section>
        </div>

        {/* Top 25: list (< 640px) */}
        <div className="mt-3 sm:hidden">
          <ol className="flex flex-col gap-2" aria-label={view.title} data-testid="top25-list">
            {top.map((slug, i) => (
              <ListRow key={slug} slug={slug} team={gd.teams[slug]!} rank={i + 1} inField={highlight && field.has(slug)} compare={showCompare} unseen={unseen.has(slug)} />
            ))}
          </ol>
          {next.length > 0 && (
            <>
              <h3 className="label-caps mt-5 mb-2 text-fg-muted">Next five</h3>
              <ol className="flex flex-col gap-2">
                {next.map((slug, i) => (
                  <ListRow key={slug} slug={slug} team={gd.teams[slug]!} rank={GRID + 1 + i} inField={highlight && field.has(slug)} compare={showCompare} unseen={unseen.has(slug)} />
                ))}
              </ol>
            </>
          )}
        </div>

        {adsEnabled && (
          <aside className="ad-slot mt-10" data-kind="incontent" aria-label="Advertisement">
            <span className="ad-label">Advertisement</span>
            <div className="ad-box" data-ad-slot="incontent" />
          </aside>
        )}

        <Bracket playoff={playoff} gd={gd} source={view.source} />
        <Bids playoff={playoff} gd={gd} />
      </div>

      <p className="mt-8 max-w-[48rem] text-lg leading-7" data-testid="agreement">
        {emphasize(shared ? sentence.replace(/^Of your /, 'Of the ') : sentence, /\d+%?/g, (m, k) =>
          m.endsWith('%') ? (
            <span key={k}>{m}</span>
          ) : (
            <b key={k} className="cond text-[1.25rem] font-bold text-accent">
              {m}
            </b>
          ),
        )}
      </p>

      <Share code={code} shared={shared} title={`${shared ? 'A' : 'My'} college football top 25`} />

      <div className="mt-8 flex flex-col items-center gap-3 text-center">
        {shared ? (
          <a className="btn btn-primary min-w-56" href="/">
            Play it yourself
          </a>
        ) : (
          <button type="button" className="btn btn-primary min-w-56" onClick={() => api.getState().playAgain()} data-testid="play-again">
            Play again
          </button>
        )}
        <p className="text-[0.8125rem] leading-5 text-fg-muted">
          New trios every run · <FeiCredit url={gd.ratingsUrl} />
        </p>
      </div>
    </div>
  );
}

function ListRow(props: { slug: string; team: GameTeam; rank: number; inField: boolean; compare: boolean; unseen: boolean }) {
  const { slug, team, rank, inField, compare, unseen } = props;
  const d = team.committee === null ? 0 : team.committee - rank;
  return (
    <li className="flex items-stretch gap-2">
      <div className="min-w-0 flex-1">
        <TeamBlock slug={slug} team={team} seed={rank} size="row" meta={recordText(team.record)} inField={inField} />
      </div>
      <div className="flex w-[4.75rem] flex-none flex-col items-end justify-center gap-0.5">
        {compare && (
          <span className="flex items-center gap-1.5">
            <span className="label-caps text-fg-muted">CFP {team.committee ?? 'NR'}</span>
            <Delta value={d} />
          </span>
        )}
        {unseen && <UnseenTag />}
      </div>
    </li>
  );
}

function FormatNote({ format, season }: { format: PlayoffFormat; season: number }) {
  return (
    <div className="mt-1 flex flex-col gap-1 border-l-2 border-line pl-3" data-testid="format-note">
      {format.status === 'proposed' && <p className="label-caps text-fg-muted">Proposed for {season + 1} — not final</p>}
      <p className="text-[0.8125rem] leading-5 text-fg-muted sm:text-[0.875rem]">
        {format.note}{' '}
        <a className="link whitespace-nowrap" href={format.sourceUrl} target="_blank" rel="noopener">
          Source: {format.sourceName}
        </a>
      </p>
    </div>
  );
}

function BidList({ title, seeds, gd, meta }: { title: string; seeds: Seed[]; gd: GameData; meta: (s: Seed) => string }) {
  return (
    <div>
      <h4 className="label-caps text-fg-muted">{title}</h4>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {seeds.map((s) => (
          <li key={s.slug} className="flex items-center gap-1.5">
            <TeamChip slug={s.slug} team={gd.teams[s.slug]!} />
            <span className="cond text-[0.875rem] font-semibold text-fg-muted">{meta(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bids({ playoff, gd }: { playoff: PlayoffResult; gd: GameData }) {
  const f = playoff.format;
  const standIn = playoff.champions.some((c) => c.standIn && playoff.autoBids.some((s) => s.slug === c.slug));
  const guaranteed = (slug: string) => f.autoBids.guaranteed.find((g) => g.slug === slug);
  const out: Seed[] = playoff.firstFiveOut.map((slug) => ({ slug, seed: 0, rank: playoff.order.indexOf(slug) + 1, bid: 'at-large' }));
  return (
    <div className="mt-8 border-t border-line pt-5" data-testid="bids">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <BidList
          title={`Automatic bids · ${rulesText(f)}`}
          seeds={playoff.autoBids}
          gd={gd}
          meta={(s) => (s.bid === 'guaranteed' ? `#${s.rank} · top-${guaranteed(s.slug)?.ifRankedAtOrAbove ?? ''} guarantee` : `#${s.rank} · ${s.conference ?? ''}`)}
        />
        <BidList title={`At-large · ${playoff.atLarge.length}`} seeds={playoff.atLarge} gd={gd} meta={(s) => `#${s.rank}`} />
        <BidList title="First five out" seeds={out} gd={gd} meta={(s) => `#${s.rank}`} />
      </div>
      {standIn && (
        <p className="mt-4 text-[0.8125rem] leading-5 text-fg-faint">Until title games are played, the team with the best conference record stands in as champion.</p>
      )}
    </div>
  );
}
