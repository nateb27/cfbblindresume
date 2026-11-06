/**
 * Agreement between the user's picks and a reference ranking (SPEC "Agreement").
 *
 * A reference is a rank lookup (1 = best). A reference ORDERS a pair when both teams have
 * different ranks, or exactly one of them is ranked (the ranked team is ahead). Pairs with both
 * teams unranked (committee: outside its top 25) or equal ranks are ignored.
 *  - Round match: the user's order agrees with the reference on every pair the reference orders.
 *    A round where the reference orders none of the three pairs (e.g. three teams outside the
 *    committee top 25) has nothing to contradict, so it counts as a match. Only an absent
 *    reference (no committee release yet) gives null, so with a reference present the
 *    rounds-matched denominator always equals the rounds played.
 *  - Pairwise: of all pairwise calls (3 per round), how many match the reference, out of the
 *    pairs it orders.
 */
import { pairwiseOutcomes } from './ranking';

/** slug -> rank (1 = best); null/undefined/missing = unranked. */
export type RankLookup = Readonly<Record<string, number | null | undefined>>;

/** Reference rankings to compare against. `committee` is null before the first release. */
export interface AgreementRefs {
  committee: RankLookup | null;
  fei: RankLookup;
}

/** Matched out of comparable, with share = matched / comparable (null when nothing comparable). */
export interface MatchCount {
  matched: number;
  comparable: number;
  share: number | null;
}

/** Output of {@link agreement}. */
export interface AgreementSummary {
  /** Per round (same order as input): true/false, or null when the reference is absent (no committee release). */
  rounds: { committee: boolean | null; fei: boolean | null }[];
  /** Rounds matched out of rounds played (comparable = 0 when the reference is absent). */
  roundsMatched: { committee: MatchCount; fei: MatchCount };
  /** Pairwise calls: total calls and matches per reference. */
  pairwise: { calls: number; committee: MatchCount; fei: MatchCount };
  /** False when there is no committee release (hide committee copy). */
  hasCommittee: boolean;
}

/** 1 if the reference puts a ahead of b, -1 if b ahead of a, 0 if it does not order the pair. */
export function referenceOrder(a: string, b: string, ref: RankLookup): -1 | 0 | 1 {
  const ra = ref[a] ?? null;
  const rb = ref[b] ?? null;
  if (ra === null && rb === null) return 0;
  if (ra === null) return -1;
  if (rb === null) return 1;
  return ra < rb ? 1 : ra > rb ? -1 : 0;
}

/**
 * Does one ranked round (user order) agree with the reference on every pair it orders? A round
 * whose pairs the reference orders none of is a match (nothing contradicts it). null only when
 * the reference is absent.
 */
export function roundAgreement(round: readonly string[], ref: RankLookup | null): boolean | null {
  if (!ref) return null;
  for (const [w, l] of pairwiseOutcomes([round])) {
    if (referenceOrder(w, l, ref) < 0) return false;
  }
  return true;
}

/** Pairwise matches of the user's calls against one reference. */
export function pairwiseAgreement(rounds: readonly (readonly string[])[], ref: RankLookup | null): MatchCount {
  if (!ref) return { matched: 0, comparable: 0, share: null };
  let matched = 0;
  let comparable = 0;
  for (const [w, l] of pairwiseOutcomes(rounds)) {
    const o = referenceOrder(w, l, ref);
    if (o === 0) continue;
    comparable++;
    if (o > 0) matched++;
  }
  return { matched, comparable, share: comparable ? matched / comparable : null };
}

function count(values: (boolean | null)[]): MatchCount {
  const judged = values.filter((v): v is boolean => v !== null);
  const matched = judged.filter((v) => v).length;
  return { matched, comparable: judged.length, share: judged.length ? matched / judged.length : null };
}

/** Round and pairwise agreement with the committee and FEI for a run. */
export function agreement(rounds: readonly (readonly string[])[], refs: AgreementRefs): AgreementSummary {
  const per = rounds.map((r) => ({ committee: roundAgreement(r, refs.committee), fei: roundAgreement(r, refs.fei) }));
  return {
    rounds: per,
    roundsMatched: { committee: count(per.map((p) => p.committee)), fei: count(per.map((p) => p.fei)) },
    pairwise: {
      calls: pairwiseOutcomes(rounds).length,
      committee: pairwiseAgreement(rounds, refs.committee),
      fei: pairwiseAgreement(rounds, refs.fei),
    },
    hasCommittee: refs.committee !== null,
  };
}

const pct = (m: MatchCount): string => `${Math.round((m.share ?? 0) * 100)}%`;

/**
 * Results copy, e.g. "Of your 45 head-to-head calls, 32 matched the committee (71%) and 38
 * matched FEI (84%)." When a reference could not judge every call, the percentage says of how many.
 */
export function agreementSentence(s: AgreementSummary): string {
  const { calls, committee, fei } = s.pairwise;
  const part = (m: MatchCount, who: string): string =>
    m.comparable === calls ? `${m.matched} matched ${who} (${pct(m)})` : `${m.matched} matched ${who} (${pct(m)} of the ${m.comparable} it ranks)`;
  const callsTxt = `${calls} head-to-head call${calls === 1 ? '' : 's'}`;
  if (!s.hasCommittee) return `Of your ${callsTxt}, ${part(fei, 'FEI')}.`;
  return `Of your ${callsTxt}, ${part(committee, 'the committee')} and ${part(fei, 'FEI')}.`;
}

const roundsWord = (n: number): string => (n === 1 ? 'round' : 'rounds');

/** Reveal running line, e.g. "You've matched the committee in 4 of 6 rounds, FEI in 5 of 6." */
export function runningLine(s: AgreementSummary): string {
  const { committee, fei } = s.roundsMatched;
  if (!s.hasCommittee) return `You've matched FEI in ${fei.matched} of ${fei.comparable} ${roundsWord(fei.comparable)}.`;
  return `You've matched the committee in ${committee.matched} of ${committee.comparable} ${roundsWord(committee.comparable)}, FEI in ${fei.matched} of ${fei.comparable}.`;
}
