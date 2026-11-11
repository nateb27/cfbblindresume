/**
 * One anonymized resume (DESIGN.md §9): letter + record, rank bars (strength of record, offense and
 * defense side by side, schedule) with tap-to-define labels, quality wins, the season strip, the
 * game log toughest first, and the FEI credit (house rule 8: on every card, which people screenshot
 * on their own). Identity never reaches the DOM: no slug, name, color or conference.
 *
 * The card is a size container: below 19rem (320px phones) pips and gaps shrink, and below 17.5rem
 * (320-340px phones) the compact row prints "Sched". Nothing truncates.
 *
 * `compact` (phones and tablets, where the at-a-glance table above already lists the four ranks):
 * the ratings fold into one row of four short label + rank pairs with thin meters, so the season
 * and the game log (where fans look for losses) start higher. The labels still open definitions.
 *
 * Type steps (DESIGN.md 6.3): labels and meta 13px (600 / 400), values 16px 800, W/L letters
 * 13px 800, ranks 22px 800 (16px compact), the record 38px, the file letter 40px.
 */
import { memo, useId, useState, type CSSProperties } from 'react';
import type { BlindCard as CardData, GameTier } from '@lib/game-data';
import { rankFill, tierFor } from '@lib/tiers';
import { tierKey } from '../styles/tokens';
import { ordinal, recordSpoken, recordText, signedMargin } from './format';
import { FeiCredit } from './ui';

type MetricKey = 'sor' | 'off' | 'def' | 'sos';

/** One-line definitions, in our own words, of the FEI numbers on the card. */
const METRICS: { key: MetricKey; label: string; short: string; tiny?: string; def: string; wide: boolean }[] = [
  {
    key: 'sor',
    label: 'Strength of record',
    short: 'SoR',
    def: 'How many fewer losses this team has than a very good team would expect against the same schedule (FEI GWD).',
    wide: true,
  },
  {
    key: 'off',
    label: 'Offense',
    short: 'Offense',
    def: 'Points per possession versus an average defense, adjusted for opponents (FEI OFEI).',
    wide: false,
  },
  {
    key: 'def',
    label: 'Defense',
    short: 'Defense',
    def: 'Points kept off the board per possession versus an average offense, adjusted for opponents (FEI DFEI).',
    wide: false,
  },
  {
    key: 'sos',
    label: 'Schedule',
    short: 'Schedule',
    // The compact row on the narrowest cards (320-340px phones), where "Schedule" outruns its column.
    tiny: 'Sched',
    def: 'Losses an elite team would expect against this schedule. #1 is the hardest (FEI ELS).',
    wide: true,
  },
];

const SITE = { h: 'Home', a: 'Away', n: 'Neutral' } as const;

const bandKey = (rank: number) => tierKey(tierFor({ fbs: true, feiRank: rank }).stars);

/** "FEI 11-25 team" -> "FEI 11-25": the band as printed (screen readers get the full label). */
const band = (label: string) => label.replace(/ team$/, '');

export type Place = 1 | 2 | 3 | undefined;

/**
 * The 1st/2nd/3rd pick stamp (DESIGN.md "Component classes"): solid violet / violet rule / graphite
 * rule. It presses onto the header as it appears (game.css `stamp-in`, transform + opacity only).
 */
function PlaceBadge({ place }: { place: 1 | 2 | 3 }) {
  return (
    <span className="pick-stamp" data-place={place}>
      {ordinal(place)}
    </span>
  );
}

