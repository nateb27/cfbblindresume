/**
 * Opponent tiers, cut on the opponent's overall FEI rank in the CURRENT week (SPEC "Opponent tiers").
 * Pure, no data access: callers pass the opponent's FBS flag, FEI rank and classification.
 */

/** Stable tier identifiers, toughest first. */
export type TierKey =
  | 'fei1-5'
  | 'fei6-10'
  | 'fei11-25'
  | 'fei26-50'
  | 'fei51-75'
  | 'fei76-100'
  | 'fei101+'
  | 'fcs'
  | 'nonfbs';

/** One opponent tier. `order` is 0 for the toughest tier and increases as tiers get weaker. */
export interface Tier {
  key: TierKey;
  /** Star value shown on cards: 5, 4.5, 4, 3, 2, 1.5, 1, 0.5. */
  stars: number;
  /** Display label, e.g. "FEI 11-25 team", "FCS team". */
  label: string;
  /** Sort key, 0 = toughest. Equal to the tier's index in {@link TIERS}. */
  order: number;
}

/** Every tier in order (index === `order`). FCS and other non-FBS opponents share 0.5 stars. */
export const TIERS: readonly Tier[] = Object.freeze([
  { key: 'fei1-5', stars: 5, label: 'FEI 1-5 team', order: 0 },
  { key: 'fei6-10', stars: 4.5, label: 'FEI 6-10 team', order: 1 },
  { key: 'fei11-25', stars: 4, label: 'FEI 11-25 team', order: 2 },
  { key: 'fei26-50', stars: 3, label: 'FEI 26-50 team', order: 3 },
  { key: 'fei51-75', stars: 2, label: 'FEI 51-75 team', order: 4 },
  { key: 'fei76-100', stars: 1.5, label: 'FEI 76-100 team', order: 5 },
  { key: 'fei101+', stars: 1, label: 'FEI 101+ team', order: 6 },
  { key: 'fcs', stars: 0.5, label: 'FCS team', order: 7 },
  { key: 'nonfbs', stars: 0.5, label: 'Non-FBS team', order: 8 },
] as Tier[]);

/** Inclusive upper FEI-rank bound of each FBS tier (tiers 0..6). */
const FBS_UPPER = [5, 10, 25, 50, 75, 100, Infinity] as const;

/** Opponent description accepted by {@link tierFor}. */
export interface TierInput {
  /** True when the opponent is an FBS team. */
  fbs: boolean;
  /** Opponent's overall FEI rank this week (required when `fbs`). */
  feiRank?: number;
  /** CFBD classification for non-FBS opponents ('fcs', 'ii', 'iii', ...). */
  classification?: string;
}

/**
 * Tier for one opponent. FBS opponents are cut on `feiRank` (1-5, 6-10, 11-25, 26-50, 51-75,
 * 76-100, 101+); non-FBS opponents are "FCS team" when classification is 'fcs' (case-insensitive)
 * and "Non-FBS team" otherwise.
 * @throws RangeError when an FBS opponent has no valid positive integer FEI rank (bad data must fail loudly).
 */
export function tierFor(opp: TierInput): Tier {
  if (!opp.fbs) {
    return (opp.classification ?? '').toLowerCase() === 'fcs' ? TIERS[7]! : TIERS[8]!;
  }
  const r = opp.feiRank;
  if (r === undefined || !Number.isInteger(r) || r < 1) {
    throw new RangeError(`tierFor: FBS opponent needs a positive integer feiRank, got ${String(r)}`);
  }
  for (let i = 0; i < FBS_UPPER.length; i++) {
    if (r <= FBS_UPPER[i]!) return TIERS[i]!;
  }
  /* c8 ignore next */
  return TIERS[6]!;
}

/**
 * Bar fill for a rank among `fbsCount` teams: rank 1 -> 1, rank fbsCount -> 0, linear between,
 * clamped to [0, 1]. Returns 1 when fbsCount <= 1.
 */
export function rankFill(rank: number, fbsCount: number): number {
  if (fbsCount <= 1) return 1;
  const v = (fbsCount - rank) / (fbsCount - 1);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
