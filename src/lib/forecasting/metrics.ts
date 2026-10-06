import { binomialUpperTail, mean, wilsonInterval } from "../math";
import type { ScoredStep } from "./backtest";
import { rankCutoffs } from "./ranking";
import { blockBootstrapMeanCI, signFlipPValue } from "./significance";
import type { BacktestConfig, ModelResult, ModelSpec, RankHit } from "./types";

/** Σ_{g=0}^{K-1} |g − a| */
function sumAbsDist(K: number, a: number): number {
  return (a * (a + 1)) / 2 + ((K - 1 - a) * (K - a)) / 2;
}

/** Exact expected |error| of a uniformly random guess against outcome `a`. */
export const expectedRandomAbsError = (K: number, a: number): number => sumAbsDist(K, a) / K;

export const baselineLogLoss = (K: number): number => Math.log(K);

function errorBins(K: number): { width: number; count: number; labels: string[] } {
  const width = K <= 10 ? 1 : Math.ceil(K / 10);
  const count = Math.ceil(K / width);
  const labels = Array.from({ length: count }, (_, i) => (width === 1 ? String(i) : `${i * width}–${Math.min(K - 1, (i + 1) * width - 1)}`));
  return { width, count, labels };
}

export interface MetricInputs {
  spec: ModelSpec;
  K: number;
  steps: ScoredStep[];
  cfg: BacktestConfig;
  /** unique seed offset per (model, target) so resampling streams are independent */
  seedOffset: number;
}

/** Scores one model against the uniform-random baseline on exactly the draws it predicted (paired). */
export function scoreModel({ spec, K, steps, cfg, seedOffset }: MetricInputs): Omit<ModelResult, "verdict" | "logLossAdjustedPValue" | "accuracyAdjustedPValue" | "status" | "reason"> {
  const n = steps.length;
  const lnK = baselineLogLoss(K);
  const logLosses = steps.map((s) => -Math.log(s.pActual));
  const deltas = logLosses.map((l) => lnK - l); // positive → better than random
  const hits = steps.filter((s) => s.argmax === s.actual).length;
  const absErr = steps.map((s) => Math.abs(s.argmax - s.actual));
  const baseAbs = steps.map((s) => expectedRandomAbsError(K, s.actual));

  const isReference = spec.id === "uniform";
  const meanDelta = mean(deltas);

  // cumulative advantage + rolling MAE series (windows of 20 scored draws)
  let cum = 0;
  const cumulative = steps.map((s, i) => ({ date: s.date, value: (cum += deltas[i]) }));
  const W = 20;
  const rolling = steps.map((s, i) => {
    const from = Math.max(0, i - W + 1);
    return { date: s.date, model: mean(absErr.slice(from, i + 1)), baseline: mean(baseAbs.slice(from, i + 1)) };
  });

  const { width, count, labels } = errorBins(K);
  const modelCounts = new Array<number>(count).fill(0);
  const randomCounts = new Array<number>(count).fill(0);
  steps.forEach((s, i) => {
    if (!isReference) modelCounts[Math.min(count - 1, Math.floor(absErr[i] / width))]++;
    for (let g = 0; g < K; g++) randomCounts[Math.min(count - 1, Math.floor(Math.abs(g - s.actual) / width))] += 1 / K;
  });

  const rankHits: RankHit[] = n
    ? rankCutoffs(K).map((c) => {
        const expected = c / K;
        if (isReference) return { n: c, hits: null, rate: expected, expected, ci: [expected, expected] as [number, number] };
        const h = steps.filter((s) => s.rank <= c).length;
        return { n: c, hits: h, rate: h / n, expected, ci: wilsonInterval(h, n) };
      })
    : [];

  return {
    modelId: spec.id,
    name: spec.name,
    family: spec.family,
    description: spec.description,
    limitations: spec.limitations,
    nTest: n,
    // The uniform reference "guesses" at random, so its expected accuracy is exactly 1/K (not the hit rate of one fixed guess).
    accuracy: n ? (isReference ? 1 / K : hits / n) : null,
    accuracyCI: n ? (isReference ? [1 / K, 1 / K] : wilsonInterval(hits, n)) : null,
    accuracyPValue: n ? (isReference ? 1 : binomialUpperTail(hits, n, 1 / K)) : null,
    logLoss: n ? mean(logLosses) : null,
    logLossAdvantage: n ? meanDelta : null,
    logLossAdvantageCI:
      n && !isReference ? blockBootstrapMeanCI(deltas, { resamples: cfg.bootstrapResamples, seed: cfg.seed + seedOffset }) : n ? [0, 0] : null,
    logLossPValue: n ? (isReference ? 1 : signFlipPValue(deltas, { resamples: cfg.signFlipResamples, seed: cfg.seed + 17 + seedOffset })) : null,
    mae: n ? (isReference ? mean(baseAbs) : mean(absErr)) : null,
    maeAdvantage: n ? (isReference ? 0 : mean(baseAbs) - mean(absErr)) : null,
    rankHits,
    series: { cumulativeLogLossAdvantage: cumulative, rollingMae: rolling },
    errorHistogram: labels.map((label, i) => ({
      label,
      model: n ? (isReference ? randomCounts[i] / n : modelCounts[i] / n) : 0,
      expectedRandom: n ? randomCounts[i] / n : 0,
    })),
  };
}
