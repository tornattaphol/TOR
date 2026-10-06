import { describe, expect, it } from "vitest";
import {
  competitionRanks,
  DEFAULT_BACKTEST,
  nextScheduledDate,
  orderByProbability,
  positionOf,
  rankCutoffs,
  runForecastExperiment,
  shortlistSize,
  trimNextDraw,
  valueLabel,
  type ForecastReport,
  type ModelNextDraw,
} from "../../src/lib/forecasting";
import { getModelSpec } from "../../src/lib/forecasting/models";
import { mulberry32 } from "../../src/lib/math";
import { pseudoValues, scheduleDraws } from "../helpers/fixtures";

const drawsFrom = (values: string[]) => scheduleDraws("2024-01-01", values);
const fast = { bootstrapResamples: 300, signFlipResamples: 600 };
const run = (values: string[], over: { config?: Record<string, unknown>; targets?: ("last2" | "tens" | "units")[]; resamples?: number; today?: string } = {}): ForecastReport =>
  runForecastExperiment(drawsFrom(values), {
    config: { ...fast, ...over.config },
    targets: over.targets,
    nextDraw: { resamples: over.resamples ?? 40, ...(over.today ? { today: over.today } : {}) },
  });
const model = (r: ForecastReport, target: string, id: string): ModelNextDraw => r.nextDraw!.targets.find((t) => t.target === target)!.models.find((m) => m.modelId === id)!;

describe("ranking helpers", () => {
  it("orders by probability, breaking ties by value ascending", () => {
    expect(orderByProbability([0.1, 0.4, 0.4, 0.1])).toEqual([1, 2, 0, 3]);
  });

  it("positionOf agrees with the ordered list for random vectors that contain ties", () => {
    const rng = mulberry32(3);
    for (let trial = 0; trial < 50; trial++) {
      const K = trial % 2 ? 10 : 100;
      const raw = Array.from({ length: K }, () => Math.floor(rng() * 6) + 1); // many exact ties
      const total = raw.reduce((a, b) => a + b, 0);
      const p = raw.map((v) => v / total);
      const order = orderByProbability(p);
      for (let v = 0; v < K; v++) expect(positionOf(p, v)).toBe(order.indexOf(v) + 1);
    }
  });

  it("assigns competition ranks (1,2,2,4) and marks tie groups", () => {
    const p = [0.4, 0.3, 0.3, 0.1];
    const ranks = competitionRanks(p, orderByProbability(p));
    expect(ranks).toEqual([
      { rank: 1, tied: false },
      { rank: 2, tied: true },
      { rank: 2, tied: true },
      { rank: 4, tied: false },
    ]);
  });

  it("treats probabilities that differ only by float noise as equal", () => {
    const p = [0.25 + 1e-15, 0.25, 0.25 - 1e-15, 0.25];
    expect(competitionRanks(p, orderByProbability(p)).every((r) => r.rank === 1 && r.tied)).toBe(true);
  });

  it("sizes shortlists/cut-offs by target and pads labels", () => {
    expect([shortlistSize(100), shortlistSize(10)]).toEqual([10, 3]);
    expect(rankCutoffs(100)).toEqual([1, 5, 10, 20]);
    expect(rankCutoffs(10)).toEqual([1, 3, 5]);
    expect([valueLabel(7, 100), valueLabel(42, 100), valueLabel(7, 10)]).toEqual(["07", "42", "7"]);
  });
});

describe("next scheduled draw date", () => {
  it("returns the first scheduled weekday strictly after the latest draw", () => {
    expect(nextScheduledDate("2026-10-02", [1, 3, 5])).toBe("2026-10-05"); // Fri → Mon
    expect(nextScheduledDate("2026-10-05", [1, 3, 5])).toBe("2026-10-07"); // Mon → Wed
    expect(nextScheduledDate("2026-10-07", [1, 3, 5])).toBe("2026-10-09"); // Wed → Fri
    expect(nextScheduledDate("2026-10-06", [1, 3, 5])).toBe("2026-10-07"); // off-schedule date
    expect(nextScheduledDate("2026-10-02", [])).toBeNull();
  });
});

