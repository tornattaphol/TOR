import { describe, expect, it } from "vitest";
import { runBacktest } from "../../src/lib/forecasting/backtest";
import { expectedRandomAbsError, scoreModel } from "../../src/lib/forecasting/metrics";
import { MODEL_SPECS, getModelSpec } from "../../src/lib/forecasting/models";
import { blockBootstrapMeanCI, holmAdjust, signFlipPValue } from "../../src/lib/forecasting/significance";
import { runForecastExperiment, DEFAULT_BACKTEST, type BacktestConfig, type Learner, type ModelSpec } from "../../src/lib/forecasting";
import { mean, mulberry32 } from "../../src/lib/math";
import { REQUIRED_WARNING } from "../../src/lib/disclaimer";
import { mkDraw, pseudoValues, scheduleDraws } from "../helpers/fixtures";

const cfg = (over: Partial<BacktestConfig> = {}): BacktestConfig => ({ ...DEFAULT_BACKTEST, ...over });
const dates = (n: number) => Array.from({ length: n }, (_, i) => `d${String(i).padStart(4, "0")}`);
const randSeq = (n: number, K: number, seed: number) => {
  const r = mulberry32(seed);
  return Array.from({ length: n }, () => Math.floor(r() * K));
};

describe("models produce valid probability distributions", () => {
  for (const spec of MODEL_SPECS) {
    for (const K of [10, 100]) {
      it(`${spec.id} (K=${K})`, () => {
        const y = randSeq(200, K, 11);
        const learner = spec.create(K);
        learner.fit(y.slice(0, 150));
        const p = learner.predict(y.slice(0, 150), mulberry32(1));
        expect(p).toHaveLength(K);
        expect(p.every((v) => Number.isFinite(v) && v > 0)).toBe(true);
        expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      });
    }
    it(`${spec.id} survives an empty / tiny history`, () => {
      const learner = spec.create(10);
      learner.fit([]);
      const p = learner.predict([], mulberry32(1));
      expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      learner.fit([3]);
      expect(learner.predict([3], mulberry32(1)).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    });
  }

  it("the uniform baseline is exactly 1/K", () => {
    const p = getModelSpec("uniform")!.create(100).predict([1, 2, 3], mulberry32(1));
    expect(p.every((v) => v === 0.01)).toBe(true);
  });

  it("frequency/EWMA/Markov respond to the data they have seen", () => {
    const hist = [7, 7, 7, 7, 3, 7, 7, 7, 2, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7];
    for (const id of ["frequency", "rolling_frequency", "moving_average", "monte_carlo"] as const) {
      const l = getModelSpec(id)!.create(10);
      l.fit(hist);
      const p = l.predict(hist, mulberry32(5));
      expect(p[7], id).toBeGreaterThan(p[0] * 2);
    }
    // Markov: after 4 the next is always 5
    const cyc = Array.from({ length: 60 }, (_, i) => i % 10);
    const m = getModelSpec("markov1")!.create(10);
    m.fit(cyc);
    const p = m.predict([...cyc, 4], mulberry32(1));
    expect(p[5]).toBeGreaterThan(0.5);
  });

  it("every model is deterministic given the same inputs and seed", () => {
    const y = randSeq(120, 10, 3);
    for (const spec of MODEL_SPECS) {
      const a = spec.create(10);
      const b = spec.create(10);
      a.fit(y);
      b.fit(y);
      expect(a.predict(y, mulberry32(9)), spec.id).toEqual(b.predict(y, mulberry32(9)));
    }
  });
});

describe("walk-forward backtest — no look-ahead", () => {
  const spy = (log: { fitLens: number[]; predLens: number[]; frozen: boolean[] }): ModelSpec => ({
    id: "frequency",
    name: "spy",
    family: "frequency",
    description: "",
    limitations: "",
    minTrain: () => 0,
    create: (K): Learner => ({
      fit: (train) => log.fitLens.push(train.length),
      predict: (h) => {
        log.predLens.push(h.length);
        log.frozen.push(Object.isFrozen(h));
        return new Array<number>(K).fill(1 / K);
      },
    }),
  });

  it("hands the model only observations strictly before the scored draw (expanding window)", () => {
    const y = randSeq(80, 10, 1);
    const log = { fitLens: [] as number[], predLens: [] as number[], frozen: [] as boolean[] };
    const run = runBacktest(spy(log), y, dates(80), 10, cfg({ minTrain: 50, refitEvery: 5 }));
    expect(run.steps.map((s) => s.index)).toEqual(Array.from({ length: 30 }, (_, i) => 50 + i));
    expect(log.predLens).toEqual(Array.from({ length: 30 }, (_, i) => 50 + i)); // history length == index of the scored draw
    expect(log.frozen.every(Boolean)).toBe(true);
    // refit every 5 scored steps, always on data that precedes the step it is first used for
    expect(log.fitLens).toEqual([50, 55, 60, 65, 70, 75]);
  });

  it("limits history to the rolling window when configured", () => {
    const y = randSeq(80, 10, 1);
    const log = { fitLens: [] as number[], predLens: [] as number[], frozen: [] as boolean[] };
    runBacktest(spy(log), y, dates(80), 10, cfg({ minTrain: 50, trainWindow: 30, refitEvery: 1 }));
    expect(Math.max(...log.predLens)).toBe(30);
    expect(Math.max(...log.fitLens)).toBe(30);
  });

  it("changing FUTURE observations never changes earlier scores (property test over every model)", () => {
    const n = 200;
    const y = randSeq(n, 10, 21);
    const t0 = 150; // late enough that even the ML model (needs 100 training draws) has scored steps
    const altered = [...y.slice(0, t0 + 1), ...randSeq(n - t0 - 1, 10, 999)];
    for (const spec of MODEL_SPECS) {
      const a = runBacktest(spec, y, dates(n), 10, cfg({ refitEvery: 3 }));
      const b = runBacktest(spec, altered, dates(n), 10, cfg({ refitEvery: 3 }));
      const upTo = (r: typeof a) => r.steps.filter((s) => s.index <= t0).map((s) => [s.index, s.pActual, s.argmax]);
      expect(upTo(b), spec.id).toEqual(upTo(a));
      expect(upTo(a).length, spec.id).toBeGreaterThan(0);
    }
  });

  it("rolling-window training also ignores the future", () => {
    const n = 130;
    const y = randSeq(n, 10, 5);
    const altered = [...y.slice(0, 100), ...randSeq(30, 10, 77)];
    for (const spec of MODEL_SPECS) {
      const c = cfg({ trainWindow: 40, refitEvery: 2 });
      const a = runBacktest(spec, y, dates(n), 10, c).steps.filter((s) => s.index <= 99);
      const b = runBacktest(spec, altered, dates(n), 10, c).steps.filter((s) => s.index <= 99);
      expect(b.map((s) => s.pActual), spec.id).toEqual(a.map((s) => s.pActual));
    }
  });

  it("rejects a model that returns an invalid distribution", () => {
    const bad: ModelSpec = { ...spy({ fitLens: [], predLens: [], frozen: [] }), create: () => ({ fit() {}, predict: () => [0.5, 0.2] }) };
    expect(() => runBacktest(bad, randSeq(60, 10, 1), dates(60), 10, cfg())).toThrow(/invalid distribution|sums to/);
  });

  it("models abstain (insufficient data) until they have enough training observations", () => {
    const ml = getModelSpec("softmax_ml")!;
    const short = runBacktest(ml, randSeq(146, 100, 1), dates(146), 100, cfg());
    expect(short.status).toBe("insufficient_data");
    expect(short.steps).toEqual([]);
    expect(short.reason).toMatch(/1000/);
    const ok = runBacktest(ml, randSeq(146, 10, 1), dates(146), 10, cfg());
    expect(ok.status).toBe("ok");
    expect(ok.steps[0].index).toBe(100); // first step only once 100 training draws exist
    expect(ok.steps).toHaveLength(46);
  });
});

describe("metrics", () => {
  it("expected |error| of a random guess is exact", () => {
    for (const K of [10, 100]) {
      for (let a = 0; a < K; a++) {
        let brute = 0;
        for (let g = 0; g < K; g++) brute += Math.abs(g - a);
        expect(expectedRandomAbsError(K, a)).toBeCloseTo(brute / K, 10);
      }
    }
    expect(expectedRandomAbsError(10, 0)).toBeCloseTo(4.5, 10);
  });

  const steps = (n: number, p: number, hit: boolean) => Array.from({ length: n }, (_, i) => ({ index: i, date: `d${i}`, actual: 3, pActual: p, argmax: hit ? 3 : 4, rank: hit ? 1 : 7 }));
  const uni = getModelSpec("frequency")!;

  it("a model that always assigns probability 1 to the truth beats random decisively", () => {
    const m = scoreModel({ spec: uni, K: 10, steps: steps(60, 0.999, true), cfg: cfg(), seedOffset: 1 });
    expect(m.accuracy).toBe(1);
    expect(m.logLossAdvantage).toBeGreaterThan(2.2);
    expect(m.logLossAdvantageCI![0]).toBeGreaterThan(2);
    expect(m.logLossPValue).toBeLessThan(0.001);
    expect(m.accuracyPValue).toBeLessThan(1e-50);
    expect(m.maeAdvantage).toBeGreaterThan(0);
  });

  it("a model that matches the random baseline shows no advantage", () => {
    const m = scoreModel({ spec: uni, K: 10, steps: steps(60, 0.1, false), cfg: cfg(), seedOffset: 1 });
    expect(m.logLossAdvantage).toBeCloseTo(0, 10);
    expect(m.logLossPValue).toBe(1);
    expect(m.accuracy).toBe(0);
  });

  it("the uniform reference row reports analytic baseline values", () => {
    const ref = scoreModel({ spec: getModelSpec("uniform")!, K: 10, steps: steps(40, 0.1, false), cfg: cfg(), seedOffset: 1 });
    expect(ref.accuracy).toBe(0.1);
    expect(ref.logLossAdvantage).toBeCloseTo(0, 12);
    expect(ref.maeAdvantage).toBe(0);
    expect(ref.errorHistogram.reduce((a, b) => a + b.model, 0)).toBeCloseTo(1, 10);
    // the reference's top-n hit rate is analytic n/K, with no observed hit count
    expect(ref.rankHits.map((h) => [h.n, h.hits, h.rate])).toEqual([[1, null, 0.1], [3, null, 0.3], [5, null, 0.5]]);
  });

  it("top-n hit rates count how often the truth was within the model's first n ranks", () => {
    // 60 steps: rank 1 for 30 of them, rank 7 for the other 30 (K=10 → cut-offs 1, 3, 5)
    const mixed = [...steps(30, 0.5, true), ...steps(30, 0.01, false)];
    const m = scoreModel({ spec: uni, K: 10, steps: mixed, cfg: cfg(), seedOffset: 1 });
    expect(m.rankHits.map((h) => [h.n, h.hits, h.rate, h.expected])).toEqual([
      [1, 30, 0.5, 0.1],
      [3, 30, 0.5, 0.3],
      [5, 30, 0.5, 0.5],
    ]);
    for (const h of m.rankHits) {
      expect(h.ci[0]).toBeLessThanOrEqual(h.rate);
      expect(h.ci[1]).toBeGreaterThanOrEqual(h.rate);
    }
    // 100-value target uses larger cut-offs
    const big = scoreModel({ spec: uni, K: 100, steps: steps(40, 0.2, true), cfg: cfg(), seedOffset: 1 });
    expect(big.rankHits.map((h) => h.n)).toEqual([1, 5, 10, 20]);
  });

  it("backtest ranks are consistent with the argmax and computed from the pre-outcome distribution", () => {
    const y = randSeq(120, 10, 21);
    const run = runBacktest(getModelSpec("frequency")!, y, dates(120), 10, cfg());
    for (const s of run.steps) {
      expect(s.rank).toBeGreaterThanOrEqual(1);
      expect(s.rank).toBeLessThanOrEqual(10);
      expect(s.rank === 1).toBe(s.argmax === s.actual);
    }
  });

  it("error histogram shares sum to one for both the model and the random expectation", () => {
    const y = randSeq(100, 100, 4);
    const run = runBacktest(getModelSpec("frequency")!, y, dates(100), 100, cfg());
    const m = scoreModel({ spec: getModelSpec("frequency")!, K: 100, steps: run.steps, cfg: cfg(), seedOffset: 2 });
    expect(m.errorHistogram.reduce((a, b) => a + b.model, 0)).toBeCloseTo(1, 10);
    expect(m.errorHistogram.reduce((a, b) => a + b.expectedRandom, 0)).toBeCloseTo(1, 10);
    expect(m.errorHistogram).toHaveLength(10);
    expect(m.series.cumulativeLogLossAdvantage).toHaveLength(run.steps.length);
  });
});

describe("significance helpers", () => {
  it("Holm–Bonferroni adjustment", () => {
    expect(holmAdjust([0.01, 0.04, 0.03])).toEqual([0.03, 0.06, 0.06].map((v) => expect.closeTo(v, 10)));
    expect(holmAdjust([0.5])).toEqual([0.5]);
    expect(holmAdjust([])).toEqual([]);
    expect(holmAdjust([0.4, 0.9]).every((p) => p <= 1)).toBe(true);
  });
  it("sign-flip test: clearly positive → small p; symmetric noise → large p; reproducible", () => {
    const pos = Array.from({ length: 60 }, (_, i) => 0.1 + (i % 3) * 0.01);
    expect(signFlipPValue(pos, { resamples: 2000, seed: 1 })).toBeLessThan(0.001);
    const r = mulberry32(5);
    const noise = Array.from({ length: 60 }, () => r() - 0.5);
    const p = signFlipPValue(noise, { resamples: 2000, seed: 1 });
    expect(p).toBeGreaterThan(0.05);
    expect(signFlipPValue(noise, { resamples: 2000, seed: 1 })).toBe(p);
    expect(signFlipPValue([], { resamples: 10, seed: 1 })).toBe(1);
    expect(signFlipPValue([0, 0, 0], { resamples: 10, seed: 1 })).toBe(1);
  });
  it("block bootstrap CI brackets the sample mean, shrinks with n, and is reproducible", () => {
    const r = mulberry32(8);
    const xs = Array.from({ length: 100 }, () => r() - 0.5);
    const ci = blockBootstrapMeanCI(xs, { resamples: 1000, seed: 3 });
    expect(ci[0]).toBeLessThan(mean(xs));
    expect(ci[1]).toBeGreaterThan(mean(xs));
    expect(blockBootstrapMeanCI(xs, { resamples: 1000, seed: 3 })).toEqual(ci);
    const small = blockBootstrapMeanCI(xs.slice(0, 20), { resamples: 1000, seed: 3 });
    expect(small[1] - small[0]).toBeGreaterThan(ci[1] - ci[0]);
    expect(blockBootstrapMeanCI([], { resamples: 10, seed: 1 }).every(Number.isNaN)).toBe(true);
  });
});

/* ───────── experiment-level behaviour ───────── */

const drawsFrom = (values: string[]) => scheduleDraws("2024-01-01", values);
const fast = { bootstrapResamples: 300, signFlipResamples: 600 };

describe("experiment", () => {
  it("reports insufficient data instead of fabricating a result", () => {
    const r = runForecastExperiment(drawsFrom(pseudoValues(60, 1)));
    expect(r.status).toBe("insufficient_data");
    expect(r.targets).toEqual([]);
    expect(r.message).toMatch(/ข้อมูลไม่เพียงพอ/);
    expect(runForecastExperiment([]).dataRange).toEqual({ from: null, to: null, draws: 0 });
  });

  it("covers every model × target, flags ML as insufficient where data is short, and states the required warning", () => {
    const r = runForecastExperiment(drawsFrom(pseudoValues(146, 2)), { config: fast });
    expect(r.status).toBe("ok");
    expect(r.targets.map((t) => t.target)).toEqual(["last2", "tens", "units"]);
    for (const t of r.targets) {
      expect(t.models.map((m) => m.modelId)).toEqual(MODEL_SPECS.map((m) => m.id));
      expect(t.baseline.accuracy).toBe(1 / t.classes);
      expect(t.baseline.logLoss).toBeCloseTo(Math.log(t.classes), 12);
    }
    expect(r.targets[0].models.find((m) => m.modelId === "softmax_ml")).toMatchObject({ status: "insufficient_data", verdict: "insufficient_data" });
    expect(r.targets[1].models.find((m) => m.modelId === "softmax_ml")).toMatchObject({ status: "ok", nTest: 46 });
    expect(r.disclaimer).toContain(REQUIRED_WARNING);
    expect(r.multipleComparisons).toMatchObject({ method: "Holm-Bonferroni", alpha: 0.05 });
    expect(r.multipleComparisons.testsCount).toBe(r.conclusion.testsCount);
    expect(r.limitations.length).toBeGreaterThan(3);
  });

  it("is deterministic (same data → same report) and respects the target filter", () => {
    const d = drawsFrom(pseudoValues(120, 3));
    const a = runForecastExperiment(d, { config: fast, targets: ["tens"] });
    const b = runForecastExperiment(d, { config: fast, targets: ["tens"] });
    expect(a.targets).toHaveLength(1);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b).replace(/"generatedAt":"[^"]*"/, ""));
  });

  it("detects genuine structure (the machinery has power): a deterministic cycle in the tens digit", () => {
    // tens digit cycles 0,1,2,…,9 → a Markov model should predict it almost perfectly
    const values = Array.from({ length: 130 }, (_, i) => `00${i % 10}${(i * 7) % 10}`);
    const r = runForecastExperiment(drawsFrom(values), { config: fast, targets: ["tens"] });
    const markov = r.targets[0].models.find((m) => m.modelId === "markov1")!;
    expect(markov.accuracy).toBeGreaterThan(0.9);
    expect(markov.verdict).toBe("evidence_better_than_random");
    expect(markov.logLossAdjustedPValue).toBeLessThan(0.05);
    expect(r.targets[0].models.find((m) => m.modelId === "uniform")!.verdict).toBe("reference");
    expect(r.conclusion.evidenceCount).toBeGreaterThan(0);
  });

  it("under pure randomness the family-wise false-positive rate stays near/below the nominal level", () => {
    // Synthetic uniform sequences are used ONLY to calibrate the testing procedure; never displayed as lottery data.
    let flagged = 0;
    const runs = 40;
    for (let s = 1; s <= runs; s++) {
      const r = runForecastExperiment(drawsFrom(pseudoValues(140, 1000 + s)), { config: { ...fast, minTrain: 50 } });
      if (r.conclusion.evidenceCount > 0) flagged++;
    }
    // Holm controls FWER at 5% → expect ≈2 of 40; allow generous slack for the bootstrap approximation.
    expect(flagged / runs).toBeLessThanOrEqual(0.15);
  }, 120_000);

  it("does not let a model that overfits look good: worse-than-random is reported as such", () => {
    const r = runForecastExperiment(drawsFrom(pseudoValues(146, 2)), { config: fast });
    const verdicts = new Set(r.targets.flatMap((t) => t.models.map((m) => m.verdict)));
    expect(verdicts.has("worse_than_random")).toBe(true);
  });
});

