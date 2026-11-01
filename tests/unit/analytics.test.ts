import { describe, expect, it } from "vitest";
import {
  buildAnalytics,
  chiSquareUniform,
  differenceStats,
  digitDistribution,
  frequencyTable,
  movingAverage,
  movingDigitFrequency,
  repeatStats,
  selectDraws,
  toPoints,
  valueHistogram,
  windowStats,
} from "../../src/lib/analytics";
import { mkDraw, pseudoValues, scheduleDraws } from "../helpers/fixtures";

const pts = (values: string[]) => values.map((value, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, value }));

describe("selection", () => {
  const draws = scheduleDraws("2026-01-02", ["1111", "2222", "3333", "4444", "5555"]);
  it("filters by date range then keeps last N, ascending", () => {
    expect(selectDraws(draws, { from: draws[1].drawDate, to: draws[3].drawDate }).map((d) => d.result4)).toEqual(["2222", "3333", "4444"]);
    expect(selectDraws(draws, { last: 2 }).map((d) => d.result4)).toEqual(["4444", "5555"]);
    expect(selectDraws([...draws].reverse(), { last: 3 }).map((d) => d.result4)).toEqual(["3333", "4444", "5555"]);
    expect(selectDraws(draws, { last: 100 })).toHaveLength(5);
    expect(selectDraws(draws, { from: "2099-01-01" })).toEqual([]);
  });

  it("applies the date range before 'last N'", () => {
    expect(selectDraws(draws, { to: draws[2].drawDate, last: 2 }).map((d) => d.result4)).toEqual(["2222", "3333"]);
  });

  it("extracts the requested prize digits and skips unpublished ones", () => {
    const d = [mkDraw("2026-01-02", "0702"), { ...mkDraw("2026-01-05", "1234"), result4: null, result3: null }];
    expect(toPoints(d, "4").map((p) => p.value)).toEqual(["0702"]);
    expect(toPoints(d, "3").map((p) => p.value)).toEqual(["702"]);
    expect(toPoints(d, "2").map((p) => p.value)).toEqual(["02", "34"]);
  });
});

describe("frequency table", () => {
  const t = frequencyTable(pts(["07", "07", "12", "99", "07", "12"]), 2, 2);
  it("counts, ranks and shares", () => {
    expect(t.total).toBe(6);
    expect(t.distinct).toBe(3);
    expect(t.possible).toBe(100);
    expect(t.entries).toEqual([
      { value: "07", count: 3, share: 0.5 },
      { value: "12", count: 2, share: 2 / 6 },
      { value: "99", count: 1, share: 1 / 6 },
    ]);
    expect(t.mostFrequent.map((e) => e.value)).toEqual(["07", "12"]);
    expect(t.leastFrequent.map((e) => e.value)).toEqual(["99", "12"]);
  });
  it("builds the 00–99 grid and the unobserved list (2-digit only)", () => {
    expect(t.grid).toHaveLength(100);
    expect(t.grid?.[7]).toBe(3);
    expect(t.grid?.[12]).toBe(2);
    expect(t.grid?.[99]).toBe(1);
    expect(t.grid?.reduce((a, b) => a + b, 0)).toBe(6);
    expect(t.unobserved).toHaveLength(97);
    expect(t.unobserved).not.toContain("07");
    expect(frequencyTable(pts(["123"]), 3).grid).toBeNull();
  });
  it("breaks ties by value so output is deterministic", () => {
    const tie = frequencyTable(pts(["20", "10", "30"]), 2);
    expect(tie.entries.map((e) => e.value)).toEqual(["10", "20", "30"]);
  });
  it("handles empty input", () => {
    const e = frequencyTable([], 2);
    expect(e.total).toBe(0);
    expect(e.entries).toEqual([]);
    expect(e.mostFrequent).toEqual([]);
  });
});