describe("next-draw report", () => {
  const values = pseudoValues(146, 2);
  const r = run(values);

  it("is opt-in and null when the experiment has too little data", () => {
    expect(runForecastExperiment(drawsFrom(values), { config: fast }).nextDraw).toBeNull();
    expect(runForecastExperiment(drawsFrom(pseudoValues(60, 1)), { nextDraw: {} }).nextDraw).toBeNull();
  });

  it("covers every target and every non-reference model, with metadata about the training data", () => {
    const nd = r.nextDraw!;
    expect(nd.targets.map((t) => t.target)).toEqual(["last2", "tens", "units"]);
    expect(nd.basedOnDraws).toBe(146);
    expect(nd.latestDrawDate).toBe(r.dataRange.to);
    expect(nd.nextScheduledDate! > nd.latestDrawDate).toBe(true);
    expect(nd.bootstrapResamples).toBe(40);
    for (const t of nd.targets) expect(t.models.map((m) => m.modelId)).not.toContain("uniform");
    expect(nd.notes.length).toBeGreaterThan(3);
  });

  it("each ranking is a complete, sorted, normalised distribution with sane uncertainty", () => {
    for (const t of r.nextDraw!.targets) {
      for (const m of t.models.filter((x) => x.status === "ok")) {
        expect(m.ranking).toHaveLength(t.classes);
        expect(new Set(m.ranking.map((x) => x.value)).size).toBe(t.classes);
        expect(m.ranking.reduce((s, x) => s + x.probability, 0)).toBeCloseTo(1, 9);
        for (let i = 1; i < m.ranking.length; i++) expect(m.ranking[i].probability).toBeLessThanOrEqual(m.ranking[i - 1].probability + 1e-12);
        expect(m.ranking[0].rank).toBe(1);
        for (const x of m.ranking) {
          expect(x.vsRandom).toBeCloseTo(x.probability * t.classes, 9);
          expect(x.interval[0]).toBeLessThanOrEqual(x.interval[1]);
          expect(x.shortlistShare).toBeGreaterThanOrEqual(0);
          expect(x.shortlistShare).toBeLessThanOrEqual(1);
          expect(x.label).toHaveLength(t.classes === 100 ? 2 : 1);
        }
        // every bootstrap resample puts exactly `shortlistSize` values in its shortlist
        expect(m.ranking.reduce((s, x) => s + x.shortlistShare, 0)).toBeCloseTo(t.shortlistSize, 9);
        expect(m.distanceFromUniform).toBeGreaterThanOrEqual(0);
        expect(m.distanceFromUniform).toBeLessThan(1);
      }
    }
  });

  it("every ranking carries the verdict of the same model on the same target in the backtest", () => {
    for (const t of r.nextDraw!.targets) {
      const bt = r.targets.find((x) => x.target === t.target)!;
      for (const m of t.models) {
        const same = bt.models.find((x) => x.modelId === m.modelId)!;
        expect(m.verdict).toBe(same.verdict);
        expect(m.logLossAdvantage).toBe(same.logLossAdvantage);
      }
    }
  });

  it("models without enough training data give no ranking (and say why) instead of an unreliable one", () => {
    const ml = model(r, "last2", "softmax_ml"); // needs max(100, 10·100) draws
    expect(ml).toMatchObject({ status: "insufficient_data", ranking: [], distanceFromUniform: null, verdict: "insufficient_data" });
    expect(ml.reason).toMatch(/ต้องใช้ข้อมูลฝึกอย่างน้อย/);
    expect(model(r, "tens", "softmax_ml").status).toBe("ok");
  });

  it("the headline model is the one with the best backtest log-loss advantage among models with a real verdict", () => {
    for (const t of r.nextDraw!.targets) {
      const eligible = t.models.filter((m) => m.status === "ok" && m.verdict !== "insufficient_data" && m.logLossAdvantage !== null);
      const best = eligible.reduce((a, b) => (b.logLossAdvantage! > a.logLossAdvantage! ? b : a));
      expect(t.recommendedModelId).toBe(best.modelId);
      expect(t.selectionRule).toMatch(/ย้อนหลัง/);
    }
  });

  it("is deterministic for the same data and configuration", () => {
    const again = run(values);
    expect(JSON.stringify(again.nextDraw)).toBe(JSON.stringify(r.nextDraw));
  });

  it("depends on the data: a different history gives a different ranking", () => {
    const other = run(pseudoValues(146, 3));
    expect(JSON.stringify(other.nextDraw!.targets[0].models[0].ranking)).not.toBe(JSON.stringify(r.nextDraw!.targets[0].models[0].ranking));
  });

  it("trimNextDraw keeps only the best n of every ranking and leaves the full report untouched", () => {
    const trimmed = trimNextDraw(r.nextDraw!, 3);
    for (const t of trimmed.targets) for (const m of t.models) expect(m.ranking.length).toBeLessThanOrEqual(3);
    expect(trimmed.targets[0].models[0].ranking).toEqual(r.nextDraw!.targets[0].models[0].ranking.slice(0, 3));
    expect(r.nextDraw!.targets[0].models[0].ranking).toHaveLength(100);
  });

  it("flags a stale dataset when the next scheduled draw date has already passed", () => {
    const next = r.nextDraw!.nextScheduledDate!;
    expect(run(values, { today: next }).nextDraw!.scheduledDatePassed).toBe(false); // draw day itself is not "passed"
    expect(run(values, { today: "2099-01-01" }).nextDraw!.scheduledDatePassed).toBe(true);
    expect(r.nextDraw!.scheduledDatePassed).toBe(false); // no `today` given → no judgement
  });
});

