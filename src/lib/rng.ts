/**
 * Seeded pseudo-random numbers. The library never calls Math.random(); anything random takes an
 * injected {@link Rng}. (Additive module, not listed in SPEC; re-exported from trios.ts.)
 */

/** A function returning uniform floats in [0, 1). */
export type Rng = () => number;

/** mulberry32: small, fast, 32-bit seeded generator. Same seed -> same sequence on every platform. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A fresh generator for one round of a run, derived from the run seed and the 1-based round
 * number. Using this (instead of one long-lived generator) keeps trio selection reproducible from
 * (pool, prior, picks, seed) alone, regardless of how many numbers earlier rounds consumed.
 */
export function rngForRound(seed: number, round: number): Rng {
  return mulberry32(hash32(seed, round));
}

/** Mix two 32-bit integers into one (deterministic, well-distributed). */
export function hash32(a: number, b: number): number {
  let h = (Math.imul(a >>> 0, 0x85ebca6b) ^ Math.imul((b >>> 0) + 0x9e3779b9, 0xc2b2ae35)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform integer in [0, n). */
export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Fisher-Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}