describe("digit distribution", () => {
  it("counts per position and overall", () => {
    const d = digitDistribution(pts(["07", "17", "28", "00"]), 2);
    expect(d.positions[0].label).toBe("หลักสิบ");
    expect(d.positions[1].label).toBe("หลักหน่วย");
    expect(d.positions[0].counts).toEqual([2, 1, 1, 0, 0, 0, 0, 0, 0, 0]); // tens: 0,1,2,0
    expect(d.positions[1].counts).toEqual([1, 0, 0, 0, 0, 0, 0, 2, 1, 0]); // units: 7,7,8,0
    expect(d.positions[0].shares[0]).toBe(0.5);
    expect(d.overall.total).toBe(8);
    expect(d.overall.counts[0]).toBe(3);
    expect(d.overall.counts[7]).toBe(2);
  });
  it("supports 3 and 4 digits with proper labels", () => {
    expect(digitDistribution(pts(["123"]), 3).positions.map((p) => p.label)).toEqual(["หลักร้อย", "หลักสิบ", "หลักหน่วย"]);
    expect(digitDistribution(pts(["1234"]), 4).positions.map((p) => p.label)).toEqual(["หลักพัน", "หลักร้อย", "หลักสิบ", "หลักหน่วย"]);
  });
  it("chi-square: perfectly uniform → statistic 0, p=1; skewed → small p", () => {
    const uniform = chiSquareUniform(new Array(10).fill(10));
    expect(uniform.statistic).toBe(0);
    expect(uniform.pValue).toBeCloseTo(1, 10);
    expect(uniform.approximationValid).toBe(true);
    const skew = chiSquareUniform([100, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(skew.statistic).toBeCloseTo(900, 6);
    expect(skew.pValue).toBeLessThan(1e-100);
    // hand-computed: counts [20,10,10,10,10,10,10,10,10,10], n=110, e=11 → Σ = (81+9*1)/11 = 8.1818
    const mild = chiSquareUniform([20, 10, 10, 10, 10, 10, 10, 10, 10, 10]);
    expect(mild.statistic).toBeCloseTo(90 / 11, 8);
    expect(mild.df).toBe(9);
  });
  it("flags small expected counts as an invalid approximation", () => {
    expect(chiSquareUniform([1, 0, 2, 0, 1, 0, 0, 1, 0, 0]).approximationValid).toBe(false);
  });
});

describe("repeats", () => {
  it("counts consecutive repeats with examples", () => {
    const r = repeatStats(pts(["07", "07", "12", "12", "12", "07"]), 2);
    expect(r.consecutive.count).toBe(3);
    expect(r.consecutive.opportunities).toBe(5);
    expect(r.consecutive.rate).toBeCloseTo(0.6, 10);
    expect(r.consecutive.expectedRate).toBe(0.01);
    expect(r.consecutive.examples).toHaveLength(3);
    expect(r.consecutive.examples[0]).toMatchObject({ date: "2026-01-02", previousDate: "2026-01-01", value: "07" });
  });
  it("lists repeated values and gap statistics", () => {
    const r = repeatStats(pts(["07", "12", "07", "99", "07"]), 2);
    expect(r.distinctRepeated).toBe(1);
    expect(r.repeatedValues).toEqual([{ value: "07", count: 3, dates: ["2026-01-01", "2026-01-03", "2026-01-05"] }]);
    expect(r.gaps).toEqual({ count: 2, min: 2, median: 2, mean: 2, max: 2 });
  });
  it("counts double-digit numbers", () => {
    const r = repeatStats(pts(["11", "12", "77", "00"]), 2);
    expect(r.doubleDigits).toEqual({ count: 3, share: 0.75, expectedShare: 0.1 });
    expect(repeatStats(pts(["111", "123"]), 3).doubleDigits?.expectedShare).toBeCloseTo(0.01, 10);
  });
  it("has no gaps when nothing repeats", () => {
    expect(repeatStats(pts(["01", "02", "03"]), 2).gaps).toBeNull();
  });
  it("handles 0 and 1 observation", () => {
    expect(repeatStats([], 2).consecutive).toMatchObject({ count: 0, opportunities: 0, rate: 0 });
    expect(repeatStats(pts(["05"]), 2).consecutive.opportunities).toBe(0);
  });
});

describe("differences between draws", () => {
  it("computes signed and absolute differences", () => {
    const d = differenceStats(pts(["10", "25", "20", "20"]), 2);
    expect(d.series.map((s) => s.diff)).toEqual([null, 15, -5, 0]);
    expect(d.series.map((s) => s.absDiff)).toEqual([null, 15, 5, 0]);
    expect(d.summary).toMatchObject({ count: 3, meanAbs: 20 / 3, medianAbs: 5, maxAbs: 15 });
    expect(d.summary?.meanSigned).toBeCloseTo(10 / 3, 10);
  });
  it("expected mean |X−Y| for independent uniform on 0..99 is (N²−1)/(3N)", () => {
    const d = differenceStats(pts(["10", "25"]), 2);
    expect(d.summary?.expectedMeanAbsUniform).toBeCloseTo(9999 / 300, 10);
  });
  it("bins absolute differences into 10 equal-width bins", () => {
    const d = differenceStats(pts(["00", "05", "50", "99"]), 2); // abs: 5, 45, 49
    expect(d.histogram).toHaveLength(10);
    expect(d.histogram[0]).toMatchObject({ label: "0–9", count: 1 });
    expect(d.histogram[4]).toMatchObject({ label: "40–49", count: 2 });
    expect(d.histogram.reduce((a, b) => a + b.count, 0)).toBe(3);
  });
  it("has no summary with fewer than two draws", () => {
    expect(differenceStats(pts(["10"]), 2).summary).toBeNull();
  });
});

describe("value histogram", () => {
  it("bins values and gives the uniform expectation", () => {
    const h = valueHistogram(pts(["00", "09", "10", "99", "55"]), 2);
    expect(h[0].count).toBe(2);
    expect(h[1].count).toBe(1);
    expect(h[5].count).toBe(1);
    expect(h[9].count).toBe(1);
    expect(h.every((b) => b.expected === 0.5)).toBe(true);
    expect(valueHistogram(pts(["0999"]), 4)[0].label).toBe("0–999");
  });
});

describe("windows and moving statistics", () => {
  const values = pseudoValues(120, 7).map((v) => v.slice(2));
  const points = pts(values.slice(0, 31)); // dates only go to 31
  it("window stats cover the most recent N draws and flag short history", () => {
    const w = windowStats(points, 2, [10, 50]);
    expect(w[0]).toMatchObject({ size: 10, complete: true, count: 10, from: points[21].date, to: points[30].date });
    expect(w[1]).toMatchObject({ size: 50, complete: false, count: 31 });
    expect(w[0].top.length).toBeLessThanOrEqual(5);
    expect(w[0].positions).toHaveLength(2);
    expect(windowStats([], 2, [10])[0]).toMatchObject({ count: 0, from: null, to: null, complete: false });
  });
  it("window counts agree with a direct frequency table", () => {
    const [w] = windowStats(points, 2, [20]);
    const direct = frequencyTable(points.slice(-20), 2, 5);
    expect(w.top).toEqual(direct.mostFrequent);
  });
  it("moving digit frequency emits only full windows", () => {
    const m = movingDigitFrequency(pts(["10", "20", "30", "10", "11"]), 2, 3);
    expect(m.window).toBe(3);
    const tens = m.positions[0].points;
    expect(tens).toHaveLength(3);
    // first window "10,20,30" → tens digits 1,2,3
    expect(tens[0]).toMatchObject({ date: "2026-01-03", d1: 1 / 3, d2: 1 / 3, d3: 1 / 3, d0: 0 });
    // last window "30,10,11" → tens digits 3,1,1
    expect(tens[2]).toMatchObject({ date: "2026-01-05", d1: 2 / 3, d3: 1 / 3, d2: 0 });
    for (const row of tens) expect(Object.entries(row).filter(([k]) => /^d[0-9]$/.test(k)).reduce((a, [, v]) => a + Number(v), 0)).toBeCloseTo(1, 10);
  });
  it("no moving points when history is shorter than the window", () => {
    expect(movingDigitFrequency(pts(["10", "20"]), 2, 5).positions[0].points).toEqual([]);
  });
  it("moving average is trailing and null until the window fills", () => {
    expect(movingAverage([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
    expect(movingAverage([], 3)).toEqual([]);
  });
});

describe("analytics bundle", () => {
  const draws = scheduleDraws("2026-01-02", pseudoValues(40, 3));
  it("assembles every section consistently", () => {
    const b = buildAnalytics(draws, { prize: "2", last: 20 }, { movingWindow: 5 });
    expect(b.selection).toMatchObject({ prize: "2", digits: 2, drawCount: 20, last: 20 });
    expect(b.selection.firstDate).toBe(draws[20].drawDate);
    expect(b.selection.lastDate).toBe(draws[39].drawDate);
    expect(b.frequency.total).toBe(20);
    expect(b.trend).toHaveLength(20);
    expect(b.trend[3].movingAverage).toBeNull();
    expect(b.trend[4].movingAverage).not.toBeNull();
    expect(b.windows.map((w) => w.size)).toEqual([10, 20, 50, 100]);
    expect(b.moving.window).toBe(5);
    expect(b.digitDistribution.positions).toHaveLength(2);
    expect(b.histogram.reduce((a, x) => a + x.count, 0)).toBe(20);
  });
  it("works for 3 and 4 digit prizes and rejects unknown ones", () => {
    expect(buildAnalytics(draws, { prize: "3" }).selection.digits).toBe(3);
    expect(buildAnalytics(draws, { prize: "4" }).digitDistribution.positions).toHaveLength(4);
    expect(() => buildAnalytics(draws, { prize: "5" as never })).toThrow(RangeError);
  });
  it("returns an empty (not failing) bundle for no data", () => {
    const b = buildAnalytics([], { prize: "2" });
    expect(b.selection).toMatchObject({ drawCount: 0, firstDate: null, lastDate: null });
    expect(b.frequency.entries).toEqual([]);
    expect(b.trend).toEqual([]);
  });
  it("does not mutate its input", () => {
    const copy = JSON.stringify(draws);
    buildAnalytics(draws, { prize: "2", last: 10 });
    expect(JSON.stringify(draws)).toBe(copy);
  });
});
