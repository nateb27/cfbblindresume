/**
 * Results (DESIGN.md §13): tabs (your ranking / committee / FEI / fans), the top 25 as a 5x5 grid
 * (a list on phones) plus the next five, "Compare to committee" and "Show playoff field", the key
 * to the marks right under those controls, the playoff-format control driving the bracket, bids,
 * the field's cut line and the teams just outside, the agreement sentence, sharing and play again.
 * Every computation is src/lib (computeRunResults, gamePlayoffs).
 *
 * The playoff field is selection chrome, drawn in ink like the content rankings tables: a dashed
 * cut line with scissors under the last team of the unbroken run at the top that is in the field
 * (a staircase through the 5x5 grid), and an AQ tag on every automatic bid, so a team that comes in
 * from below the line is marked. Violet stays the fan's own marks.
 *
 * Pointer activations in the first moments after the screen appears are ignored (a double tap on
 * "Finish now" or "Final results" must not land on Play again or a team tile). On phones the
 * top Play again is gone (it sat exactly where Skip was); a jump row leads to the bracket and share.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { agreementSentence } from '@lib/agreement';
import { computeRunResults, gamePlayoffs, type GameData, type GameTeam } from '@lib/game-data';
import type { PlayoffResult, PlayoffResults, Seed } from '@lib/playoff';
import type { PlayoffFormat } from '@lib/types';
import { encodeRun } from '@lib/sharecode';
import { TRIO_RULES } from '@lib/trios';
import { fetchFansTop25 } from './api';
import { Bracket } from './Bracket';
import { useGame, useGameApi, useGameData } from './context';
import { emphasize, plural, recordText, scrollBehavior } from './format';
import { useFreshGuard } from './hooks';
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
  /** How many positions of `order` the source itself ranked (the rest is filled in FEI order). */
  ranked: number;
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

/** Automatic bids a format reserves for champions (guarantees like Notre Dame's come out of at-large). */
const autoCount = (f: PlayoffFormat): number => f.autoBids.rules.reduce((n, r) => n + r.count, 0);

/**
 * Segment label: "12 teams · 2026 format" / "24 teams (2027 proposal)"; on phones (under 640px the
 * two segments share the width) the size alone: "12 · 2026 format" / "24 · 2027 proposal", so each
 * fits one line from 360px. The hidden variant is display:none, so the accessible name always
 * equals the visible text.
 */