export const BlindCard = memo(function BlindCard(props: {
  letter: string;
  card: CardData;
  tiers: GameTier[];
  fbsCount: number;
  place: Place;
  /** FEI attribution link (week's sources.ratings.url). */
  ratingsUrl: string;
  /** One compact row of ratings (the glance table above already lists them). */
  compact?: boolean;
}) {
  const { letter, card, tiers, fbsCount, place, ratingsUrl, compact = false } = props;
  const [open, setOpen] = useState<MetricKey | null>(null);
  const uid = useId();
  const { top10, r11to25, r26to50 } = card.quality;

  return (
    <article
      className="blind-card @container flex h-full flex-col overflow-hidden rounded-card border bg-surface"
      aria-label={`Team ${letter}, ${recordSpoken(card.record)} record${place ? `, ranked ${ordinal(place)} by you` : ''}`}
      data-card={letter}
      data-place={place}
    >
      {/* The reveal slab with its name inked out: [file letter] Team A / [redaction bar] [record]. */}
      <header className="card-header">
        <span className="file-letter" aria-hidden="true">
          {letter}
        </span>
        <h3 className="card-header-title">
          <span className="label-caps">Team {letter}</span>
          {/* Fixed-width decoration: never sized from the hidden name, so it cannot leak its length. */}
          <span data-redacted aria-hidden="true" />
          <span className="text-record" data-record aria-hidden="true">
            {recordText(card.record)}
          </span>
          <span className="sr-only">, {recordSpoken(card.record)}</span>
        </h3>
        {place && <PlaceBadge place={place} />}
      </header>

      <div className={compact ? 'grid grid-cols-4 gap-x-3 px-4 pt-2.5 pb-2.5 @max-[19rem]:gap-x-2' : 'grid grid-cols-2 gap-x-5 gap-y-2.5 px-4 pt-3.5 pb-3.5 @max-[19rem]:gap-x-3'}>
        <h4 className="sr-only">Ratings, rank among {fbsCount} FBS teams</h4>
        {METRICS.map((m) => {
          const rank = card.ranks[m.key];
          const isOpen = open === m.key;
          const defId = `${uid}-${m.key}`;
          const label = (
            <button
              type="button"
              aria-expanded={isOpen}
              aria-controls={defId}
              aria-label={compact ? (m.short !== m.label ? `${m.short}: ${m.label}` : m.tiny ? `${m.tiny}: ${m.label}` : undefined) : undefined}
              onClick={() => setOpen(isOpen ? null : m.key)}
              className={`label-caps relative -my-1.5 py-1.5 text-left underline decoration-dotted decoration-1 underline-offset-[5px] after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:text-fg ${isOpen ? 'text-fg decoration-fg-muted' : 'text-fg-muted decoration-control'}`}
            >
              {compact && m.tiny ? (
                <>
                  <span className="@max-[17.5rem]:hidden">{m.short}</span>
                  <span className="hidden @max-[17.5rem]:inline">{m.tiny}</span>
                </>
              ) : compact ? (
                m.short
              ) : (
                m.label
              )}
            </button>
          );
          const value = (
            <span className={compact ? 'cond text-[1rem] leading-5 font-extrabold' : 'cond text-stat'} data-rank>
              <span aria-hidden="true">#{rank}</span>
              <span className="sr-only">
                rank {rank} of {fbsCount}
              </span>
            </span>
          );
          const meter = (
            <div className={`meter ${compact ? 'mt-1 h-[3px]' : 'mt-1.5'}`} data-tier={bandKey(rank)} data-animate="" style={{ '--fill': rankFill(rank, fbsCount).toFixed(3) } as CSSProperties} aria-hidden="true">
              <span />
            </div>
          );
          return compact ? (
            <div key={m.key} className="flex min-w-0 flex-col items-start" data-metric={m.key}>
              {label}
              <span className="mt-1">{value}</span>
              <div className="w-full">{meter}</div>
            </div>
          ) : (
            <div key={m.key} className={m.wide ? 'col-span-2' : 'min-w-0'} data-metric={m.key}>
              <div className="flex items-baseline justify-between gap-2">
                {label}
                {value}
              </div>
              {meter}
              <p id={defId} hidden={!isOpen} className="mt-1.5 animate-fade text-[0.8125rem] leading-5 text-fg-muted">
                {m.def}
              </p>
            </div>
          );
        })}
        {/* Compact: the open definition prints under the row, full width. */}
        {compact &&
          METRICS.map((m) => (
            <p key={m.key} id={`${uid}-${m.key}`} hidden={open !== m.key} className="col-span-4 mt-2 animate-fade text-[0.8125rem] leading-5 text-fg-muted">
              <b className="font-semibold text-fg">{m.label}:</b> {m.def}
            </p>
          ))}
      </div>

      <section className="border-t border-line px-4 py-3">
        <h4 className="label-caps text-fg-muted">Quality wins</h4>
        <ul className="mt-1.5 grid grid-cols-3 gap-1.5">
          {(
            [
              ['Top 10', 'FEI top 10', top10, '50'],
              ['11-25', 'FEI 11 to 25', r11to25, '40'],
              ['26-50', 'FEI 26 to 50', r26to50, '30'],
            ] as const
          ).map(([label, spoken, [w, l]]) => (
            <li key={label} className="flex h-7 min-w-0 items-center gap-1 rounded-slab border-b border-line-strong bg-raised px-1.5 @max-[19rem]:px-1">
              <span className="label-caps flex-1 whitespace-nowrap text-fg-muted" aria-hidden="true">
                {label}
              </span>
              <span className={`cond text-[1rem] leading-none font-bold whitespace-nowrap ${w + l === 0 ? 'text-fg-faint' : 'text-fg'}`} aria-hidden="true">
                {w}-{l}
              </span>
              <span className="sr-only">
                Versus {spoken}: {w} {w === 1 ? 'win' : 'wins'}, {l} {l === 1 ? 'loss' : 'losses'}
              </span>
            </li>
          ))}
        </ul>
        <h4 className="label-caps mt-2.5 text-fg-muted">Season, in order</h4>
        {/* One slot per game across the card's full width; ticks at 1.7x so the tiers separate. */}
        <ol className="season-ticks mt-1.5 grid" style={{ gridTemplateColumns: `repeat(${card.strip.length}, minmax(0, 1fr))` }}>
          {card.strip.map(([t, result], i) => {
            const tier = tiers[t]!;
            return (
              <li key={i} className="min-w-0">
                {/* Tooltip for mouse users on the hidden visual; screen readers get the sentence below once. */}
                <span className="flex flex-col items-center gap-1" aria-hidden="true" title={`${result === 'W' ? 'Win' : 'Loss'} vs ${tier.label}`}>
                  <span className="tick-slot">
                    <span className="tier-dot" data-tier={tierKey(tier.stars)} />
                  </span>
                  <span className={`cond text-[0.8125rem] leading-none font-bold ${result === 'W' ? 'text-win' : 'text-loss'}`}>{result}</span>
                </span>
                <span className="sr-only">
                  Game {i + 1}: {result === 'W' ? 'win' : 'loss'} versus {tier.label.startsWith('Non') ? 'a' : 'an'} {tier.label}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="flex-1 border-t border-line px-4 pt-3 pb-2">
        <h4 className="label-caps text-fg-muted">Game log, toughest first</h4>
        <ol className="mt-1">
          {card.games.map(([t, site, result, margin], i) => {
            const tier = tiers[t]!;
            return (
              <li key={i} className="grid min-h-7 grid-cols-[auto_1fr_auto_auto] items-center gap-x-2.5 border-t border-line py-0.5 first:border-t-0 @max-[19rem]:gap-x-1.5">
                <span className="stars" data-tier={tierKey(tier.stars)} role="img" aria-label={`${tier.stars} of 5 pips, ${tier.label}`} />
                <span className="min-w-0 text-[0.8125rem] leading-[1.125rem] font-semibold [overflow-wrap:anywhere]" aria-hidden="true">
                  {band(tier.label)}
                </span>
                <span className="text-[0.8125rem] leading-5 text-fg-muted">{SITE[site]}</span>
                <span className="result-chip card-result" data-result={result}>
                  <span aria-hidden="true">{result}</span>
                  <span aria-hidden="true">{signedMargin(result, margin)}</span>
                  <span className="sr-only">
                    {result === 'W' ? 'Won' : 'Lost'} by {margin}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="border-t border-line bg-raised px-4 py-2 text-[0.8125rem] leading-4 text-fg-faint" data-testid="card-credit">
        <FeiCredit url={ratingsUrl} />
      </footer>
    </article>
  );
});