describe("next-draw ranking reflects what the models actually learned", () => {
  it("frequency model ranks values by smoothed historical count", () => {
    // tens digit history with distinct counts: 7×60, 3×30, 5×10, others 0 → order 7, 3, 5, then ties (ascending)
    const tens = [...Array(60).fill(7), ...Array(30).fill(3), ...Array(10).fill(5)];
    const rng = mulberry32(9);
    for (let i = tens.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [tens[i], tens[j]] = [tens[j], tens[i]];
    }
    const r = run(tens.map((d) => `00${d}0`), { targets: ["tens"] });
    const m = model(r, "tens", "frequency");
    expect(m.ranking.slice(0, 3).map((x) => x.value)).toEqual([7, 3, 5]);
    // Laplace α=1: (60+1)/(100+10) for the leader (the 0.1% uniform mix is applied afterwards)
    expect(m.ranking[0].probability).toBeCloseTo(0.999 * (61 / 110) + 0.001 / 10, 6);
    // unseen digits are tied and ordered by value, flagged as tied
    const unseen = m.ranking.slice(3);
    expect(unseen.map((x) => x.value)).toEqual([0, 1, 2, 4, 6, 8, 9]);
    expect(unseen.every((x) => x.tied && x.rank === 4)).toBe(true);
  });

  it("the rolling window restricts what the model learns from", () => {
    const early = Array(70).fill(2); // tens digit 2 for the first 70 draws …
    const late = Array.from({ length: 60 }, (_, i) => (i % 2 ? 8 : 9)); // … then only 8s and 9s
    const vals = [...early, ...late].map((d) => `00${d}0`);
    const expanding = run(vals, { targets: ["tens"] });
    const rolling = run(vals, { targets: ["tens"], config: { trainWindow: 60 } });
    expect(model(expanding, "tens", "frequency").ranking[0].value).toBe(2);
    expect([8, 9]).toContain(model(rolling, "tens", "frequency").ranking[0].value);
    expect(model(rolling, "tens", "frequency").ranking.find((x) => x.value === 2)!.probability).toBeLessThan(0.02); // 1/70 smoothed, vs 70/130 when expanding
  });

  it("a deterministic cycle is ranked correctly and flagged as better than random (the machinery has power)", () => {
    // tens digit cycles 0,1,…,9 → after 130 draws (…,9) the next value is 0
    const values = Array.from({ length: 130 }, (_, i) => `00${i % 10}${(i * 7) % 10}`);
    const r = run(values, { targets: ["tens"], resamples: 60 });
    const m = model(r, "tens", "markov1");
    expect(m.verdict).toBe("evidence_better_than_random");
    expect(m.ranking[0]).toMatchObject({ value: 0, rank: 1 });
    // 13 observed "9 → next" transitions, all followed by 0, smoothed towards the overall frequency (β = 5)
    expect(m.ranking[0].probability).toBeGreaterThan(0.7);
    expect(m.ranking[0].shortlistShare).toBeGreaterThanOrEqual(0.9); // stable under resampling
    expect(m.ranking[0].interval[0]).toBeGreaterThan(0.4);
    expect(m.distanceFromUniform).toBeGreaterThan(0.5);
    expect(r.nextDraw!.targets[0].recommendedModelId).not.toBeNull();
  });

  it("under pure randomness no model is flagged and the rankings are unstable", () => {
    const flaggedModels = new Set<string>();
    let instability = 0;
    let n = 0;
    for (let s = 1; s <= 6; s++) {
      const r = run(pseudoValues(146, 500 + s), { targets: ["tens"], resamples: 40 });
      for (const m of r.nextDraw!.targets[0].models.filter((x) => x.status === "ok")) {
        if (m.verdict === "evidence_better_than_random") flaggedModels.add(`${s}:${m.modelId}`);
        // share of resamples in which the leading value stayed in the shortlist: far from certain on random data
        instability += 1 - m.ranking[0].shortlistShare;
        n++;
      }
    }
    expect([...flaggedModels]).toEqual([]);
    expect(instability / n).toBeGreaterThan(0.02);
  });
});

describe("rank-based backtest evidence matches the displayed ranking", () => {
  it("the top-n hit rate the report states is reproducible from the model", () => {
    const values = pseudoValues(146, 8);
    const r = runForecastExperiment(drawsFrom(values), { config: { ...fast, minTrain: 50 }, targets: ["tens"], models: ["frequency"] });
    const freq = r.targets[0].models.find((m) => m.modelId === "frequency")!;
    // brute force: replay the walk-forward with the same learner and count top-3 hits
    const spec = getModelSpec("frequency")!;
    const y = values.map((v) => Math.floor(Number(v.slice(2)) / 10));
    let hits = 0;
    let steps = 0;
    for (let t = DEFAULT_BACKTEST.minTrain; t < y.length; t++) {
      const h = y.slice(0, t);
      if (h.length < spec.minTrain(10)) continue;
      const learner = spec.create(10);
      learner.fit(h);
      const order = orderByProbability(learner.predict(h, mulberry32(1)));
      if (order.slice(0, 3).includes(y[t])) hits++;
      steps++;
    }
    const reported = freq.rankHits.find((x) => x.n === 3)!;
    expect(reported.hits).toBe(hits);
    expect(freq.nTest).toBe(steps);
  });
});
