/**
 * Experimental forecasting module.
 *
 * Two strictly separated outputs:
 *  1. Backtest (`targets`) — a model is only asked for a distribution over a draw whose real outcome is
 *     already known (walk-forward). This part contains scores and uncertainty only, never numbers.
 *  2. Next-draw ranking (`nextDraw`) — the same models fitted on ALL known draws, ranking the values for the
 *     next draw. It is an experimental model output and is always returned together with the backtest verdict
 *     of the model that produced it, so a ranking can never be shown without its evidence status.
 */

export type ModelId =
  | "uniform"
  | "frequency"
  | "rolling_frequency"
  | "moving_average"
  | "markov1"
  | "autoregressive"
  | "monte_carlo"
  | "softmax_ml";

export type TargetId = "last2" | "tens" | "units";

export interface Learner {
  /** Called on (a windowed copy of) the training history only. */
  fit(train: readonly number[]): void;
  /** Distribution over K classes given the history that precedes the draw being scored. */
  predict(history: readonly number[], rng: () => number): number[];
}

export interface ModelSpec {
  id: ModelId;
  name: string;
  family: "baseline" | "frequency" | "smoothing" | "markov" | "time-series" | "simulation" | "machine-learning";
  description: string;
  limitations: string;
  /** Minimum training observations for this model on a K-class target (below → insufficient_data). */
  minTrain(K: number): number;
  create(K: number): Learner;
}

export interface BacktestConfig {
  /** Observations used for the first fit; test steps start right after. */
  minTrain: number;
  /** null = expanding window; otherwise a fixed-size rolling training window. */
  trainWindow: number | null;
  /** Re-fit period for models with a fit step (others are stateless). */
  refitEvery: number;
  seed: number;
  bootstrapResamples: number;
  signFlipResamples: number;
  alpha: number;
  /** Minimum scored steps for a verdict other than "insufficient_data". */
  minTestSteps: number;
}

export const DEFAULT_BACKTEST: BacktestConfig = {
  minTrain: 50,
  trainWindow: null,
  refitEvery: 5,
  seed: 20260101,
  bootstrapResamples: 2000,
  signFlipResamples: 5000,
  alpha: 0.05,
  minTestSteps: 30,
};

export interface StepScore {
  date: string;
  logLoss: number;
  hit: boolean;
  absError: number;
}

export type Verdict = "insufficient_data" | "no_evidence" | "worse_than_random" | "evidence_better_than_random" | "reference";

/**
 * How often the realised outcome fell inside the model's top-`n` ranked values (same tie-break as the displayed
 * ranking: equal probabilities are ordered by value, ascending). Descriptive only — not part of the verdict.
 */
export interface RankHit {
  n: number;
  /** null for the uniform reference (its expected hit rate is analytic: n/K). */
  hits: number | null;
  rate: number;
  /** n / K — hit rate of picking n values at random. */
  expected: number;
  ci: [number, number];
}

export interface ModelResult {
  modelId: ModelId;
  name: string;
  family: ModelSpec["family"];
  description: string;
  limitations: string;
  status: "ok" | "insufficient_data";
  reason: string | null;
  /** Number of scored (already-known) draws. */
  nTest: number;
  accuracy: number | null;
  accuracyCI: [number, number] | null;
  /** Exact one-sided binomial p-value: P(hits ≥ observed | each guess hits with prob 1/K). */
  accuracyPValue: number | null;
  /** Holm-adjusted across every model × target tested (same family as the log-loss tests). */
  accuracyAdjustedPValue: number | null;
  logLoss: number | null;
  /** baseline log-loss − model log-loss: positive = better than random. */
  logLossAdvantage: number | null;
  logLossAdvantageCI: [number, number] | null;
  /** One-sided sign-flip permutation p-value for advantage > 0. */
  logLossPValue: number | null;
  /** Holm-adjusted across every model × target tested. */
  logLossAdjustedPValue: number | null;
  mae: number | null;
  /** baseline MAE − model MAE: positive = smaller errors than random guessing. */
  maeAdvantage: number | null;
  /** Backtest hit rate of the model's top-n ranking vs. picking n values at random. */
  rankHits: RankHit[];
  verdict: Verdict;
  series: {
    cumulativeLogLossAdvantage: { date: string; value: number }[];
    rollingMae: { date: string; model: number; baseline: number }[];
  };
  errorHistogram: { label: string; model: number; expectedRandom: number }[];
}

export interface TargetReport {
  target: TargetId;
  label: string;
  classes: number;
  observations: number;
  initialTrain: number;
  testSteps: number;
  baseline: { accuracy: number; logLoss: number; mae: number };
  models: ModelResult[];
}

/** One value of a target's distribution for the next draw, as scored by one model. */
export interface RankedValue {
  /** 1-based; values with equal probability share a rank (competition ranking: 1,2,2,4). */
  rank: number;
  tied: boolean;
  value: number;
  /** zero-padded display form ("07" for the 2-digit target, "7" for a single digit) */
  label: string;
  probability: number;
  /** probability × K — 1 means "no different from picking at random". */
  vsRandom: number;
  /** 5th–95th percentile of the probability over block-bootstrap resamples of the training history. */
  interval: [number, number];
  /** Share of bootstrap resamples in which this value stayed inside the model's shortlist. */
  shortlistShare: number;
}

export interface ModelNextDraw {
  modelId: ModelId;
  name: string;
  family: ModelSpec["family"];
  status: "ok" | "insufficient_data";
  reason: string | null;
  /** Backtest verdict of this model on this target — always travels with its ranking. */
  verdict: Verdict;
  logLossAdvantage: number | null;
  /** Bootstrap resamples behind `interval` / `shortlistShare` (fewer for the costly ML model). */
  bootstrapResamples: number;
  /** Total-variation distance of the predicted distribution from uniform (0 = indistinguishable from random). */
  distanceFromUniform: number | null;
  /** Every value of the target, best first. */
  ranking: RankedValue[];
}

export interface TargetNextDraw {
  target: TargetId;
  label: string;
  classes: number;
  /** Number of values counted as the model's "shortlist" (10 for the 2-digit target, 3 for a single digit). */
  shortlistSize: number;
  /** Model used for the headline list: best backtest Δ log-loss among models with enough data; null if none. */
  recommendedModelId: ModelId | null;
  selectionRule: string;
  models: ModelNextDraw[];
}

export interface NextDrawReport {
  basedOnDraws: number;
  /** Latest draw date contained in the training data. */
  latestDrawDate: string;
  /** First scheduled draw weekday after `latestDrawDate`; null if no schedule is known. */
  nextScheduledDate: string | null;
  /** True when `nextScheduledDate` is already in the past (data is probably out of date — refresh first). */
  scheduledDatePassed: boolean;
  bootstrapResamples: number;
  targets: TargetNextDraw[];
  notes: string[];
}

export interface ForecastReport {
  status: "ok" | "insufficient_data";
  message: string | null;
  dataRange: { from: string | null; to: string | null; draws: number };
  config: BacktestConfig;
  targets: TargetReport[];
  /** Experimental next-draw ranking. Separate from `targets` on purpose; null when disabled/insufficient. */
  nextDraw: NextDrawReport | null;
  multipleComparisons: { method: "Holm-Bonferroni"; testsCount: number; alpha: number; expectedFalsePositivesUncorrected: number };
  conclusion: {
    evidenceCount: number;
    testsCount: number;
    summary: string;
  };
  limitations: string[];
  disclaimer: string;
}
