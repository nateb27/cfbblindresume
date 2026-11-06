/**
 * Exact least-squares isotonic regression on a DAG (additive helper module for ranking.ts).
 *
 *   minimize  sum_i (x_i - p_i)^2   subject to   x_a <= x_b  for every constraint (a, b)
 *
 * Algorithm: recursive partitioning (Luss, Rosset & Shahar 2010; Hochbaum & Queyranne 2003).
 * For a block B with mean m, find the lower set L (closed under predecessors: b in L => a in L)
 * maximizing sum_{i in L} (m - p_i) by a max-weight-closure min cut. If the maximum is 0 the
 * block is a level set at m; otherwise split into L and B \ L and recurse. With integer p the
 * cut capacities are integers (scaled by |B|), so every decision is exact and x_i is the exact
 * block mean (one floating-point division).
 */

/** Dinic max-flow on a small graph with numeric capacities. */
export class MaxFlow {
  private readonly head: number[];
  private readonly to: number[] = [];
  private readonly cap: number[] = [];
  private readonly next: number[] = [];
  private level: number[] = [];
  private it: number[] = [];
  /** Node count. */
  readonly n: number;

  constructor(n: number) {
    this.n = n;
    this.head = new Array<number>(n).fill(-1);
  }

  /** Directed edge u -> v with capacity c (adds the residual reverse edge). */
  addEdge(u: number, v: number, c: number): void {
    this.to.push(v);
    this.cap.push(c);
    this.next.push(this.head[u]!);
    this.head[u] = this.to.length - 1;
    this.to.push(u);
    this.cap.push(0);
    this.next.push(this.head[v]!);
    this.head[v] = this.to.length - 1;
  }

  private bfs(s: number, t: number): boolean {
    this.level = new Array<number>(this.n).fill(-1);
    const q = [s];
    this.level[s] = 0;
    for (let qi = 0; qi < q.length; qi++) {
      const u = q[qi]!;
      for (let e = this.head[u]!; e !== -1; e = this.next[e]!) {
        const v = this.to[e]!;
        if (this.cap[e]! > 0 && this.level[v] === -1) {
          this.level[v] = this.level[u]! + 1;
          q.push(v);
        }
      }
    }
    return this.level[t] !== -1;
  }

  private dfs(u: number, t: number, f: number): number {
    if (u === t) return f;
    for (; this.it[u] !== -1; this.it[u] = this.next[this.it[u]!]!) {
      const e = this.it[u]!;
      const v = this.to[e]!;
      if (this.cap[e]! > 0 && this.level[v] === this.level[u]! + 1) {
        const d = this.dfs(v, t, Math.min(f, this.cap[e]!));
        if (d > 0) {
          this.cap[e] = this.cap[e]! - d;
          this.cap[e ^ 1] = this.cap[e ^ 1]! + d;
          return d;
        }
      }
    }
    return 0;
  }

  /** Maximum s-t flow value. */
  maxflow(s: number, t: number): number {
    let flow = 0;
    while (this.bfs(s, t)) {
      this.it = this.head.slice();
      for (;;) {
        const f = this.dfs(s, t, Infinity);
        if (f <= 0) break;
        flow += f;
      }
    }
    return flow;
  }

  /** After maxflow: nodes reachable from s in the residual graph (the minimal min-cut source side). */
  reachable(s: number): boolean[] {
    const seen = new Array<boolean>(this.n).fill(false);
    const stack = [s];
    seen[s] = true;
    while (stack.length) {
      const u = stack.pop()!;
      for (let e = this.head[u]!; e !== -1; e = this.next[e]!) {
        const v = this.to[e]!;
        if (this.cap[e]! > 0 && !seen[v]) {
          seen[v] = true;
          stack.push(v);
        }
      }
    }
    return seen;
  }
}

/**
 * Exact L2 isotonic regression of `p` under constraints x[a] <= x[b] for each [a, b] in
 * `constraints` (indices into p; the constraint graph must be acyclic or the affected nodes
 * are simply pooled). Exact for integer p; for real p decisions use a tiny relative tolerance.
 */
export function isotonicRegression(p: readonly number[], constraints: readonly (readonly [number, number])[]): number[] {
  const n = p.length;
  const x = new Array<number>(n).fill(0);
  const integer = p.every((v) => Number.isInteger(v));
  const stack: number[][] = [Array.from({ length: n }, (_, i) => i)];
  while (stack.length) {
    const block = stack.pop()!;
    const k = block.length;
    if (k === 0) continue;
    let sum = 0;
    for (const i of block) sum += p[i]!;
    if (k === 1) {
      x[block[0]!] = sum;
      continue;
    }
    const local = new Map<number, number>();
    block.forEach((g, li) => local.set(g, li));
    // c_i = sum - k * p_i  (= k * (mean - p_i)); positive => wants to go down.
    const c = block.map((g) => sum - k * p[g]!);
    let total = 0;
    for (const v of c) total += Math.abs(v);
    const S = k;
    const T = k + 1;
    const mf = new MaxFlow(k + 2);
    let pos = 0;
    c.forEach((v, li) => {
      if (v > 0) {
        mf.addEdge(S, li, v);
        pos += v;
      } else if (v < 0) {
        mf.addEdge(li, T, -v);
      }
    });
    const INF = total + 1;
    for (const [a, b] of constraints) {
      const la = local.get(a);
      const lb = local.get(b);
      // b in L (down) forces a in L: infinite edge b -> a.
      if (la !== undefined && lb !== undefined) mf.addEdge(lb, la, INF);
    }
    const flow = mf.maxflow(S, T);
    const gain = pos - flow;
    const eps = integer ? 0.5 : 1e-12 * Math.max(1, total);
    let split: number[] | null = null;
    if (gain > eps) {
      const reach = mf.reachable(S);
      const L = block.filter((_, li) => reach[li]);
      if (L.length > 0 && L.length < k) split = L;
    }
    if (!split) {
      const m = sum / k;
      for (const i of block) x[i] = m;
      continue;
    }
    const inL = new Set(split);
    stack.push(split, block.filter((g) => !inL.has(g)));
  }
  return x;
}
