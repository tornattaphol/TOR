import { mean, mulberry32 } from "../math";

/**
 * Moving-block bootstrap percentile CI for the mean. Blocks preserve short-range dependence between
 * consecutive per-draw score differences (models re-use overlapping training data).
 */
export function blockBootstrapMeanCI(
  xs: readonly number[],
  opts: { resamples: number; seed: number; level?: number; blockLength?: number },
): [number, number] {
  const n = xs.length;
  if (n === 0) return [NaN, NaN];
  const level = opts.level ?? 0.95;
  const L = Math.max(1, Math.min(n, opts.blockLength ?? Math.ceil(Math.cbrt(n))));
  const rng = mulberry32(opts.seed);
  const means: number[] = new Array(opts.resamples);
  const maxStart = n - L;
  for (let b = 0; b < opts.resamples; b++) {
    let acc = 0;
    let count = 0;
    while (count < n) {
      const start = Math.floor(rng() * (maxStart + 1));
      for (let j = 0; j < L && count < n; j++, count++) acc += xs[start + j];
    }
    means[b] = acc / n;
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(((1 - level) / 2) * (opts.resamples - 1))];
  const hi = means[Math.ceil((1 - (1 - level) / 2) * (opts.resamples - 1))];
  return [lo, hi];
}

/**
 * One-sided sign-flip (randomisation) test of H0: the paired differences are symmetric about 0,
 * against H1: mean difference > 0. Uses the "+1" correction so p is never exactly 0.
 */
export function signFlipPValue(diffs: readonly number[], opts: { resamples: number; seed: number }): number {
  const n = diffs.length;
  if (n === 0) return 1;
  const observed = mean(diffs);
  if (diffs.every((d) => d === 0)) return 1;
  const rng = mulberry32(opts.seed);
  let atLeast = 0;
  for (let b = 0; b < opts.resamples; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += rng() < 0.5 ? diffs[i] : -diffs[i];
    if (s / n >= observed - 1e-15) atLeast++;
  }
  return (atLeast + 1) / (opts.resamples + 1);
}

/** Holm–Bonferroni step-down adjusted p-values (valid under arbitrary dependence). */
export function holmAdjust(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const adj = new Array<number>(m);
  let running = 0;
  order.forEach(({ p, i }, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * p));
    adj[i] = running;
  });
  return adj;
}
