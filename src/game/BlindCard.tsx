/**
 * One anonymized resume (DESIGN.md §9): letter + record, rank bars (strength of record, offense and
 * defense side by side, schedule) with tap-to-define labels, quality wins, the season strip, the
 * game log toughest first, and the FEI credit (house rule 8: on every card, which people screenshot
 * on their own). Identity never reaches the DOM: no slug, name, color or conference.
 *
 * The card is a size container: below 21rem (phones under ~390px) tier labels drop the word "team"
 * and the quality-win dots go; below 19rem (320px phones) stars and gaps shrink. Nothing truncates.
 */
import { memo, useId, useState, type CSSProperties } from 'react';
import type { BlindCard as CardData, GameTier } from '@lib/game-data';
import { rankFill, tierFor } from '@lib/tiers';
import { tierKey } from '../styles/tokens';
import { ordinal, recordSpoken, recordText, signedMargin } from './format';
import { FeiCredit } from './ui';

type MetricKey = 'sor' | 'off' | 'def' | 'sos';

/** One-line definitions, in our own words, of the FEI numbers on the card. */
const METRICS: { key: MetricKey; label: string; def: string; wide: boolean }[] = [
  {
    key: 'sor',
    label: 'Strength of record',
    def: 'How many fewer losses this team has than a very good team would expect against the same schedule (FEI GWD).',
    wide: true,
  },
  {
    key: 'off',
    label: 'Offense',
    def: 'Points per possession versus an average defense, adjusted for opponents (FEI OFEI).',
    wide: false,
  },
  {
    key: 'def',
    label: 'Defense',
    def: 'Points kept off the board per possession versus an average offense, adjusted for opponents (FEI DFEI).',
    wide: false,
  },
  {
    key: 'sos',
    label: 'Schedule',
    def: 'Losses an elite team would expect against this schedule. #1 is the hardest (FEI ELS).',
    wide: true,
  },
];

const SITE = { h: 'Home', a: 'Away', n: 'Neutral' } as const;

const bandKey = (rank: number) => tierKey(tierFor({ fbs: true, feiRank: rank }).stars);

/** "FEI 11-25 team" -> ["FEI 11-25", " team"]: the trailing word can drop on narrow cards. */
function splitTier(label: string): [string, string] {
  return label.endsWith(' team') ? [label.slice(0, -5), ' team'] : [label, ''];
}

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
}) {
  const { letter, card, tiers, fbsCount, place, ratingsUrl } = props;
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

      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 px-4 pt-3.5 pb-3.5 @max-[19rem]:gap-x-3">
        <h4 className="sr-only">Ratings, rank among {fbsCount} FBS teams</h4>
        {METRICS.map((m) => {
          const rank = card.ranks[m.key];
          const isOpen = open === m.key;
          const defId = `${uid}-${m.key}`;
          return (
            <div key={m.key} className={m.wide ? 'col-span-2' : 'min-w-0'} data-metric={m.key}>
              <div className="flex items-baseline justify-between gap-2">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  aria-controls={defId}
                  onClick={() => setOpen(isOpen ? null : m.key)}
                  className={`label-caps relative -my-1.5 py-1.5 text-left underline decoration-dotted decoration-1 underline-offset-[5px] after:absolute after:-inset-x-1.5 after:-inset-y-2 after:content-[''] hover:text-fg ${isOpen ? 'text-fg decoration-fg-muted' : 'text-fg-muted decoration-control'}`}
                >
                  {m.label}
                </button>
                <span className="cond text-stat" data-rank>
                  <span aria-hidden="true">#{rank}</span>
                  <span className="sr-only">
                    rank {rank} of {fbsCount}
                  </span>
                </span>
              </div>
              <div className="meter mt-1.5" data-tier={bandKey(rank)} data-animate="" style={{ '--fill': rankFill(rank, fbsCount).toFixed(3) } as CSSProperties} aria-hidden="true">
                <span />
              </div>
              <p id={defId} hidden={!isOpen} className="mt-1.5 animate-fade text-[0.8125rem] leading-5 text-fg-muted">
                {m.def}
              </p>
            </div>
          );
        })}
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
              <span className="label-caps flex-1 whitespace-nowrap text-[0.75rem] text-fg-muted" aria-hidden="true">
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
        <ol className="mt-1.5 flex flex-wrap gap-x-1.5 gap-y-2">
          {card.strip.map(([t, result], i) => {
            const tier = tiers[t]!;
            return (
              <li key={i} className="w-4">
                {/* Tooltip for mouse users on the hidden visual; screen readers get the sentence below once. */}
                <span className="flex flex-col items-center gap-1" aria-hidden="true" title={`${result === 'W' ? 'Win' : 'Loss'} vs ${tier.label}`}>
                  <span className="tick-slot">
                    <span className="tier-dot" data-tier={tierKey(tier.stars)} />
                  </span>
                  <span className={`cond text-[0.75rem] leading-none font-bold ${result === 'W' ? 'text-win' : 'text-loss'}`}>{result}</span>
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
        <h4 className="label-caps text-fg-muted">Toughest opponent first</h4>
        <ol className="mt-1">
          {card.games.map(([t, site, result, margin], i) => {
            const tier = tiers[t]!;
            const [tierBase, tierWord] = splitTier(tier.label);
            return (
              <li key={i} className="grid min-h-7 grid-cols-[auto_1fr_auto_auto] items-center gap-x-2.5 border-t border-line py-0.5 first:border-t-0 @max-[19rem]:gap-x-1.5">
                <span className="stars" data-tier={tierKey(tier.stars)} role="img" aria-label={`${tier.stars} of 5 pips`} />
                <span className="min-w-0 text-[0.875rem] leading-[1.125rem] font-semibold [overflow-wrap:anywhere]">
                  {tierBase}
                  {tierWord && <span className="@max-[21rem]:hidden">{tierWord}</span>}
                </span>
                <span className="text-[0.8125rem] leading-5 text-fg-muted">{SITE[site]}</span>
                <span className="result-chip" data-result={result}>
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

      <footer className="border-t border-line bg-raised px-4 py-2 text-[0.75rem] leading-4 text-fg-faint" data-testid="card-credit">
        <FeiCredit url={ratingsUrl} />
      </footer>
    </article>
  );
});
