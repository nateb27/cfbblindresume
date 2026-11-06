/**
 * MAP Bradley-Terry with an independent Gaussian prior on log-strengths (SPEC "bradley-terry.ts").
 *
 *   P(i beats j) = logistic(theta_i - theta_j),   theta_i ~ N(mean_i, sigma^2)
 *
 * The prior makes the log-posterior strictly concave, so the MAP is unique and finite even under
 * perfect separation (a team that won every comparison). Solved by damped Newton's method;
 * uncertainty by the Laplace approximation (covariance = inverse negative Hessian at the MAP).
 * Used for adaptive trio selection and the fans consensus ranking; NOT for the user's ranking.
 */

/** One observed comparison; `weight` (default 1) counts repeated identical outcomes. */
export interface BTComparison {
  winner: string;
  loser: string;
  weight?: number;
}

/** Fitting options. */
export interface BTOptions {
  /** Prior standard deviation of each log-strength (default 1). */
  sigma?: number;
  /** Prior mean per id (default 0 for ids not listed). */
  mean?: Readonly<Record<string, number>>;
  /** Newton iteration cap (default 100). */
  maxIter?: number;
  /** Convergence tolerance on the max-abs gradient (default 1e-10). */
  tol?: number;
}

/** Fitted model. Index-aligned arrays follow `ids`. */
export interface BTResult {
  ids: string[];
  /** MAP log-strengths. */
  theta: number[];
  /** MAP log-strength by id. */
  strength: Record<string, number>;
  /** Laplace posterior covariance of theta (n x n). */
  covariance: number[][];
  /** P(a beats b) at the MAP: logistic(theta_a - theta_b). prob(a,b) + prob(b,a) = 1. */
  prob(a: string, b: string): number;
  /** P(a beats b) integrating Laplace uncertainty (probit approximation). Symmetric like prob. */
  probMarginal(a: string, b: string): number;
  /** Posterior variance of theta_a - theta_b. */
  diffVariance(a: string, b: string): number;
  /** ids by strength, strongest first (ties: input order). */
  order(): string[];
  /** Newton iterations used. */
  iterations: number;
  /** True when the gradient tolerance was reached. */
  converged: boolean;
}

/** Numerically stable logistic function. */
export function logistic(x: number): number {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const e = Math.exp(x);
  return e / (1 + e);
}

/** log(logistic(x)), stable for large |x|. */
function logLogistic(x: number): number {
  return x >= 0 ? -Math.log1p(Math.exp(-x)) : x - Math.log1p(Math.exp(x));
}

/** In-place Cholesky of a symmetric positive-definite matrix; returns lower factor L. */
function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    const Li = L[i]!;
    for (let j = 0; j <= i; j++) {
      const Lj = L[j]!;
      let s = a[i]![j]!;
      for (let k = 0; k < j; k++) s -= Li[k]! * Lj[k]!;
      if (i === j) {
        if (!(s > 0)) throw new Error('bradleyTerry: matrix not positive definite');
        Li[i] = Math.sqrt(s);
      } else {
        Li[j] = s / Lj[j]!;
      }
    }
  }
  return L;
}

function cholSolve(L: number[][], b: readonly number[]): number[] {
  const n = L.length;
  const y = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    const Li = L[i]!;
    for (let k = 0; k < i; k++) s -= Li[k]! * y[k]!;
    y[i] = s / Li[i]!;
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= L[k]![i]! * x[k]!;
    x[i] = s / L[i]![i]!;
  }
  return x;
}

/**
 * Fit MAP Bradley-Terry over `ids` from `comparisons`.
 * @throws RangeError on unknown ids, self-comparisons, negative/non-finite weights or sigma <= 0.
 */