function FormatSegmentLabel({ f, season }: { f: PlayoffFormat; season: number }) {
  return (
    <>
      <span className="max-sm:hidden">{f.status === 'current' ? `${f.label} · ${season} format` : `${f.label} (${season + 1} proposal)`}</span>
      <span className="hidden max-sm:inline">{f.status === 'current' ? `${f.size} · ${season} format` : `${f.size} · ${season + 1} proposal`}</span>
    </>
  );
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

const pctText = (share: number | null): string | null => (share === null ? null : `${Math.round(share * 100)}%`);

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

function Tag({ children, title, tone = 'plain' }: { children: ReactNode; title: string; tone?: 'plain' | 'quiet' }) {
  return (
    <span className="file-tag" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

const UnseenTag = () => <Tag title="This team never came up in your rounds">Unseen</Tag>;
const NotShownTag = () => (
  <Tag title="Not one of this week's resumes: placed in FEI strength of record order" tone="quiet">
    Not shown
  </Tag>
);
const AqTag = () => <Tag title="Automatic bid">AQ</Tag>;

/** The cut line's note: the content rankings tables' device (scissors, ink). */
const cutText = (f: PlayoffFormat) => `Above the line: the ${f.size}-team field`;

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
  const pool = useMemo(() => new Set(gd.prior), [gd]);

  const [tab, setTab] = useState<TabId>('you');
  const [compare, setCompare] = useState(true);
  const [highlight, setHighlight] = useState(true);
  const [formatId, setFormatId] = useState(formats[0]!.id);
  const [fans, setFans] = useState<string[] | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const isStale = useFreshGuard('mount');

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
          ranked: results.ranking.order.length,
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
        make: () => ({
          title: 'Committee top 25',
          source: 'the committee',
          order: committee.slice(),
          ranked: committee.length,
          hasNext: false,
          playoffs: gamePlayoffs(gd, committee),
        }),
      });
    }
    list.push({
      id: 'fei',
      label: 'FEI SoR',
      make: () => ({
        title: 'FEI strength of record top 25',
        source: 'FEI strength of record',
        order: extendTo(gd.feiOrder, gd, GRID + NEXT),
        ranked: gd.gwdOrder.length,
        hasNext: true,
        playoffs: gamePlayoffs(gd, gd.feiOrder),
      }),
    });
    if (fans) {
      list.push({
        id: 'fans',
        label: 'Fans',
        make: () => ({
          title: 'Fans’ top 25',
          source: 'the fans',
          order: extendTo(fans, gd, GRID + NEXT),
          ranked: fans.length,
          // The server sends every voted team (the pool, about 27-35): show the fans' own teams past
          // 25 (up to five); positions past their list would be FEI's, not theirs (see `next`).
          hasNext: fans.length > GRID,
          playoffs: gamePlayoffs(gd, fans),
        }),
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
  const auto = useMemo(() => new Set(playoff.autoBids.map((s) => s.slug)), [playoff]);
  const top = view.order.slice(0, GRID);
  // The cut: positions 1..cut are all in the field; every field team below it is an automatic bid.
  const cut = useMemo(() => {
    if (!highlight) return 0;
    const field = new Set(playoff.field.map((s) => s.slug));
    let k = 0;
    while (k < view.order.length && field.has(view.order[k]!)) k++;
    return k;
  }, [highlight, playoff, view.order]);
  // The fans' next five stops where their list does; other tabs always show five.
  const next = view.hasNext ? view.order.slice(GRID, view.id === 'fans' ? Math.min(GRID + NEXT, view.ranked) : GRID + NEXT) : [];
  const nextShort = view.id === 'fans' && next.length < NEXT;
  const showCompare = compare && gd.hasCommittee && view.id !== 'committee';
  const unseen = view.id === 'you' ? results.ranking.unseen : new Set<string>();
  /** Your ranking: teams past the week's pool (never in the game) are placed in FEI order. */
  const notShown = (slug: string) => view.id === 'you' && !pool.has(slug);
  const partial = results.partial;
  const sentence = agreementSentence(results.agreement);
  const { committee: cMatch, fei: fMatch } = results.agreement.pairwise;

  const shownSlugs = [...top, ...next];
  const anyUnseen = shownSlugs.some((s) => unseen.has(s));
  const anyNotShown = shownSlugs.some(notShown);
  const anyAq = highlight && shownSlugs.some((s) => auto.has(s));
  /** Grid staircase: a dashed rule under tile p when the tile below it is past the cut, and right of the last tile in. */
  const cutMarks = (p: number) => ({
    below: cut > 0 && p <= cut && p + 5 > cut && p + 5 <= GRID,
    right: cut > 0 && cut < GRID && p === cut && p % 5 !== 0,
    last: p === cut,
  });

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === view.id);
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    setTab(tabs[j]!.id);
    (e.currentTarget.querySelectorAll('[role="tab"]')[j] as HTMLElement | undefined)?.focus();
  };

  // The second half of a double tap that brought this screen up must not open a team or restart.
  const onClickCapture = (e: MouseEvent) => {
    if (isStale(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
    el.focus({ preventScroll: true });
  };

  const cfpLabel = (t: GameTeam) => `CFP ${t.committee ?? 'NR'}`;
  const unseenCount = results.ranking.unseen.size;
  const unseenOffCommittee = [...results.ranking.unseen].some((s) => gd.teams[s]?.committee === null);

  // "Matched the committee on 43% of your head-to-head calls, FEI on 65%."
  const cPct = gd.hasCommittee ? pctText(cMatch.share) : null;
  const fPct = pctText(fMatch.share);
  const whose = shared ? 'its' : 'your';
  // Violet means you: the player's own numbers. In a shared view they are the sharer's, so ink.
  const mine = shared ? 'text-fg' : 'text-accent';
  const headline = cPct
    ? (['Matched the committee on ', cPct, ` of ${whose} head-to-head calls`, fPct ? ', FEI on ' : '', fPct ?? '', '.'] as const)
    : fPct
      ? (['Matched FEI on ', fPct, ` of ${whose} head-to-head calls.`] as const)
      : null;

  return (
    <div className="mx-auto w-full max-w-game px-gutter pb-16 lg:px-gutter-lg" data-testid="results" onClickCapture={onClickCapture}>
      {/* Header */}
      <div className="flex flex-col gap-x-4 gap-y-3 pt-6 pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="label-caps text-fg-muted">
            {shared ? 'Shared ranking · ' : ''}
            {gd.label} · {plural(rounds.length, 'round')}
            {partial ? ' · partial' : ''}
          </p>
          <h2 ref={heading} tabIndex={-1} className="cond text-title outline-none lg:text-display" data-testid="results-title">
            {view.title}
          </h2>
          {headline && (
            <p className="mt-1 text-[0.9375rem] leading-6 text-fg-muted" data-testid="headline">
              {shared ? 'This ranking ' : ''}
              {shared ? headline[0].charAt(0).toLowerCase() + headline[0].slice(1) : headline[0]}
              <b className={`cond text-[1.125rem] font-bold ${mine}`}>{headline[1]}</b>
              {headline[2]}
              {headline.length > 3 && (
                <>
                  {headline[3]}
                  {headline[4] && <b className={`cond text-[1.125rem] font-bold ${mine}`}>{headline[4]}</b>}
                  {headline[5]}
                </>
              )}
            </p>
          )}
        </div>
        {shared ? (
          <a className="btn btn-primary flex-none max-sm:w-full" href="/" data-testid="play-own">
            Play it yourself
          </a>
        ) : (
          <button type="button" className="btn btn-secondary flex-none max-sm:hidden" onClick={() => api.getState().playAgain()} data-testid="play-again-top">
            Play again
          </button>
        )}
      </div>

      {/* Phones: the bracket and share module are far below the list */}
      {/* 36px buttons whose hit areas reach 44px, so the list starts higher. */}
      <nav className="-mt-1 mb-3 flex items-center gap-2 sm:hidden [&>button]:relative [&>button]:min-h-9 [&>button]:px-3.5 [&>button]:after:absolute [&>button]:after:inset-x-0 [&>button]:after:-inset-y-1 [&>button]:after:content-['']" aria-label="Jump to">
        <span className="label-caps text-fg-muted">Jump to</span>
        <button type="button" className="btn btn-secondary text-label-lg" onClick={() => jump('bracket-h')}>
          Bracket
        </button>
        <button type="button" className="btn btn-secondary text-label-lg" onClick={() => jump('bids-h')}>
          Bids
        </button>
        <button type="button" className="btn btn-secondary text-label-lg" onClick={() => jump('share-h')}>
          Share
        </button>
      </nav>

      {partial && (
        <div className="callout mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <p className="text-[0.9375rem] leading-6">
            {shared ? 'This run stopped' : 'You stopped'} after {rounds.length} of {TRIO_RULES.baseRounds} rounds.{' '}
            <span className="text-fg-muted">
              {plural(unseenCount, 'team')} never came up; {unseenCount === 1 ? 'it holds its' : 'they hold their'} starting spot
              {!gd.hasCommittee ? ' (FEI order)' : unseenOffCommittee ? ' (committee order, then FEI)' : ' (committee order)'} and{' '}
              {unseenCount === 1 ? 'is' : 'are'} marked Unseen.
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
        <div className="grid grid-cols-[auto_auto] items-center justify-between gap-x-3 py-1 sm:flex sm:py-2 sm:flex-wrap sm:justify-start sm:gap-x-6 [&_.switch]:max-sm:text-[0.875rem] [&_.switch]:max-sm:leading-[1.125rem]">
          {/* From 640px each switch carries a sample of the mark it turns on (the key line below says
              what it means); phones keep both switches on one line and rely on the key. */}
          {gd.hasCommittee && view.id !== 'committee' && (
            <Switch checked={compare} onChange={setCompare}>
              Compare to committee
              <span className="delta ml-0.5 max-sm:hidden" data-dir="up" aria-hidden="true">
                2
              </span>
            </Switch>
          )}
          <Switch checked={highlight} onChange={setHighlight}>
            Show playoff field
            <span className="cut-swatch ml-0.5 max-sm:hidden" aria-hidden="true" />
          </Switch>
          {formats.length > 1 && (
            <div className="segmented col-span-2 my-0.5 ml-auto sm:my-1 max-w-full min-w-0 max-sm:ml-0 max-sm:w-full max-sm:[&>*]:min-w-0 max-sm:[&>*]:flex-1 max-sm:[&>*]:px-2" role="group" aria-label="Playoff format">
              {formats.map((f) => (
                <button key={f.id} type="button" aria-pressed={f.id === format.id} onClick={() => setFormatId(f.id)} data-testid={`format-${f.id}`}>
                  <FormatSegmentLabel f={f} season={gd.season} />
                </button>
              ))}
            </div>
          )}
        </div>
        <FormatNote format={format} season={gd.season} />

        {/* What the marks mean: one line right under the controls, before the first mark. */}
        {(showCompare || highlight || anyUnseen || anyNotShown) && (
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] leading-5 text-fg-muted" data-testid="legend">
            {highlight && <span className="cut-note">{cutText(format)}</span>}
            {anyAq && (
              <span className="inline-flex items-center gap-1.5">
                <AqTag />
                <span>automatic bid</span>
              </span>
            )}
            {showCompare && (
              <span className="inline-flex items-center gap-1.5">
                <span className="delta" data-dir="up" aria-hidden="true">
                  4
                </span>
                <span>
                  <span className="sr-only">Up triangle and a number: that many </span>spots above the committee
                </span>
              </span>
            )}
            {anyUnseen && (
              <span className="inline-flex items-center gap-1.5">
                <UnseenTag />
                <span>never came up in your rounds</span>
              </span>
            )}
            {anyNotShown && (
              <span className="inline-flex items-center gap-1.5">
                <NotShownTag />
                <span>not in the game (FEI order)</span>
              </span>
            )}
          </p>
        )}

        {/* Top 25: grid (>= 640px) */}
        <div className="mt-3 hidden gap-6 sm:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,1fr)]">
          <ol className="grid grid-cols-5 gap-x-3 gap-y-3.5" aria-label={view.title} data-testid="top25-grid">
            {top.map((slug, i) => (
              <Tile key={slug} slug={slug} team={gd.teams[slug]!} rank={i + 1} aq={highlight && auto.has(slug)} compare={showCompare} unseen={unseen.has(slug)} notShown={notShown(slug)} cfp={cfpLabel} cut={cutMarks(i + 1)} cutLabel={cutText(format)} />
            ))}
          </ol>
          <section className="lg:border-l lg:border-line lg:pl-6" aria-labelledby="next-h">
            <h3 id="next-h" className="label-caps mb-2 text-fg-muted lg:mb-1.5">
              Next five
            </h3>
            {next.length > 0 && (
              <ol className="grid grid-cols-5 gap-x-3 gap-y-3.5 lg:grid-cols-1 [&_.seed-plate]:text-[1.125rem] [&_.team-name]:text-[0.875rem] [&_.team-name]:leading-4 [&_.team-name]:[overflow-wrap:normal]">
                {next.map((slug, i) => (
                  <Tile key={slug} slug={slug} team={gd.teams[slug]!} rank={GRID + 1 + i} aq={highlight && auto.has(slug)} compare={showCompare} unseen={unseen.has(slug)} notShown={notShown(slug)} cfp={cfpLabel} />
                ))}
              </ol>
            )}
            {(next.length === 0 || nextShort) && (
              <p className={`text-[0.875rem] leading-5 text-fg-muted ${next.length ? 'mt-2' : ''}`}>
                {view.id === 'committee' ? 'The committee ranks only 25 teams.' : `The fans’ ranking stops at ${view.ranked} teams so far.`}
              </p>
            )}
          </section>
        </div>

        {/* Top 25: list (< 640px) */}
        <div className="mt-3 sm:hidden">
          <ol className="flex flex-col gap-2" aria-label={view.title} data-testid="top25-list">
            {top.map((slug, i) => (
              <ListRow key={slug} slug={slug} team={gd.teams[slug]!} rank={i + 1} aq={highlight && auto.has(slug)} compare={showCompare} unseen={unseen.has(slug)} notShown={notShown(slug)} cutAfter={cut === i + 1 ? cutText(format) : undefined} />
            ))}
          </ol>
          {next.length > 0 && (
            <>
              <h3 className="label-caps mt-5 mb-2 text-fg-muted">Next five</h3>
              <ol className="flex flex-col gap-2">
                {next.map((slug, i) => (
                  <ListRow key={slug} slug={slug} team={gd.teams[slug]!} rank={GRID + 1 + i} aq={highlight && auto.has(slug)} compare={showCompare} unseen={unseen.has(slug)} notShown={notShown(slug)} />
                ))}
              </ol>
              {nextShort && <p className="mt-2 text-[0.875rem] leading-5 text-fg-muted">{`The fans’ ranking stops at ${view.ranked} teams so far.`}</p>}
            </>
          )}
          {next.length === 0 && (
            <p className="mt-3 text-[0.875rem] leading-5 text-fg-muted">
              {view.id === 'committee' ? 'The committee ranks only 25 teams.' : `The fans’ ranking stops at ${view.ranked} teams so far.`}
            </p>
          )}
        </div>

        <Bracket key={format.id} playoff={playoff} gd={gd} source={view.source} />
        <Bids
          playoff={playoff}
          gd={gd}
          ranked={view.id === 'committee' || view.id === 'fans' ? view.ranked : Infinity}
          sourceName={view.id === 'committee' ? 'the committee' : view.id === 'fans' ? 'the fans' : null}
        />
      </div>

      <p className="mt-8 max-w-[48rem] text-lg leading-7" data-testid="agreement">
        {emphasize(shared ? sentence.replace(/^Of your /, 'Of the ') : sentence, /\d+%?(?: it ranks)?/g, (m, k) =>
          // Accent marks the user's own counts (ink in a shared view: they are the sharer's);
          // percentages and the committee's own count stay plain.
          m.endsWith('%') || m.endsWith('it ranks') ? (
            <span key={k}>{m}</span>
          ) : (
            <b key={k} className={`cond text-[1.25rem] font-bold ${mine}`}>
              {m}
            </b>
          ),
        )}
      </p>

      {adsEnabled && (
        <div className="ad-slot mt-10" data-kind="incontent">
          <span className="ad-label">Advertisement</span>
          <div className="ad-box" data-ad-slot="incontent" />
        </div>
      )}

      <Share code={code} shared={shared} title={`${shared ? 'A' : 'My'} college football top 25`} />

      <div className="mt-8 flex flex-col items-center gap-3 text-center">
        {shared ? (
          <a className="btn btn-primary min-w-56" href="/">
            Play it yourself
          </a>
        ) : (
          // The share module above holds this screen's primary action; Play again is the quiet next step.
          <button type="button" className="btn btn-secondary min-w-56" onClick={() => api.getState().playAgain()} data-testid="play-again">
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

interface RowProps {
  slug: string;
  team: GameTeam;
  rank: number;
  aq: boolean;
  compare: boolean;
  unseen: boolean;
  notShown: boolean;
}

function Tile(props: RowProps & { cfp: (t: GameTeam) => string; cut?: { below: boolean; right: boolean; last: boolean }; cutLabel?: string }) {
  const { slug, team, rank, aq, compare, unseen, notShown, cfp, cut, cutLabel } = props;
  const d = team.committee === null ? 0 : team.committee - rank;
  return (
    <li className="field-cut-tile min-w-0" data-cut-below={cut?.below ? '' : undefined} data-cut-right={cut?.right ? '' : undefined}>
      <TeamBlock slug={slug} team={team} seed={rank} size="tile" meta={recordText(team.record)} unseen={unseen} />
      <div className="mt-1.5 flex h-4 items-center justify-between gap-1 px-0.5">
        <span className="label-caps whitespace-nowrap text-fg-muted">{compare ? cfp(team) : ''}</span>
        <span className="flex items-center gap-1">
          {aq && <AqTag />}
          {unseen ? <UnseenTag /> : notShown ? <NotShownTag /> : compare ? <Delta value={d} /> : null}
        </span>
      </div>
      {cut?.last && cutLabel && <span className="sr-only">{cutLabel}: the field's unbroken run ends here.</span>}
    </li>
  );
}

/**
 * Phone row. A fixed side column right next to the row (its width never depends on state): "CFP 12"
 * with the delta, then the tags (Unseen / Not shown, AQ) stacked under it. The cut line, when it
 * falls under this row, spans the row and the column.
 */
function ListRow(props: RowProps & { cutAfter?: string }) {
  const { slug, team, rank, aq, compare, unseen, notShown, cutAfter } = props;
  const d = team.committee === null ? 0 : team.committee - rank;
  return (
    <li>
      <div className="flex items-stretch gap-2">
        <div className="min-w-0 flex-1">
          <TeamBlock slug={slug} team={team} seed={rank} size="row" meta={recordText(team.record)} unseen={unseen} />
        </div>
        <div className="flex w-[4.75rem] flex-none flex-col items-start justify-center gap-0.5">
          {compare && (
            <span className="flex items-center gap-1">
              <span className="label-caps whitespace-nowrap text-fg-muted">CFP {team.committee ?? 'NR'}</span>
              {!unseen && <Delta value={d} />}
            </span>
          )}
          {(unseen || notShown || aq) && (
            <span className="flex flex-wrap items-center gap-1">
              {unseen ? <UnseenTag /> : notShown ? <NotShownTag /> : null}
              {aq && <AqTag />}
            </span>
          )}
        </div>
      </div>
      {cutAfter && (
        <p className="field-cut">
          <span className="cut-note">{cutAfter}</span>
        </p>
      )}
    </li>
  );
}

/**
 * The selected format's rules. The proposed format always shows them in full with its status and
 * source (SPEC). The current format does too from 640px; on phones it folds into a one-line
 * disclosure so the top 25 starts higher.
 */
function FormatNote({ format, season }: { format: PlayoffFormat; season: number }) {
  const body = (
    <p className="max-w-[70ch] text-[0.8125rem] leading-5 text-fg-muted sm:text-[0.875rem]">
      {format.note}{' '}
      <a className="link whitespace-nowrap" href={format.sourceUrl} target="_blank" rel="noopener">
        Source: {format.sourceName}
      </a>
    </p>
  );
  if (format.status === 'proposed') {
    return (
      <div className="mt-1 flex flex-col gap-1 border-l-2 border-line pl-3" data-testid="format-note">
        <p className="label-caps text-fg-muted">Proposed for {season + 1} — not final</p>
        {body}
      </div>
    );
  }
  return (
    <div className="mt-1 border-l-2 border-line pl-3" data-testid="format-note">
      <details className="group sm:hidden">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 py-1 text-[0.8125rem] leading-5 text-fg-muted [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <b className="font-semibold text-fg">{format.size}-team field:</b> {autoCount(format)} champions, {format.size - autoCount(format)} at-large.{' '}
            <span className="link">Rules</span>
          </span>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className="ml-auto flex-none transition-transform group-open:rotate-180">
            <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
          </svg>
        </summary>
        <div className="pt-1 pb-1">{body}</div>
      </details>
      <div className="max-sm:hidden">{body}</div>
    </div>
  );
}

function BidList({ title, sub, seeds, gd, meta, id }: { title: string; sub?: string; seeds: Seed[]; gd: GameData; meta: (s: Seed) => string; id?: string }) {
  return (
    <div>
      <h4 id={id} tabIndex={id ? -1 : undefined} className="label-caps text-fg-muted outline-none">
        {title}
      </h4>
      {sub && <p className="mt-0.5 text-[0.8125rem] leading-5 text-fg-muted">{sub}</p>}
      {/* Phones: one column, ranks right-aligned so they line up; wider screens: an inline flow. */}
      <ul className="mt-2 flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-4 sm:gap-y-2">
        {seeds.map((s) => (
          <li key={s.slug} className="flex min-h-9 items-center justify-between gap-3 border-b border-line max-sm:first:border-t sm:min-h-0 sm:justify-start sm:gap-1.5 sm:border-0">
            <TeamChip slug={s.slug} team={gd.teams[s.slug]!} />
            <span className="cond text-right text-[0.875rem] font-semibold whitespace-nowrap text-fg-muted">{meta(s)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bid lists. `ranked` = how many positions the selected source ranks itself: a position past it is
 * a team the source never ranked (the playoff fills the order in FEI order), shown as "NR".
 */
function Bids({ playoff, gd, ranked, sourceName }: { playoff: PlayoffResult; gd: GameData; ranked: number; sourceName: string | null }) {
  const f = playoff.format;
  const standIn = playoff.champions.some((c) => c.standIn && playoff.autoBids.some((s) => s.slug === c.slug));
  const guaranteed = (slug: string) => f.autoBids.guaranteed.find((g) => g.slug === slug);
  const out: Seed[] = playoff.firstFiveOut.map((slug) => ({ slug, seed: 0, rank: playoff.order.indexOf(slug) + 1, bid: 'at-large' }));
  const rankText = (s: Seed) => (s.rank > ranked ? 'NR' : `#${s.rank}`);
  const anyNr = sourceName !== null && [...playoff.autoBids, ...playoff.atLarge, ...out].some((s) => s.rank > ranked);
  const guaranteedIn = playoff.autoBids.filter((s) => s.bid === 'guaranteed');
  const sub = [
    rulesText(f),
    ...guaranteedIn.map((s) => `${gd.teams[s.slug]!.name} (top-${guaranteed(s.slug)?.ifRankedAtOrAbove ?? ''} guarantee)`),
  ].join(' + ');
  return (
    <div className="mt-8 border-t border-line pt-5" data-testid="bids">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <BidList
          id="bids-h"
          title={`Automatic bids · ${playoff.autoBids.length}`}
          sub={sub}
          seeds={playoff.autoBids}
          gd={gd}
          meta={(s) => (s.bid === 'guaranteed' ? `${rankText(s)} · top-${guaranteed(s.slug)?.ifRankedAtOrAbove ?? ''} guarantee` : `${rankText(s)} · ${s.conference ?? ''}`)}
        />
        <BidList title={`At-large · ${playoff.atLarge.length}`} seeds={playoff.atLarge} gd={gd} meta={rankText} />
        <BidList title="Just outside" seeds={out} gd={gd} meta={rankText} />
      </div>
      {anyNr && <p className="mt-4 text-[0.8125rem] leading-5 text-fg-faint">NR: not ranked by {sourceName}; the field is filled out in FEI strength of record order.</p>}
      {standIn && (
        <p className="mt-4 text-[0.8125rem] leading-5 text-fg-faint">Until title games are played, the team with the best conference record stands in as champion.</p>
      )}
    </div>
  );
}
