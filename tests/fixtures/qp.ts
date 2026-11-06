/**
 * Independent checks for isotonic regression (tests only):
 * - kktViolation: brute-force KKT certificate for  min sum (x-p)^2  s.t. x_a <= x_b.
 *   Optimal iff (1) feasible, (2) on every component joined by tight constraints the residuals
 *   d = p - x sum to 0, and (3) every up-set S of that component (a in S => b in S) has
 *   sum_S d <= 0 (Gale's condition for a nonnegative multiplier flow). Exhaustive over subsets,
 *   so components must be small (<= maxComp).
 * - dykstra: Dykstra's alternating projections onto each half-space, run to convergence.
 */

export type Constraint = readonly [number, number];

/** Returns null when KKT holds within tol, else a description of the first violation. */
export function kktViolation(p: readonly number[], cons: readonly Constraint[], x: readonly number[], tol = 1e-9, maxComp = 18): string | null {
  const n = p.length;
  for (const [a, b] of cons) if (x[a]! > x[b]! + tol) return `infeasible ${a}<=${b}: ${x[a]} > ${x[b]}`;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  const tight = cons.filter(([a, b]) => Math.abs(x[a]! - x[b]!) <= tol);
  for (const [a, b] of tight) parent[find(a)] = find(b);
  const comps = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    comps.set(r, [...(comps.get(r) ?? []), i]);
  }
  for (const comp of comps.values()) {
    const d = comp.map((i) => p[i]! - x[i]!);
    const total = d.reduce((s, v) => s + v, 0);
    if (Math.abs(total) > tol * Math.max(1, comp.length)) return `component residual sum ${total}`;
    if (comp.length > maxComp) return `component too large to brute force (${comp.length})`;
    const local = new Map(comp.map((g, li) => [g, li]));
    const inner = tight.filter(([a, b]) => local.has(a) && local.has(b)).map(([a, b]) => [local.get(a)!, local.get(b)!] as const);
    const k = comp.length;
    for (let mask = 1; mask < 1 << k; mask++) {
      let closed = true;
      for (const [a, b] of inner) {
        if (mask & (1 << a) && !(mask & (1 << b))) {
          closed = false;
          break;
        }
      }
      if (!closed) continue;
      let s = 0;
      for (let i = 0; i < k; i++) if (mask & (1 << i)) s += d[i]!;
      if (s > tol * k) return `up-set with positive residual ${s}`;
    }
  }
  return null;
}

/** Dykstra projection of p onto { x : x_a <= x_b for all constraints }. */
export function dykstra(p: readonly number[], cons: readonly Constraint[], tol = 1e-13, maxSweeps = 2_000_000): number[] {
  const x = p.slice();
  const ya = new Float64Array(cons.length);
  const yb = new Float64Array(cons.length);
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let change = 0;
    for (let e = 0; e < cons.length; e++) {
      const [a, b] = cons[e]!;
      const za0 = x[a]! + ya[e]!;
      const zb0 = x[b]! + yb[e]!;
      let za = za0;
      let zb = zb0;
      if (za > zb) {
        const m = (za + zb) / 2;
        za = m;
        zb = m;
      }
      ya[e] = za0 - za;
      yb[e] = zb0 - zb;
      change = Math.max(change, Math.abs(x[a]! - za), Math.abs(x[b]! - zb));
      x[a] = za;
      x[b] = zb;
    }
    if (change < tol) return x;
  }
  return x;
}