export function bradleyTerry(ids: readonly string[], comparisons: readonly BTComparison[], opts: BTOptions = {}): BTResult {
  const n = ids.length;
  const sigma = opts.sigma ?? 1;
  if (!(sigma > 0) || !Number.isFinite(sigma)) throw new RangeError('bradleyTerry: sigma must be > 0');
  const maxIter = opts.maxIter ?? 100;
  const tol = opts.tol ?? 1e-10;
  const index = new Map<string, number>();
  ids.forEach((id, i) => {
    if (index.has(id)) throw new RangeError(`bradleyTerry: duplicate id "${id}"`);
    index.set(id, i);
  });
  const idx = (id: string): number => {
    const i = index.get(id);
    if (i === undefined) throw new RangeError(`bradleyTerry: unknown id "${id}"`);
    return i;
  };

  // Aggregate wins: W[i][j] = weight of "i beat j".
  const W: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const c of comparisons) {
    const w = c.weight ?? 1;
    if (!(w >= 0) || !Number.isFinite(w)) throw new RangeError('bradleyTerry: weights must be finite and >= 0');
    const a = idx(c.winner);
    const b = idx(c.loser);
    if (a === b) throw new RangeError(`bradleyTerry: self-comparison "${c.winner}"`);
    W[a]![b]! += w;
  }
  const pairs: [number, number, number, number][] = []; // i, j, wins_ij, total
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t = W[i]![j]! + W[j]![i]!;
      if (t > 0) pairs.push([i, j, W[i]![j]!, t]);
    }
  }
  const mu = ids.map((id) => opts.mean?.[id] ?? 0);
  const prec = 1 / (sigma * sigma);

  const logPost = (th: readonly number[]): number => {
    let lp = 0;
    for (const [i, j, wij, t] of pairs) {
      const d = th[i]! - th[j]!;
      lp += wij * logLogistic(d) + (t - wij) * logLogistic(-d);
    }
    for (let i = 0; i < n; i++) lp -= 0.5 * prec * (th[i]! - mu[i]!) ** 2;
    return lp;
  };
  /** Gradient and NEGATIVE Hessian. */
  const derivs = (th: readonly number[]): { g: number[]; H: number[][] } => {
    const g = th.map((t, i) => -prec * (t - mu[i]!));
    const H: number[][] = Array.from({ length: n }, (_, i) => {
      const row = new Array<number>(n).fill(0);
      row[i] = prec;
      return row;
    });
    for (const [i, j, wij, t] of pairs) {
      const s = logistic(th[i]! - th[j]!);
      const r = wij - t * s;
      g[i]! += r;
      g[j]! -= r;
      const h = t * s * (1 - s);
      H[i]![i]! += h;
      H[j]![j]! += h;
      H[i]![j]! -= h;
      H[j]![i]! -= h;
    }
    return { g, H };
  };

  let theta = mu.slice();
  let iterations = 0;
  let converged = false;
  let lp = logPost(theta);
  for (; iterations < maxIter; iterations++) {
    const { g, H } = derivs(theta);
    let gmax = 0;
    for (const v of g) gmax = Math.max(gmax, Math.abs(v));
    if (gmax < tol) {
      converged = true;
      break;
    }
    const step = cholSolve(cholesky(H), g);
    let t = 1;
    let next = theta;
    let nextLp = lp;
    for (let k = 0; k < 60; k++) {
      next = theta.map((v, i) => v + t * step[i]!);
      nextLp = logPost(next);
      if (nextLp >= lp - 1e-15 * Math.abs(lp)) break;
      t *= 0.5;
    }
    theta = next;
    lp = nextLp;
  }
  if (!converged) {
    const { g } = derivs(theta);
    converged = g.every((v) => Math.abs(v) < tol * 100);
  }

  const { H } = derivs(theta);
  const L = cholesky(H);
  const covariance: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let k = 0; k < n; k++) {
    const e = new Array<number>(n).fill(0);
    e[k] = 1;
    const col = cholSolve(L, e);
    for (let i = 0; i < n; i++) covariance[i]![k] = col[i]!;
  }
  // Symmetrize against rounding.
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const v = 0.5 * (covariance[i]![j]! + covariance[j]![i]!);
      covariance[i]![j] = v;
      covariance[j]![i] = v;
    }
  }

  const strength: Record<string, number> = {};
  ids.forEach((id, i) => (strength[id] = theta[i]!));
  const diffVarIdx = (i: number, j: number): number =>
    Math.max(0, covariance[i]![i]! + covariance[j]![j]! - 2 * covariance[i]![j]!);
  const finalTheta = theta;

  return {
    ids: ids.slice(),
    theta: finalTheta,
    strength,
    covariance,
    prob: (a, b) => logistic(finalTheta[idx(a)]! - finalTheta[idx(b)]!),
    probMarginal: (a, b) => {
      const i = idx(a);
      const j = idx(b);
      return logistic((finalTheta[i]! - finalTheta[j]!) / Math.sqrt(1 + (Math.PI * diffVarIdx(i, j)) / 8));
    },
    diffVariance: (a, b) => diffVarIdx(idx(a), idx(b)),
    order: () =>
      ids
        .map((id, i) => ({ id, i }))
        .sort((x, y) => finalTheta[y.i]! - finalTheta[x.i]! || x.i - y.i)
        .map((o) => o.id),
    iterations,
    converged,
  };
}