describe("safety: the backtest section carries scores only; numbers for the next draw are opt-in", () => {
  const report = runForecastExperiment(drawsFrom(pseudoValues(146, 2)), { config: fast });
  const ALLOWED_MODEL_KEYS = [
    "modelId", "name", "family", "description", "limitations", "status", "reason", "nTest", "accuracy", "accuracyCI", "accuracyPValue",
    "accuracyAdjustedPValue", "logLoss", "logLossAdvantage", "logLossAdvantageCI", "logLossPValue", "logLossAdjustedPValue", "mae",
    "maeAdvantage", "rankHits", "verdict", "series", "errorHistogram",
  ].sort();

  it("without an explicit opt-in the report has no next-draw section at all", () => {
    expect(report.nextDraw).toBeNull();
    expect(JSON.stringify(report).toLowerCase()).not.toContain("ranking");
  });
  it("model results expose only scores and uncertainty", () => {
    for (const t of report.targets) for (const m of t.models) expect(Object.keys(m).sort()).toEqual(ALLOWED_MODEL_KEYS);
  });
  it("series contain only dates (of already-known draws) and aggregate error values", () => {
    const lastKnown = report.dataRange.to as string;
    for (const t of report.targets)
      for (const m of t.models) {
        for (const p of m.series.cumulativeLogLossAdvantage) {
          expect(Object.keys(p).sort()).toEqual(["date", "value"]);
          expect(p.date <= lastKnown).toBe(true);
        }
        for (const p of m.series.rollingMae) expect(p.date <= lastKnown).toBe(true);
        for (const b of m.errorHistogram) expect(Object.keys(b).sort()).toEqual(["expectedRandom", "label", "model"]);
        for (const h of m.rankHits) expect(Object.keys(h).sort()).toEqual(["ci", "expected", "hits", "n", "rate"]);
      }
  });
  it("the backtest part has no field that could carry a recommended/predicted number", () => {
    const json = JSON.stringify(report.targets);
    for (const forbidden of ["nextDraw", "next_draw", "prediction", "predicted", "recommend", "topPick", "hotNumber", "luckyNumber", "rankedNumbers", "ranking", "shortlist"]) {
      expect(json.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });
  it("a single-draw extension in the data only extends the test window by one scored step", () => {
    const base = pseudoValues(140, 9);
    const r1 = runForecastExperiment(drawsFrom(base), { config: fast, targets: ["tens"] });
    const r2 = runForecastExperiment(drawsFrom([...base, "0000"]), { config: fast, targets: ["tens"] });
    expect(r2.targets[0].testSteps).toBe(r1.targets[0].testSteps + 1);
  });
  it("unrelated: mkDraw is consistent with the 4/3/2-digit convention used by the experiment", () => {
    const d = mkDraw("2026-01-02", "0702");
    expect([d.result3, d.result2]).toEqual(["702", "02"]);
  });
});
